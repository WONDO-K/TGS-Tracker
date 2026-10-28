import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { prepareImage } from '../../lib/image';
import { errorMessage } from '../../lib/domain';
import { Alert } from '../../components/UI';
export function ImagePicker({files,onChange,disabled=false,remaining=5}:{files:File[];onChange:(files:File[])=>void;disabled?:boolean;remaining?:number}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[previews,setPreviews]=useState<string[]>([]);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{const urls=files.map(f=>URL.createObjectURL(f));setPreviews(urls);return()=>urls.forEach(u=>URL.revokeObjectURL(u));},[files]);
 async function add(selected:File[]){if(disabled||busy)return;setError('');if(selected.length+files.length>remaining){setError(`이미지는 ${remaining}장까지 추가할 수 있습니다.`);return;}setBusy(true);try{const prepared=await Promise.all(selected.map(prepareImage));onChange([...files,...prepared]);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 function paste(e:ClipboardEvent){const images=Array.from(e.clipboardData.files);if(images.length){e.preventDefault();void add(images);}}
 return <div className="image-picker" onPaste={paste} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void add(Array.from(e.dataTransfer.files));}} tabIndex={disabled?-1:0} aria-label="이미지 첨부 영역"><input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={disabled||busy} onChange={e=>{void add(Array.from(e.target.files||[]));e.target.value='';}} hidden/>
 <button className="upload-zone" type="button" disabled={disabled||busy||remaining<=files.length} onClick={()=>input.current?.click()}><span>＋</span><strong>{busy?'이미지 준비 중…':'화면 캡처를 첨부하세요'}</strong><small>끌어다 놓기 · 파일 선택 · 이 영역에서 Ctrl+V<br/>PNG, JPEG, WebP · 원본 10MB 이하 · 최대 5장</small></button>
 {error&&<Alert>{error}</Alert>}<div className="image-previews">{files.map((f,i)=><figure key={`${f.name}-${i}`}><img src={previews[i]} alt={`${f.name} 첨부 전 미리보기`}/><figcaption><span>{f.name} · {Math.ceil(f.size/1024)}KB</span><button type="button" disabled={disabled} onClick={()=>onChange(files.filter((_,n)=>n!==i))} aria-label={`${f.name} 선택 취소`}>×</button></figcaption></figure>)}</div></div>;
}
