import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('고객사 권한과 요청·첨부 변경 계약', async t => {
  const db = new PGlite();
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
    let migration = '';
    try { migration = await readFile(new URL('../migrations/202610290001_tracker.sql', import.meta.url),'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (migration) await db.exec(migration);
    const admin='00000000-0000-0000-0000-000000000001';
    const alice='00000000-0000-0000-0000-000000000002';
    const bob='00000000-0000-0000-0000-000000000003';
    const carol='00000000-0000-0000-0000-000000000004';
    const asUser = async id => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]); await db.exec('set role authenticated'); };
    const rpc = async (name,args=[]) => (await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as value`,args)).rows[0].value;
    let c1,c2,r;
    await t.test('안전한 기본 프로필과 관리자·담당 배정', async()=>{
      await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'admin@test.local','{}'),($2,'alice@test.local','{"role":"admin","is_active":true}'),($3,'bob@test.local','{}'),($4,'carol@test.local','{}')`,[admin,alice,bob,carol]);
      assert.equal((await db.query('select role from public.profiles where id=$1',[alice])).rows[0].role,'member');
      await db.query(`update public.profiles set is_active=true,role=case when id=$1 then 'admin' else 'member' end`,[admin]);
      await asUser(admin);
      c1=await rpc('save_customer',[null,'한빛','HAN',true]); c2=await rpc('save_customer',[null,'새봄','SAE',true]);
      await rpc('set_customer_members',[alice,[c1]]); await rpc('set_customer_members',[bob,[c2]]); await rpc('set_customer_members',[carol,[c1,c2]]);
    });
    await t.test('담당 요청 생성 및 완료 상태의 운영 미반영',async()=>{
      await asUser(alice);
      r=await rpc('create_request',[{customer_id:c1,title:'운영 반영 대기',description:'테스트 완료',requested_on:'2026-01-01',requires_deployment:true}]);
      const updated=await rpc('update_request',[r,1,{status:'completed',test_deployed_at:'2026-01-02T01:00:00Z'}]);
      assert.equal(updated.status,'completed'); assert.equal(updated.version,2); assert.equal(updated.created_by,alice);
      assert.equal((await db.query(`select count(*)::int as n from requests where test_deployed_at is not null and production_deployed_at is null and requires_deployment`)).rows[0].n,1);
    });
    await t.test('다른 고객사 조회·직접 변경·RPC 접근 거부',async()=>{
      await asUser(bob);
      assert.equal((await db.query('select * from requests where id=$1',[r])).rows.length,0);
      await assert.rejects(()=>rpc('update_request',[r,2,{title:'침범'}]),/권한/);
      await assert.rejects(()=>db.query(`update requests set title='침범' where id=$1`,[r]),/permission denied/);
      await assert.rejects(()=>rpc('create_request',[{customer_id:c1,title:'침범',description:'x',requested_on:'2026-01-01'}]),/권한/);
    });
    await t.test('같은 고객사 동료 조치와 낙관적 잠금',async()=>{
      await asUser(carol); await rpc('add_request_activity',[r,'action','확인했습니다']);
      await assert.rejects(()=>rpc('add_request_activity',[r,'system','위조']),/유형/);
      await assert.rejects(()=>rpc('update_request',[r,1,{title:'오래된 수정'}]),/다른 사용자가/);
      await assert.rejects(()=>rpc('update_request',[r,null,{title:'버전 우회'}]),/다른 사용자가/);
      assert.equal((await db.query(`select count(*)::int n from request_activities where request_id=$1`,[r])).rows[0].n,2);
    });
    await t.test('배포 불필요 변경의 날짜 일관성과 필드 위조 방어',async()=>{
      await asUser(alice);
      await assert.rejects(()=>rpc('update_request',[r,2,{created_by:bob}]),/허용/);
      await assert.rejects(()=>rpc('update_request',[r,2,{production_deployed_at:'2999-01-01T00:00:00Z'}]),/미래/);
      const row=await rpc('update_request',[r,2,{requires_deployment:false}]);
      assert.equal(row.test_deployed_at,null); assert.equal(row.requires_deployment,false);
    });
    await t.test('목록 필터와 전체 집계는 같은 담당 범위를 사용한다',async()=>{
      await asUser(carol);
      const result=await rpc('list_requests',[{search:'운영'},null,30,0]);
      assert.equal(result.total,1); assert.equal(result.counts.completed,1); assert.equal(result.rows[0].attachment_count,0);
      assert.equal((await rpc('list_requests',[{search:'없는,문자(%)'},null,30,0])).total,0);
      await asUser(bob); assert.equal((await rpc('list_requests',[{},null,30,0])).total,0);
    });
    await t.test('첨부 예약 제한, 실제 파일 확인, 소유권',async()=>{
      await asUser(alice);
      const attachments=[];
      for(let i=0;i<5;i++) attachments.push(await rpc('reserve_attachment',[r,'화면.png','image/png',100]));
      await assert.rejects(()=>rpc('reserve_attachment',[r,'초과.png','image/png',100]),/5장/);
      await assert.rejects(()=>rpc('finalize_attachment',[attachments[0].id]),/업로드/);
      await db.query(`insert into storage.objects(bucket_id,name,metadata) values ('request-images',$1,'{"size":100,"mimetype":"image/png"}')`,[attachments[0].storage_path]);
      await rpc('finalize_attachment',[attachments[0].id]);
      await asUser(carol);
      await assert.rejects(()=>rpc('remove_attachment_record',[attachments[0].id]),/권한/);
      await asUser(bob);
      assert.equal((await db.query('select * from storage.objects')).rows.length,0);
      await assert.rejects(()=>db.query(`insert into storage.objects(bucket_id,name,metadata) values ('request-images',$1,'{}')`,[`${c1}/${r}/bad.png`]),/row-level security/);
    });
    await t.test('자기 승격·관리자 RPC 위조 거절',async()=>{
      await asUser(alice);
      await assert.rejects(()=>db.exec(`update profiles set role='admin' where id=auth.uid()`),/permission denied/);
      await assert.rejects(()=>rpc('set_user_access',[alice,'admin',true]),/관리자/);
    });
    await t.test('사용자 차단 시 기존 JWT로 요청과 이미지 접근 차단',async()=>{
      await asUser(admin); await rpc('set_user_access',[alice,'member',false]); await asUser(alice);
      assert.equal((await db.query('select * from requests')).rows.length,0);
      assert.equal((await db.query('select * from storage.objects')).rows.length,0);
      await assert.rejects(()=>rpc('add_request_activity',[r,'note','차단 후']),/권한/);
    });
    await t.test('마지막 관리자 보호와 고객사 읽기 전용',async()=>{
      await asUser(admin);
      await assert.rejects(()=>rpc('set_user_access',[admin,'member',true]),/마지막/);
      await rpc('save_customer',[c1,'한빛','HAN',false]); await asUser(carol);
      assert.equal((await db.query('select * from requests where id=$1',[r])).rows.length,1);
      await assert.rejects(()=>rpc('update_request',[r,3,{title:'수정'}]),/읽기 전용/);
      await asUser(admin); await rpc('save_customer',[c1,'한빛','HAN',true]);
      await assert.rejects(()=>rpc('set_request_archived',[r,null,true]),/다른 사용자가/);
      await rpc('set_request_archived',[r,3,true]); await asUser(carol);
      await assert.rejects(()=>rpc('add_request_activity',[r,'note','보관 후']),/읽기 전용/);
      await asUser(admin); await rpc('set_request_archived',[r,4,false]);
      assert.equal((await db.query('select version from requests where id=$1',[r])).rows[0].version,5);
    });
  } finally { await db.close(); }
});
