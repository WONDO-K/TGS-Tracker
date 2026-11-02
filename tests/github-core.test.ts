import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../supabase/functions/github/core.ts';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const commit = (n: number, message = `Change ${n}`) => ({sha: sha(n), html_url: `https://github.com/acme/app/commit/${sha(n)}`, commit: {message, author: {name: 'Dev', date: '2026-11-01T00:00:00Z'}}});
const repository = {id: 'r', customerId: 'c', githubId: 1, fullName: 'acme/app', defaultBranch: 'main'};
function client(route: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return new GitHubClient('secret-token', {now: () => new Date('2026-11-02T00:00:00Z'), fetchImpl: (async (input, init) => route(new URL(String(input)), init)) as typeof fetch});
}
const json = (body: unknown, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), {headers});
function comparison(source: unknown[], target: unknown[], links: any[] = []) {
  const requests: URL[] = [];
  const api = client(url => {
    requests.push(url);
    if (url.pathname.includes('/branches/')) return json({name: url.pathname.split('/').at(-1), commit: {sha: url.pathname.endsWith('/main') ? sha(9000) : sha(9001)}});
    return json(url.searchParams.get('sha') === sha(9000) ? source : target);
  });
  return {result: api.compare(repository, 'main', 'release', 30, links), requests};
}

test('exact SHA, full cherry-pick marker, titles and stale manual links produce distinct evidence', async () => {
  const source = [commit(1), commit(2), commit(3, '  Same   title\nsource body'), commit(4), commit(5)];
  const target = [commit(1), commit(22, `Other\n\n(cherry picked from commit ${sha(2)})`), commit(33, 'Same title'), commit(44, `Other\n(cherry picked from commit ${sha(4).slice(0,7)})`)];
  const {result, requests} = comparison(source, target, [{sourceSha: sha(5), targetSha: sha(55), baseBranch: 'main', targetBranch: 'release'}]);
  const value = await result;
  assert.deepEqual(value.rows.map(row => row.result), ['matched','matched','review','unmatched','review']);
  assert.equal(value.rows[1].target, sha(22));
  assert.equal(value.rows[2].candidates[0].sha, sha(33));
  assert.equal(value.rows[2].message, '  Same   title\nsource body');
  assert.equal(value.sourceComplete, true);
  assert.equal(value.targetComplete, true);
  const scans = requests.filter(url => url.pathname.endsWith('/commits'));
  assert.ok(scans.every(url => [sha(9000), sha(9001)].includes(url.searchParams.get('sha')!)));
  assert.equal(scans.find(url => url.searchParams.get('sha') === sha(9001))!.searchParams.has('since'), false);
});

test('manual counterpart requires reachability and the same branch pair', async () => {
  const {result} = comparison([commit(1),commit(2)], [commit(9)], [
    {sourceSha:sha(1),targetSha:sha(9),baseBranch:'main',targetBranch:'release'},
    {sourceSha:sha(2),targetSha:sha(9),baseBranch:'other',targetBranch:'release'},
  ]);
  assert.deepEqual((await result).rows.map(row=>row.result), ['matched','unmatched']);
});

test('scans caps and exact full pages cannot claim complete without pagination evidence', async () => {
  let scans = 0;
  const api = client(url => {
    if (url.pathname.includes('/branches/')) return json({name:'x',commit:{sha: url.pathname.endsWith('/main') ? sha(9000) : sha(9001)}});
    scans++;
    const page = Number(url.searchParams.get('page'));
    return json(Array.from({length:100}, (_,i)=>commit((url.searchParams.get('sha') === sha(9000) ? 0 : 10000) + page*100+i)));
  });
  const value = await api.compare(repository,'main','release',7,[]);
  assert.equal(value.sourceScanned,500);
  assert.equal(value.targetScanned,1000);
  assert.equal(value.sourceComplete,false);
  assert.equal(value.targetComplete,false);
  assert.ok(value.rows.every(row=>row.result==='review'));
  assert.equal(scans,15);
});

test('probes a full page, follows only fixed API paths despite hostile Link and sanitizes HTML URLs', async () => {
  const pages: string[] = [];
  const api = client((url,init) => {
    assert.equal(url.origin,'https://api.github.com');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer secret-token');
    assert.equal(init?.redirect,'error');
    pages.push(url.searchParams.get('page')!);
    return json({ ...commit(1), html_url:'https://evil.test/secret', files: pages.length===1 ? Array.from({length:100},(_,i)=>({filename:`a${i}`,additions:1,deletions:0,status:'modified'})) : [] }, pages.length===1 ? {Link:'<https://evil.test/steal>; rel="next"'} : {});
  });
  const value = await api.getCommit('acme/app',sha(1));
  assert.deepEqual(pages,['1','2']);
  assert.equal(value.filesComplete,true);
  assert.equal(value.files.length,100);
  assert.equal(new URL(value.url).origin,'https://github.com');
  assert.equal(value.files[0].patch,undefined);
});

test('file pagination stops at 300 and marks incomplete', async () => {
  const api = client(() => json({...commit(1),files:Array.from({length:100},()=>({filename:'a',additions:1,deletions:0,status:'modified',patch:'@@'}))}));
  const value = await api.getCommit('acme/app',sha(1));
  assert.equal(value.files.length,300);
  assert.equal(value.filesComplete,false);
});

