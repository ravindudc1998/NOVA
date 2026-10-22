import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {pcmLevels,audioReading,ingestRate,outputSnapshot} from '../scripts/stream-health-analysis.mjs';
import {readStreamHealth} from '../apps/api/src/stream-health';
import {MediaService} from '../apps/api/src/media.service';
import {StreamHealthView} from '../apps/web/src/stream-health';

const session='11111111-1111-4111-8111-111111111111',channel='22222222-2222-4222-8222-222222222222',now=Date.now(),stamp=new Date(now).toISOString();
const report=()=>({version:1,sessionId:session,channelId:channel,checkedAt:stamp,ingest:{state:'receiving',bitrateKbps:5500},video:{state:'ready',width:1920,height:1080,codec:'h264',fps:30,qualities:[{width:640,height:360},{width:1920,height:1080}],lastSegmentAt:stamp},audio:{state:'active',peakDbfs:-12,rmsDbfs:-19,sampledAt:stamp,quietSince:null}});
test('Stereo audio measurement retains opposite-phase signals and rejects invalid/empty samples',()=>{
 const pcm=Buffer.alloc(8);pcm.writeFloatLE(0.5,0);pcm.writeFloatLE(-0.5,4);assert.deepEqual(pcmLevels(pcm),{peakDbfs:-6,rmsDbfs:-6});
 assert.deepEqual(pcmLevels(Buffer.alloc(32)),{peakDbfs:null,rmsDbfs:null});assert.throws(()=>pcmLevels(Buffer.alloc(0)));pcm.writeFloatLE(NaN,0);assert.throws(()=>pcmLevels(pcm));
});
test('A short quiet pause is neutral; sustained quiet warns and recovered sound clears the warning',()=>{
 const levels={peakDbfs:null,rmsDbfs:null},first=audioReading(levels,null,now),second=audioReading(levels,first,now+10000),third=audioReading(levels,second,now+20000);
 assert.equal(first.state,'quiet');assert.equal(third.state,'silent');assert.equal(audioReading({peakDbfs:-12,rmsDbfs:-19},third,now+30000).quietSince,null);assert.equal(audioReading(levels,first,now+40000).state,'quiet');
});
test('Incoming bitrate uses elapsed time and discards reset or uninitialized counters',()=>{
 assert.equal(ingestRate({bytes:1000,at:now},1001000,now+2000),4000);assert.equal(ingestRate(null,1000,now),null);assert.equal(ingestRate({bytes:1000,at:now},999,now+1000),null);
});
test('Owner health files reject wrong sessions/channels, malformed data and stale/future heartbeats',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nova-health-'));try{
  const path=join(root,session+'.json');await writeFile(path,JSON.stringify(report()));assert.equal((await readStreamHealth(session,channel,root,now)).monitor,'fresh');
  assert.equal((await readStreamHealth(session,'33333333-3333-4333-8333-333333333333',root,now)).report,null);
  assert.equal((await readStreamHealth(session,channel,root,now+21000)).monitor,'stale');assert.equal((await readStreamHealth(session,channel,root,now-6000)).monitor,'stale');
  const stale=report();stale.audio.sampledAt=new Date(now-25000).toISOString();stale.video.lastSegmentAt=new Date(now-16000).toISOString();await writeFile(path,JSON.stringify(stale));
  const value=await readStreamHealth(session,channel,root,now);assert.equal(value.report?.audio.state,'unavailable');assert.equal(value.report?.video.state,'stalled');
  await writeFile(path,JSON.stringify({...report(),secret:'not allowed'}));assert.equal((await readStreamHealth(session,channel,root,now)).report,null);
  assert.equal((await readStreamHealth('../outside',channel,root,now)).report,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Output readiness checks every advertised quality and rejects untrusted segment paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nova-health-hls-'));try{
  await writeFile(join(root,'index.m3u8'),'#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\nq360.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nq1080.m3u8\n');
  for(const quality of [360,1080]){await writeFile(join(root,`q${quality}.m3u8`),`#EXTM3U\n#EXT-X-MAP:URI="init-q${quality}.mp4"\n#EXTINF:2,\nseg-q${quality}-123.m4s\n`);await writeFile(join(root,`seg-q${quality}-123.m4s`),'segment');}
  assert.equal((await outputSnapshot(root)).ready,true);const old=new Date(Date.now()-20000);await utimes(join(root,'q360.m3u8'),old,old);assert.equal((await outputSnapshot(root)).ready,false);
  await writeFile(join(root,'q360.m3u8'),'#EXTM3U\n#EXT-X-MAP:URI="../secret"\n../segment.m4s');await assert.rejects(outputSnapshot(root));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Health access requires creator management and always scopes the session query to the actor channel',async()=>{
 process.env.MEDIA_SERVICE_SECRET||='unit-test-secret-that-is-at-least-32-characters';let queried=false;
 const platform:any={require(user:any,permission:string){assert.equal(permission,'channel.manage_own');if(!user.permitted)throw new Error('Forbidden');},db:{streamSession:{findFirst:async(input:any)=>{queried=true;assert.equal(input.where.channelId,channel);return null;}}}};
 const media=new MediaService(platform);await assert.rejects(media.health({channel:{id:channel}}),/Forbidden/);assert.equal(queried,false);
 const result=await media.health({permitted:true,channel:{id:channel,state:'offline'}});assert.equal(result.monitor,'offline');assert.equal(queried,true);
});
test('Studio health does not label unavailable or stale observations healthy, and explains silent vs missing audio',()=>{
 const data={monitor:'fresh',checkedAt:stamp,report:report(),session:{protocol:'rtmp'}};
 const render=(value:any,failed=false)=>renderToStaticMarkup(React.createElement(StreamHealthView,{data:value,failed,now}));
 assert.match(render(data),/Broadcast healthy/);assert.match(render(data),/Sound detected/);assert.match(render(data),/5.50 Mbps/);
 for(const value of [{...data,monitor:'stale'},{...data,checkedAt:new Date(now-25000).toISOString()}]){const html=render(value);assert.match(html,/Health unavailable/);assert.equal(html.includes('Broadcast healthy'),false);}
 assert.equal(render(data,true).includes('Sound detected'),false);
 assert.match(render({...data,report:{...report(),audio:{...report().audio,state:'missing'}}}),/Add Desktop Audio/);
 assert.match(render({...data,report:{...report(),audio:{...report().audio,state:'silent'}}}),/No sound detected for at least 20 seconds/);
 assert.match(render({monitor:'offline',session:null}),/Ready for your next broadcast/);
});
