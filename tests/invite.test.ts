import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseInvite,checkInviteState} from '../supabase/functions/invite-user/input.ts';
test('초대 이메일과 이름을 검증하고 정규화한다',()=>{assert.deepEqual(parseInvite({email:' A@TGS.COM ',display_name:' 홍길동 '}),{email:'a@tgs.com',display_name:'홍길동'});assert.throws(()=>parseInvite({email:'wrong',display_name:'김'}));assert.throws(()=>parseInvite({email:'a@tgs.com',display_name:' '}));});
test('차단 계정 재활성화와 즉시 재발송을 막고 미완료 초대 복구를 허용한다',()=>{assert.throws(()=>checkInviteState({is_active:false,last_invited_at:'2026-01-01T00:00:00Z'}),/차단/);assert.throws(()=>checkInviteState({is_active:true,last_invited_at:new Date().toISOString()}),/1분/);assert.doesNotThrow(()=>checkInviteState({is_active:false,last_invited_at:null}));});
