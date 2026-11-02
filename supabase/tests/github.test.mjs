import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('GitHub service-only storage and OAuth lifecycle', async t => {
  const db = new PGlite();
  const admin = '00000000-0000-0000-0000-000000000001';
  const member = '00000000-0000-0000-0000-000000000002';
  const missing = '00000000-0000-0000-0000-000000000099';
  const gen1 = '10000000-0000-0000-0000-000000000001';
  const gen2 = '10000000-0000-0000-0000-000000000002';
  const hash1 = 'a'.repeat(64), hash2 = 'b'.repeat(64);
  const ticketHash = 'd'.repeat(64);
  const sha1 = 'a'.repeat(40), sha2 = 'b'.repeat(40);
  const tables = ['github_connections', 'github_oauth_states', 'github_repositories', 'github_commit_links'];
  const existing = ['profiles', 'customers', 'customer_members', 'requests', 'request_activities', 'request_attachments'];
  const snapshot = async () => Promise.all(existing.map(async table => (await db.query(`select to_jsonb(t) as value from public.${table} t order by to_jsonb(t)::text`)).rows));
  const role = async (name, uid = '') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    if (name) await db.exec(`set role ${name}`);
  };
  const begin = (uid = member, gen = gen1, hash = hash1, expires = '2999-01-01T00:00:00Z') =>
    db.query('select public.github_begin_oauth($1,$2,$3,$4,$5,$6)', [uid, gen, hash, 'pkce-verifier', 'https://example.test/#/commits', expires]);
  const consume = hash => db.query('delete from public.github_oauth_states where state_hash=$1 and expires_at>now() and code_ciphertext is null returning *', [hash]);
  const complete = (hash, uid = member) => db.query('delete from public.github_oauth_states where state_hash=$1 and user_id=$2 and expires_at>now() and code_ciphertext is not null returning *', [hash, uid]);
  const stage = async (uid = member, gen = gen1, hash = ticketHash, expires = '2999-01-01T00:00:00Z') =>
    (await db.query('select public.github_stage_oauth($1,$2,$3,$4,$5,$6,$7) as staged', [uid, gen, hash, 'pkce-verifier', 'https://example.test/#/commits', expires, 'encrypted-code'])).rows[0].staged;
  let customer, repository, before;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text unique, metadata jsonb);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert,delete on storage.objects to authenticated;
    `);
    await db.exec(await readFile(new URL('../migrations/202610290001_tracker.sql', import.meta.url), 'utf8'));
    await db.query("insert into auth.users(id,email) values ($1,'admin@test.local'),($2,'member@test.local')", [admin, member]);
    await db.query("update public.profiles set is_active=true,role=case when id=$1 then 'admin' else 'member' end", [admin]);
    customer = (await db.query("insert into public.customers(name,code) values ('Fixture','FIX') returning id")).rows[0].id;
    await db.query('insert into public.customer_members(customer_id,user_id) values ($1,$2)', [customer, member]);
    await db.query("insert into public.requests(customer_id,title,description,requested_on,created_by,updated_by) values ($1,'Existing','Keep this request','2026-11-01',$2,$2)", [customer, member]);
    before = await snapshot();
    await db.exec(await readFile(new URL('../migrations/202611020001_github.sql', import.meta.url), 'utf8'));

    await t.test('migration preserves existing customer and request data', async () => {
      assert.deepEqual(await snapshot(), before);
      assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='public' and tablename like 'github_%' and rowsecurity")).rows[0].n, 4);
    });
    await t.test('service can start OAuth and register a repository', async () => {
      await role('service_role');
      await begin();
      const row = (await db.query('select * from public.github_connections where user_id=$1', [member])).rows[0];
      assert.equal(row.generation, gen1); assert.equal(row.token_ciphertext, null);
      repository = (await db.query('insert into public.github_repositories(customer_id,github_id,full_name,created_by) values ($1,123,$2,$3) returning *', [customer, 'test-owner/private.repo', admin])).rows[0];
      assert.equal(repository.default_branch, 'main'); assert.equal(repository.is_active, true);
      await db.query('insert into public.github_commit_links(repository_id,base_branch,target_branch,source_sha,target_sha,confirmed_by) values ($1,$2,$3,$4,$5,$6)', [repository.id, 'main', 'release', sha1, sha2, member]);
    });
    await t.test('anon and authenticated members and admins cannot access any GitHub table or RPC', async () => {
      for (const [name, uid] of [['anon', ''], ['authenticated', member], ['authenticated', admin]]) {
        await role(name, uid);
        for (const table of tables) {
          await assert.rejects(() => db.query(`select * from public.${table}`), /permission denied/);
          await assert.rejects(() => db.query(`insert into public.${table} default values`), /permission denied/);
          await assert.rejects(() => db.query(`update public.${table} set ${table === 'github_connections' || table === 'github_oauth_states' ? 'user_id=user_id' : table === 'github_repositories' ? 'id=id' : 'repository_id=repository_id'}`), /permission denied/);
          await assert.rejects(() => db.query(`delete from public.${table}`), /permission denied/);
        }
        await assert.rejects(() => begin(), /permission denied/);
        await assert.rejects(() => stage(), /permission denied/);
        await assert.rejects(() => db.query('select public.github_end_connection($1)', [member]), /permission denied/);
      }
      await role('service_role');
    });
    await t.test('state is consumed once and expired state cannot be consumed', async () => {
      const state = (await consume(hash1)).rows[0];
      assert.equal(state.user_id, member); assert.equal(state.generation, gen1);
      assert.equal((await db.query("update public.github_connections set token_ciphertext='encrypted' where user_id=$1 and generation=$2 returning *", [state.user_id, state.generation])).rows.length, 1);
      assert.equal((await consume(hash1)).rows.length, 0);
      await begin(member, gen1, hash1, '2000-01-01T00:00:00Z');
      assert.equal((await consume(hash1)).rows.length, 0);
      await begin(admin, gen1, hash2);
      assert.equal((await db.query('select * from public.github_oauth_states where state_hash=$1', [hash1])).rows.length, 0);
    });
    await t.test('new starts supersede pending attempts while preserving connected credentials', async () => {
      await db.query("update public.github_connections set token_ciphertext='encrypted',github_user_id=456,login='tester',scopes='repo',expires_at='2999-01-01',connected_at=now() where user_id=$1", [member]);
      await begin();
      await begin(member, gen2, 'c'.repeat(64));
      assert.equal((await consume(hash1)).rows.length, 0);
      const connection = (await db.query('select * from public.github_connections where user_id=$1', [member])).rows[0];
      assert.equal(connection.generation, gen2); assert.equal(connection.token_ciphertext, 'encrypted'); assert.equal(connection.login, 'tester');
      assert.equal((await db.query('select * from public.github_oauth_states where user_id=$1', [member])).rows.length, 1);
      assert.equal((await db.query("update public.github_connections set token_ciphertext='stale' where user_id=$1 and generation=$2 returning *", [member, gen1])).rows.length, 0);
    });
    await t.test('disconnect keeps a tombstone and rejects in-flight callback restoration', async () => {
      const state = (await consume('c'.repeat(64))).rows[0];
      assert.equal(state.generation, gen2);
      await begin(member, gen2, hash1);
      await db.query('select public.github_end_connection($1)', [member]);
      const row = (await db.query('select * from public.github_connections where user_id=$1', [member])).rows[0];
      assert.notEqual(row.generation, gen2);
      for (const field of ['token_ciphertext', 'github_user_id', 'login', 'scopes', 'expires_at', 'connected_at']) assert.equal(row[field], null);
      assert.equal((await consume(hash1)).rows.length, 0);
      assert.equal((await db.query("update public.github_connections set token_ciphertext='late' where user_id=$1 and generation=$2 returning *", [member, state.generation])).rows.length, 0);
      await db.query('select public.github_end_connection($1)', [missing]);
      assert.equal((await db.query('select * from public.github_connections where user_id=$1', [missing])).rows.length, 0);
    });
    await t.test('staged completion tickets bind the user, stay separate from initial state and consume once', async () => {
      await begin();
      assert.equal((await complete(hash1)).rows.length, 0);
      assert.equal((await consume(hash1)).rows[0].code_ciphertext, null);
      assert.equal(await stage(), true);
      assert.equal((await consume(ticketHash)).rows.length, 0);
      assert.equal((await complete(ticketHash, admin)).rows.length, 0);
      const ticket = (await complete(ticketHash)).rows[0];
      assert.equal(ticket.user_id, member); assert.equal(ticket.generation, gen1);
      assert.equal(ticket.code_ciphertext, 'encrypted-code');
      assert.equal((await complete(ticketHash)).rows.length, 0);
      assert.equal((await db.query('select token_ciphertext from public.github_connections where user_id=$1', [member])).rows[0].token_ciphertext, null);
      assert.equal(await stage(member, gen1, ticketHash, '2000-01-01T00:00:00Z'), true);
      assert.equal((await complete(ticketHash)).rows.length, 0);
    });
    await t.test('stale callbacks cannot overwrite a newer pending state and disconnect cancels staged codes', async () => {
      await begin(member, gen2, hash1);
      assert.equal(await stage(member, gen1), false);
      assert.equal(await stage(missing), false);
      assert.equal((await db.query('select state_hash from public.github_oauth_states where user_id=$1', [member])).rows[0].state_hash, hash1);
      await consume(hash1);
      assert.equal(await stage(member, gen2), true);
      await db.query('select public.github_end_connection($1)', [member]);
      assert.equal((await complete(ticketHash)).rows.length, 0);
      assert.equal(await stage(member, gen2), false);
      assert.equal((await db.query('select * from public.github_oauth_states where user_id=$1', [member])).rows.length, 0);
    });
    await t.test('foreign keys and state/repository validation reject invalid records atomically', async () => {
      await begin(member, gen2, hash1);
      await assert.rejects(() => begin(missing), /foreign key/);
      for (const badHash of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) await assert.rejects(() => begin(member, gen1, badHash), /check constraint/);
      assert.equal((await db.query('select generation from public.github_connections where user_id=$1', [member])).rows[0].generation, gen2);
      assert.equal((await db.query('select state_hash from public.github_oauth_states where user_id=$1', [member])).rows[0].state_hash, hash1);
      for (const name of ['repo', '/repo', 'owner/', 'owner/repo/extra', 'owner/invalid name']) {
        await assert.rejects(() => db.query('insert into public.github_repositories(customer_id,github_id,full_name,created_by) values ($1,999,$2,$3)', [customer, name, member]), /check constraint/);
      }
      await assert.rejects(() => db.query('insert into public.github_repositories(customer_id,github_id,full_name,created_by) values ($1,123,$2,$3)', [customer, 'another/repo', member]), /unique constraint/);
      await assert.rejects(() => db.query('insert into public.github_repositories(customer_id,github_id,full_name,created_by) values ($1,999,$2,$3)', [missing, 'another/repo', member]), /foreign key/);
      await assert.rejects(() => db.query('insert into public.github_repositories(customer_id,github_id,full_name,created_by) values ($1,999,$2,$3)', [customer, 'another/repo', missing]), /foreign key/);
    });
    await t.test('manual correspondence is unique per branch pair and full source SHA', async () => {
      const link = (repo, base, target, source = sha1, dest = sha2, user = member) => db.query('insert into public.github_commit_links(repository_id,base_branch,target_branch,source_sha,target_sha,confirmed_by) values ($1,$2,$3,$4,$5,$6)', [repo, base, target, source, dest, user]);
      await assert.rejects(() => link(repository.id, 'main', 'release'), /unique constraint/);
      await link(repository.id, 'main', 'staging');
      await link(repository.id, 'release', 'main');
      for (const [base, target, source, dest] of [['', 'other', sha1, sha2], ['main', '', sha1, sha2], [' ', 'other', sha1, sha2], ['main', 'main', sha1, sha2], ['x'.repeat(251), 'other', sha1, sha2], ['main', 'x'.repeat(251), sha1, sha2], ['x'.repeat(250)+' ', 'other', sha1, sha2], ['main', 'other', 'A'.repeat(40), sha2], ['main', 'other', 'a'.repeat(39), sha2], ['main', 'other', sha1, 'b'.repeat(41)]]) {
        await assert.rejects(() => link(repository.id, base, target, source, dest), /check constraint/);
      }
      await assert.rejects(() => link(missing, 'main', 'other'), /foreign key/);
      await assert.rejects(() => link(repository.id, 'main', 'other', sha1, sha2, missing), /foreign key/);
      assert.equal((await db.query('select count(*)::int n from public.github_commit_links')).rows[0].n, 3);
      await role();
      assert.deepEqual(await snapshot(), before);
    });
  } finally { await db.close(); }
});
