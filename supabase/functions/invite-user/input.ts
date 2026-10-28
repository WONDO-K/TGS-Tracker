export function parseInvite(value:unknown){
 if(!value||typeof value!=='object')throw new Error('초대 정보를 입력해주세요.');
 const {email,display_name}=value as Record<string,unknown>;
 if(typeof email!=='string'||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw new Error('올바른 이메일을 입력해주세요.');
 if(typeof display_name!=='string'||!display_name.trim()||display_name.trim().length>80)throw new Error('이름은 1~80자로 입력해주세요.');
 return {email:email.trim().toLowerCase(),display_name:display_name.trim()};
}
export function checkInviteState(profile:{is_active:boolean;last_invited_at:string|null}|null,now=Date.now()){
 if(profile?.last_invited_at&&now-new Date(profile.last_invited_at).getTime()<60_000)throw new Error('초대 재발송은 1분 후에 가능합니다.');
 if(profile&&!profile.is_active&&profile.last_invited_at)throw new Error('접근 차단된 사용자입니다. 먼저 사용자 관리에서 활성화해주세요.');
}
