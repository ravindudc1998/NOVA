import React,{useEffect,useId,useRef,useState} from 'react';
import {navigateRoute} from './routes';
const can=(user:any,permission:string)=>Boolean(user&&(user.permissions.includes('platform.admin')||user.permissions.includes(permission)));
export function useSocial(user:any,api:any,identity:any){
 const owner=user?.id||'guest',current=useRef(owner);current.current=owner;
 const [state,setState]=useState<any>({owner,follows:[],notifications:{items:[],unread:0,nextCursor:null,enabled:true},error:''}),[busy,setBusy]=useState<Set<string>>(new Set());
 const data=state.owner===owner?state:{owner,follows:[],notifications:{items:[],unread:0,nextCursor:null,enabled:true},error:''};
 const reload=async()=>{if(!can(user,'follows.manage_own'))return;const follows=await api('/me/follows');if(current.current===owner)setState((previous:any)=>({...previous,owner,follows}));};
 useEffect(()=>{
  let disposed=false;const abort=new AbortController();setBusy(new Set());setState({owner,follows:[],notifications:{items:[],unread:0,nextCursor:null,enabled:true},error:''});
  if(!user)return;
  const load=()=>reload().catch(()=>{});void load();const interval=setInterval(()=>{if(document.visibilityState==='visible')void load();},10000);
  if(can(user,'streams.view'))(async()=>{
   while(!disposed){try{
    await identity.updateToken(30);if(disposed)return;
    const response=await fetch('/api/v1/me/notifications/events',{headers:{Authorization:`Bearer ${identity.token}`},signal:abort.signal,cache:'no-store'});
    if(!response.ok)throw new Error('Notifications unavailable. Sign in again if your session ended.');
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
    while(!disposed){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>1000000)throw new Error('Notification update was too large.');let boundary;
     while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(!frame.startsWith('data: '))continue;const value=JSON.parse(frame.slice(6));if(value.type==='notifications'&&!disposed)setState((previous:any)=>({...previous,owner,notifications:value,error:''}));}
    }
   }catch(error:any){if(!disposed)setState((previous:any)=>({...previous,error:error.message||'Reconnecting notifications…'}));}
   if(!disposed)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timeout);abort.signal.removeEventListener('abort',done);resolve();};const timeout=setTimeout(done,3000);abort.signal.addEventListener('abort',done,{once:true});});
   }
  })().catch(()=>{});
  return()=>{disposed=true;abort.abort();clearInterval(interval);};
 },[owner,api,can(user,'follows.manage_own'),can(user,'streams.view')]);
 const change=async(channel:any,notifyLive?:boolean)=>{
  if(busy.has(channel.id))return;setBusy(previous=>new Set(previous).add(channel.id));
  try{const followed=data.follows.some((item:any)=>item.id===channel.id);await api(`/me/follows/${channel.id}`,notifyLive===undefined?(followed?'DELETE':'PUT'):'PATCH',notifyLive===undefined?(followed?undefined:{}):{notifyLive});await reload();}
  finally{if(current.current===owner)setBusy(previous=>{const next=new Set(previous);next.delete(channel.id);return next;});}
 };
 const read=async(id?:string)=>{await api(id?`/me/notifications/${id}/read`:'/me/notifications/read-all','POST');const notifications=await api('/me/notifications');if(current.current===owner)setState((previous:any)=>({...previous,notifications}));};
 return {...data,busy,change,read,canFollow:can(user,'follows.manage_own')};
}
export function BellIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg>;}
export function FollowButton({channel,user,social,signin,run}:any){
 if(user?.channel?.id===channel.id||user&&!social?.canFollow)return null;
 const follow=social?.follows.find((item:any)=>item.id===channel.id),busy=social?.busy.has(channel.id);
 return <div className="follow-actions"><button className={`follow-button ${follow?'is-following':'primary'}`} disabled={busy} aria-pressed={Boolean(follow)} onClick={()=>{if(!user){signin();return;}void run(()=>social.change(channel));}}>{busy?'Saving…':follow?'Following':'Follow'}</button>{follow&&<button className={`follow-alerts ${follow.notifyLive?'is-on':''}`} aria-pressed={follow.notifyLive} aria-label={follow.notifyLive?'Turn live alerts off':'Turn live alerts on'} title={follow.notifyLive?'Live alerts on':'Live alerts off'} disabled={busy} onClick={()=>void run(()=>social.change(channel,!follow.notifyLive))}><BellIcon/></button>}</div>;
}
export function FollowingList({social}:any){
 if(!social.canFollow)return null;
 const follows=[...social.follows].sort((a:any,b:any)=>Number(b.state==='live')-Number(a.state==='live'));
 return <section className="following-section" aria-label="Following channels"><div className="side-label">FOLLOWING <span>{follows.length}</span></div><nav className="favourites-nav">{follows.map((channel:any)=><a className="favourite-channel" key={channel.id} href={`/channel/${channel.id}`} title={channel.title}><span className={`channel-dot ${channel.state==='live'?'live-dot':''}`} aria-label={channel.state==='live'?'Live':'Offline'}/><span><strong>{channel.owner.displayName}</strong><small>@{channel.slug} · {channel.state==='live'?'Live':'Offline'}</small></span></a>)}{!follows.length&&<p className="favourites-empty">Follow a creator to find them here.</p>}</nav></section>;
}
export function NotificationBell({social,api}:any){
 const [open,setOpen]=useState(false),[older,setOlder]=useState<any[]>([]),[next,setNext]=useState<string|null|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),menuId=useId();
 useEffect(()=>{if(!open)return;const pointer=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);},key=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};},[open]);
 const snapshot=social.notifications,items=[...new Map([...snapshot.items,...older].map((item:any)=>[item.id,item])).values()] as any[],cursor=next===undefined?snapshot.nextCursor:next;
 const action=async(task:()=>Promise<void>)=>{setBusy(true);setError('');try{await task();}catch(error:any){setError(error.message);}finally{setBusy(false);}};
 return <div className="notification-root" ref={root}><button className="notification-bell" aria-label={`Notifications${snapshot.unread?`, ${snapshot.unread} unread`:''}`} aria-expanded={open} aria-controls={menuId} onClick={()=>{if(!open){setOlder([]);setNext(undefined);setError('');}setOpen(value=>!value);}}><BellIcon/>{snapshot.unread>0&&<span>{snapshot.unread>99?'99+':snapshot.unread}</span>}</button>{open&&<section className="notification-menu" id={menuId} aria-label="Notifications"><div className="notification-heading"><h2>Notifications</h2><button className="subtle" disabled={busy||!snapshot.unread} onClick={()=>void action(async()=>{await social.read();setOlder(previous=>previous.map(item=>({...item,readAt:new Date().toISOString()})));})}>Mark all read</button></div>{!snapshot.enabled&&<p className="notification-status">Live alerts are paused by the administrator.</p>}{(error||social.error)&&<p className="notification-status is-error" role="alert">{error||social.error}</p>}<div className="notification-items">{items.map(item=><button className={`notification-item ${item.readAt?'':'is-unread'}`} key={item.id} onClick={()=>void action(async()=>{await social.read(item.id);setOpen(false);navigateRoute('channel/'+item.channelId);})}><span className="notification-dot"/><span><strong>{item.creatorName} went live</strong><span>{item.title}</span><small>{new Date(item.createdAt).toLocaleString()}{item.live?' · Live now':''}</small></span></button>)}{!items.length&&<p className="notification-empty">Follow creators to receive their live updates here.</p>}</div>{cursor&&<button className="notification-more secondary" disabled={busy} onClick={()=>void action(async()=>{const result=await api('/me/notifications?cursor='+cursor);setOlder(previous=>[...previous,...result.items]);setNext(result.nextCursor);})}>Load older notifications</button>}</section>}</div>;
}
