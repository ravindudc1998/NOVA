// Temporary identities/broadcasts only. Existing streams and global policy are untouched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Database} from '../apps/api/dist/database.js';
import {PlatformService} from '../apps/api/dist/platform.service.js';
import {decryptSecret} from '../apps/api/dist/secrets.js';
const db=new Database(),platform=new PlatformService(db),base=`https://${process.env.NOVA_HOST}/api/v1`,identity='http://keycloak:8080/auth',prefix=`health_${Date.now().toString(36)}`,clientId=prefix,password=randomBytes(24).toString('base64url');
const identities=[],accounts=[],children=new Set();let adminToken,clientUuid,creator,other,viewer,passed=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=async(name,task)=>{await task();passed++;console.log(`PASS ${name}`);};
const before=await platform.settings(),existingIds=(await db.user.findMany({select:{id:true}})).map(user=>user.id);
async function snapshot(){const credentials=await db.streamCredential.findMany({where:{channel:{ownerId:{in:existingIds}}},orderBy:{channelId:'asc'}});return createHash('sha256').update(JSON.stringify(credentials)).digest('hex');}
const keysBefore=await snapshot();
async function renew(){const response=await fetch(`${identity}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:readFileSync('/run/secrets/identity_admin_password','utf8').trim()})});assert.equal(response.status,200);adminToken=(await response.json()).access_token;}
async function admin(path,method='GET',body,retry=true){const response=await fetch(`${identity}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.status===401&&retry){await renew();return admin(path,method,body,false);}assert.ok(response.ok,`Identity operation HTTP ${response.status}`);const text=await response.text();return text?JSON.parse(text):null;}
async function api(path,token,method='GET',body){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};}
async function account(suffix,type){const username=`${prefix}_${suffix}`;await admin('/users','POST',{username,enabled:true,firstName:username,credentials:[{type:'password',value:password,temporary:false}]});const user=(await admin(`/users?username=${username}&exact=true`))[0];identities.push(user.id);const response=await fetch(`${identity}/realms/nova/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:clientId,grant_type:'password',username,password})});assert.equal(response.status,200);const token=(await response.json()).access_token,result=await api('/me/bootstrap',token,'POST',{accountType:type});assert.equal(result.status,200);accounts.push(result.body);return {token,user:result.body};}
async function until(task,timeout=65000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await task();if(result)return result;await pause(1000);}throw new Error('Health verification timed out.');}
async function end(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('close',resolve)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function publish(mode){
 const key=decryptSecret((await db.streamCredential.findUniqueOrThrow({where:{channelId:creator.user.channel.id}})).encryptedSecret);
 const args=['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i','color=size=320x180:rate=30'];
 if(mode!=='missing')args.push('-re','-f','lavfi','-i',mode==='sound'?'sine=frequency=880:sample_rate=48000':'anullsrc=sample_rate=48000:channel_layout=stereo');
 args.push('-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-g','60','-sc_threshold','0');
 if(mode!=='missing')args.push('-c:a','aac','-b:a','64k');else args.push('-an');
 args.push('-f','flv',`rtmp://mediamtx:1935/ingest/${creator.user.channel.id}?key=${key}`);
 const child=spawn('ffmpeg',args,{stdio:'ignore'});children.add(child);child.once('close',()=>children.delete(child));return child;
}
async function health(state){let last='';return until(async()=>{const response=await api('/me/channel/health',creator.token);assert.equal(response.status,200);const report=response.body.report,key=JSON.stringify({monitor:response.body.monitor,video:report?.video.state,audio:report?.audio.state});if(key!==last){console.log(`Health observation ${key}`);last=key;}return response.body.monitor==='fresh'&&report?.video.state==='ready'&&report.audio.state===state?response:false;});}
async function offline(){return until(async()=>{const response=await api('/me/channel/health',creator.token);return response.body.monitor==='offline';},20000);}
try{
 await renew();await admin('/clients','POST',{clientId,enabled:true,publicClient:true,defaultClientScopes:['basic','profile'],standardFlowEnabled:false,directAccessGrantsEnabled:true,protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'nova-api','access.token.claim':'true','id.token.claim':'false'}}]});clientUuid=(await admin(`/clients?clientId=${clientId}`))[0].id;
 creator=await account('c','creator');other=await account('o','creator');viewer=await account('v','viewer');
 await check('Health API rejects guests and viewer-only accounts',async()=>{assert.equal((await api('/me/channel/health')).status,401);assert.equal((await api('/me/channel/health',viewer.token)).status,403);});
 await check('Offline creators receive no previous-session health values',async()=>{const response=await api('/me/channel/health',creator.token);assert.equal(response.body.monitor,'offline');assert.equal(response.body.report,null);assert.match(response.cache,/no-store/);});
 let child=await publish('sound');
 await check('Real RTMP video and audible AAC become fresh creator health',async()=>{const response=await health('active'),report=response.body.report;assert.equal(report.channelId,creator.user.channel.id);assert.equal(report.video.width,320);assert.equal(report.video.height,180);assert.ok(report.audio.peakDbfs> -60);assert.ok(report.ingest.bitrateKbps===null||report.ingest.bitrateKbps>=0);console.log(JSON.stringify({event:'health.sound',resolution:[report.video.width,report.video.height],audio:report.audio.state,peakDbfs:report.audio.peakDbfs}));});
 await check('Another creator cannot select the live owner report through query parameters',async()=>{const response=await api(`/me/channel/health?channelId=${creator.user.channel.id}`,other.token);assert.equal(response.body.monitor,'offline');assert.equal(response.body.report,null);});
 await check('Current creator permissions and suspension apply to existing tokens',async()=>{const membership=await db.membership.findFirstOrThrow({where:{userId:other.user.id,group:{key:'creators'}}});await db.membership.delete({where:{userId_groupId:{userId:membership.userId,groupId:membership.groupId}}});assert.equal((await api('/me/channel/health',other.token)).status,403);await db.membership.create({data:membership});await db.user.update({where:{id:other.user.id},data:{status:'suspended'}});assert.equal((await api('/me/channel/health',other.token)).status,403);await db.user.update({where:{id:other.user.id},data:{status:'active'}});});
 await end(child);await offline();child=await publish('silence');
 await check('Brief silence is quiet, then sustained silence becomes a warning',async()=>{await health('quiet');const response=await health('silent');assert.equal(response.body.report.audio.peakDbfs,null);assert.ok(Date.parse(response.body.report.audio.sampledAt)-Date.parse(response.body.report.audio.quietSince)>=20000);});
 await end(child);await offline();child=await publish('missing');
 await check('Video-only publishing reports missing audio instead of silence or a decode failure',async()=>{const response=await health('missing');assert.equal(response.body.report.audio.sampledAt!==null,true);assert.equal(response.body.report.video.state,'ready');});
 await end(child);await offline();
 await check('Global settings and existing publishing credentials remain unchanged',async()=>{assert.deepEqual(await platform.settings(),before);assert.equal(await snapshot(),keysBefore);});
 console.log(`${passed} stream health integration checks passed.`);
}finally{
 for(const child of children)await end(child);
 for(const id of identities)try{await admin(`/users/${id}`,'DELETE');}catch{console.error('Health identity cleanup needs attention.');}
 if(clientUuid)try{await admin(`/clients/${clientUuid}`,'DELETE');}catch{console.error('Health client cleanup needs attention.');}
 const ids=accounts.map(account=>account.id),channels=accounts.map(account=>account.channel?.id).filter(Boolean),sessions=await db.streamSession.findMany({where:{channelId:{in:channels}},select:{id:true}});
 await db.auditEvent.deleteMany({where:{OR:[{actorId:{in:ids}},{targetId:{in:[...channels,...sessions.map(session=>session.id)]}}]}});await db.channel.deleteMany({where:{ownerId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});await db.$disconnect();console.log('Health fixtures removed.');
}
