import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {assertSession,identitySession} from '../apps/api/src/account-security';
import {observationWindow,AnalyticsService} from '../apps/api/src/analytics.service';
import {SocialService} from '../apps/api/src/social.service';
import {PlatformService} from '../apps/api/src/platform.service';
import {AccountService} from '../apps/api/src/account.service';
import {FollowButton,FollowingList,NotificationBell} from '../apps/web/src/social';
import {AccountPage} from '../apps/web/src/accounts';
import {readRoute} from '../apps/web/src/routes';
import {allowed,validSlug} from '../apps/api/src/policy';
test('Global logout rejects already issued tokens and accepts only explicitly preserved or subsequently authenticated sessions',async()=>{
 const db={revokedSession:{findFirst:async()=>null}},user={id:'u',authNotBefore:100,authAllowedSessionId:'kept'};
 for(const identity of [{iat:99,sid:'old'},{iat:100,sid:'old'},{sid:'old'},{}])await assert.rejects(assertSession(db,user,identity),/session ended/);
 await assertSession(db,user,{iat:99,sid:'kept'});await assertSession(db,user,{iat:101,sid:'new'});await assert.rejects(assertSession(db,user,{iat:200,auth_time:99,sid:'refreshed-old-session'}));
 await assert.rejects(assertSession(db,{...user,authAllowedSessionId:null},{iat:99,sid:'kept'}));
});
test('Individual session revocation rejects its tokens even when issued after the global cutoff',async()=>{
 const db={revokedSession:{findFirst:async(query:any)=>query.where.sessionId==='revoked'?{sessionId:'revoked'}:null}},user={id:'u',authNotBefore:10};
 await assert.rejects(assertSession(db,user,{iat:100,sid:'revoked'}));await assertSession(db,user,{iat:100,sid:'other'});
 assert.equal(identitySession({session_state:'legacy'}),'legacy');assert.equal(identitySession({sid:'current',session_state:'legacy'}),'current');
});
test('Legacy accounts/tickets remain valid until a security revocation occurs',async()=>{
 await assertSession({}, {id:'u',authNotBefore:0},{sub:'identity'});
 await assert.rejects(assertSession({}, {id:'u',authNotBefore:1},{sub:'identity'}));
});
test('Delegated account managers cannot reset or revoke a full administrator, including a suspended administrator',async()=>{
 const grants=(permissionCode:string)=>[{group:{permissions:[{permissionCode}]}}],actor={id:'manager',status:'active',memberships:grants('users.manage')};
 const target={id:'admin',status:'active',identitySubject:'admin-identity',memberships:grants('platform.admin')};let identityCalls=0;
 const platform={actor:async()=>actor,require:(user:any,permission:string)=>{if(!allowed(user,permission))throw new Error('Permission denied');},db:{user:{findUnique:async()=>target}}};
 const service=new AccountService(platform as any,{sessions:async()=>{identityCalls++;return [];}} as any);
 for(const status of ['active','suspended']){target.status=status;await assert.rejects(service.sessions({},target.id),/Permission denied/);await assert.rejects(service.revoke({},{},target.id),/Permission denied/);await assert.rejects(service.resetPassword({},target.id),/Permission denied/);}
 assert.equal(identityCalls,0);actor.memberships=grants('platform.admin');assert.deepEqual(await service.sessions({},target.id),[]);assert.equal(identityCalls,1);
});
test('Private account presentations include editable profile fields without exposing revocation internals',()=>{
 const platform=new PlatformService({} as any),value=platform.present({id:'u',username:'viewer',displayName:'Viewer',bio:'About',profileVersion:3,status:'active',memberships:[],channel:null,authNotBefore:500,authAllowedSessionId:'secret-session'});
 assert.equal(value.bio,'About');assert.equal(value.profileVersion,3);assert.equal('authNotBefore'in value,false);assert.equal(JSON.stringify(value).includes('secret-session'),false);
});
test('Observation windows do not invent pre-installation time or record negative/unbounded outage coverage',()=>{
 const now=new Date('2026-10-21T12:00:00Z');assert.equal(observationWindow(null,now),0);assert.equal(observationWindow(new Date(now.getTime()-15000),now),15);assert.equal(observationWindow(new Date(now.getTime()-3600000),now),30);assert.equal(observationWindow(new Date(now.getTime()+1000),now),0);
});
test('Audience sampling initializes once, weights observed viewer time and refuses duplicate timestamps',async()=>{
 const session:any={id:'s',status:'live',endedAt:null,lastAnalyticsAt:null,analyticsStartedAt:null},samples:any[]=[];
 const tx={$executeRaw:async()=>{},streamSession:{findUnique:async()=>session,update:async({data}:any)=>Object.assign(session,data)},audienceSample:{upsert:async(value:any)=>samples.push(value)}};
 const analytics=new AnalyticsService({db:{$transaction:async(fn:any)=>fn(tx)}} as any,{} as any),start=new Date('2026-10-21T12:00:00Z');
 await analytics.record('s',2,start);assert.equal(samples.length,0);
 await analytics.record('s',2,new Date(start.getTime()+15000));assert.equal(samples[0].create.viewerSeconds,30);assert.equal(samples[0].create.observedSeconds,15);
 await analytics.record('s',20,new Date(start.getTime()+15000));assert.equal(samples.length,1);
 session.endedAt=new Date();await analytics.record('s',20,new Date(start.getTime()+30000));assert.equal(samples.length,1);
});
function fakeSocial(owner='someone',grants=['follows.manage_own']){
 const actor={id:'viewer',status:'active',memberships:[{group:{permissions:grants.map(permissionCode=>({permissionCode}))}}]},activity:any[]=[];let follow:any=null;
 const tx:any={$executeRaw:async()=>{},channel:{findFirst:async()=>({id:'channel',ownerId:owner})},follow:{findUnique:async()=>follow,count:async()=>follow?1:0,upsert:async({create,update}:any)=>{follow=follow?{...follow,...update}:create;},deleteMany:async()=>{follow=null;}},followActivity:{create:async({data}:any)=>activity.push(data)}};
 const platform={actor:async()=>actor,require:(user:any,permission:string)=>{if(!allowed(user,permission))throw new Error('Permission denied');},db:{$transaction:async(fn:any)=>fn(tx)},audit:async()=>{}};
 return {service:new SocialService(platform as any,{} as any),activity,getFollow:()=>follow};
}
test('Repeated follow/unfollow requests are idempotent and alert changes do not fabricate follower growth',async()=>{
 const fixture=fakeSocial();await fixture.service.follow({},'channel',true);await fixture.service.follow({},'channel',true);assert.equal(fixture.activity.length,1);assert.equal(fixture.getFollow().notifyLive,true);
 await fixture.service.follow({},'channel',true,false);assert.equal(fixture.activity.length,1);assert.equal(fixture.getFollow().notifyLive,false);
 await fixture.service.follow({},'channel',false);await fixture.service.follow({},'channel',false);assert.deepEqual(fixture.activity.map(item=>item.kind),['follow','unfollow']);
});
test('Following requires the current permission and cannot target the actor’s own channel',async()=>{
 await assert.rejects(fakeSocial('viewer').service.follow({},'channel',true),/own channel/);await assert.rejects(fakeSocial('someone',[]).service.follow({},'channel',true),/Permission denied/);
});
test('Disabling live notifications drains a pending event without creating alerts to replay later',async()=>{
 let completed=false;const tx:any={$executeRaw:async()=>{},liveNotificationEvent:{findUnique:async()=>({processedAt:null,session:{status:'live',endedAt:null},channel:{state:'live',accessState:'ready',owner:{status:'active'}}}),update:async({data}:any)=>{completed=Boolean(data.processedAt);}},notification:{createMany:async()=>{throw new Error('No alert should be created');}}};
 const service=new SocialService({db:{$transaction:async(fn:any)=>fn(tx)},settings:async()=>({liveNotificationsEnabled:false})} as any,{} as any);
 assert.deepEqual(await service.dispatchEvent('session'),[]);assert.equal(completed,true);
});
test('Account and analytics routes survive legacy bookmarks and cannot be registered as channel usernames',()=>{
 for(const route of ['account','analytics']){assert.equal(readRoute('/'+route),route);assert.equal(readRoute('/','#/'+route),route);assert.equal(validSlug(route),false);}
});
test('Follow controls distinguish followed/muted state and expose both live and offline following entries',()=>{
 const channel={id:'channel',title:'Live',slug:'creator',state:'offline',owner:{displayName:'Creator'}},user={id:'viewer'},social:any={canFollow:true,follows:[{...channel,notifyLive:false}],busy:new Set()};
 const button=renderToStaticMarkup(React.createElement(FollowButton,{channel,user,social,signin:()=>{},run:()=>{}}));assert.match(button,/Following/);assert.match(button,/Turn live alerts on/);
 assert.equal(renderToStaticMarkup(React.createElement(FollowButton,{channel,user:{channel:{id:'channel'}},social})), '');
 const list=renderToStaticMarkup(React.createElement(FollowingList,{social}));assert.match(list,/FOLLOWING/);assert.match(list,/Offline/);
 const bell=renderToStaticMarkup(React.createElement(NotificationBell,{social:{notifications:{unread:2,items:[]}},api:async()=>{}}));assert.match(bell,/Notifications, 2 unread/);
});
test('Account pages expose the local password action and profile/session controls without password inputs in the profile form',()=>{
 const user={id:'u',username:'viewer',displayName:'Viewer',bio:'',profileVersion:1,channel:null,permissions:['profile.edit_own'],groups:[]};
 const html=renderToStaticMarkup(React.createElement(AccountPage,{user,api:async()=>{},identity:{},refreshUser:()=>{},config:{creatorSignupEnabled:true},signin:()=>{}}));
 for(const label of ['Display name','Change password','Active sessions','Become a creator'])assert.ok(html.includes(label));assert.equal(html.includes('type="password"'),false);
});
