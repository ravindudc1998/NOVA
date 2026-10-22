type Video=Pick<HTMLVideoElement,'paused'|'ended'|'readyState'|'currentTime'|'addEventListener'|'removeEventListener'>;
type Options={uuid?:()=>string;leave?:(url:string,body:string)=>void;now?:()=>number;warmupMs?:number;intervalMs?:number};
export function trackViewer(video:Video,id:string,api:any,options:Options={}){
 const uuid=options.uuid||(()=>crypto.randomUUID()),now=options.now||Date.now,intervalMs=options.intervalMs||10000;
 const leave=options.leave||((url,body)=>{const blob=new Blob([body],{type:'application/json'});if(!navigator.sendBeacon?.(url,blob))void fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'same-origin',keepalive:true}).catch(()=>{});});
 let lease:string|undefined,disposed=false,busy=false,lastSent=0,lastPosition=-1,warmup:ReturnType<typeof setTimeout>|undefined,request:AbortController|undefined;
 const stop=()=>{const ended=lease;lease=undefined;request?.abort();if(warmup)clearTimeout(warmup);if(ended)try{leave(`/api/v1/play/${id}/presence/leave`,JSON.stringify({leaseId:ended}));}catch{}};
 const tick=async(force=false)=>{
  if(disposed||busy||!lease||video.paused||video.ended||video.readyState<2||!Number.isFinite(video.currentTime))return;
  if(!force&&(now()-lastSent<intervalMs||video.currentTime<=lastPosition+0.25))return;
  const active=lease;busy=true;lastSent=now();lastPosition=video.currentTime;request=new AbortController();const timeout=setTimeout(()=>request?.abort(),8000);
  try{await api(`/play/${id}/presence/heartbeat`,'POST',{leaseId:active,position:video.currentTime},request.signal);}catch{}finally{clearTimeout(timeout);busy=false;}
 };
 const start=()=>{if(disposed||lease||video.paused||video.ended||video.readyState<2)return;try{lease=uuid();}catch{return;}lastPosition=-1;lastSent=0;void tick(true);warmup=setTimeout(()=>void tick(true),options.warmupMs??2000);};
 const progress=()=>{if(!lease)start();else void tick();};
 video.addEventListener('playing',start);video.addEventListener('timeupdate',progress);for(const event of ['pause','ended','error','emptied'])video.addEventListener(event,stop);
 const pageHide=()=>stop(),pageShow=()=>start();if(typeof window!=='undefined'){window.addEventListener('pagehide',pageHide);window.addEventListener('pageshow',pageShow);}
 const interval=setInterval(()=>{if(!lease)start();else void tick();},intervalMs);start();
 return()=>{disposed=true;stop();clearInterval(interval);video.removeEventListener('playing',start);video.removeEventListener('timeupdate',progress);for(const event of ['pause','ended','error','emptied'])video.removeEventListener(event,stop);if(typeof window!=='undefined'){window.removeEventListener('pagehide',pageHide);window.removeEventListener('pageshow',pageShow);}};
}
