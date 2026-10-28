import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../../app/Session';
import { errorMessage, todayKST } from '../../lib/domain';
import { rpc, uploadAttachment } from '../../lib/api';
import type { RequestInput } from '../../lib/types';
import { Alert, PageTitle } from '../../components/UI';
import { ImagePicker } from './Images';
export function NewRequest(){
 const {customers}=useSession(),active=customers.filter(c=>c.is_active),navigate=useNavigate();
 const [form,setForm]=useState<RequestInput>({customer_id:active.length===1?active[0].id:'',title:'',description:'',requester_name:'',requested_on:todayKST(),requires_deployment:true}),[files,setFiles]=useState<File[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 function field<K extends keyof RequestInput>(key:K,value:RequestInput[K]){setForm(f=>({...f,[key]:value}));}
 async function submit(e:React.FormEvent){e.preventDefault();setError('');setBusy(true);let id:string|undefined;
 try{id=await rpc<string>('create_request',{payload:form});let attachmentError='';for(const file of files){try{await uploadAttachment(id,file);}catch(e){attachmentError=errorMessage(e);break;}}
 navigate(`/requests/${id}`,{replace:true,state:{notice:attachmentError?`요청은 저장되었습니다. 일부 이미지는 저장하지 못했습니다: ${attachmentError}. 첨부 목록에서 확인하고 다시 첨부해주세요.`:'요청이 등록되었습니다.'}});
 }catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <><Link className="back-link" to="/board">← 진행 현황</Link><PageTitle eyebrow="NEW REQUEST" title="요청 등록" description="고객사의 요청과 확인에 필요한 화면을 함께 기록하세요."/>{error&&<Alert>{error}</Alert>}{!active.length&&<Alert tone="info">등록 가능한 고객사가 없습니다. 관리자에게 담당 고객사 배정을 요청해주세요.</Alert>}
 <form onSubmit={submit} className="form-panel"><div className="form-grid"><label>고객사 <em>*</em><select required value={form.customer_id} onChange={e=>field('customer_id',e.target.value)}><option value="">고객사 선택</option>{active.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>요청일 <em>*</em><input type="date" required value={form.requested_on} onChange={e=>field('requested_on',e.target.value)}/></label></div><label>제목 <em>*</em><input autoFocus required maxLength={150} value={form.title} onChange={e=>field('title',e.target.value)} placeholder="어떤 요청인지 간단하게 적어주세요"/></label><label>요청 내용 <em>*</em><textarea required rows={8} maxLength={10000} value={form.description} onChange={e=>field('description',e.target.value)} placeholder="현재 동작, 요청한 변경 내용, 확인 방법을 기록해주세요."/></label><div className="form-grid"><label>고객사 요청자<input maxLength={80} value={form.requester_name} onChange={e=>field('requester_name',e.target.value)} placeholder="선택 입력"/></label><label className="check"><input type="checkbox" checked={form.requires_deployment} onChange={e=>field('requires_deployment',e.target.checked)}/>서버 배포가 필요한 요청</label></div><div className="section-label">첨부 이미지 <span>선택</span></div><ImagePicker files={files} onChange={setFiles} disabled={busy}/><div className="form-actions"><Link className="button" to="/board">취소</Link><button className="primary" disabled={busy||!active.length}>{busy?'요청과 이미지 저장 중…':'요청 등록'}</button></div></form></>;
}
