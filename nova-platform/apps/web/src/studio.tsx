import React,{useEffect,useRef,useState} from 'react';
import {LivePlayer} from './player';
import {Chat} from './chat';
import {StreamHealth} from './stream-health';
import {ModalDialog as StudioDialog} from './dialog';
import {ChannelTools} from './channel-tools';
import {AnalyticsDashboard} from './analytics';
import {CategorySelect} from './branding';

type Popup='obs'|'settings'|'tools'|'analytics'|null;
const languages:Record<string,string>={en:'English',si:'Sinhala',ta:'Tamil'};

export function StudioWorkspace({channel,effectiveSettings,branding,broadcastingAvailable,user,api,identity,run,openPopup,onStop}:any){
 const settings=effectiveSettings,live=channel.state==='live';
 return <div className="studio-manager">
  <div className="studio-toolbar"><div className="studio-title"><div className="eyebrow">CREATOR STUDIO</div><h1>Stream manager <span>@{channel.slug}</span></h1></div>
   <div className="studio-actions"><span className={`stage ${live?'is-live':''}`}>{channel.state.toUpperCase()}</span><button className="secondary" onClick={()=>openPopup('obs')}>Broadcast with OBS</button><button className="secondary" onClick={()=>openPopup('tools')}>Channel tools</button>{(user.permissions.includes('analytics.read_own')||user.permissions.includes('platform.admin'))&&<button className="secondary" onClick={()=>openPopup('analytics')}>Analytics</button>}<button className="primary" onClick={()=>openPopup('settings')}>Edit stream info</button><a className="studio-channel-link" href={`/channel/${channel.id}`} target="_blank" rel="noopener noreferrer" aria-label="Open your channel in a new tab" title="Open your channel in a new tab">↗</a>{channel.state!=='offline'&&<button className="danger" onClick={onStop}>Stop broadcast</button>}</div>
  </div>
  {!broadcastingAvailable&&<div className="info studio-publishing-notice">Publishing is unavailable. Your administrator may need to enable broadcasting or approve your channel.</div>}
  <div className="studio-workspace">
   <div className="studio-overview">
    <section className="panel studio-preview" aria-label="Live output monitor"><div className="studio-panel-heading"><h2>Live output monitor</h2><span>Starts muted</span></div>
     <div className="studio-preview-layout"><LivePlayer id={channel.id} state={channel.state} offlineImage={branding?.offline} api={api} user={user} signin={()=>identity.login({redirectUri:location.href})} monitor/>
      <div className="studio-stream-info"><span className="studio-info-label">YOUR BROADCAST</span><h3>{channel.title}</h3><dl><div><dt>Category</dt><dd>{settings.category}</dd></div><div><dt>Language</dt><dd>{languages[settings.language]||settings.language}</dd></div><div><dt>Channel chat</dt><dd>{settings.chatEnabled?'Enabled':'Disabled'}{settings.chatEnabled&&settings.slowModeSeconds>0?` · ${settings.slowModeSeconds}s slow mode`:''}</dd></div></dl><button className="subtle" onClick={()=>openPopup('settings')}>Edit stream info ↗</button></div>
     </div>
    </section>
    <StreamHealth key={channel.id} api={api} compact/>
   </div>
   <div className="studio-chat"><Chat key={channel.id} id={channel.id} user={user} api={api} identity={identity} run={run} signin={()=>identity.login({redirectUri:location.href})}/></div>
  </div>
 </div>;
}

