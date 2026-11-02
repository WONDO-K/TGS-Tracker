import type { AccessibleRepository, CommitDetail, CommitSummary, Comparison, GitHubBranch, GitHubRepository, ManualLink } from './contracts.ts';

export class GitHubError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

type RawCommit = { sha: string; html_url?: string; commit: {message: string; author?: {name?: string; date?: string} | null}; author?: {login?: string} | null; files?: {filename: string; additions: number; deletions: number; status: string; patch?: string}[] };
type RawRepository = {id: number; full_name: string; default_branch: string; private: boolean};
const invalid = () => new GitHubError('invalid_input', 'GitHub 조회 조건을 확인해 주세요.');
function repositoryPath(fullName: string) {
  if (typeof fullName !== 'string' || fullName.length > 201 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,161}$/.test(fullName) || fullName.split('/').some(part => part === '.' || part === '..')) throw invalid();
  return `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`;
}
function branchRef(branch: string) {
  if (typeof branch !== 'string' || !branch || branch.length > 255 || /[\s\x00-\x1f\x7f~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch === '@' || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) throw invalid();
  return encodeURIComponent(branch);
}
function commitSha(sha: string, full = false) {
  if (typeof sha !== 'string' || !(full ? /^[a-f\d]{40}$/i : /^[a-f\d]{7,40}$/i).test(sha)) throw invalid();
  return sha.toLowerCase();
}
function pageNumber(page: number) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw invalid();
  return page;
}
function hasNext(headers: Headers, length: number) {
  const link = headers.get('link');
  return link ? /;\s*rel\s*=\s*"?next"?(?:\s|,|$)/i.test(link) : length === 100;
}
function accessible(repo: RawRepository): AccessibleRepository {
  return {githubId: repo.id, fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private};
}
function summary(raw: RawCommit, fullName: string): CommitSummary {
  const message = raw.commit.message;
  let url = `https://github.com/${fullName}/commit/${raw.sha}`;
  try {
    const candidate = new URL(raw.html_url || '');
    if (candidate.origin === 'https://github.com' && !candidate.username && !candidate.password) url = candidate.href;
  } catch { /* Use a fixed GitHub origin when the upstream URL is absent or invalid. */ }
  return {sha: raw.sha, title: message.split(/\r?\n/,1)[0].trim().slice(0,200), message, author: raw.commit.author?.name || raw.author?.login || '알 수 없음', date: raw.commit.author?.date || '', url};
}

