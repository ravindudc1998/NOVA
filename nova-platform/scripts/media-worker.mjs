// Self-hosted ingest -> aligned multi-quality HLS. Media files are private to the API.
import {spawn} from 'node:child_process';
import {mkdir,readdir,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {hlsArguments,selectRenditions,sourceInfo} from './quality-ladder.mjs';
const secret=process.env.MEDIA_SERVICE_SECRET;
if(!secret)throw new Error('Media worker secret is required.');
const root=resolve(process.env.NOVA_HLS_ROOT||'/var/lib/nova-hls'),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const preset=process.env.NOVA_VIDEO_PRESET||'veryfast',maxHeight=Number(process.env.NOVA_VIDEO_MAX_HEIGHT||2160);
if(!['ultrafast','superfast','veryfast','faster','fast'].includes(preset)||![360,480,720,1080,1440,2160].includes(maxHeight))throw new Error('Invalid video encoding configuration.');
const auth=`Basic ${Buffer.from(`nova-system:${secret}`).toString('base64')}`;
const jobs=new Map(),retryAfter=new Map();let closing=false,lastSweep=0;
function terminate(job){job.child.kill('SIGTERM');setTimeout(()=>{if(job.child.exitCode===null)job.child.kill('SIGKILL');},4000).unref();}
async function probe(input){
 return new Promise((resolve,reject)=>{
  const child=spawn('ffprobe',['-v','error','-rtsp_transport','tcp','-timeout','8000000','-analyzeduration','2000000','-probesize','2000000','-read_intervals','%+7','-show_packets','-show_entries','stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate:packet=stream_index,pts_time,flags,size','-of','json',input],{stdio:['ignore','pipe','ignore']});
  let output='';const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Source probe timed out.'));},16000);
  child.stdout.on('data',data=>{output+=data.toString();if(output.length>2000000){child.kill('SIGKILL');reject(new Error('Source probe too large.'));}});
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('close',code=>{clearTimeout(timeout);try{if(code!==0)throw new Error('Source probe failed.');resolve(sourceInfo(JSON.parse(output)));}catch(error){reject(error);}});
 });
}
async function start(job){
 const input=`rtsp://nova-worker:${encodeURIComponent(secret)}@mediamtx:8554/ingest/${job.channelId}`;
 const source=await probe(input),variants=selectRenditions(source,maxHeight);
 if(closing)return;
 const output=join(root,job.id);
 // Only exact UUID children of the dedicated HLS directory can be removed.
 if(!uuid.test(job.id)||resolve(output)!==resolve(root,job.id))throw new Error('Invalid session directory.');
 await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
 const child=spawn('ffmpeg',hlsArguments(input,output,source,variants,{preset}),{stdio:['ignore','ignore','pipe']});let diagnostic='';
 child.stderr.on('data',data=>{diagnostic=(diagnostic+data.toString()).slice(-2500);});
 jobs.set(job.id,{...job,child});console.log(JSON.stringify({event:'transcoder.started',sessionId:job.id,source:{width:source.width,height:source.height,audio:source.audio},sourcePassthrough:Boolean(source.copySafe&&variants.at(-1).width===source.width&&variants.at(-1).height===source.height),qualities:variants.map(({width,height})=>({width,height})),fps:30}));
 child.on('error',()=>console.error(`Transcoder could not start: ${job.id}`));
 child.on('close',code=>{jobs.delete(job.id);retryAfter.set(job.id,Date.now()+5000);console.log(`Transcoder ended: ${job.id}, exit ${code}`);if(code&&diagnostic)console.error(diagnostic.replaceAll(secret,'[redacted]').replace(/rtsp:\/\/\S+/g,'[media endpoint]'));});
}
async function sweep(active){
 if(Date.now()-lastSweep<30000)return;lastSweep=Date.now();
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isDirectory()||!uuid.test(entry.name)||active.has(entry.name))continue;
  const path=join(root,entry.name),info=await stat(path).catch(()=>null);
  if(info&&Date.now()-info.mtimeMs>60000)await rm(path,{recursive:true,force:true});
 }
}
async function reconcile(){
 const response=await fetch('http://api:3000/internal/media/jobs',{headers:{Authorization:auth},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();const desired=await response.json();
 const valid=desired.filter(job=>uuid.test(job.id)&&uuid.test(job.channelId)),active=new Set(valid.map(job=>job.id));
 for(const [id,job]of jobs)if(!active.has(id))terminate(job);
 for(const job of valid)if(!jobs.has(job.id)&&(retryAfter.get(job.id)||0)<Date.now())try{await start(job);}catch{retryAfter.set(job.id,Date.now()+5000);console.error(`Transcoder startup failed: ${job.id}`);}
 for(const [id,time]of retryAfter)if(time<Date.now()-60000)retryAfter.delete(id);
 await sweep(new Set([...active,...jobs.keys()]));
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{closing=true;for(const job of jobs.values())terminate(job);});
await mkdir(root,{recursive:true});
let failedSince=0;while(!closing){try{await reconcile();failedSince=0;}catch{failedSince||=Date.now();if(Date.now()-failedSince>10000)for(const job of jobs.values())terminate(job);}await new Promise(r=>setTimeout(r,2000));}
