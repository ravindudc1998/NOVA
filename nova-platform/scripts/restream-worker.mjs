import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {destinationKey,destinationUrl,relayArguments,relayVariant,RESTREAM_ERRORS} from '../apps/api/dist/restream-policy.js';
import {createDestinationProxy} from '../apps/api/dist/restream-egress.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function runRestreamWorker({signal,proxyFactory=createDestinationProxy,onlyDestinations,apiOrigin='http://api:3000',root='/var/lib/nova-hls',secret=process.env.RESTREAM_SERVICE_SECRET}={}){
 if(!secret)throw Error('Restream worker credential is required.');
 const slots=new Map(),reports=new Map(),reporting=new Set();let closing=false,failedSince=0;
 const call=async(path,body)=>{const response=await fetch(apiOrigin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${secret}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('api_unavailable');return response.json();};
 async function report(slot){
  if(reporting.has(slot.job.id))return;reporting.add(slot.job.id);
  const now=Date.now(),bytes=slot.proxy?.bytesSent||slot.bytes||0,elapsed=(now-(slot.sampleAt||now))/1000;
  const bitrateKbps=elapsed>0?Math.max(0,(bytes-(slot.sampleBytes||0))*8/elapsed/1000):0;slot.sampleAt=now;slot.sampleBytes=bytes;
  try{await call(`/internal/restream/${slot.job.id}/status`,{version:slot.job.version,sessionId:slot.job.sessionId,status:slot.state,errorCode:slot.errorCode||null,bytesSent:bytes,bitrateKbps:Math.min(1000000,bitrateKbps)});}catch{}finally{reporting.delete(slot.job.id);}
 }
 function stop(slot){slot.cancelled=true;slot.child?.kill('SIGTERM');void slot.proxy?.close();if(slot.child){const child=slot.child;setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},3000).unref();}slots.delete(slot.job.id);}
 function failed(slot,error){
  if(slot.cancelled)return;slot.bytes=slot.proxy?.bytesSent||0;void slot.proxy?.close();slot.proxy=null;slot.child=null;slot.attempt=(slot.attempt||0)+1;
  slot.errorCode=RESTREAM_ERRORS.includes(error)?error:'output_failed';slot.state=error==='address_rejected'||error==='source_audio_missing'?'error':'reconnecting';
  slot.retryAt=Date.now()+(error==='address_rejected'?300000:Math.min(30000,2000*2**Math.min(slot.attempt-1,4)));void report(slot);
 }
 async function start(slot){
  try{
   const job=slot.job,serverUrl=destinationUrl(job.serverUrl),key=destinationKey(job.streamKey),folder=join(root,job.sessionId),master=await readFile(join(folder,'index.m3u8'),'utf8'),variant=relayVariant(master,job.maxHeight);
   const proxy=await proxyFactory(serverUrl);if(slot.cancelled||closing){await proxy.close();return;}slot.proxy=proxy;
   const url=new URL(serverUrl),output=`rtmp://127.0.0.1:${proxy.port}${url.pathname}/${key}`;
   const child=spawn('ffmpeg',relayArguments(join(folder,variant.file),output,serverUrl,variant,job.maxHeight),{stdio:['ignore','pipe','ignore']});slot.child=child;slot.state='starting';slot.errorCode=null;slot.lastProgress=Date.now();slot.sampleAt=Date.now();slot.sampleBytes=0;let buffer='',completed=false;
   const finish=error=>{if(completed)return;completed=true;failed(slot,error);};
   child.stdout.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.startsWith('out_time_ms=')&&Number(line.split('=')[1])>0){slot.lastProgress=Date.now();if(proxy.bytesSent>0){slot.state='sending';slot.errorCode=null;}}}if(buffer.length>65536)buffer='';});
   child.once('error',()=>finish('output_failed'));child.once('close',()=>finish(proxy.errorCode||'output_failed'));
   console.log(JSON.stringify({event:'restream.started',destinationId:job.id,sessionId:job.sessionId,mode:variant.copy?'remux':'encode'}));
  }catch(error){failed(slot,RESTREAM_ERRORS.includes(error.message)?error.message:error.code==='ENOENT'?'source_unavailable':'connection_failed');}
 }
 const onStop=()=>{closing=true;for(const slot of [...slots.values()])stop(slot);};signal?.addEventListener('abort',onStop,{once:true});if(signal?.aborted)onStop();
 try{
  while(!closing){
   try{
    const plan=await call('/internal/restream/jobs');failedSince=0;
    const desired=plan.jobs.filter(job=>uuid.test(job.id)&&uuid.test(job.channelId)&&uuid.test(job.sessionId)&&[720,1080].includes(job.maxHeight)&&Number.isInteger(job.version)&&job.version>0&&(!onlyDestinations||onlyDestinations.has(job.id)));
    const active=new Map(desired.filter(job=>!job.queued).slice(0,Math.min(64,plan.maxActive)).map(job=>[job.id,job]));
    for(const [id,slot] of slots){const job=active.get(id);if(!job||job.sessionId!==slot.job.sessionId||job.version!==slot.job.version)stop(slot);}
    for(const job of desired){
     if(!active.has(job.id)){if((reports.get(job.id)||0)<Date.now()-8000){reports.set(job.id,Date.now());void report({job,state:'queued',errorCode:'capacity'});}continue;}
     let slot=slots.get(job.id);
     if(!slot){slot={job,state:'starting',errorCode:null,cancelled:false};slots.set(job.id,slot);void start(slot);}
     else if(!slot.child&&slot.retryAt&&slot.retryAt<Date.now()){slot.retryAt=null;slot.state='starting';void start(slot);}
     if(slot.child&&Date.now()-slot.lastProgress>20000)slot.child.kill('SIGTERM');
     if((reports.get(job.id)||0)<Date.now()-3000){reports.set(job.id,Date.now());void report(slot);}
    }
    for(const id of reports.keys())if(!desired.some(job=>job.id===id))reports.delete(id);
   }catch{failedSince||=Date.now();if(Date.now()-failedSince>10000)for(const slot of [...slots.values()])stop(slot);}
   await sleep(2000);
  }
 }finally{onStop();signal?.removeEventListener('abort',onStop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const abort=new AbortController();for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>abort.abort());await runRestreamWorker({signal:abort.signal});}
