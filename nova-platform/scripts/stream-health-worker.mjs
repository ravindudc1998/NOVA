// Separate read-only media observer: never changes publishers or transcoders.
import {mkdir,writeFile,rename,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {ingestRate,audioReading,outputSnapshot,segmentInput,sampleOutput,thumbnailImage} from './stream-health-analysis.mjs';
const secret=process.env.MEDIA_SERVICE_SECRET;if(!secret)throw new Error('Media observer secret is required.');
const auth=`Basic ${Buffer.from(`nova-system:${secret}`).toString('base64')}`,root=process.env.NOVA_HEALTH_ROOT||'/var/lib/nova-health',hls=process.env.NOVA_HLS_ROOT||'/var/lib/nova-hls';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const history=new Map(),pending=new Map();let closing=false,lastSweep=0;
const blankAudio=()=>({state:'checking',peakDbfs:null,rmsDbfs:null,sampledAt:null,quietSince:null});
async function inspect(job){
 const now=Date.now(),previous=history.get(job.id)||{},bytes=Number(job.receivedBytes),rate=Number.isSafeInteger(bytes)&&bytes>=0?ingestRate(previous.counter,bytes,now):null;
 const advanced=rate===null||rate>0,stalledSince=advanced?null:previous.stalledSince||now;
 const report={version:1,sessionId:job.id,channelId:job.channelId,checkedAt:new Date(now).toISOString(),
  ingest:{state:stalledSince&&now-stalledSince>=10000?'stalled':'receiving',bitrateKbps:rate},
  video:{state:'waiting',width:null,height:null,codec:null,fps:null,qualities:[],lastSegmentAt:null},audio:previous.audio||blankAudio()};
 const next={...previous,lastChecked:now,counter:Number.isSafeInteger(bytes)?{bytes,at:now}:undefined,stalledSince};
 let snapshot,input;
 try{
  snapshot=await outputSnapshot(join(hls,job.id));const top=snapshot.files.at(-1),lowest=snapshot.files[0];
  report.video={state:snapshot.ready?(previous.probeOk?'ready':'unverified'):'stalled',width:top.width,height:top.height,codec:previous.codec||null,fps:previous.fps??null,qualities:snapshot.files.map(({width,height})=>({width,height})),lastSegmentAt:new Date(snapshot.at).toISOString()};
  if(snapshot.ready&&(!previous.lastSample||now-previous.lastSample>=8000)&&lowest.segment!==previous.segment){
   next.lastSample=now;
   try{
    input=await segmentInput(join(hls,job.id),lowest);const measured=await sampleOutput(input);
    report.video.codec=next.codec=measured.codec;report.video.fps=next.fps=measured.fps;
    report.video.state='ready';next.probeOk=true;
    report.audio=measured.audio?audioReading(measured.audio,previous.audio,Date.now()):{...blankAudio(),state:'missing',sampledAt:new Date().toISOString()};
    next.segment=lowest.segment;
   }catch{report.audio={...blankAudio(),state:'unavailable'};report.video.state='unverified';next.probeOk=false;}
  }
 }catch{report.video.state=previous.hadOutput?'stalled':'waiting';report.audio=blankAudio();}
 next.hadOutput=previous.hadOutput||report.video.state==='ready';next.audio=report.audio;
 // Fresh heartbeat does not make an old audio sample current.
 if(report.audio.sampledAt&&Date.now()-Date.parse(report.audio.sampledAt)>20000)report.audio={...blankAudio(),state:'unavailable'};
 const temporary=join(root,`${job.id}.tmp`);await writeFile(temporary,JSON.stringify(report),{mode:0o600});await rename(temporary,join(root,`${job.id}.json`));history.set(job.id,next);
 // Rendering a preview cannot change health results or restart the encoder.
 if(!snapshot?.ready){next.lastThumbnail=0;await rm(join(root,`${job.id}.jpg`),{force:true});}
 else if((!previous.lastThumbnail||now-previous.lastThumbnail>=15000)&&snapshot.files[0].segment!==previous.thumbnailSegment){
  next.lastThumbnail=now;
  try{
   input||=await segmentInput(join(hls,job.id),snapshot.files[0]);const jpeg=await thumbnailImage(input),temporaryImage=join(root,`${job.id}.thumb`);
   await writeFile(temporaryImage,jpeg,{mode:0o600});await rename(temporaryImage,join(root,`${job.id}.jpg`));next.thumbnailSegment=snapshot.files[0].segment;
  }catch{console.error(`Stream preview unavailable: ${job.id}`);}
 }
}
await mkdir(root,{recursive:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closing=true;});
while(!closing){
 try{
  const response=await fetch('http://api:3000/internal/media/jobs',{headers:{Authorization:auth},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Observer jobs unavailable.');
  const jobs=(await response.json()).filter(job=>uuid.test(job.id)&&uuid.test(job.channelId)).sort((a,b)=>(history.get(a.id)?.lastChecked||0)-(history.get(b.id)?.lastChecked||0)),active=new Set(jobs.map(job=>job.id));
  for(const job of jobs){if(pending.size>=2)break;if(pending.has(job.id))continue;const task=inspect(job).catch(()=>console.error(`Stream health sample unavailable: ${job.id}`)).finally(()=>pending.delete(job.id));pending.set(job.id,task);}
  for(const id of history.keys())if(!active.has(id)&&!pending.has(id))history.delete(id);
  if(Date.now()-lastSweep>30000){lastSweep=Date.now();for(const file of await readdir(root)){const id=file.replace(/\.(?:json|jpg|tmp|thumb)$/,'');if(!uuid.test(id)||active.has(id)||pending.has(id))continue;const path=join(root,file),info=await stat(path).catch(()=>null);if(info&&Date.now()-info.mtimeMs>60000)await rm(path,{force:true});}}
 }catch{console.error('Stream health observer could not refresh.');}
 await new Promise(resolve=>setTimeout(resolve,5000));
}
await Promise.allSettled([...pending.values()]);
