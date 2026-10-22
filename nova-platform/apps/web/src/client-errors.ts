export function safeErrorText(value:unknown,maxLength=2000){
 return String(value||'Unknown display error')
  .replace(/\bBearer\s+\S+/gi,'Bearer [redacted]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[redacted token]')
  .replace(/https?:\/\/[^\s)]+/g,value=>{try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return '[URL]';}})
  .slice(0,maxLength);
}
export function routeKind(hash:string,pathname='/'){const name=(hash?hash.replace(/^#\/?/,''):pathname.replace(/^\//,'')).split('/')[0]||'home';return ['home','discover','studio','admin','channel'].includes(name)?name:'other';}
let reports=0,windowStart=0;
export function reportClientError(kind:'react'|'runtime'|'promise'|'startup'|'navigation',error:unknown,componentStack=''){
 const now=Date.now();if(now-windowStart>60000){reports=0;windowStart=now;}
 const reference=globalThis.crypto?.randomUUID?.()||now.toString(36);
 if(++reports>10)return reference;
 const detail=error instanceof Error?error:new Error(String(error));
 try{fetch('/api/v1/client-errors',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference,kind,route:routeKind(location.hash,location.pathname),message:safeErrorText(detail.message,1000),stack:safeErrorText(detail.stack||'',3000),componentStack:safeErrorText(componentStack,2000)}),signal:AbortSignal.timeout(3000)}).catch(()=>{});}catch{}
 return reference;
}
export function installErrorReporting(){
 window.addEventListener('error',event=>{if(event.error)reportClientError('runtime',event.error);});
 window.addEventListener('unhandledrejection',event=>reportClientError('promise',event.reason));
 let navigationReports=0;
 const inspect=()=>{if(++navigationReports>4)return;const root=document.getElementById('root'),main=document.querySelector('main');reportClientError('navigation',new Error(JSON.stringify({ready:document.readyState,visible:document.visibilityState,rootChildren:root?.childElementCount||0,rootHeight:Math.round(root?.getBoundingClientRect().height||0),header:Boolean(document.querySelector('header')),main:Boolean(main),mainHeight:Math.round(main?.getBoundingClientRect().height||0),loading:Boolean(document.getElementById('nova-boot')),recovery:Boolean(document.querySelector('.error-page')),bodyColor:getComputedStyle(document.body).color})));};
 setTimeout(inspect,3000);setTimeout(inspect,10000);window.addEventListener('hashchange',()=>setTimeout(inspect,700));window.addEventListener('popstate',()=>setTimeout(inspect,700));
}
