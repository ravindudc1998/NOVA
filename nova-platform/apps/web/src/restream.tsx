import React,{useEffect,useRef,useState} from 'react';
import {ModalDialog} from './dialog';
import './restream.css';
const providers:Record<string,{name:string;help:string;url:string}>={
 twitch:{name:'Twitch',help:'Copy the ingest server URL and stream key from your Twitch dashboard. Follow your account’s simulcasting terms.',url:'https://dev.twitch.tv/docs/video-broadcast/'},
 youtube:{name:'YouTube Live',help:'Create or select a broadcast in Live Control Room. Copy its RTMPS URL and stream key; check its preview and Go Live settings.',url:'https://support.google.com/youtube/answer/2907883'},
 facebook:{name:'Facebook Live',help:'Open Live Producer, select streaming software, and copy the server URL and key. You may need to click Go Live there.',url:'https://www.facebook.com/live/producer/'},
 linkedin:{name:'LinkedIn Live',help:'An eligible account and a scheduled Live Event are required. Get its URL/key in Live Studio, then use Go Live after checking the preview.',url:'https://www.linkedin.com/help/linkedin/answer/a564446/'},
 custom:{name:'Custom RTMP/RTMPS',help:'Use the public server URL and stream key supplied by your streaming destination. Ports 1935 and 443 are supported.',url:''},
};
const labels:Record<string,string>={paused:'Paused',blocked:'Disabled by administrator',waiting:'Waiting for your live stream',starting:'Connecting',sending:'Sending',reconnecting:'Reconnecting',error:'Needs attention',queued:'Queued for capacity'};
const errors:Record<string,string>={connection_failed:'The destination could not keep a connection. Check its URL, key and dashboard.',address_rejected:'The destination must resolve to a public streaming server.',source_unavailable:'Waiting for a fresh NOVA video output.',source_audio_missing:'Add an audio source in OBS before relaying this stream.',output_failed:'The relay stopped. Check the destination preview and encoder requirements.',capacity:'Waiting for an available relay slot.',worker_unavailable:'The relay worker is unavailable.'};

