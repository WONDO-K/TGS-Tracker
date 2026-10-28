import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseInvite, checkInviteState } from './input.ts';

Deno.serve(async(req:Request)=>{
 const appUrl=Deno.env.get('APP_URL');
 if(!appUrl)return Response.json({error:'서버 APP_URL 설정이 필요합니다.'},{status:503});
 const allowedOrigin=new URL(appUrl).origin;
 const headers={'Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
 if(req.headers.get('origin')&&req.headers.get('origin')!==allowedOrigin)return json({error:'허용되지 않는 요청입니다.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'POST 요청만 가능합니다.'},405);
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)return json({error:'로그인이 필요합니다.'},401);
 try{
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:authError}=await service.auth.getUser(token);
 if(authError||!identity.user)return json({error:'로그인이 만료되었습니다.'},401);
 const {data:caller,error:callerError}=await service.from('profiles').select('role,is_active').eq('id',identity.user.id).single();
 if(callerError||!caller?.is_active||caller.role!=='admin')return json({error:'관리자 권한이 필요합니다.'},403);
 const raw=await req.text();if(raw.length>4096)return json({error:'요청이 너무 큽니다.'},400);
 const input=parseInvite(JSON.parse(raw));
 const {data:existing,error:lookupError}=await service.from('profiles').select('id,is_active,last_invited_at').eq('email',input.email).maybeSingle();if(lookupError)throw lookupError;
 checkInviteState(existing);
 let userId=existing?.id;
 if(existing){
 const {data,error}=await service.auth.admin.getUserById(existing.id);if(error)throw error;
 if(data.user.email_confirmed_at){
 const {error}=await service.auth.resetPasswordForEmail(input.email,{redirectTo:appUrl});if(error)throw error;
 }else{const {error}=await service.auth.admin.inviteUserByEmail(input.email,{redirectTo:appUrl,data:{display_name:input.display_name}});if(error)throw error;}
 }else{
 const {data,error}=await service.auth.admin.inviteUserByEmail(input.email,{redirectTo:appUrl,data:{display_name:input.display_name}});if(error)throw error;userId=data.user?.id;
 }
 if(!userId)throw new Error('초대 계정을 확인하지 못했습니다.');
 const {error:saveError}=await service.from('profiles').update({last_invited_at:new Date().toISOString(),...(!existing||!existing.last_invited_at?{is_active:true}:{})}).eq('id',userId);
 if(saveError)return json({error:'메일 발송 후 사용자 설정을 완료하지 못했습니다. 사용자 상태를 확인하고 다시 시도해주세요.'},500);
 return json({ok:true});
 }catch(error){const message=error instanceof Error?error.message:'초대 처리에 실패했습니다.';return json({error:message},400);}
});
