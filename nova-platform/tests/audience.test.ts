import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AudienceStore,VIEWER_TTL} from '../apps/api/src/audience-store';
import {browserCookie,browserFromCookie,AudienceService} from '../apps/api/src/audience.service';
import {LibraryService} from '../apps/api/src/library.service';
import {trackViewer} from '../apps/web/src/viewer-presence';
import {elapsedSeconds,durationLabel,WatchAudience,StudioAudience} from '../apps/web/src/audience';

const session='session',channel='channel';
const pulse=(store:AudienceStore,browserId:string,leaseId:string,position:number,viewerId:string|null=null,peak=0)=>store.beat({sessionId:session,channelId:channel,browserId,leaseId,position,viewerId,peak});
test('Audience browser identity is signed, shared by tabs and rejects tampering or a different secret',()=>{
 const id='11111111-1111-4111-8111-111111111111',secret='a'.repeat(40),value=browserCookie(id,secret);
 assert.equal(browserFromCookie(value,secret),id);assert.equal(browserFromCookie(value+'x',secret),null);assert.equal(browserFromCookie(value,'b'.repeat(40)),null);assert.equal(browserFromCookie(browserCookie('../path',secret),secret),null);
});
test('A ticket or unchanged playback position never counts; video delivery and forward progress are required',()=>{
 let now=0;const store=new AudienceStore(()=>now);assert.equal(pulse(store,'b','a',0),null);store.delivery(session,'b');
 assert.equal(pulse(store,'b','a',0)?.current,0);now=1000;assert.equal(pulse(store,'b','a',0)?.current,0);now=2000;assert.equal(pulse(store,'b','a',2)?.current,1);
 now+=VIEWER_TTL;assert.equal(store.current(session),0);store.prune();assert.equal(store.streams.get(session)?.leases.size,0);
});
test('Guest tabs share one count, signed-in accounts share one count across browsers, and login collapses guest leases',()=>{
 let now=0;const store=new AudienceStore(()=>now);for(const browser of ['a','b'])store.delivery(session,browser);
 pulse(store,'a','tab1',0);pulse(store,'a','tab2',0);now=1000;pulse(store,'a','tab1',2);pulse(store,'a','tab2',2);assert.equal(store.current(session),1);
 pulse(store,'b','tab3',0);now=2000;pulse(store,'b','tab3',2);assert.equal(store.current(session),2);
 now=3000;pulse(store,'a','tab1',4,'account');pulse(store,'b','tab3',4,'account');assert.equal(store.current(session),1);assert.deepEqual(store.userIds(),['account']);
});
test('Closing one tab preserves another; a late heartbeat cannot resurrect a released lease and peaks do not fall',()=>{
 let now=0;const store=new AudienceStore(()=>now);store.delivery(session,'a');pulse(store,'a','one',0);pulse(store,'a','two',0);now=1000;pulse(store,'a','one',1);pulse(store,'a','two',1);
 store.leave(channel,'a','one');assert.equal(store.current(session),1);now=2000;assert.equal(pulse(store,'a','one',2),null);
 store.leave(channel,'a','two');assert.equal(store.current(session),0);assert.equal(store.streams.get(session)?.peak,1);
 assert.equal(store.beat({sessionId:'next-session',channelId:channel,browserId:'a',leaseId:'new',position:4,viewerId:null,peak:0}),null);
});
test('Revoked users, disabled guests and ended sessions are removed without resetting the observed peak',()=>{
 let now=0;const store=new AudienceStore(()=>now);for(const browser of ['a','b'])store.delivery(session,browser);pulse(store,'a','a',0,'user');pulse(store,'b','b',0);now=1000;pulse(store,'a','a',2,'user');pulse(store,'b','b',2);assert.equal(store.current(session),2);
 store.prune(new Set([session]),new Set(),true);assert.equal(store.current(session),1);assert.equal(store.streams.get(session)?.peak,2);
 store.prune(new Set([session]),new Set(),false);assert.equal(store.current(session),0);store.prune(new Set());assert.equal(store.streams.has(session),false);
});
test('Public channel summaries expose counts/timing while keeping session identity and owner-only peaks private',async()=>{
 const platform:any={db:{channel:{findMany:async()=>[{id:channel,state:'live',title:'Test',sessions:[{id:session,status:'live',startedAt:new Date('2026-10-21T10:00:00Z'),endedAt:null,peakViewers:8}]}]}}};
 const audience=new AudienceService(platform),result=await new LibraryService(platform,audience).channels(true);
 assert.equal(result[0].audience.current,0);assert.equal(result[0].audience.startedAt,'2026-10-21T10:00:00.000Z');assert.equal('sessions'in result[0],false);assert.equal('peak'in result[0].audience,false);
 assert.equal(audience.stats({id:session,status:'ended',startedAt:new Date(),endedAt:new Date(),peakViewers:8},false,true).peak,8);
});
test('Player tracking only starts during playback, releases on pause, creates a new resume lease and cleans up',async()=>{
 class Video extends EventTarget {paused=true;ended=false;readyState=4;currentTime=0;}
 const video=new Video(),calls:any[]=[],leaves:any[]=[];let serial=0,now=0;
 const cleanup=trackViewer(video as any,'channel',async(_path:string,_method:string,body:any)=>{calls.push(body);},{uuid:()=>`lease-${++serial}`,leave:(_url,body)=>leaves.push(JSON.parse(body)),now:()=>now,warmupMs:5,intervalMs:100000});
 assert.equal(calls.length,0);video.paused=false;video.currentTime=1;video.dispatchEvent(new Event('playing'));await Promise.resolve();now=2000;video.currentTime=3;await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls.length,2);
 video.paused=true;video.dispatchEvent(new Event('pause'));assert.equal(leaves.length,1);video.paused=false;video.dispatchEvent(new Event('playing'));await Promise.resolve();assert.notEqual(calls.at(-1).leaseId,calls[0].leaseId);
 assert.equal(cleanup(),undefined);const count=calls.length;video.dispatchEvent(new Event('playing'));video.dispatchEvent(new Event('timeupdate'));await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls.length,count);assert.equal(leaves.length,2);
});
test('Live time follows server timestamps, freezes after end, and renders viewer/peak values without starting a player',()=>{
 const stats={live:true,current:3,peak:9,startedAt:'2026-10-21T10:00:00Z',serverTime:'2026-10-21T11:02:03Z',endedAt:null};
 assert.equal(durationLabel(elapsedSeconds(stats)),'1:02:03');assert.equal(elapsedSeconds(stats,2000),3725);assert.equal(durationLabel(NaN),'0:00');assert.equal(elapsedSeconds({...stats,live:false,endedAt:'2026-10-21T10:01:00Z'},100000),60);
 const watch=renderToStaticMarkup(React.createElement(WatchAudience,{stats})),studio=renderToStaticMarkup(React.createElement(StudioAudience,{stats}));assert.match(watch,/3 viewers/);assert.match(watch,/1:02:03 live/);assert.match(studio,/Peak viewers/);assert.match(studio,/>9<\/strong>/);assert.equal(studio.includes('<video'),false);
});
