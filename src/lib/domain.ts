import type { Filters, RequestRow } from './types.ts';
export const statuses={received:'접수',in_progress:'진행 중',verification:'확인 대기',completed:'완료'} as const;
type Deployment=Pick<RequestRow,'requires_deployment'|'test_deployed_at'|'production_deployed_at'>;
export function deploymentLabel(r:Deployment){ return !r.requires_deployment?'배포 불필요':r.production_deployed_at?'운영 반영':r.test_deployed_at?'운영 반영 대기':'테스트 미반영'; }
export function matchesFilters(r:Pick<RequestRow,'customer_id'|'title'|'description'|'requested_on'|'created_by'|'archived_at'>&Deployment,f:Filters){
 if(f.customer&&r.customer_id!==f.customer) return false;
 if(Boolean(r.archived_at)!==Boolean(f.archived)) return false;
 if(f.search&&!`${r.title} ${r.description}`.toLowerCase().includes(f.search.toLowerCase())) return false;
 if(f.author&&r.created_by!==f.author) return false;
 if(f.from&&r.requested_on<f.from||f.to&&r.requested_on>f.to) return false;
 switch(f.deployment){case 'pending':return r.requires_deployment&&Boolean(r.test_deployed_at)&&!r.production_deployed_at;case 'untested':return r.requires_deployment&&!r.test_deployed_at&&!r.production_deployed_at;case 'production':return Boolean(r.production_deployed_at);case 'unnecessary':return !r.requires_deployment;default:return true;}
}
export function todayKST(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function formatDate(value:string|null,withTime=false){return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value)):'미반영';}
export function localDatetime(value:string|null){if(!value)return '';const d=new Date(value);return new Date(d.getTime()+9*3600000).toISOString().slice(0,16);}
export function isoKST(value:string){return value?new Date(value+':00+09:00').toISOString():null;}
export function validateDeployment(required:boolean,test:string,prod:string){if(required&&[test,prod].some(v=>v&&new Date(v+':00+09:00').getTime()>Date.now()))throw new Error('배포일은 미래일 수 없습니다.');}
export function validateImage(f:{type:string;size:number}){if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw new Error('PNG, JPEG, WebP 이미지만 첨부할 수 있습니다.');if(!f.size||f.size>10*1024*1024)throw new Error('이미지 원본은 10MB 이하여야 합니다.');}
export type AuthCallback={kind:'none'}|{kind:'error';message:string}|{kind:'otp';token_hash:string;type:'invite'|'recovery'}|{kind:'code';code:string}|{kind:'session';access_token:string;refresh_token:string;type:string};
export function parseAuthCallback(url:string):AuthCallback{
 const u=new URL(url),q=u.searchParams,h=new URLSearchParams(u.hash.slice(1));
 if(q.has('error')||h.has('error'))return {kind:'error',message:q.get('error_description')||h.get('error_description')||'인증 링크가 만료되었거나 잘못되었습니다.'};
 if(q.has('token_hash')){const type=q.get('type');return type==='invite'||type==='recovery'?{kind:'otp',token_hash:q.get('token_hash')!,type}:{kind:'error',message:'지원하지 않는 인증 링크입니다.'};}
 if(q.get('code'))return {kind:'code',code:q.get('code')!};
 if(h.has('access_token'))return h.get('refresh_token')?{kind:'session',access_token:h.get('access_token')!,refresh_token:h.get('refresh_token')!,type:h.get('type')||''}:{kind:'error',message:'불완전한 인증 링크입니다.'};
 return {kind:'none'};
}
export function errorMessage(e:unknown){return e instanceof Error?e.message:typeof e==='object'&&e&&'message'in e?String(e.message):'처리하지 못했습니다. 다시 시도해주세요.';}
