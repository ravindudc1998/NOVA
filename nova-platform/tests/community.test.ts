import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import {activeRestriction,hasBlockedWord,normalizedWords,ChatService} from '../apps/api/src/chat.service';
import {BRANDING_SIZES,brandingLinks,normalizeBranding} from '../apps/api/src/branding';
import {BrandingService} from '../apps/api/src/branding.service';
import {allowed} from '../apps/api/src/policy';
import {ChannelAvatar,ChannelBanner} from '../apps/web/src/branding';
import {ModalDialog} from '../apps/web/src/dialog';

test('Chat filters normalize case, compatibility characters and invisible separators without blocking parts of unrelated words',()=>{
 assert.equal(hasBlockedWord('THAT BAD word',['bad']),true);
 assert.equal(hasBlockedWord('a ＢＡＤ word',['bad']),true);
 assert.equal(hasBlockedWord('b\u200ba\u200bd',['bad']),true);
 assert.equal(hasBlockedWord('a bad\n phrase here',['bad phrase']),true);
 assert.equal(hasBlockedWord('a badge and badminton',['bad']),false);
 assert.equal(hasBlockedWord('literal a.b here',['a.b']),true);
 assert.equal(hasBlockedWord('literal axb here',['a.b']),false);
 assert.equal(hasBlockedWord('Café',['cafe\u0301']),true);
 assert.deepEqual(normalizedWords([' BAD ','bad','two  words']),['bad','two words']);
});
test('Permanent bans remain active; expired and exact-boundary timeouts release automatically',()=>{
 const now=Date.now();assert.equal(activeRestriction({kind:'ban',expiresAt:null},now)?.kind,'ban');
 assert.equal(activeRestriction({kind:'timeout',expiresAt:new Date(now+1)},now)?.kind,'timeout');
 assert.equal(activeRestriction({kind:'timeout',expiresAt:new Date(now)},now),null);
 assert.equal(activeRestriction({kind:'timeout',expiresAt:new Date(now-1)},now),null);
});
test('Branding rejects SVG, disguised text, malformed images and oversized input before storing any asset',async()=>{
 for(const input of [Buffer.from('<svg/>'),Buffer.from('<html>image.jpg</html>'),Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(5*1024*1024+1)])await assert.rejects(normalizeBranding(input,'avatar'));
});
test('Branding fully decodes and re-encodes each size to still WebP without uploaded EXIF or ICC metadata',async()=>{
 const input=await sharp({create:{width:80,height:60,channels:3,background:'#aabbcc'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 for(const kind of ['avatar','banner','offline'] as const){const bytes=await normalizeBranding(input,kind),metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,BRANDING_SIZES[kind].width);assert.equal(metadata.height,BRANDING_SIZES[kind].height);assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.equal(metadata.pages,undefined);assert.ok(bytes.length<=1048576);}
});
test('Animated WebP uploads are refused instead of storing animation',async()=>{
 const frames=await Promise.all(['red','blue'].map(background=>sharp({create:{width:2,height:2,channels:3,background}}).png().toBuffer()));
 const animated=await sharp(frames,{join:{animated:true}}).webp({loop:0,delay:[100,100]}).toBuffer();
 assert.ok((await sharp(animated).metadata()).pages!>1);await assert.rejects(normalizeBranding(animated,'offline'));
});
test('Branding metadata contains only supported local asset links and never binary payloads',()=>{
 const links=brandingLinks('channel',[{kind:'avatar',revision:'abc'},{kind:'unknown',revision:'ignored'}]);assert.deepEqual(links,{avatar:'/api/v1/channels/channel/branding/avatar?v=abc'});
});
const user=(codes:string[],channelId='own')=>({id:'actor',status:'active',channel:{id:channelId},memberships:[{group:{permissions:codes.map(permissionCode=>({permissionCode}))}}]});
test('Branding writes require ownership plus channel permission or explicit global channel management',async()=>{
 const service=new BrandingService({db:{channel:{findUnique:async()=>({id:'target'})}}} as any);
 await assert.rejects(service.manage(user(['channel.manage_own']),'another'));
 await assert.rejects(service.manage(user(['streams.view']),'own'));
 assert.equal((await service.manage(user(['channel.manage_own']),'own')).id,'target');
 assert.equal((await service.manage(user(['channels.manage_any']),'another')).id,'target');
});
function chatPlatform(restriction:any=null){
 const actor=user(['streams.view','chat.send']),channel={id:'channel',accessState:'ready',ownerId:'someone',owner:{status:'active'},chatRoom:{id:'room'},chatRules:null,settings:{},moderators:[]};
 const db:any={channel:{findUnique:async()=>channel},chatRestriction:{findUnique:async()=>restriction}};
 return {actor:async()=>actor,require:(u:any,p:string)=>{if(!allowed(u,p))throw new Error('Forbidden');},settings:async()=>({chatEnabled:true,defaultSlowModeSeconds:0,maintenanceEnabled:false}),db,channel};
}
test('Channel restrictions disable sending while preserving readable history; local moderation stays scoped to its channel',async()=>{
 const platform=chatPlatform({kind:'ban',expiresAt:null}),chat=new ChatService(platform as any);
 let policy=await chat.access({sub:'actor'},'channel');assert.equal(policy.canSend,false);assert.equal(policy.canModerate,false);
 platform.channel.moderators.push({userId:'actor'} as never);policy=await chat.access({sub:'actor'},'channel');assert.equal(policy.canModerate,true);assert.equal(policy.canManageModerators,false);
 platform.channel.moderators=[];assert.equal((await chat.access({sub:'actor'},'channel')).canModerate,false);
});
test('A ban committed between initial access and the send transaction prevents creating a message',async()=>{
 const platform=chatPlatform(),chat=new ChatService(platform as any);let created=0;
 const tx={...platform.db,$executeRaw:async()=>{},chatRestriction:{findUnique:async()=>({kind:'ban',expiresAt:null})},chatMessage:{create:async()=>{created++;}}};
 platform.db.$transaction=async(callback:any)=>callback(tx);
 await assert.rejects(chat.send({sub:'actor'},'channel',{text:'hello',clientMessageId:'id'}),/banned/);assert.equal(created,0);
});
test('Branding renderers use local images with an initial fallback, and dialogs expose their label and local errors',()=>{
 const avatar=renderToStaticMarkup(React.createElement(ChannelAvatar,{name:'Creator',url:'/api/v1/channels/id/branding/avatar?v=a'}));assert.match(avatar,/<img/);assert.match(avatar,/alt=""/);
 assert.match(renderToStaticMarkup(React.createElement(ChannelAvatar,{name:'Creator'})),/>C<\/span>/);
 assert.equal(renderToStaticMarkup(React.createElement(ChannelBanner,{})),'');
 const dialog=renderToStaticMarkup(React.createElement(ModalDialog,{title:'Channel tools',description:'Manage channel',onClose:()=>{},error:'Upload failed'},React.createElement('div',null,'Tools')));assert.match(dialog,/<dialog/);assert.match(dialog,/aria-labelledby=/);assert.match(dialog,/role="alert"/);
});
