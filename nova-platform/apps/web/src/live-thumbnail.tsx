import React,{useEffect,useRef,useState} from 'react';

export function ThumbnailFrame({initial,preview,onError}: {initial:string;preview?:string;onError?:()=>void}){
 return <><strong aria-hidden="true">{initial}</strong>{preview&&<img className="live-thumbnail" src={preview} alt="" decoding="async" onError={onError}/>}</>;
}
export function LiveThumbnail({id,live,initial,api,viewer='guest',fallbackImage}: {id:string;live:boolean;initial:string;api?:any;viewer?:string;fallbackImage?:string}){
 const [failedFallback,setFailedFallback]=useState('');
 const surface=useRef<HTMLSpanElement>(null),[preview,setPreview]=useState<{key:string;url:string}|null>(null),key=`${viewer}:${id}`;
 useEffect(()=>{
  setPreview(null);
  if(!live||!api)return;
  let disposed=false,busy=false,inView=typeof IntersectionObserver==='undefined',url='',request:AbortController|undefined;
  const clear=()=>{if(url)URL.revokeObjectURL(url);url='';if(!disposed)setPreview(null);};
  const load=async()=>{
   if(disposed||busy||!inView||document.visibilityState==='hidden')return;busy=true;request=new AbortController();const timeout=setTimeout(()=>request?.abort(),8000);
   try{
    const image=await api(`/channels/${id}/thumbnail`,'GET',undefined,request.signal);
    if(!(image instanceof Blob)||image.type!=='image/jpeg'||image.size>524288)throw new Error('Preview unavailable.');
    if(disposed)return;const next=URL.createObjectURL(image);if(url)URL.revokeObjectURL(url);url=next;setPreview({key,url});
   }catch{clear();}finally{clearTimeout(timeout);busy=false;}
  };
  const visible=()=>{if(document.visibilityState==='hidden')request?.abort();else void load();};
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{inView=entries.some(entry=>entry.isIntersecting);if(inView)void load();else request?.abort();});
  if(surface.current)observer?.observe(surface.current);void load();const timer=setInterval(()=>void load(),15000);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;request?.abort();clearInterval(timer);observer?.disconnect();document.removeEventListener('visibilitychange',visible);clear();};
 },[id,live,api,viewer]);
 const current=live&&preview?.key===key?preview.url:failedFallback===fallbackImage?undefined:fallbackImage;
 return <span ref={surface} className="thumbnail-surface"><ThumbnailFrame initial={initial} preview={current} onError={()=>{if(current===fallbackImage)setFailedFallback(fallbackImage||'');setPreview(null);}}/></span>;
}
