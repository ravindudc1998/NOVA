import React,{useCallback,useEffect,useState} from 'react';
import {Watch} from './live';
import {Discover,FavouriteList,Home} from './channel-pages';
import {useChannelLibrary} from './channel-library';
import {interceptNavigation,navigateRoute,normalizeLocation,readRoute} from './routes';
import {useSocial,FollowingList,NotificationBell} from './social';
import {AccountPage} from './accounts';
import {AnalyticsDashboard} from './analytics';
import {PageBoundary} from './error-boundary';

const can=(user:any,permission:string)=>Boolean(user&&(user.permissions.includes('platform.admin')||user.permissions.includes(permission)));
const adminAccess=(user:any)=>['operations.read','users.manage','groups.manage','settings.manage','audit.read','streams.stop_any','categories.manage','reports.review','channels.manage_any','analytics.read_any','restreams.manage_any'].some(permission=>can(user,permission));

export function App({identity,api,config,Admin,Studio}:any){
 const [user,setUser]=useState<any>(null),[route,setRoute]=useState(()=>readRoute(location.pathname,location.hash)),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const loadUser=async()=>{
  if(identity.authenticated){const accountType=sessionStorage.getItem('nova-signup-type')==='creator'?'creator':'viewer',value=await api('/me/bootstrap','POST',{accountType});sessionStorage.removeItem('nova-signup-type');setUser(value);if(!value.channel&&readRoute(location.pathname,location.hash)==='studio')navigateRoute(adminAccess(value)?'admin':'home');}
  else setUser(null);setLoading(false);
 };
 const run=useCallback(async(task:()=>Promise<unknown>)=>{setError('');try{await task();}catch(cause:any){setError(cause.message||'The request could not be completed.');}},[]);
 const social=useSocial(loading?null:user,api,identity);
 const library=useChannelLibrary(loading?null:user,api);
 useEffect(()=>{
  loadUser().catch(cause=>{setError(cause.message);setLoading(false);});
  const changed=()=>{setError('');setRoute(normalizeLocation());};window.addEventListener('popstate',changed);window.addEventListener('hashchange',changed);document.addEventListener('click',interceptNavigation);
  return()=>{window.removeEventListener('popstate',changed);window.removeEventListener('hashchange',changed);document.removeEventListener('click',interceptNavigation);};
 },[]);
 const signin=(register=false,type='creator')=>{
  if(register)sessionStorage.setItem('nova-signup-type',type);
  const destination=!register&&(route.startsWith('channel/')||route==='account'||route==='analytics')?route:'home',options={redirectUri:location.origin+'/'+destination};
  return register?identity.register(options):identity.login(options);
 };
 const flash=(message:string)=>{setNotice(message);setTimeout(()=>setNotice(''),4500);};
 const studioMode=route==='studio'&&Boolean(user?.channel);
 const favouriteProps={library,canFavourite:can(user,'favourites.manage_own'),onToggle:(channel:any)=>run(()=>library.toggle(channel)),thumbnailApi:api,thumbnailViewer:user?.id||'guest'};
 return <><header><a href="/home" className="brand"><span>{String(config.name||'NOVA').slice(0,1)}</span><b className="wordmark">{String(config.name||'NOVA').toLowerCase()}</b><i/></a><div className="header-center">YOUR COMMUNITY. YOUR SERVER.</div><div className="header-actions"><span className="local-dot">Local</span>{user?<><span className="user-name">{user.displayName}</span><NotificationBell social={social} api={api}/><a className="account-header-link" href="/account" title="My account">My account</a><button className="subtle" onClick={()=>identity.logout({redirectUri:location.origin+'/home'})}>Sign out</button></>:<><button className="subtle" onClick={()=>signin()}>Sign in</button><button className="primary" onClick={()=>signin(true)}>Become a creator ↗</button></>}</div></header>
 <aside className={studioMode?'studio-navigation':undefined}><div className="side-label">YOUR SPACE</div><nav className="space-links" aria-label="Your space"><a className={route==='home'?'active':''} href="/home" title="Home"><span aria-hidden="true">⌂</span><b className="nav-label">Home</b></a><a className={route==='discover'?'active':''} href="/discover" title="Discover"><span aria-hidden="true">◈</span><b className="nav-label">Discover</b></a>{user?.channel&&<a className={route==='studio'?'active':''} href="/studio" title="Creator studio"><span aria-hidden="true">▷</span><b className="nav-label">Creator studio</b></a>}{adminAccess(user)&&<a className={route==='admin'?'active':''} href="/admin" title="Administration"><span aria-hidden="true">▦</span><b className="nav-label">Administration</b></a>}{user?.channel&&can(user,'analytics.read_own')&&<a className={route==='analytics'?'active':''} href="/analytics" title="Creator analytics"><span aria-hidden="true">▥</span><b className="nav-label">Analytics</b></a>}</nav>{user&&<><FavouriteList library={library}/><FollowingList social={social}/></>}</aside>
 <main className={[user?'main-with-favourites main-with-follows':'',studioMode?'studio-main':''].filter(Boolean).join(' ')}><div className="page-content">{notice&&<div className="toast" role="status">{notice}</div>}{error&&<div className="error" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}{config.announcement&&<div className="announcement">{config.announcement}</div>}
 <PageBoundary resetKey={route}>{loading?<div className="empty">Getting your space ready…</div>:route==='home'?<Home user={user} signin={signin} run={run} {...favouriteProps}/>:route==='discover'?<Discover api={api} run={run} {...favouriteProps}/>:route==='account'?<AccountPage user={user} api={api} identity={identity} refreshUser={loadUser} config={config} signin={signin}/>:route==='analytics'?user?.channel?<AnalyticsDashboard api={api}/>:<div className="empty"><h1>Creator analytics</h1><p>Open My account to create your channel.</p><a href="/account" className="primary button-link">My account</a></div>:route==='studio'?user?.channel?<Studio user={user} run={run} flash={flash}/>:<section className="empty"><h1>Your next chapter starts here.</h1><p>Create a creator account to get your personal channel and studio automatically.</p>{!user&&<button className="primary" onClick={()=>signin(true)}>Create creator account ↗</button>}{user&&<p>This is a viewer account. Open My account to upgrade this viewer account to a creator.</p>}</section>:route==='admin'?adminAccess(user)?<Admin user={user} run={run} flash={flash} refreshUser={loadUser}/>:<div className="empty"><h1>Administrator access required.</h1><p>Your current account does not have access to this section.</p></div>:<Watch key={route} id={route.slice(8)} social={social} user={user} api={api} identity={identity} run={run} signin={signin} onVisit={library.visit} {...favouriteProps}/>}</PageBoundary>
 </div><footer><span>NOVA · Your local streaming platform</span><span>Local live video & community chat</span></footer></main></>;
}