export function RestreamDialog({api,onClose,channelId}:any){
 const base=channelId?`/admin/channels/${channelId}/restreams`:'/me/channel/restreams';
 const [data,setData]=useState<any>(null),[editing,setEditing]=useState<any>(null),[provider,setProvider]=useState('twitch'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(false),revision=useRef(0),busyRef=useRef(false);
 const load=async()=>{const current=++revision.current,result=await api(base);if(mounted.current&&current===revision.current)setData(result);};
 useEffect(()=>{mounted.current=true;void load().catch((e:any)=>{if(mounted.current)setError(e.message);});const timer=setInterval(()=>{if(!busyRef.current)void load().catch(()=>{});},4000);return()=>{mounted.current=false;revision.current++;clearInterval(timer);};},[api,base]);
 const mutate=async(action:()=>Promise<any>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');revision.current++;try{const result=await action();if(mounted.current){setData(result);setEditing(null);}}catch(e:any){if(mounted.current)setError(e.message);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
 const edit=(row?:any)=>{const value=row||{provider:'twitch',name:'',serverUrl:'',enabled:false,maxHeight:720};setProvider(value.provider);setEditing(value);setError('');};
 return <ModalDialog wide title="Multistream" description={data?`Send @${data.channel.slug} to your other platforms.`:'Connect your live stream to other platforms.'} error={error} onClose={onClose}>
  {!data?<p className="tools-help">Loading destinations…</p>:<>
   <div className="restream-intro"><p>OBS sends one stream to NOVA. Enabled destinations receive your live output automatically. <strong>Sending</strong> confirms relay traffic; use each platform’s dashboard to check its preview and publish it to your audience.</p><span>{data.destinations.length}/{data.policy.maxDestinations} destinations</span></div>
   {!data.policy.enabled&&<div className="info">Your administrator has disabled multistreaming. You can still manage your saved destinations.</div>}
   <div className="restream-heading"><h3>Your destinations</h3><button className="primary" disabled={busy||data.destinations.length>=data.policy.maxDestinations} onClick={()=>edit()}>+ Add destination</button></div>
   <div className="restream-list">{!data.destinations.length&&<div className="restream-empty">Add Twitch, YouTube, Facebook, LinkedIn or a custom streaming destination.</div>}{data.destinations.map((row:any)=><section className="restream-card" key={row.id}>
    <div className="restream-card-heading"><div><span className="studio-info-label">{providers[row.provider]?.name||row.provider}</span><h3>{row.name}</h3></div><span className={`restream-state is-${row.status}`}>{labels[row.status]||row.status}</span></div>
    <p className="restream-address">{row.serverUrl}</p><div className="restream-details"><span>Up to {row.maxHeight}p · 30 fps</span><span>Key saved</span>{row.status==='sending'&&<span>{(row.bitrateKbps/1000).toFixed(2)} Mbps</span>}</div>
    {row.enabled&&['error','reconnecting','queued'].includes(row.status)&&row.errorCode&&<p className="tools-help" role="status">{errors[row.errorCode]||'Waiting for the destination.'}</p>}
    <div className="restream-card-actions"><button className={row.enabled?'secondary':'primary'} disabled={busy} onClick={()=>void mutate(()=>api(`${base}/${row.id}`,'PATCH',{version:row.version,enabled:!row.enabled}))}>{row.enabled?'Pause relay':'Enable relay'}</button><button className="secondary" disabled={busy} onClick={()=>edit(row)}>Edit</button><button className="subtle" disabled={busy} onClick={()=>void mutate(()=>api(`${base}/${row.id}?version=${row.version}`,'DELETE'))}>Remove</button></div>
   </section>)}</div>
   {editing&&<form className="restream-editor" key={editing.id||'new'} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget),key=String(form.get('streamKey')||'');void mutate(()=>api(`${base}${editing.id?'/'+editing.id:''}`,editing.id?'PATCH':'POST',{provider:form.get('provider'),name:form.get('name'),serverUrl:form.get('serverUrl'),enabled:form.get('enabled')==='on',maxHeight:Number(form.get('maxHeight')),...(key?{streamKey:key}:{}),...(editing.id?{version:editing.version}:{})}));}}>
    <h3>{editing.id?'Edit destination':'Add destination'}</h3><div className="form-row"><label>Platform<select name="provider" value={provider} onChange={event=>setProvider(event.target.value)}>{Object.entries(providers).map(([key,value])=><option key={key} value={key}>{value.name}</option>)}</select></label><label>Name<input name="name" defaultValue={editing.name} maxLength={60} required placeholder="My YouTube channel" autoFocus/></label></div>
    <p className="tools-help">{providers[provider].help}{providers[provider].url&&<> <a href={providers[provider].url} target="_blank" rel="noopener noreferrer">Open platform guide ↗</a></>}</p>
    <label>Server URL<input name="serverUrl" defaultValue={editing.serverUrl} type="text" inputMode="url" maxLength={500} required placeholder="rtmps://your-platform-server/app" autoComplete="off"/></label>
    <label>{editing.id?'Replace stream key (leave blank to keep it)':'Stream key'}<input name="streamKey" type="password" required={!editing.id} maxLength={2048} autoComplete="new-password" placeholder={editing.id?'Saved key stays private':'Paste the platform stream key'}/></label>
    <p className="tools-help">Changing the server URL requires a new key. Keys are encrypted and cannot be revealed after saving.</p>
    <label>Maximum output quality<select name="maxHeight" defaultValue={editing.maxHeight}><option value={720}>720p · 30 fps</option><option value={1080}>1080p · 30 fps</option></select></label>
    <label className="check"><input name="enabled" type="checkbox" defaultChecked={editing.enabled}/> Relay automatically whenever this channel is live</label>
    <div className="studio-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save destination'}</button></div>
   </form>}
   <p className="tools-help restream-footer">Each destination adds server upload traffic. Available source resolution can be lower than your selected maximum. Manage broadcast titles, final Go Live controls and chat in the destination’s own dashboard.</p>
  </>}
 </ModalDialog>;
}
export function AdminRestreams({data,api}:any){const [channel,setChannel]=useState<any>(null);return <section className="panel"><h2>Channel destinations</h2><p className="help">Manage each creator’s relays. Global controls are in Platform settings.</p><div className="table-wrap"><table><thead><tr><th>Channel</th><th>Status</th><th>Destinations</th><th/></tr></thead><tbody>{data.map((row:any)=><tr key={row.id}><td><strong>{row.title}</strong><small>@{row.slug}</small></td><td>{row.state}</td><td>{row._count.restreamDestinations}</td><td><button className="secondary" onClick={()=>setChannel(row)}>Manage destinations</button></td></tr>)}</tbody></table></div>{channel&&<RestreamDialog api={api} channelId={channel.id} onClose={()=>setChannel(null)}/>}</section>;}
