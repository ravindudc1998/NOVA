import React,{useEffect,useRef,useState} from 'react';
import {scrollChatToEnd} from './chat-scroll';
import {PlayerIcon} from './player-icons';
import {ModalDialog} from './dialog';
import {ChannelTools} from './channel-tools';

export function Chat({id,user,api,identity,run,signin,onClose}:any){
 const [messages,setMessages]=useState<any[]>([]),[text,setText]=useState(''),[policy,setPolicy]=useState<any>({enabled:false,canModerate:false,canSend:false}),[status,setStatus]=useState('Connecting…'),[sending,setSending]=useState(false);
 const [toolsOpen,setToolsOpen]=useState(false);
 const [action,setAction]=useState<any>(null),[actionError,setActionError]=useState(''),[actionBusy,setActionBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 const tail=useRef<HTMLDivElement>(null),mounted=useRef(true),epoch=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  setToolsOpen(false);setMessages([]);setPolicy({enabled:false,canSend:false});setAction(null);setText('');setError('');
  epoch.current=0;
  if(!user)return;let disposed=false;const abort=new AbortController();
  const adopt=(value:number)=>{if(disposed||value<epoch.current)return false;if(value>epoch.current){epoch.current=value;setMessages([]);setAction(null);setText('');setFeedback('Stream ended. Chat cleared.');}return true;};
  const merge=(items:any[],generation=epoch.current)=>{if(!adopt(generation))return;setMessages(previous=>{const map=new Map(previous.map(message=>[message.id,message]));items.filter(message=>message.epoch===generation).forEach(message=>map.set(message.id,message));return [...map.values()].sort((a,b)=>a.id-b.id).slice(-100);});};
  const refresh=async()=>{try{const value=await api(`/channels/${id}/chat`,'GET',undefined,abort.signal);if(adopt(value.epoch)){merge(value.messages,value.epoch);setPolicy(value);}}catch{}};
  (async()=>{while(!disposed){try{
   await identity.updateToken(30);if(disposed)return;
   const response=await fetch(`/api/v1/channels/${id}/chat/events`,{headers:{Authorization:`Bearer ${identity.token}`},signal:abort.signal,cache:'no-store'});
   if(!response.ok)throw new Error(response.status===401?'Sign in again to join chat.':'Chat is unavailable for this account.');
   if(disposed)return;setStatus('Connected');const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
   while(!disposed){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(!frame.startsWith('data: '))continue;const event=JSON.parse(frame.slice(6));
     if(event.type==='message')merge([event.message],event.message.epoch);
     else if(event.type==='history'){if(adopt(event.epoch)){merge(event.messages,event.epoch);setPolicy(event);}}
     else if(event.type==='deleted')setMessages(list=>list.map(message=>message.id===event.id?{...message,deleted:true,text:''}:message));
     else if(event.type==='policy'){if(adopt(event.epoch))setPolicy(event);}
     else if(event.type==='reset')adopt(event.epoch);
     else if(event.type==='refresh')void refresh();
    }
   }
  }catch(error:any){if(!disposed)setStatus(error.message||'Reconnecting…');}
  if(!disposed){setStatus('Reconnecting…');await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timeout);abort.signal.removeEventListener('abort',done);resolve();};const timeout=setTimeout(done,2500);abort.signal.addEventListener('abort',done,{once:true});});}
  }})().catch(()=>{});
  return()=>{disposed=true;abort.abort();};
 },[id,user?.id]);
 useEffect(()=>{scrollChatToEnd(tail.current);},[messages.length]);
 const open=(message:any,kind='menu')=>{setActionError('');setAction({message,kind});};
 const perform=async(path:string,method:string,body?:any)=>{
  if(actionBusy)return;const expected=action;setActionBusy(true);setActionError('');
  try{await api(path,method,body);if(mounted.current){setAction((current:any)=>current===expected?null:current);setFeedback(expected.kind==='report'?'Report sent to the channel moderators.':'Moderation action saved.');}}
  catch(error:any){if(mounted.current)setActionError(error.message);}
  finally{if(mounted.current)setActionBusy(false);}
 };
 const restriction=policy.restriction,canSend=Boolean(policy.canSend),placeholder=restriction?.kind==='ban'?'You are banned from this channel’s chat':restriction?'You are temporarily timed out':policy.enabled?'Send a message…':'Chat is disabled';
 return <section className="panel chat-panel" aria-label="Live chat"><div className="chat-heading"><div className="chat-title-row"><h2>Live chat</h2><div className="chat-heading-actions">{policy.canModerate&&<button type="button" className="chat-tools-button" onClick={()=>setToolsOpen(true)}>Moderation</button>}{onClose&&<button type="button" className="chat-close" aria-label="Hide chat" title="Hide chat" onClick={onClose}><PlayerIcon name="close"/></button>}</div></div><span className="muted small">{user?status:'Sign in to join'}</span></div>
  <div className="chat-messages" aria-live="polite">{messages.map(message=><div className="chat-message" key={message.id}><b>{message.displayName}</b><span>{message.deleted?<i>Message removed</i>:message.text}</span>{!message.deleted&&(policy.canModerate||policy.canReport&&message.authorId!==user?.id)&&<button className="subtle chat-message-action" aria-label={`Actions for message from ${message.displayName}`} title="Message actions" onClick={()=>open(message)}>⋯</button>}</div>)}{!messages.length&&<p className="help">{user?'Say hello to the community.':'Sign in to read and send chat messages.'}</p>}<div ref={tail}/></div>
  {user?<form className="chat-compose" onSubmit={event=>{
   event.preventDefault();if(!text.trim()||sending||!canSend)return;const message=text;setSending(true);setError('');setFeedback('');
   api(`/channels/${id}/chat`,'POST',{text:message,clientMessageId:crypto.randomUUID(),epoch:epoch.current}).then(()=>{if(mounted.current)setText('');}).catch((error:any)=>{if(mounted.current)setError(error.message);}).finally(()=>{if(mounted.current)setSending(false);});
  }}>{restriction&&<p className="chat-restriction" role="status">{restriction.kind==='ban'?'You are banned from sending messages here.':`Timed out until ${new Date(restriction.expiresAt).toLocaleTimeString()}.`}{restriction.reason?` ${restriction.reason}`:''}</p>}{error&&<p className="chat-feedback is-error" role="alert">{error}</p>}{feedback&&<p className="chat-feedback" role="status">{feedback}</p>}<label className="sr-only" htmlFor={`message-${id}`}>Chat message</label><textarea id={`message-${id}`} value={text} maxLength={500} rows={2} disabled={!canSend} placeholder={placeholder} onChange={event=>setText(event.target.value)}/><div className="chat-send"><small>{policy.slowModeSeconds?`${policy.slowModeSeconds}s slow mode`:`${text.length}/500`}</small><button className="primary" disabled={!canSend||sending||!text.trim()}>Send</button></div></form>:<button className="primary" onClick={()=>signin()}>Sign in to chat</button>}
  {toolsOpen&&<ChannelTools id={id} api={api} canBrand={false} canModerate onClose={()=>setToolsOpen(false)}/>}
  {action&&<ModalDialog title={action.kind==='menu'?'Message actions':action.kind==='report'?'Report message':action.kind==='ban'?'Ban from this channel':'Time out from this channel'} description={`Message from ${action.message.displayName}`} error={actionError} onClose={()=>setAction(null)}>
   <blockquote className="message-action-preview">{action.message.text}</blockquote>
   {action.kind==='menu'?<div className="message-action-buttons">{policy.canModerate&&<><button className="secondary" disabled={actionBusy} onClick={()=>void perform(`/channels/${id}/chat/${action.message.id}`,'DELETE')}>Delete message</button>{action.message.authorId&&action.message.authorId!==user?.id&&<><button className="secondary" disabled={actionBusy} onClick={()=>open(action.message,'timeout')}>Time out sender</button><button className="danger" disabled={actionBusy} onClick={()=>open(action.message,'ban')}>Ban sender</button></>}</>}{policy.canReport&&action.message.authorId!==user?.id&&<button className="secondary" disabled={actionBusy} onClick={()=>open(action.message,'report')}>Report message</button>}</div>:<form onSubmit={event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);
    if(action.kind==='report')void perform(`/channels/${id}/chat/${action.message.id}/reports`,'POST',{reason:form.get('reason'),details:form.get('details')});
    else void perform(`/channels/${id}/moderation/users/${action.message.authorId}`,'PUT',{kind:action.kind,reason:form.get('reason'),...(action.kind==='timeout'?{seconds:Number(form.get('seconds'))}:{})});
   }}>{action.kind==='report'?<><label>Reason<select name="reason"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="hate">Hateful content</option><option value="other">Other</option></select></label><label>Details<textarea name="details" maxLength={500} rows={3}/></label></>:<>{action.kind==='timeout'&&<label>Duration<select name="seconds"><option value="300">5 minutes</option><option value="3600">1 hour</option><option value="86400">24 hours</option><option value="604800">7 days</option></select></label>}<label>Reason<input name="reason" maxLength={300} placeholder="Optional reason"/></label><p className="tools-help">This restricts sending messages in this channel. You can lift it under Channel tools → Moderation.</p></>}<div className="studio-dialog-actions"><button type="button" className="secondary" onClick={()=>setAction(null)}>Cancel</button><button className={action.kind==='ban'?'danger':'primary'} disabled={actionBusy}>{actionBusy?'Saving…':action.kind==='report'?'Submit report':action.kind==='ban'?'Ban sender':'Apply timeout'}</button></div></form>}
  </ModalDialog>}
 </section>;
}