test('user repositories branches and ancestor use GET projections and safe query encoding', async () => {
  const api = client(url => {
    if(url.pathname==='/user') return json({id:7,login:'dev'});
    if(url.pathname==='/user/repos') return json([{id:1,full_name:'acme/app',default_branch:'main',private:true}],{Link:'<https://evil.test>; rel="next"'});
    if(url.pathname.endsWith('/branches')) return json([{name:'feature/a',commit:{sha:sha(1)}}]);
    if(url.pathname.includes('/compare/')) return json({status:'ahead'});
    return json({id:1,full_name:'acme/app',default_branch:'main',private:true});
  });
  assert.deepEqual(await api.getUser(),{id:7,login:'dev'});
  assert.equal((await api.listRepositories()).hasMore,true);
  assert.equal((await api.getRepository('acme/app')).private,true);
  assert.equal((await api.listBranches('acme/app')).branches[0].name,'feature/a');
  assert.equal(await api.isAncestor('acme/app',sha(1),sha(2)),true);
});

test('validates request inputs before HTTP and hides upstream error bodies', async () => {
  const api = client(()=>{throw new Error('must not call')});
  for(const name of ['https://evil.test/a','a/../b','a/b?x=1','a/b/c']) await assert.rejects(api.getRepository(name),{code:'invalid_input'});
  await assert.rejects(api.getCommit('acme/app','abc'),{code:'invalid_input'});
  await assert.rejects(api.getBranch('acme/app','../main'),{code:'invalid_input'});
  await assert.rejects(api.listRepositories(0),{code:'invalid_input'});
  await assert.rejects(api.compare(repository,'main','release',1,[]),{code:'invalid_input'});
  for(const [status,code] of [[401,'github_expired'],[403,'github_permission'],[404,'github_missing'],[429,'github_rate_limit'],[503,'github_unavailable']] as const) {
    const failed=client(()=>new Response('secret-token private details',{status}));
    await assert.rejects(failed.getUser(),(error:any)=>error.code===code && !error.message.includes('secret-token'));
  }
});

test('exact 100-commit scan probes the next page before declaring complete', async () => {
  const seen: string[] = [];
  const api=client(url=>{
    if(url.pathname.includes('/branches/')) return json({name:'x',commit:{sha:url.pathname.endsWith('/main') ? sha(9000) : sha(9001)}});
    const page=url.searchParams.get('page');
    const source=url.searchParams.get('sha')===sha(9000);
    seen.push(`${source?'source':'target'}-${page}`);
    return json(page==='1' ? Array.from({length:100},(_,i)=>commit((source?0:1000)+i)) : []);
  });
  const value=await api.compare(repository,'main','release',90,[]);
  assert.deepEqual(seen,['source-1','source-2','target-1','target-2']);
  assert.equal(value.sourceComplete,true);
  assert.equal(value.targetComplete,true);
  assert.equal(value.rows[0].result,'unmatched');
});

test('branch names are encoded, rate limits distinguish permission errors, network failures hide secrets', async () => {
  const api=client(url=>{
    assert.equal(url.pathname,'/repos/acme/app/branches/feature%2Fnew');
    assert.equal(url.search,'');
    return json({name:'feature/new',commit:{sha:sha(1)}});
  });
  assert.deepEqual(await api.getBranch('acme/app','feature/new'),{name:'feature/new',sha:sha(1)});
  await assert.rejects(client(()=>new Response('secret',{status:403,headers:{'X-RateLimit-Remaining':'0'}})).getUser(),{code:'github_rate_limit'});
  await assert.rejects(client(()=>{throw new Error('secret-token')}).getUser(),(error:any)=>error.code==='github_unavailable'&&!error.message.includes('secret-token'));
  assert.equal(await client(()=>json({status:'behind'})).isAncestor('acme/app',sha(1),sha(2)),false);
  assert.equal(await client(()=>json({status:'identical'})).isAncestor('acme/app',sha(1),sha(1)),true);
});

test('GET requests have a deadline signal and lazy links load only pinned source hashes', async () => {
  const visited: string[]=[];
  const api=client((url,init)=>{
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted,false);
    if(url.pathname.includes('/branches/')) return json({name:'x',commit:{sha:url.pathname.endsWith('/main')?sha(9000):sha(9001)}});
    const source=url.searchParams.get('sha')===sha(9000);
    visited.push(source?'source':'target');
    return json(source?[commit(1),commit(2)]:[commit(9)]);
  });
  let requested: string[]=[];
  const value=await api.compare(repository,'main','release',7,async sourceShas=>{
    assert.deepEqual(visited,['source','target']);
    requested=sourceShas;
    return [{sourceSha:sha(1),targetSha:sha(9),baseBranch:'main',targetBranch:'release',confirmedBy:'person',confirmedAt:'2026-11-02T00:00:00Z'}];
  });
  assert.deepEqual(requested,[sha(1),sha(2)]);
  assert.equal(value.rows[0].result,'matched');
  assert.equal(value.rows[0].target,sha(9));
  assert.equal(value.rows[1].result,'unmatched');
});