export function CreatorStudio({user,api,identity,run,flash}:any){
 const [data,setData]=useState<any>(null),[popup,setPopup]=useState<Popup>(null),[editing,setEditing]=useState<any>(null);
 const [key,setKey]=useState(''),[saving,setSaving]=useState(false),[revealing,setRevealing]=useState(false),[rotating,setRotating]=useState(false);
 const [popupError,setPopupError]=useState(''),[popupNotice,setPopupNotice]=useState('');
 const mounted=useRef(false),requestVersion=useRef(0),popupRef=useRef<Popup>(null),popupVersion=useRef(0),keyVersion=useRef(0);
 const load=async()=>{const request=++requestVersion.current,result=await api('/me/channel');if(mounted.current&&request===requestVersion.current)setData(result);return result;};
 useEffect(()=>{
  mounted.current=true;void run(load);let busy=false;
  const timer=setInterval(()=>{if(busy)return;busy=true;load().catch(()=>{}).finally(()=>{busy=false;});},3000);
  return()=>{mounted.current=false;requestVersion.current++;popupVersion.current++;keyVersion.current++;clearInterval(timer);};
 },[api]);
 const openPopup=(value:Popup)=>{
  popupRef.current=value;popupVersion.current++;keyVersion.current++;
  setKey('');setRevealing(false);setPopupError('');setPopupNotice('');
  setEditing(value==='settings'?data:null);setPopup(value);
 };
 const runPopup=(task:()=>Promise<void>)=>run(async()=>{
  const version=popupVersion.current;setPopupError('');setPopupNotice('');
  try{await task();}catch(error:any){
   if(mounted.current&&popupRef.current&&popupVersion.current===version)setPopupError(error.message||'The request could not be completed.');
   else throw error;
  }
 });
 const reauthenticate=()=>identity.login({maxAge:0,redirectUri:location.origin+'/studio'});
 const reveal=()=>runPopup(async()=>{
  const version=++keyVersion.current;if(key){setKey('');return;}setRevealing(true);
  try{
   const result=await api('/me/channel/stream-key/reveal','POST');
   if(mounted.current&&popupRef.current==='obs'&&keyVersion.current===version)setKey(result.key);
  }catch(error:any){if(error.message==='REAUTHENTICATION_REQUIRED'){await reauthenticate();return;}throw error;}
  finally{if(mounted.current&&keyVersion.current===version)setRevealing(false);}
 });
 const copy=(value:string,message:string)=>runPopup(async()=>{
  const version=popupVersion.current;await navigator.clipboard.writeText(value);
  if(mounted.current&&popupRef.current==='obs'&&popupVersion.current===version)setPopupNotice(message);
 });
 const rotate=()=>runPopup(async()=>{
  setRotating(true);keyVersion.current++;setKey('');
  try{
   await api('/me/channel/stream-key/rotate','POST');await load();
   const message='Stream key rotated. Reveal and update your OBS settings.';
   if(mounted.current&&popupRef.current==='obs')setPopupNotice(message);else flash(message);
  }catch(error:any){if(error.message==='REAUTHENTICATION_REQUIRED'){await reauthenticate();return;}throw error;}
  finally{if(mounted.current){setRotating(false);setRevealing(false);}}
 });
 if(!data)return <div className="empty">Loading your studio…</div>;
 const c=data.channel,edit=editing||data;
 const stop=()=>run(async()=>{await api('/me/channel/stop','POST');keyVersion.current++;setKey('');await load();flash('Broadcast stopped. Your stream key has changed.');});
 const save=(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(saving)return;
  const form=new FormData(event.currentTarget),version=popupVersion.current;
  void runPopup(async()=>{
   setSaving(true);
   try{
    await api('/me/channel','PATCH',{version:edit.channel.version,title:form.get('title'),bio:form.get('bio'),settings:{language:form.get('language'),category:form.get('category'),chatEnabled:form.get('chatEnabled')==='on',slowModeSeconds:Number(form.get('slowModeSeconds'))}});
    await load();
    if(mounted.current&&popupRef.current==='settings'&&popupVersion.current===version)openPopup(null);
    flash('Your channel settings are saved.');
   }finally{if(mounted.current)setSaving(false);}
  });
 };
 return <>
  <StudioWorkspace channel={c} effectiveSettings={data.effectiveSettings} branding={data.branding} broadcastingAvailable={data.broadcasting.available} user={user} api={api} identity={identity} run={run} openPopup={openPopup} onStop={stop}/>
  {popup==='settings'&&<StudioDialog title="Make it yours" description="Update your stream details and channel chat." error={popupError} notice={popupNotice} onClose={()=>openPopup(null)}>
   <form onSubmit={save}>
    <label>Stream title<input name="title" defaultValue={edit.channel.title} maxLength={100} required autoFocus/></label>
    <label>About your channel<textarea name="bio" defaultValue={edit.channel.bio} maxLength={500} rows={3}/></label>
    <div className="form-row"><label>Language<select name="language" defaultValue={edit.effectiveSettings.language}><option value="en">English</option><option value="si">Sinhala</option><option value="ta">Tamil</option></select></label><CategorySelect api={api} defaultValue={edit.effectiveSettings.category}/></div>
    <label className="check"><input name="chatEnabled" type="checkbox" defaultChecked={edit.effectiveSettings.chatEnabled}/> Enable channel chat</label>
    <label>Chat slow mode (seconds)<input name="slowModeSeconds" type="number" min={0} max={120} defaultValue={edit.effectiveSettings.slowModeSeconds}/></label>
    <div className="studio-dialog-actions"><button type="button" className="secondary" onClick={()=>openPopup(null)}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':'Save channel settings'}</button></div>
   </form>
  </StudioDialog>}
  {popup==='analytics'&&<StudioDialog title="Creator analytics" description="Your broadcast history and audience observations." onClose={()=>openPopup(null)} wide><AnalyticsDashboard api={api}/></StudioDialog>}
  {popup==='tools'&&<ChannelTools id={c.id} api={api} canBrand canModerate onClose={()=>openPopup(null)} onChanged={load}/>}
  {popup==='obs'&&<StudioDialog title="Broadcast with OBS" description="Connect OBS to your NOVA channel." error={popupError} notice={popupNotice} onClose={()=>openPopup(null)}>
   <div className="studio-obs-fields">
    <label>Service<input readOnly value="Custom…"/></label>
    <div className="studio-server-field"><label htmlFor="studio-obs-server">Server</label><div className="studio-copy-field"><input id="studio-obs-server" readOnly value={data.broadcasting.server}/><button className="secondary" onClick={()=>copy(data.broadcasting.server,'OBS server copied.')}>Copy</button></div></div>
    <label>Stream key<input type={key?'text':'password'} readOnly value={key?data.broadcasting.keyPrefix+key:'••••••••••••••••••••••••'}/></label>
    <div className="actions"><button className="secondary" disabled={revealing||rotating} onClick={reveal}>{revealing?'Revealing…':key?'Hide stream key':'Reveal stream key'}</button>{key&&<button className="secondary" disabled={rotating} onClick={()=>copy(data.broadcasting.keyPrefix+key,'OBS stream key copied.')}>Copy key</button>}</div>
    <p className="help">OBS → Settings → Stream → Custom. Use H.264 video and AAC audio, with a 2 second keyframe interval. Start Streaming in OBS when ready.</p>
    <div className="studio-key-actions"><p>Rotating your private key ends any active broadcast. Update OBS with the new key before streaming again.</p><button className="danger" disabled={rotating} onClick={rotate}>{rotating?'Rotating…':'Rotate key & stop broadcast'}</button></div>
   </div>
  </StudioDialog>}
 </>;
}
