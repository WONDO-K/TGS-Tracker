import { parseAuthCallback } from './domain';
import { client } from './supabase';
export async function handleAuthCallback(){
 const value=parseAuthCallback(window.location.href);if(value.kind==='none')return;
 const clean=()=>history.replaceState(null,'',window.location.pathname+'#/set-password');
 if(value.kind==='error'){history.replaceState(null,'',window.location.pathname+'#/login');throw new Error(value.message);}
 // 토큰을 교환하기 전에 주소에서 제거해 브라우저 기록과 화면 링크에 남기지 않는다.
 clean();
 const auth=client().auth;
 const result=value.kind==='otp'?await auth.verifyOtp({token_hash:value.token_hash,type:value.type}):value.kind==='code'?await auth.exchangeCodeForSession(value.code):await auth.setSession({access_token:value.access_token,refresh_token:value.refresh_token});
 if(result.error)throw result.error;
}