export class GitHubClient {
  private token: string;
  private fetchImpl: typeof fetch;
  private now: () => Date;
  constructor(token: string, options: {fetchImpl?: typeof fetch; now?: () => Date} = {}) {
    this.token = token;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => new Date());
  }

  private async get<T>(path: string, query: Record<string,string | number> = {}): Promise<{data: T; headers: Headers}> {
    const url = new URL(`https://api.github.com${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key,String(value));
    let response: Response;
    try {
      response = await this.fetchImpl(url.href, {method:'GET', redirect:'error', signal:AbortSignal.timeout(15000), headers: {Authorization:`Bearer ${this.token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'TGS-Tracker'}});
    } catch {
      throw new GitHubError('github_unavailable','GitHub에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',502);
    }
    if (!response.ok) {
      const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (rateLimited) throw new GitHubError('github_rate_limit','GitHub 조회 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',429);
      if (response.status === 401) throw new GitHubError('github_expired','GitHub 연결이 만료되었습니다. 다시 연결해 주세요.',401);
      if (response.status === 403) throw new GitHubError('github_permission','GitHub 저장소 접근 권한을 확인해 주세요.',403);
      if (response.status === 404) throw new GitHubError('github_missing','저장소, 브랜치 또는 커밋을 찾을 수 없습니다.',404);
      throw new GitHubError('github_unavailable','GitHub 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.',502);
    }
    try { return {data: await response.json() as T, headers:response.headers}; }
    catch { throw new GitHubError('github_unavailable','GitHub 응답을 읽을 수 없습니다.',502); }
  }

  async getUser(): Promise<{id:number; login:string}> {
    const {data} = await this.get<{id:number;login:string}>('/user');
    return {id:data.id,login:data.login};
  }
  async getRepository(fullName: string): Promise<AccessibleRepository> {
    return accessible((await this.get<RawRepository>(repositoryPath(fullName))).data);
  }
  async listRepositories(page = 1): Promise<{repositories:AccessibleRepository[];hasMore:boolean}> {
    const {data,headers} = await this.get<RawRepository[]>('/user/repos',{page:pageNumber(page),per_page:100,sort:'full_name',affiliation:'owner,collaborator,organization_member'});
    return {repositories:data.map(accessible),hasMore:hasNext(headers,data.length)};
  }
  async listBranches(fullName: string, page = 1): Promise<{branches:GitHubBranch[];hasMore:boolean}> {
    const {data,headers} = await this.get<{name:string;commit:{sha:string}}[]>(`${repositoryPath(fullName)}/branches`,{page:pageNumber(page),per_page:100});
    return {branches:data.map(branch=>({name:branch.name,sha:branch.commit.sha})),hasMore:hasNext(headers,data.length)};
  }
  async getBranch(fullName: string, branch: string): Promise<GitHubBranch> {
    const {data} = await this.get<{name:string;commit:{sha:string}}>(`${repositoryPath(fullName)}/branches/${branchRef(branch)}`);
    return {name:data.name,sha:commitSha(data.commit.sha,true)};
  }
  async getCommit(fullName: string, sha: string): Promise<CommitDetail> {
    const path = `${repositoryPath(fullName)}/commits/${commitSha(sha)}`;
    let result: CommitDetail | undefined;
    for (let page=1;page<=3;page++) {
      const {data,headers} = await this.get<RawCommit>(path,{page,per_page:100});
      result ||= {...summary(data,fullName),files:[],filesComplete:false};
      const files = data.files || [];
      result.files.push(...files.slice(0,100).map(file=>({name:file.filename,added:file.additions,removed:file.deletions,status:file.status,...(typeof file.patch === 'string' ? {patch:file.patch} : {})})));
      if (!hasNext(headers,files.length)) {result.filesComplete=true;break;}
    }
    return result!;
  }
  async isAncestor(fullName: string, sha: string, head: string): Promise<boolean> {
    const {data} = await this.get<{status:string}>(`${repositoryPath(fullName)}/compare/${commitSha(sha,true)}...${commitSha(head,true)}`);
    return data.status==='ahead' || data.status==='identical';
  }
  private async scan(fullName: string, tip: string, cap: number, since?: string) {
    const commits: CommitSummary[] = [];
    let complete = false;
    for(let page=1;page<=cap/100;page++) {
      const {data,headers} = await this.get<RawCommit[]>(`${repositoryPath(fullName)}/commits`,{sha:tip,per_page:100,page,...(since ? {since} : {})});
      commits.push(...data.slice(0,100).map(commit=>summary(commit,fullName)));
      if(!hasNext(headers,data.length)) {complete=true;break;}
    }
    return {commits,complete};
  }
  async compare(repository: GitHubRepository, baseBranch: string, targetBranch: string, days: number, links: ManualLink[] | ((sourceShas: string[]) => Promise<ManualLink[]>)): Promise<Comparison> {
    repositoryPath(repository.fullName); branchRef(baseBranch); branchRef(targetBranch);
    if(![7,30,90].includes(days)) throw invalid();
    const comparedAt = this.now().toISOString();
    const since = new Date(new Date(comparedAt).getTime()-days*86400000).toISOString();
    const base = await this.getBranch(repository.fullName,baseBranch);
    const target = await this.getBranch(repository.fullName,targetBranch);
    const sourceScan = await this.scan(repository.fullName,base.sha,500,since);
    const targetScan = await this.scan(repository.fullName,target.sha,1000);
    const manualLinks = typeof links === 'function' ? await links(sourceScan.commits.map(commit=>commit.sha)) : links;
    const targets = new Map(targetScan.commits.map(commit=>[commit.sha,commit]));
    const cherryPicks = new Map<string,string>();
    for(const commit of targetScan.commits) for(const marker of commit.message.matchAll(/\(cherry picked from commit ([a-f\d]{40})\)/gi)) cherryPicks.set(marker[1].toLowerCase(),commit.sha);
    const normalize = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g,' ');
    const rows = sourceScan.commits.map(source => {
      const candidates = targetScan.commits.filter(commit=>normalize(commit.title)===normalize(source.title));
      const exact = targets.has(source.sha) ? source.sha : cherryPicks.get(source.sha);
      if(exact) return {...source,result:'matched' as const,target:exact,evidence:exact===source.sha ? '동일 SHA가 대상 브랜치 이력에 있습니다.' : '전체 원본 SHA를 명시한 체리픽 출처가 있습니다.',candidates:[]};
      const manual = manualLinks.find(link=>link.sourceSha===source.sha && link.baseBranch===baseBranch && link.targetBranch===targetBranch);
      if(manual && targets.has(manual.targetSha)) return {...source,result:'matched' as const,target:manual.targetSha,evidence:'대상 브랜치 이력에서 확인한 수동 대응입니다.',candidates:[]};
      if(manual) return {...source,result:'review' as const,evidence:'저장한 수동 대응을 현재 대상 이력에서 확인할 수 없습니다.',candidates};
      if(candidates.length) return {...source,result:'review' as const,evidence:'제목이 같은 후보입니다. 변경 내용을 확인해 주세요.',candidates};
      if(!targetScan.complete) return {...source,result:'review' as const,evidence:'대상 이력 조회 한도로 대응 여부를 확인할 수 없습니다.',candidates:[]};
      return {...source,result:'unmatched' as const,evidence:'조회한 대상 이력에서 대응 근거를 찾지 못했습니다.',candidates:[]};
    });
    return {repositoryId:repository.id,baseBranch,targetBranch,baseSha:base.sha,targetSha:target.sha,since,comparedAt,sourceComplete:sourceScan.complete,targetComplete:targetScan.complete,sourceScanned:sourceScan.commits.length,targetScanned:targetScan.commits.length,rows};
  }
}
