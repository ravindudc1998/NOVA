import test from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT} from 'jose';
import {forwardedMediaPath,validatePlaybackPolicy} from '../apps/api/src/playback-access';
import {MediaService} from '../apps/api/src/media.service';
import {AudienceStore} from '../apps/api/src/audience-store';
import {browserCookie} from '../apps/api/src/audience.service';
const channel='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333',secret='delivery-tests-secret-at-least-32-characters';
function policy(){return {channelId:channel,accessState:'ready',ownerStatus:'active',sessionId:session,peakViewers:3,settings:{guestViewingEnabled:true,maintenanceEnabled:false},viewerId:viewer,viewerStatus:'active',authNotBefore:0,authAllowedSessionId:null,canView:true,revoked:false};}
test('Forwarded media paths accept only local HLS files and reject traversal, encoding, nested paths and wrong methods',()=>{
 assert.deepEqual(forwardedMediaPath(`/api/v1/play/${channel}/seg-q720-123.m4s?_HLS_msn=1`,'GET'),{channelId:channel,file:'seg-q720-123.m4s'});
 for(const file of ['../index.m3u8','%2e%2e/index.m3u8','%71%37720.m3u8','health.json','index.m3u8/extra','seg-q720-123.m4s#x'])assert.throws(()=>forwardedMediaPath(`/api/v1/play/${channel}/${file}`,'GET'));
 for(const method of [undefined,'POST','DELETE'])assert.throws(()=>forwardedMediaPath(`/api/v1/play/${channel}/index.m3u8`,method));
});
test('Current viewing rules apply to guests, administrators, hidden owners and offline sessions without stale access grants',()=>{
 const row=policy();assert.equal(validatePlaybackPolicy(row,{viewerId:null}).id,session);
 row.settings.guestViewingEnabled=false;assert.throws(()=>validatePlaybackPolicy(row,{viewerId:null}),/Sign in/);assert.equal(validatePlaybackPolicy(row,{viewerId:viewer}).id,session);
 row.settings.maintenanceEnabled=true;assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer}),/maintenance/);row.settings.maintenanceEnabled=false;
 row.viewerStatus='suspended';assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer}),/not active/);row.viewerStatus='active';row.canView=false;assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer}),/permission/);row.canView=true;
 row.ownerStatus='suspended';assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer}),/unavailable/);row.ownerStatus='active';row.accessState='disabled';assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer}),/unavailable/);
 row.accessState='ready';row.sessionId='';assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer}),/offline/);
});
test('Lean media access rejects old authentication, refreshed old sessions and individual revocations',()=>{
 const row=policy();row.authNotBefore=100;
 for(const payload of [{viewerId:viewer,iat:99},{viewerId:viewer,authIat:200,authTime:99,sid:'old'}])assert.throws(()=>validatePlaybackPolicy(row,payload),/session ended/);
 row.authAllowedSessionId='kept' as any;assert.equal(validatePlaybackPolicy(row,{viewerId:viewer,iat:99,sid:'kept'}).id,session);
 row.revoked=true;assert.throws(()=>validatePlaybackPolicy(row,{viewerId:viewer,iat:200,sid:'kept'}),/session ended/);
});
test('Receipt renewal is scoped to the browser/session and is not satisfied by authorization or HEAD requests',async()=>{
 process.env.MEDIA_SERVICE_SECRET=secret;let queries=0;const row=policy(),media=new MediaService({db:{$queryRaw:async()=>{queries++;return [row];}}} as any);
 let now=0;const store=new AudienceStore(()=>now);(media.audience as any).store=store;
 const browser='44444444-4444-4444-8444-444444444444',token=await new SignJWT({channelId:channel,viewerId:null}).setProtectedHeader({alg:'HS256'}).setIssuer('nova-media').setAudience('playback').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
 const req={headers:{cookie:`nova_play=${token}; nova_audience=${browserCookie(browser,secret)}`,'x-forwarded-uri':`/api/v1/play/${channel}/seg-q720-123.m4s`,'x-forwarded-method':'GET'}};
 assert.deepEqual(await media.gatewayAccess(req),{path:`/${session}/seg-q720-123.m4s`,mode:'verified'});assert.equal(store.needsDelivery(session,browser),true);assert.equal(queries,1);
 req.headers['x-forwarded-method']='HEAD';assert.equal((await media.gatewayAccess(req)).mode,'direct');assert.equal(store.needsDelivery(session,browser),true);
 media.audience.delivered(req,session);req.headers['x-forwarded-method']='GET';assert.equal((await media.gatewayAccess(req)).mode,'direct');now=20000;assert.equal((await media.gatewayAccess(req)).mode,'verified');assert.equal(store.needsDelivery('another-session',browser),true);
 row.accessState='disabled';await assert.rejects(media.gatewayAccess(req),/unavailable/);
});
test('Cross-channel/tampered playback cookies fail before a policy query or file-path grant',async()=>{
 process.env.MEDIA_SERVICE_SECRET=secret;let queries=0;const media=new MediaService({db:{$queryRaw:async()=>{queries++;return [policy()];}}} as any);
 const token=await new SignJWT({channelId:session,viewerId:null}).setProtectedHeader({alg:'HS256'}).setIssuer('nova-media').setAudience('playback').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
 for(const cookie of ['',`nova_play=${token}`,`nova_play=${token}x`])await assert.rejects(media.gatewayAccess({headers:{cookie,'x-forwarded-uri':`/api/v1/play/${channel}/index.m3u8`,'x-forwarded-method':'GET'}}),/expired/);
 assert.equal(queries,0);
});
