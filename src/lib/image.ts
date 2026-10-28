import { validateImage } from './domain';
export async function prepareImage(file:File):Promise<File>{
 validateImage(file);const bitmap=await createImageBitmap(file);
 try {
 const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
 if(scale===1&&file.size<=2*1024*1024)return file;
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이미지 처리를 지원하지 않는 브라우저입니다.');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 for(const quality of [.9,.8,.7]){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob&&blob.size<=2*1024*1024)return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.webp',{type:blob.type});}
 throw new Error('2MB 이하로 줄이지 못했습니다. 이미지 크기를 줄여 다시 선택해주세요.');
 }finally{bitmap.close();}
}
