// Isolated real RTMP/HTTPS checks. Never changes global policy or an existing account.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Database} from '../apps/api/dist/database.js';
import {PlatformService} from '../apps/api/dist/platform.service.js';
import {decryptSecret} from '../apps/api/dist/secrets.js';
import {sourceInfo} from './quality-ladder.mjs';
const db=new Database(),platform=new PlatformService(db),prefix=`qv_${Date.now().toString(36)}`,password=randomBytes(24).toString('base64url'),clientId=`quality-${prefix}`;
const base=`https://${process.env.NOVA_HOST}`,identityBase='http://keycloak:8080/auth',identities=[],children=new Set(),directory=await mkdtemp(join(tmpdir(),'nova-live-quality-'));
let adminToken,clientUuid,creator,viewer,passed=0;const before=await platform.settings();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(task,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const value=await task();if(value)return value;await pause(500);}throw new Error('Timed out waiting for quality media.');}
async function check(name,task){console.log(`CHECK ${name}`);await task();passed++;console.log(`PASS ${name}`);}
async function renewAdmin(){const response=await fetch(`${identityBase}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:readFileSync('/run/secrets/identity_admin_password','utf8').trim()})});assert.equal(response.status,200);adminToken=(await response.json()).access_token;}
async function admin(path,method='GET',body,retry=true){const response=await fetch(`${identityBase}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.status===401&&retry){await renewAdmin();return admin(path,method,body,false);}assert.ok(response.ok,`Identity operation ${response.status}`);const text=await response.text();return text?JSON.parse(text):null;}
async function api(path,token,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function account(suffix,type){const username=`${prefix}_${suffix}`;await admin('/users','POST',{username,enabled:true,firstName:username,credentials:[{type:'password',value:password,temporary:false}]});const identity=(await admin(`/users?username=${username}&exact=true`))[0];identities.push(identity.id);const response=await fetch(`${identityBase}/realms/nova/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:clientId,grant_type:'password',username,password})});assert.equal(response.status,200);const token=(await response.json()).access_token,result=await api('/me/bootstrap',token,'POST',{accountType:type});assert.equal(result.status,200);return {token,user:result.body};}
function launch(binary,args){const child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout=(stdout+data).slice(-200000));child.stderr.on('data',data=>stderr=(stderr+data).slice(-3000));children.add(child);child.once('close',()=>children.delete(child));return {child,result:()=>({stdout,stderr})};}
async function command(binary,args,timeout=60000){const task=launch(binary,args);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{task.child.kill('SIGKILL');reject(new Error(`${binary} timed out`));},timeout);task.child.once('error',error=>{clearTimeout(timer);reject(error);});task.child.once('close',code=>{clearTimeout(timer);if(code){let diagnostic=task.result().stderr.replace(/(?:rtmps?|rtsps?):\/\/\S+/g,'[media endpoint]');if(process.env.MEDIA_SERVICE_SECRET)diagnostic=diagnostic.replaceAll(process.env.MEDIA_SERVICE_SECRET,'[redacted]');reject(new Error(`${binary} exited ${code}: ${diagnostic}`));}else resolve(task.result().stdout);});});}
async function terminate(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('close',resolve)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function state(value){await until(async()=>{const channel=await db.channel.findUnique({where:{id:creator.user.channel.id}});return channel?.state===value;});}
async function ticket(token){const result=await api(`/channels/${creator.user.channel.id}/playback`,token,'POST');assert.equal(result.status,200);assert.ok(result.cookie);return result;}
async function media(file,cookie){return fetch(`${base}/api/v1/play/${creator.user.channel.id}/${file}`,{headers:cookie?{Cookie:cookie}:{},signal:AbortSignal.timeout(15000)});}
function variants(master){return master.split(/\r?\n/).filter(line=>/^q\d+\.m3u8$/.test(line));}
function segments(playlist){return playlist.split(/\r?\n/).filter(line=>/^seg-q\d+-\d+\.m4s$/.test(line));}
try{
 assert.equal(before.guestViewingEnabled,true,'This deployment check requires the already-enabled guest policy.');
 await renewAdmin();await admin('/clients','POST',{clientId,enabled:true,publicClient:true,defaultClientScopes:['basic','profile'],standardFlowEnabled:false,directAccessGrantsEnabled:true,protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'nova-api','access.token.claim':'true','id.token.claim':'false'}}]});clientUuid=(await admin(`/clients?clientId=${clientId}`))[0].id;
 creator=await account('c','creator');viewer=await account('v','viewer');
 const key=decryptSecret((await db.streamCredential.findUniqueOrThrow({where:{channelId:creator.user.channel.id}})).encryptedSecret),endpoint=`rtmp://mediamtx:1935/ingest/${creator.user.channel.id}?key=${key}`,sourcePath=join(directory,'source.mp4');
 await check('Prepare a genuine 3840×2160 H.264/AAC source',async()=>{
  // Eight seconds contains an integer number of both 30-fps frames and 48-kHz AAC frames.
  await command('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=3840x2160:rate=30','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','8','-c:v','libx264','-preset','ultrafast','-threads','6','-pix_fmt','yuv420p','-b:v','20000k','-g','60','-sc_threshold','0','-c:a','aac','-b:a','128k','-movflags','+faststart',sourcePath]);
 });
 if(process.argv.includes('--source-diagnostics')){
  const publisher=launch('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-stream_loop','-1','-re','-i',sourcePath,'-c','copy','-f','flv',endpoint]).child;await until(async()=>await db.streamSession.count({where:{channelId:creator.user.channel.id,endedAt:null}})>0);
  const input=`rtsp://nova-worker:${encodeURIComponent(process.env.MEDIA_SERVICE_SECRET)}@mediamtx:8554/ingest/${creator.user.channel.id}`;
  const details=JSON.parse(await command('ffprobe',['-v','error','-rtsp_transport','tcp','-timeout','8000000','-analyzeduration','2000000','-probesize','2000000','-read_intervals','%+7','-show_packets','-show_entries','stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate:packet=stream_index,pts_time,flags,size','-of','json',input],20000));
  console.log(JSON.stringify({event:'quality.source-diagnostics',streams:details.streams,keyframes:details.packets.filter(packet=>packet.flags?.includes('K')&&packet.stream_index===details.streams.find(stream=>stream.codec_type==='video').index).map(packet=>packet.pts_time),source:sourceInfo(details)}));await terminate(publisher);
 }else{
 let publisher,guest,signedIn,files,playlists;
 await check('4K RTMP ingest becomes a live six-quality HLS master',async()=>{
  publisher=launch('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-stream_loop','-1','-re','-i',sourcePath,'-c','copy','-f','flv',endpoint]).child;await state('live');
  guest=await ticket();const response=await media('index.m3u8',guest.cookie);assert.equal(response.status,200);const master=await response.text();files=variants(master);assert.equal(files.length,6);assert.match(master,/RESOLUTION=3840x2160/);assert.equal([...master.matchAll(/\bBANDWIDTH=(\d+)/g)].filter(match=>Number(match[1])>0).length,6);
  console.log(JSON.stringify({event:'quality.master',variants:files}));
 });
 await check('Guest and signed-in viewers can load every quality; media without a ticket is denied',async()=>{
  signedIn=await ticket(viewer.token);
  for(const cookie of [guest.cookie,signedIn.cookie])for(const file of ['index.m3u8',...files])assert.equal((await media(file,cookie)).status,200);
  for(const file of ['index.m3u8',...files])assert.equal((await media(file)).status,401);
  const other=await fetch(`${base}/api/v1/play/00000000-0000-4000-8000-000000000001/index.m3u8`,{headers:{Cookie:guest.cookie}});assert.equal(other.status,401);
 });
 await check('All qualities contain aligned, independently decodable H.264/AAC segments over HTTPS',async()=>{
  playlists=await until(async()=>{const values=await Promise.all(files.map(async file=>{const response=await media(file,guest.cookie);assert.equal(response.status,200);return response.text();}));return values.every(playlist=>segments(playlist).length>=3)?values:false;});
  const common=segments(playlists[0]).map(file=>/-(\d+)\.m4s$/.exec(file)[1]).find(number=>playlists.every(playlist=>segments(playlist).some(file=>file.endsWith(`-${number}.m4s`))));assert.ok(common,'Renditions need a common segment clock.');
  const starts=[];
  for(const file of files){
   const quality=file.slice(0,-5),init=await media(`init-${quality}.mp4`,guest.cookie),segment=await media(`seg-${quality}-${common}.m4s`,guest.cookie);assert.equal(init.status,200);assert.equal(segment.status,200);assert.match(segment.headers.get('cache-control'),/no-store/);
   assert.equal((await media(`init-${quality}.mp4`)).status,401);assert.equal((await media(`seg-${quality}-${common}.m4s`)).status,401);
   const path=join(directory,quality+'.mp4');await writeFile(path,Buffer.concat([Buffer.from(await init.arrayBuffer()),Buffer.from(await segment.arrayBuffer())]));
   const metadata=JSON.parse(await command('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height','-of','json',path]));assert.ok(metadata.streams.some(stream=>stream.codec_name==='h264'));assert.ok(metadata.streams.some(stream=>stream.codec_name==='aac'));
   const frames=JSON.parse(await command('ffprobe',['-v','error','-select_streams','v:0','-read_intervals','%+0.1','-show_entries','frame=best_effort_timestamp_time,key_frame','-of','json',path]));assert.equal(frames.frames[0].key_frame,1);starts.push(Number(frames.frames[0].best_effort_timestamp_time));
   const progress=await command('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-xerror','-i',path,'-map','0:v:0','-map','0:a:0','-frames:v','3','-frames:a','3','-progress','pipe:1','-f','null','-']);assert.ok([...progress.matchAll(/frame=(\d+)/g)].some(match=>Number(match[1])>=3),`${quality}: three real frames must decode`);
  }
  console.log(JSON.stringify({event:'quality.segment-alignment',starts}));assert.ok(Math.max(...starts)-Math.min(...starts)<0.04,'Variant timestamps must align for quality switches.');
 });
 await check('A suspended viewer loses existing playback tickets for every quality',async()=>{
  await db.user.update({where:{id:viewer.user.id},data:{status:'suspended'}});for(const file of ['index.m3u8',files.at(-1)])assert.equal((await media(file,signedIn.cookie)).status,403);await db.user.update({where:{id:viewer.user.id},data:{status:'active'}});
 });
 await check('4K stays live and its output clock advances at real-time speed',async()=>{
  const playlist=async()=>{const response=await media(files.at(-1),guest.cookie);assert.equal(response.status,200);return response.text();};
  // MEDIA-SEQUENCE is the oldest retained segment; the window may still be filling.
  const latest=value=>Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(value)[1])+segments(value).length-1;
  const initial=latest(await playlist());await pause(12000);const current=latest(await playlist());
  console.log(JSON.stringify({event:'quality.clock',elapsedSeconds:12,advancedSegments:current-initial}));assert.ok(current-initial>=5,'Encoder is not keeping up with a live source.');
 });
 await check('Natural disconnect ends 4K; a 720p video-only source advertises no larger qualities',async()=>{
  await terminate(publisher);await state('offline');publisher=launch('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-c:v','libx264','-preset','ultrafast','-threads','2','-g','60','-sc_threshold','0','-pix_fmt','yuv420p','-an','-f','flv',endpoint]).child;await state('live');
  const response=await media('index.m3u8',guest.cookie);assert.equal(response.status,200);const master=await response.text();assert.equal(variants(master).length,3);assert.match(master,/RESOLUTION=1280x720/);assert.doesNotMatch(master,/1920x1080|2560x1440|3840x2160|mp4a/);
 });
 await check('Creator stop revokes all old quality URLs even while files await cleanup',async()=>{
  assert.equal((await api('/me/channel/stop',creator.token,'POST')).status,200);await state('offline');for(const file of ['index.m3u8','q720.m3u8','init-q720.mp4'])assert.equal((await media(file,guest.cookie)).status,404);await terminate(publisher);
 });
 await check('Platform settings remain unchanged',async()=>assert.deepEqual(await platform.settings(),before));
 console.log(`${passed} quality integration checks passed.`);
 }
}finally{
 for(const child of children)await terminate(child);
 if(creator){const sessions=await db.streamSession.findMany({where:{channelId:creator.user.channel.id},select:{id:true}});await db.auditEvent.deleteMany({where:{targetId:{in:[creator.user.channel.id,...sessions.map(session=>session.id)]}}});}
 for(const id of identities)try{await admin(`/users/${id}`,'DELETE');}catch{console.error('Identity quality fixture cleanup needs attention.');}
 if(clientUuid)try{await admin(`/clients/${clientUuid}`,'DELETE');}catch{console.error('Identity quality client cleanup needs attention.');}
 const users=await db.user.findMany({where:{username:{startsWith:prefix+'_'}},select:{id:true}}),ids=users.map(user=>user.id);await db.channel.deleteMany({where:{ownerId:{in:ids}}});await db.auditEvent.deleteMany({where:{actorId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});
 await db.$disconnect();await rm(directory,{recursive:true,force:true});console.log('Quality fixtures removed.');
}
