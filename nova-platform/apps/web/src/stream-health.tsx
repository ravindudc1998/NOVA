import React,{useEffect,useState} from 'react';
import {StudioAudience} from './audience';

const endReasons:Record<string,string>={publisher_disconnected:'The broadcaster disconnected.',publisher_timeout:'No broadcast arrived before the connection timed out.',transcode_timeout:'Video processing did not become ready in time.',media_unavailable:'The media service became unavailable.',access_revoked:'Broadcasting access was removed.',stopped:'The broadcast was stopped.'};
const audioNames:Record<string,string>={checking:'Checking audio',missing:'No audio track',active:'Sound detected',quiet:'Quiet right now',silent:'No recent sound',unavailable:'Audio check unavailable'};
function HealthHint({compact,children}: {compact:boolean;children:React.ReactNode}){return compact?<details className="health-details"><summary>Details</summary><p>{children}</p></details>:<p>{children}</p>;}
export function StreamHealthView({data,failed=false,now=Date.now(),compact=false}: {data:any;failed?:boolean;now?:number;compact?:boolean}){
 const stale=data?.monitor==='stale'||Boolean(data?.checkedAt&&now-Date.parse(data.checkedAt)>20000),offline=data?.monitor==='offline';
 const fresh=!failed&&!stale&&data?.monitor==='fresh',report=fresh?data.report:null,audio=report?.audio,video=report?.video,ingest=report?.ingest;
 const audioCurrent=audio&&(!audio.sampledAt||now-Date.parse(audio.sampledAt)<=20000),audioState=audioCurrent?audio.state:'unavailable';
 const problem=ingest?.state==='stalled'||video?.state==='stalled'||video?.state==='unverified',audioWarning=audioState==='missing'||audioState==='silent';
 const status=failed||stale?'Health unavailable':offline?'Offline':!fresh?'Checking stream':problem?'Check broadcast':audioWarning?'Check audio':video?.state==='ready'?'Broadcast healthy':'Preparing video';
 const tone=failed||stale?'unknown':problem?'error':audioWarning?'warning':fresh&&video?.state==='ready'?'good':'neutral';
 const rate=ingest?.bitrateKbps,rateLabel=rate===null||rate===undefined?'Measuring bitrate':rate>=1000?`${(rate/1000).toFixed(2)} Mbps`:`${rate} kbps`;
 const qualities=(video?.qualities||[]).map((quality:any)=>`${Math.min(quality.width,quality.height)}p`).join(' · ');
 const audioHint=audioState==='missing'?'Add Desktop Audio or a microphone in OBS Settings → Audio.':audioState==='silent'?'No sound detected for at least 20 seconds. If sound is expected, check the OBS mixer, mute buttons and stream audio track.':audioState==='quiet'?'A short pause can be normal. Play sound or speak to check the next sample.':audioState==='active'?'Sound is present in the processed broadcast. Viewer mute and device volume are separate.':audioState==='unavailable'?'Audio could not be measured. This does not mean the stream is silent.':'Audio is checked once processed video is ready.';
 return <section className={`panel stream-health${compact?' is-compact':''}`} aria-label="Stream health"><div className="health-heading"><div><h2>Stream health</h2>{!compact&&<p>Check what is reaching your viewers.</p>}</div><span className={`health-status is-${tone}`} role="status"><i/>{status}</span></div>
 {!failed&&<StudioAudience stats={data?.audience}/>}
 {failed||stale?<div className="health-empty">Health updates are unavailable. The broadcast may still be running; checking again automatically.</div>:offline?<div className="health-empty"><strong>Ready for your next broadcast.</strong><p>Start streaming from OBS to see video, audio and connection checks.</p>{data?.session?.endReason&&<p className="health-last">Last broadcast: {endReasons[data.session.endReason]||'The session ended.'}</p>}</div>:!fresh?<div className="health-empty">Waiting for the broadcaster and the first health sample. Checks appear automatically.</div>:<>
 <div className="health-grid"><article><span className="health-label">Incoming stream</span><h3>{ingest.state==='stalled'?'No recent data':'Receiving broadcast'}</h3><strong>{rateLabel}</strong><HealthHint compact={compact}>{ingest.state==='stalled'?'Check OBS connection status. No incoming data change has been seen for at least 10 seconds.':`${data.session?.protocol==='webrtc'?'Browser':'OBS / RTMP'} broadcast is connected.`}</HealthHint></article>
 <article><span className="health-label">Video output</span><h3>{video.state==='ready'?'Video ready':video.state==='waiting'?'Preparing video':video.state==='unverified'?'Video check failed':'Video not updating'}</h3><strong>{video.width&&video.height?`${video.width} × ${video.height}`:'Waiting for video'}{video.fps?` · ${video.fps} fps`:''}</strong><HealthHint compact={compact}>{video.state==='ready'?`Available qualities: ${qualities}`:video.state==='waiting'?'The first processed video segments have not arrived yet.':video.state==='unverified'?'Recent files exist, but their media could not be checked. Retrying automatically.':'Processed video is missing or stale. Check OBS; if this persists, retry the broadcast or ask an administrator.'}</HealthHint></article>
 <article className={audioWarning?'health-audio-warning':''}><span className="health-label">Broadcast audio</span><h3>{audioNames[audioState]||'Checking audio'}</h3><div className="health-audio-level"><meter aria-label="Latest broadcast audio level" min={-60} max={0} low={-45} high={-6} optimum={-18} value={audioCurrent?Math.max(-60,Math.min(0,audio.rmsDbfs??-60)):-60}/><span>{audioCurrent&&audio.peakDbfs!==null?`${audio.peakDbfs} dBFS peak`:'—'}</span></div><HealthHint compact={compact}>{audioHint}</HealthHint></article></div>
 <div className="health-footer"><span>Audio uses a short sample about every 8–10 seconds; brief silence can be normal.</span><span>Updated {Math.max(0,Math.floor((now-Date.parse(data.checkedAt))/1000))}s ago</span></div></>}
 </section>;
}
export function StreamHealth({api,compact=false}: {api:any;compact?:boolean}){
 const [data,setData]=useState<any>(null),[failed,setFailed]=useState(false),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  let disposed=false,busy=false,request:AbortController|undefined;
  const load=async()=>{setNow(Date.now());if(busy)return;busy=true;request=new AbortController();const timeout=setTimeout(()=>request?.abort(),8000);try{const result=await api('/me/channel/health','GET',undefined,request.signal);if(!disposed){setData(result);setFailed(false);}}catch{if(!disposed)setFailed(true);}finally{clearTimeout(timeout);busy=false;}};
  void load();const timer=setInterval(()=>void load(),5000);return()=>{disposed=true;clearInterval(timer);request?.abort();};
 },[api]);
 return <StreamHealthView data={data} failed={failed} now={now} compact={compact}/>;
}
