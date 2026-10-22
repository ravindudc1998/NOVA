// Isolated presence clients with real HTTPS HLS receipts; existing broadcasts/policy are untouched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Database} from '../apps/api/dist/database.js';
import {PlatformService} from '../apps/api/dist/platform.service.js';
import {AudienceService} from '../apps/api/dist/audience.service.js';
import {decryptSecret} from '../apps/api/dist/secrets.js';
const db=new Database(),platform=new PlatformService(db),base=`https://${process.env.NOVA_HOST}/api/v1`,identity='http://keycloak:8080/auth',prefix=`aud_${Date.now().toString(36)}`,clientId=prefix,password=randomBytes(24).toString('base64url');
const identities=[],accounts=[],children=new Set();let adminToken,clientUuid,creator,viewer,passed=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const beforeSettings=await platform.settings(),existingIds=(await db.user.findMany({select:{id:true}})).map(user=>user.id);
async function credentials(){return createHash('sha256').update(JSON.stringify(await db.streamCredential.findMany({where:{channel:{ownerId:{in:existingIds}}},orderBy:{channelId:'asc'}}))).digest('hex');}
const beforeKeys=await credentials();
async function check(name,task){await task();passed++;console.log(`PASS ${name}`);}
async function renew(){const response=await fetch(`${identity}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:readFileSync('/run/secrets/identity_admin_password','utf8').trim()})});assert.equal(response.status,200);adminToken=(await response.json()).access_token;}
async function admin(path,method='GET',body,retry=true){const response=await fetch(`${identity}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.status===401&&retry){await renew();return admin(path,method,body,false);}assert.ok(response.ok,`Identity operation HTTP ${response.status}`);const text=await response.text();return text?JSON.parse(text):null;}
async function api(path,token,method='GET',body,jar){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json',...(jar?{Cookie:[...jar.entries()].map(([name,value])=>`${name}=${value}`).join('; ')}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(jar)for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],separator=pair.indexOf('=');jar.set(pair.slice(0,separator),pair.slice(separator+1));}const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};}
async function account(suffix,type){const username=`${prefix}_${suffix}`;await admin('/users','POST',{username,enabled:true,firstName:username,credentials:[{type:'password',value:password,temporary:false}]});const user=(await admin(`/users?username=${username}&exact=true`))[0];identities.push(user.id);const response=await fetch(`${identity}/realms/nova/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:clientId,grant_type:'password',username,password})});assert.equal(response.status,200);const token=(await response.json()).access_token,result=await api('/me/bootstrap',token,'POST',{accountType:type});assert.equal(result.status,200);accounts.push(result.body);return {token,user:result.body};}
async function until(task,timeout=65000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await task();if(result)return result;await pause(500);}throw new Error('Audience verification timed out.');}
async function end(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('close',resolve)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function publish(){const key=decryptSecret((await db.streamCredential.findUniqueOrThrow({where:{channelId:creator.user.channel.id}})).encryptedSecret),child=spawn('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-g','60','-sc_threshold','0','-b:v','500k','-an','-f','flv',`rtmp://mediamtx:1935/ingest/${creator.user.channel.id}?key=${key}`],{stdio:'ignore'});children.add(child);child.once('close',()=>children.delete(child));return child;}
const route=()=>`/play/${creator.user.channel.id}/presence`;
async function beat(client,leaseId,position){return api(route()+'/heartbeat',client.token,'POST',{leaseId,position},client.jar);}
async function leave(client,leaseId){assert.equal((await api(route()+'/leave',null,'POST',{leaseId},client.jar)).status,204);}
async function channel(){const result=await api(`/channels/${creator.user.channel.id}`);assert.equal(result.status,200);return result.body;}
async function current(){return (await channel()).audience.current;}
async function client(token){const result={token,jar:new Map()},ticket=await api(`/channels/${creator.user.channel.id}/playback`,token,'POST',undefined,result.jar);assert.equal(ticket.status,200);return result;}
async function receipt(client){
 const fetchFile=async file=>{const response=await fetch(`${base}/play/${creator.user.channel.id}/${file}`,{headers:{Cookie:[...client.jar.entries()].map(([name,value])=>`${name}=${value}`).join('; ')},signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());};
 const master=(await fetchFile('index.m3u8')).toString(),variant=master.split(/\r?\n/).find(line=>/^q\d+\.m3u8$/.test(line));assert.ok(variant);const playlist=(await fetchFile(variant)).toString(),segment=playlist.split(/\r?\n/).filter(line=>/^seg-q\d+-\d+\.m4s$/.test(line)).at(-1);assert.ok(segment);await fetchFile(segment);
}
async function playing(client,lease){await receipt(client);assert.equal((await beat(client,lease,0)).status,200);await pause(650);assert.equal((await beat(client,lease,2)).status,200);}
try{
 assert.equal(beforeSettings.guestViewingEnabled,true,'This deployment test requires the already-enabled guest policy.');
 await renew();await admin('/clients','POST',{clientId,enabled:true,publicClient:true,defaultClientScopes:['basic','profile'],standardFlowEnabled:false,directAccessGrantsEnabled:true,protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'nova-api','access.token.claim':'true','id.token.claim':'false'}}]});clientUuid=(await admin(`/clients?clientId=${clientId}`))[0].id;
 creator=await account('c','creator');viewer=await account('v','viewer');let publisher=await publish();await until(async()=>(await channel()).state==='live');
 const a=await client(),a1=randomUUID(),a2=randomUUID(),a3=randomUUID();
 await check('Playback tickets alone do not count; heartbeat requires a signed browser and a delivered video segment',async()=>{assert.equal(await current(),0);assert.equal((await beat(a,a1,0)).status,403);const forged={jar:new Map(a.jar)};forged.jar.set('nova_audience',forged.jar.get('nova_audience')+'x');await receipt(a);assert.equal((await beat(forged,randomUUID(),0)).status,401);});
 await check('A first pulse remains zero until playback time advances',async()=>{assert.equal((await beat(a,a1,0)).status,200);assert.equal(await current(),0);await pause(650);assert.equal((await beat(a,a1,2)).status,200);assert.equal(await current(),1);});
 await check('Guest tabs and refresh remain one viewer, with late leaves/heartbeats scoped to their own lease',async()=>{await playing(a,a2);await leave(a,a1);await playing(a,a3);assert.equal(await current(),1);assert.equal((await beat(a,a1,5)).status,403);await leave(a,a3);assert.equal(await current(),1);});
 const b=await client(viewer.token),c=await client(viewer.token),d=await client(),b1=randomUUID(),c1=randomUUID(),d1=randomUUID();
 await check('The same signed-in account on two browsers counts once alongside independent guests',async()=>{await playing(b,b1);await playing(c,c1);assert.equal(await current(),2);await playing(d,d1);assert.equal(await current(),3);});
 let startedAt;
 await check('Channel, Discover and Studio agree on current viewers; only Studio exposes the durable peak',async()=>{
  const value=await channel();startedAt=value.audience.startedAt;assert.ok(Date.parse(startedAt)>0);assert.equal('sessions'in value,false);assert.equal('peak'in value.audience,false);
  const discover=await api('/channels?live=true');assert.equal(discover.body.find(item=>item.id===creator.user.channel.id).audience.current,3);
  const studio=await api('/me/channel/health',creator.token);assert.equal(studio.body.audience.current,3);assert.equal(studio.body.audience.peak,3);
  const session=await db.streamSession.findFirstOrThrow({where:{channelId:creator.user.channel.id,endedAt:null}});assert.equal(session.peakViewers,3);assert.equal(new AudienceService(platform).stats(session,true,true).peak,3);
 });
 await check('Closing one signed-in tab leaves the other counted; pause removes only the matching browser lease',async()=>{await leave(a,a2);await leave(d,d1);assert.equal(await current(),1);await leave(b,b1);assert.equal(await current(),1);});
 await check('Suspending an account rejects its existing heartbeat and removes it from current viewers',async()=>{await db.user.update({where:{id:viewer.user.id},data:{status:'suspended'}});assert.equal((await beat(c,c1,4)).status,403);await until(async()=>await current()===0,15000);await db.user.update({where:{id:viewer.user.id},data:{status:'active'}});});
 await check('A browser that disappears without a leave expires, while peak and stream start time remain',async()=>{const vanished=await client(),lease=randomUUID();await playing(vanished,lease);assert.equal(await current(),1);await pause(36500);assert.equal(await current(),0);const value=await channel();assert.equal(value.audience.startedAt,startedAt);const studio=await api('/me/channel/health',creator.token);assert.equal(studio.body.audience.peak,3);});
 await check('Stop returns zero immediately and preserves the ended stream peak/duration',async()=>{assert.equal((await api('/me/channel/stop',creator.token,'POST')).status,200);await end(publisher);const value=await channel();assert.equal(value.audience.current,0);assert.equal(value.audience.live,false);const studio=await api('/me/channel/health',creator.token);assert.equal(studio.body.audience.peak,3);assert.ok(Date.parse(studio.body.audience.endedAt)>Date.parse(startedAt));});
 publisher=await publish();
 await check('The next broadcast starts with a new live time and zero current/peak viewers',async()=>{await until(async()=>(await channel()).audience.live);const value=await channel();assert.notEqual(value.audience.startedAt,startedAt);assert.equal(value.audience.current,0);const studio=await api('/me/channel/health',creator.token);assert.equal(studio.body.audience.peak,0);await end(publisher);});
 await check('Existing platform settings and publishing credentials remain unchanged',async()=>{assert.deepEqual(await platform.settings(),beforeSettings);assert.equal(await credentials(),beforeKeys);});
 console.log(`${passed} audience integration checks passed.`);
}finally{
 for(const child of children)await end(child);
 for(const id of identities)try{await admin(`/users/${id}`,'DELETE');}catch{console.error('Audience identity cleanup needs attention.');}
 if(clientUuid)try{await admin(`/clients/${clientUuid}`,'DELETE');}catch{console.error('Audience client cleanup needs attention.');}
 const ids=accounts.map(account=>account.id),channels=accounts.map(account=>account.channel?.id).filter(Boolean),sessions=await db.streamSession.findMany({where:{channelId:{in:channels}},select:{id:true}});
 await db.auditEvent.deleteMany({where:{OR:[{actorId:{in:ids}},{targetId:{in:[...channels,...sessions.map(session=>session.id)]}}]}});await db.channel.deleteMany({where:{ownerId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});await db.$disconnect();console.log('Audience fixtures removed.');
}
