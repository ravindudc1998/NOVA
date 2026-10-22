// Separate test identities and RTMP sources; never changes global settings or a real broadcast.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Database} from '../apps/api/dist/database.js';
import {PlatformService} from '../apps/api/dist/platform.service.js';
import {decryptSecret} from '../apps/api/dist/secrets.js';
import {mediaCommand} from './stream-health-analysis.mjs';
const db=new Database(),platform=new PlatformService(db),base=`https://${process.env.NOVA_HOST}/api/v1`,identity='http://keycloak:8080/auth',prefix=`thumb_${Date.now().toString(36)}`,clientId=prefix,password=randomBytes(24).toString('base64url');
const identities=[],accounts=[],children=new Set();let adminToken,clientUuid,creator,viewer,passed=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=value=>createHash('sha256').update(value).digest('hex');
const beforeSettings=await platform.settings(),existingIds=(await db.user.findMany({select:{id:true}})).map(user=>user.id);
async function credentials(){return hash(JSON.stringify(await db.streamCredential.findMany({where:{channel:{ownerId:{in:existingIds}}},orderBy:{channelId:'asc'}})));}
const beforeKeys=await credentials();
async function check(name,task){await task();passed++;console.log(`PASS ${name}`);}
async function renew(){const response=await fetch(`${identity}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:readFileSync('/run/secrets/identity_admin_password','utf8').trim()})});assert.equal(response.status,200);adminToken=(await response.json()).access_token;}
async function admin(path,method='GET',body,retry=true){const response=await fetch(`${identity}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.status===401&&retry){await renew();return admin(path,method,body,false);}assert.ok(response.ok,`Identity operation HTTP ${response.status}`);const text=await response.text();return text?JSON.parse(text):null;}
async function api(path,token,method='GET',body){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json()};}
async function account(suffix,type){const username=`${prefix}_${suffix}`;await admin('/users','POST',{username,enabled:true,firstName:username,credentials:[{type:'password',value:password,temporary:false}]});const user=(await admin(`/users?username=${username}&exact=true`))[0];identities.push(user.id);const response=await fetch(`${identity}/realms/nova/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:clientId,grant_type:'password',username,password})});assert.equal(response.status,200);const token=(await response.json()).access_token,result=await api('/me/bootstrap',token,'POST',{accountType:type});assert.equal(result.status,200);accounts.push(result.body);return {token,user:result.body};}
async function image(token,query=''){const response=await fetch(`${base}/channels/${creator.user.channel.id}/thumbnail${query}`,{headers:token?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(10000)});return {status:response.status,type:response.headers.get('content-type'),cache:response.headers.get('cache-control'),bytes:Buffer.from(await response.arrayBuffer())};}
async function until(task,timeout=65000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await task();if(value)return value;await pause(1000);}throw new Error('Thumbnail verification timed out.');}
async function end(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('close',resolve)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function publish(solid=false){
 const key=decryptSecret((await db.streamCredential.findUniqueOrThrow({where:{channelId:creator.user.channel.id}})).encryptedSecret);
 const child=spawn('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i',solid?'color=c=blue:size=640x360:rate=30':'testsrc2=size=640x360:rate=30','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-g','60','-sc_threshold','0','-b:v','500k','-an','-f','flv',`rtmp://mediamtx:1935/ingest/${creator.user.channel.id}?key=${key}`],{stdio:'ignore'});
 children.add(child);child.once('close',()=>children.delete(child));return child;
}
try{
 await renew();await admin('/clients','POST',{clientId,enabled:true,publicClient:true,defaultClientScopes:['basic','profile'],standardFlowEnabled:false,directAccessGrantsEnabled:true,protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'nova-api','access.token.claim':'true','id.token.claim':'false'}}]});clientUuid=(await admin(`/clients?clientId=${clientId}`))[0].id;
 creator=await account('c','creator');viewer=await account('v','viewer');
 await check('Offline channels have no live thumbnail',async()=>assert.equal((await image(creator.token)).status,404));
 let child=await publish(),first;
 await check('A real RTMP source produces a bounded decodable 480x270 JPEG over HTTPS',async()=>{
  first=await until(async()=>{const result=await image(creator.token);return result.status===200?result:false;});assert.equal(first.type,'image/jpeg');assert.match(first.cache,/private/);assert.match(first.cache,/no-store/);assert.ok(first.bytes.length>100&&first.bytes.length<=524288);
  const metadata=JSON.parse((await mediaCommand('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height','-of','json','pipe:0'],first.bytes)).toString());assert.equal(metadata.streams[0].codec_name,'mjpeg');assert.equal(metadata.streams[0].width,480);assert.equal(metadata.streams[0].height,270);console.log(JSON.stringify({event:'thumbnail.jpeg',bytes:first.bytes.length,width:480,height:270}));
 });
 await check('Signed-in viewers and the current guest policy govern preview access',async()=>{assert.equal((await image(viewer.token)).status,200);assert.equal((await image()).status,beforeSettings.guestViewingEnabled?200:401);});
 await check('Preview content refreshes while the source is live',async()=>{await until(async()=>{const result=await image(viewer.token);return result.status===200&&hash(result.bytes)!==hash(first.bytes);},45000);});
 await check('Existing viewer tokens immediately lose access after permission removal or suspension',async()=>{
  const memberships=await db.membership.findMany({where:{userId:viewer.user.id}});await db.membership.deleteMany({where:{userId:viewer.user.id}});assert.equal((await image(viewer.token)).status,403);await db.membership.createMany({data:memberships});await db.user.update({where:{id:viewer.user.id},data:{status:'suspended'}});assert.equal((await image(viewer.token)).status,403);await db.user.update({where:{id:viewer.user.id},data:{status:'active'}});
 });
 const oldSession=await db.streamSession.findFirstOrThrow({where:{channelId:creator.user.channel.id,endedAt:null}});await end(child);
 await until(async()=>(await image(creator.token)).status===404,20000);child=await publish(true);
 await check('A restarted broadcast cannot reuse the previous session preview',async()=>{
  await until(async()=>{const current=await db.streamSession.findFirst({where:{channelId:creator.user.channel.id,endedAt:null}});return current&&current.id!==oldSession.id;},20000);
  assert.equal((await image(creator.token,`?sessionId=${oldSession.id}`)).status,404);
  const next=await until(async()=>{const result=await image(viewer.token);return result.status===200?result:false;});assert.notEqual(hash(next.bytes),hash(first.bytes));
 });
 await check('Disabling the channel and stopping its publisher revoke previews immediately',async()=>{
  await db.channel.update({where:{id:creator.user.channel.id},data:{accessState:'disabled'}});assert.equal((await image(viewer.token)).status,404);await db.channel.update({where:{id:creator.user.channel.id},data:{accessState:'ready'}});
  assert.equal((await api('/me/channel/stop',creator.token,'POST')).status,200);assert.equal((await image(viewer.token)).status,404);await end(child);
 });
 await check('Settings and existing publishing credentials are preserved',async()=>{assert.deepEqual(await platform.settings(),beforeSettings);assert.equal(await credentials(),beforeKeys);});
 console.log(`${passed} thumbnail integration checks passed.`);
}finally{
 for(const child of children)await end(child);
 for(const id of identities)try{await admin(`/users/${id}`,'DELETE');}catch{console.error('Thumbnail identity cleanup needs attention.');}
 if(clientUuid)try{await admin(`/clients/${clientUuid}`,'DELETE');}catch{console.error('Thumbnail client cleanup needs attention.');}
 const ids=accounts.map(account=>account.id),channels=accounts.map(account=>account.channel?.id).filter(Boolean),sessions=await db.streamSession.findMany({where:{channelId:{in:channels}},select:{id:true}});
 await db.auditEvent.deleteMany({where:{OR:[{actorId:{in:ids}},{targetId:{in:[...channels,...sessions.map(session=>session.id)]}}]}});await db.channel.deleteMany({where:{ownerId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});await db.$disconnect();console.log('Thumbnail fixtures removed.');
}
