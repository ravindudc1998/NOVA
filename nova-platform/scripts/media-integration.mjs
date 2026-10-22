// Real local media checks. Run in media-worker with test-only secret/CA mounts.
// Temporary identity client/accounts are removed in finally. No keys/tokens are logged.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createSocket} from 'node:dgram';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PlatformService} from '../apps/api/dist/platform.service.js';
import {decryptSecret} from '../apps/api/dist/secrets.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const platform=new PlatformService(db),prefix=`qm_${Date.now().toString(36)}`,password=randomBytes(24).toString('base64url'),clientId=`nova-media-${prefix}`;
const base=`https://${process.env.NOVA_HOST||'192.168.0.191'}`,identityBase='http://keycloak:8080/auth';
let adminToken,clientUuid,originalSettings,staffToken,creatorToken,viewerToken,creator,viewer,staff;const identities=[],children=new Set(),resources=[];let passed=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=async(name,fn)=>{console.log(`CHECK ${name}`);await fn();passed++;console.log(`PASS ${name}`);};
async function until(fn,timeout=35000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await pause(500);}throw new Error('Timed out waiting for media state.');}
async function renewIdentityAdmin(){const r=await fetch(`${identityBase}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:readFileSync('/run/secrets/identity_admin_password','utf8').trim()})});assert.equal(r.status,200);adminToken=(await r.json()).access_token;}
async function identityAdmin(path,method='GET',body,retry=true){const r=await fetch(`${identityBase}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.status===401&&retry){await renewIdentityAdmin();return identityAdmin(path,method,body,false);}assert.ok(r.ok,`Identity operation: ${r.status}`);const text=await r.text();return text?JSON.parse(text):null;}
async function call(path,token,method='GET',body){const r=await fetch(`${base}/api/v1${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function createIdentity(suffix,type){const username=`${prefix}_${suffix}`;await identityAdmin('/users','POST',{username,enabled:true,firstName:username,credentials:[{type:'password',value:password,temporary:false}]});const list=await identityAdmin(`/users?username=${username}&exact=true`);identities.push(list[0].id);const r=await fetch(`${identityBase}/realms/nova/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:clientId,grant_type:'password',username,password})});assert.equal(r.status,200);const token=(await r.json()).access_token;const bootstrap=await call('/me/bootstrap',token,'POST',{accountType:type});assert.equal(bootstrap.status,200);return {token,user:bootstrap.body};}
async function settings(changes){const current=await call('/admin/settings',staffToken);const r=await call('/admin/settings',staffToken,'PATCH',{expectedVersion:current.body._revision,...changes});assert.equal(r.status,200);return r.body;}
function launch(args){const child=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let diagnostic='';child.stderr.on('data',data=>diagnostic=(diagnostic+data.toString()).slice(-2500));children.add(child);child.once('close',code=>{children.delete(child);if(code)console.log('Test media exit '+code+': '+diagnostic.replace(/rtmps?:\/\/\S+/g,'[media endpoint]').replace(/rtsp:\/\/\S+/g,'[media endpoint]'));});return child;}
async function terminate(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('close',r)),pause(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function key(){return decryptSecret((await db.streamCredential.findUniqueOrThrow({where:{channelId:creator.channel.id}})).encryptedSecret);}
async function publish(secret=undefined){secret??=await key();return launch(['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-re','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-pix_fmt','yuv420p','-g','60','-c:a','aac','-f','flv',`rtmp://${process.env.NOVA_HOST||'192.168.0.191'}:1935/ingest/${creator.channel.id}?key=${secret}`]);}
async function live(){return until(async()=>{const c=await db.channel.findUniqueOrThrow({where:{id:creator.channel.id}});return c.state==='live';});}
async function offline(){return until(async()=>{const c=await db.channel.findUniqueOrThrow({where:{id:creator.channel.id}});return c.state==='offline';},18000);}
async function activeCount(){return db.streamSession.count({where:{channelId:creator.channel.id,endedAt:null}});}
async function stop(token=creatorToken){const r=await call(token===staffToken?`/admin/channels/${creator.channel.id}/stop`:'/me/channel/stop',token,'POST');assert.equal(r.status,200);await offline();}
async function verifyPlayback(){
 const ticket=await call(`/channels/${creator.channel.id}/playback`,viewerToken,'POST');assert.equal(ticket.status,200);assert.ok(ticket.cookie);const url=base+ticket.body.url;
 const playlist=await until(async()=>{const r=await fetch(url,{headers:{Cookie:ticket.cookie},signal:AbortSignal.timeout(12000)});const body=await r.text();return r.ok&&body.includes('#EXTM3U')?body:false;});assert.ok(playlist.includes('#EXTM3U'));
 const codecs=await new Promise((resolve,reject)=>{const child=spawn('ffprobe',['-v','error','-tls_verify','1','-ca_file','/tmp/nova-ca.crt','-headers',`Cookie: ${ticket.cookie}\r\n`,'-read_intervals','%+3','-show_entries','stream=codec_name,codec_type','-of','json',url],{stdio:['ignore','pipe','ignore']});children.add(child);let result='';child.stdout.on('data',d=>result+=d);const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Playback probe timed out.'));},35000);child.on('close',code=>{clearTimeout(timeout);children.delete(child);if(code!==0)return reject(new Error(`Playback probe exited ${code}`));resolve(JSON.parse(result));});});
 assert.ok(codecs.streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'));assert.ok(codecs.streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'));const decoded=await new Promise((resolve,reject)=>{const child=spawn('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-xerror','-tls_verify','1','-ca_file','/tmp/nova-ca.crt','-headers',`Cookie: ${ticket.cookie}\r\n`,'-i',url,'-t','2','-map','0:v:0','-map','0:a:0','-progress','pipe:1','-f','null','-'],{stdio:['ignore','pipe','ignore']});children.add(child);let progress='';child.stdout.on('data',d=>progress+=d);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Viewer decode timed out'));},30000);child.on('close',code=>{clearTimeout(timer);children.delete(child);if(code!==0)return reject(new Error('Viewer video/audio decode failed'));resolve(progress);});});assert.ok([...decoded.matchAll(/frame=(\d+)/g)].some(m=>Number(m[1])>10));return ticket;
}
try{
 const grant=await fetch(`${identityBase}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:readFileSync('/run/secrets/identity_admin_password','utf8').trim()})});assert.equal(grant.status,200);adminToken=(await grant.json()).access_token;
 await identityAdmin('/clients','POST',{clientId,enabled:true,publicClient:true,defaultClientScopes:['basic','profile'],standardFlowEnabled:false,directAccessGrantsEnabled:true,protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.client.audience':'nova-api','access.token.claim':'true','id.token.claim':'false'}}]});clientUuid=(await identityAdmin(`/clients?clientId=${clientId}`))[0].id;
 if(process.argv.includes('--identity-cleanup-only')){
  await identityAdmin('/users','POST',{username:`${prefix}_v`,enabled:true});const identity=(await identityAdmin(`/users?username=${prefix}_v&exact=true`))[0];identities.push(identity.id);adminToken='expired-test-token';
  await check('Expired test administration tokens renew before fixture cleanup',async()=>assert.ok((await identityAdmin(`/clients?clientId=${clientId}`)).length===1));
 }else{
 ({token:staffToken,user:staff}=await createIdentity('a','viewer'));const administrators=await db.group.findUniqueOrThrow({where:{key:'administrators'}});await db.membership.create({data:{userId:staff.id,groupId:administrators.id}});
 originalSettings=(await call('/admin/settings',staffToken)).body;await settings({registrationEnabled:true,creatorSignupEnabled:true,creatorApprovalRequired:false,publishingEnabled:true,browserPublishingEnabled:true,maintenanceEnabled:false,chatEnabled:true,guestViewingEnabled:false});
 ({token:creatorToken,user:creator}=await createIdentity('c','creator'));({token:viewerToken,user:viewer}=await createIdentity('v','viewer'));
 await check('Invalid OBS credential cannot create a stream session',async()=>{const child=await publish('invalid-key');await until(()=>child.exitCode!==null,12000);assert.equal(await activeCount(),0);});
 let publisher;
 await check('OBS-compatible RTMP reaches a real live stream',async()=>{publisher=await publish();await live();assert.equal(await activeCount(),1);});
 let ticket;
 await check('Viewer receives decodable H.264 video and AAC audio over trusted HTTPS HLS',async()=>{ticket=await verifyPlayback();});
 await check('Playback requires access and rejects unauthenticated media requests',async()=>{assert.equal((await call(`/channels/${creator.channel.id}/playback`,null,'POST')).status,401);assert.equal((await fetch(base+ticket.body.url)).status,401);});
 await check('Guest viewing follows current policy, including previously issued tickets',async()=>{await settings({guestViewingEnabled:true});const guest=await call(`/channels/${creator.channel.id}/playback`,null,'POST');assert.equal(guest.status,200);assert.equal((await fetch(base+guest.body.url,{headers:{Cookie:guest.cookie}})).status,200);await settings({guestViewingEnabled:false});assert.equal((await fetch(base+guest.body.url,{headers:{Cookie:guest.cookie}})).status,401);});
 await check('A second publisher cannot replace the active channel source',async()=>{const second=await publish();await until(()=>second.exitCode!==null,12000);assert.equal(publisher.exitCode,null);assert.equal(await activeCount(),1);});
 await check('Viewer cannot use creator or administrator stop controls',async()=>{assert.equal((await call('/me/channel/stop',viewerToken,'POST')).status,403);assert.equal((await call(`/admin/channels/${creator.channel.id}/stop`,creatorToken,'POST')).status,403);});
 const oldKey=await key();
 await check('Creator stop disconnects media, rotates credentials and blocks buffered refetch',async()=>{await stop();assert.equal(await activeCount(),0);assert.notEqual(await key(),oldKey);assert.equal((await fetch(base+ticket.body.url,{headers:{Cookie:ticket.cookie}})).status,404);await until(()=>publisher.exitCode!==null,12000);});
 await check('Stopped OBS credentials cannot auto-reconnect',async()=>{const child=await publish(oldKey);await until(()=>child.exitCode!==null,12000);assert.equal(await activeCount(),0);});
 await check('New credentials reconnect and a natural publisher disconnect returns offline',async()=>{publisher=await publish();await live();await terminate(publisher);await offline();assert.equal(await activeCount(),0);});
 await check('Removing current creator grants terminates an existing publisher',async()=>{publisher=await publish();await live();const viewerGroup=await db.group.findUniqueOrThrow({where:{key:'viewers'}});assert.equal((await call(`/admin/users/${creator.id}`,staffToken,'PATCH',{groupIds:[viewerGroup.id]})).status,200);await offline();await until(()=>publisher.exitCode!==null,12000);assert.equal((await call(`/admin/users/${creator.id}`,staffToken,'PATCH',{groupIds:creator.groups.map(g=>g.id)})).status,200);});
 await check('Suspension terminates an active broadcast and invalidates viewer access',async()=>{publisher=await publish();await live();assert.equal((await call(`/admin/users/${creator.id}`,staffToken,'PATCH',{status:'suspended'})).status,200);await offline();assert.equal((await call(`/channels/${creator.channel.id}/playback`,viewerToken,'POST')).status,404);await until(()=>publisher.exitCode!==null,12000);await call(`/admin/users/${creator.id}`,staffToken,'PATCH',{status:'active'});});
 await check('Administrator stop disconnects a live publisher and rotates its key',async()=>{publisher=await publish();await live();const before=await key();await stop(staffToken);assert.notEqual(await key(),before);await until(()=>publisher.exitCode!==null,12000);});
 await check('Disabling global broadcasting drains active streams',async()=>{publisher=await publish();await live();await settings({publishingEnabled:false});await offline();await until(()=>publisher.exitCode!==null,12000);await settings({publishingEnabled:true});});
 await check('Unapproved channels cannot publish with an otherwise valid key',async()=>{assert.equal((await call(`/admin/channels/${creator.channel.id}`,staffToken,'PATCH',{accessState:'pending_approval'})).status,200);const denied=await publish();await until(()=>denied.exitCode!==null,12000);assert.equal(await activeCount(),0);assert.equal((await call(`/admin/channels/${creator.channel.id}`,staffToken,'PATCH',{accessState:'ready'})).status,200);});
 for(const videoCodec of ['H264','VP8'])await check(`Browser WebRTC/WHIP ${videoCodec} + Opus becomes playable H.264 + AAC`,async()=>{
  const {RTCPeerConnection,MediaStreamTrack,useH264,useVP8,useOPUS}=await import('werift');
  const pc=new RTCPeerConnection({iceServers:[],codecs:{video:[videoCodec==='H264'?useH264():useVP8()],audio:[useOPUS()]}});resources.push(()=>pc.close());
  const video=new MediaStreamTrack({kind:'video'}),audio=new MediaStreamTrack({kind:'audio'});pc.addTrack(video);pc.addTrack(audio);
  const sockets=[createSocket('udp4'),createSocket('udp4')];for(const socket of sockets){await new Promise(r=>socket.bind(0,'127.0.0.1',r));resources.push(()=>socket.close());}
  sockets[0].on('message',packet=>video.writeRtp(packet));sockets[1].on('message',packet=>audio.writeRtp(packet));
  await pc.setLocalDescription(await pc.createOffer());const offer=pc.localDescription.sdp;
  const answer=await call('/me/channel/browser-session',creatorToken,'POST',{offer});assert.equal(answer.status,200);await pc.setRemoteDescription({type:'answer',sdp:answer.body.answer});await until(()=>pc.connectionState==='connected',16000);
  const videoPayload=Number(new RegExp(`a=rtpmap:(\\d+) ${videoCodec}/90000`,'i').exec(offer)[1]),audioPayload=Number(/a=rtpmap:(\d+) opus\/48000/i.exec(offer)[1]);
  const media=launch(['-hide_banner','-nostdin','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-re','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-map','0:v:0',...(videoCodec==='H264'?['-c:v','libx264','-profile:v','baseline','-pix_fmt','yuv420p','-preset','ultrafast','-tune','zerolatency']:['-c:v','libvpx','-deadline','realtime','-cpu-used','8']),'-g','30','-payload_type',String(videoPayload),'-f','rtp',`rtp://127.0.0.1:${sockets[0].address().port}?pkt_size=1100`,'-map','1:a:0','-c:a','libopus','-payload_type',String(audioPayload),'-f','rtp',`rtp://127.0.0.1:${sockets[1].address().port}?pkt_size=1100`]);
  await live();await verifyPlayback();await stop();await terminate(media);await pc.close();
 });
 await check('Shared chat persists, delivers across accounts and deduplicates retries',async()=>{
  const controller=new AbortController();resources.push(()=>controller.abort());const response=await fetch(`${base}/api/v1/channels/${creator.channel.id}/chat/events`,{headers:{Authorization:`Bearer ${creatorToken}`},signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();let received='';const message={text:'Real shared message <script>plain text</script>',clientMessageId:randomUUID()};
  const first=await call(`/channels/${creator.channel.id}/chat`,viewerToken,'POST',message);assert.equal(first.status,200);assert.equal((await call(`/channels/${creator.channel.id}/chat`,viewerToken,'POST',message)).body.id,first.body.id);
  await until(async()=>{received+=(await Promise.race([reader.read().then(r=>Buffer.from(r.value||'').toString()),pause(2000).then(()=>{throw new Error('Chat delivery timed out.');})]));return received.includes('Real shared message');},5000);controller.abort();
  const history=await call(`/channels/${creator.channel.id}/chat`,viewerToken);assert.ok(history.body.messages.some(m=>m.id===first.body.id));
  assert.equal((await call(`/channels/${creator.channel.id}/chat/${first.body.id}`,viewerToken,'DELETE')).status,403);assert.equal((await call(`/channels/${creator.channel.id}/chat/${first.body.id}`,creatorToken,'DELETE')).status,200);assert.equal((await call(`/channels/${creator.channel.id}/chat`,viewerToken)).body.messages.find(m=>m.id===first.body.id).text,'');
 });
 await check('Chat slow mode and global disable are enforced by the server',async()=>{
  const c=await db.channel.findUniqueOrThrow({where:{id:creator.channel.id}});await call('/me/channel',creatorToken,'PATCH',{version:c.version,title:c.title,bio:c.bio,settings:{chatEnabled:true,slowModeSeconds:20}});
  assert.equal((await call(`/channels/${creator.channel.id}/chat`,viewerToken,'POST',{text:'Too soon',clientMessageId:randomUUID()})).status,429);await settings({chatEnabled:false});assert.equal((await call(`/channels/${creator.channel.id}/chat`,viewerToken,'POST',{text:'Disabled',clientMessageId:randomUUID()})).status,403);await settings({chatEnabled:true});
 });
 await check('A suspended viewer cannot keep using an issued playback ticket',async()=>{publisher=await publish();await live();const t=await call(`/channels/${creator.channel.id}/playback`,viewerToken,'POST');await call(`/admin/users/${viewer.id}`,staffToken,'PATCH',{status:'suspended'});assert.equal((await fetch(base+t.body.url,{headers:{Cookie:t.cookie}})).status,403);await stop();});
 console.log(`${passed} real-media and chat integration checks passed.`);
 }
}finally{
 for(const child of children)await terminate(child);for(const cleanup of resources.reverse())try{await cleanup();}catch{}
 if(creator&&staffToken)try{await stop(staffToken);}catch{}
 if(originalSettings&&staffToken){const {_revision,...changes}=originalSettings;try{await settings(changes);}catch(error){console.error('Settings restore failed:',error.message);}}
 if(adminToken){for(const id of identities)try{await identityAdmin(`/users/${id}`,'DELETE');}catch{}if(!clientUuid)try{clientUuid=(await identityAdmin(`/clients?clientId=${clientId}`))[0]?.id;}catch{}if(clientUuid)try{await identityAdmin(`/clients/${clientUuid}`,'DELETE');}catch{}}
 const localUsers=await db.user.findMany({where:{username:{startsWith:prefix}},select:{id:true}});for(const u of localUsers){await db.channel.deleteMany({where:{ownerId:u.id}});await db.user.delete({where:{id:u.id}});}await db.$disconnect();
}

// Werift may retain housekeeping timers after close; all fixtures/resources are already cleaned.
assert.equal((await identityAdmin(`/clients?clientId=${clientId}`)).length,0);
assert.equal((await identityAdmin(`/users?username=${prefix}&max=100`)).filter(user=>user.username.startsWith(prefix)).length,0);
console.log('Verification database and identity fixtures cleaned up.');
process.exit(0);
