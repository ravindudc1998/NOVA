import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readThumbnail} from '../apps/api/src/thumbnails';
import {MediaService} from '../apps/api/src/media.service';
import {LiveThumbnail,ThumbnailFrame} from '../apps/web/src/live-thumbnail';
const id='11111111-1111-4111-8111-111111111111';
test('Preview storage accepts bounded fresh JPEGs only and cannot select another path',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nova-thumbnail-')),path=join(root,id+'.jpg'),jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x01,0xff,0xd9]);
 try{
  await writeFile(path,jpeg);assert.deepEqual(await readThumbnail(id,root),jpeg);assert.equal(await readThumbnail('../outside',root),null);assert.equal(await readThumbnail('22222222-2222-4222-8222-222222222222',root),null);
  const old=new Date(Date.now()-46000);await utimes(path,old,old);assert.equal(await readThumbnail(id,root),null);
  const future=new Date(Date.now()+10000);await utimes(path,future,future);assert.equal(await readThumbnail(id,root),null);
  await writeFile(path,'not-an-image');assert.equal(await readThumbnail(id,root),null);
  await writeFile(path,Buffer.alloc(524289));assert.equal(await readThumbnail(id,root),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Thumbnail requests apply current guest, account and channel viewing policy before reading media',async()=>{
 process.env.MEDIA_SERVICE_SECRET||='unit-test-secret-that-is-at-least-32-characters';let queriedSession=false;
 const settings:any={guestViewingEnabled:false,maintenanceEnabled:false},channel:any={id,state:'live',accessState:'ready',owner:{status:'active'}};
 const platform:any={settings:async()=>settings,actor:async(identity:any)=>{if(identity.sub==='suspended')throw new Error('Account inactive');return {id:'viewer'};},require(_user:any,permission:string){assert.equal(permission,'streams.view');throw new Error('No viewing permission');},db:{channel:{findUnique:async()=>channel},streamSession:{findFirst:async()=>{queriedSession=true;return null;}}}};
 const service=new MediaService(platform);await assert.rejects(service.thumbnail(id),/Sign in/);await assert.rejects(service.thumbnail(id,{sub:'suspended'}),/inactive/);await assert.rejects(service.thumbnail(id,{sub:'viewer'}),/permission/);assert.equal(queriedSession,false);
 settings.guestViewingEnabled=true;channel.accessState='disabled';await assert.rejects(service.thumbnail(id),/Channel unavailable/);channel.accessState='ready';channel.state='offline';await assert.rejects(service.thumbnail(id),/preview unavailable/);assert.equal(queriedSession,false);
 channel.state='live';settings.maintenanceEnabled=true;await assert.rejects(service.thumbnail(id),/maintenance/);
});
test('Thumbnail session selection uses the current live session, with no caller-supplied asset selector',async()=>{
 process.env.MEDIA_SERVICE_SECRET||='unit-test-secret-that-is-at-least-32-characters';
 const platform:any={settings:async()=>({guestViewingEnabled:true}),db:{channel:{findUnique:async()=>({id,state:'live',accessState:'ready',owner:{status:'active'}})},streamSession:{findFirst:async(query:any)=>{assert.deepEqual(query.where,{channelId:id,endedAt:null,status:'live'});return null;}}}};
 await assert.rejects(new MediaService(platform).thumbnail(id),/preview unavailable/);
});
test('Preview frames use an image while keeping the initial as fallback; offline cards never render old previews',()=>{
 const fallback=renderToStaticMarkup(React.createElement(ThumbnailFrame,{initial:'N'}));assert.match(fallback,/>N<\/strong>/);assert.equal(fallback.includes('<img'),false);
 const image=renderToStaticMarkup(React.createElement(ThumbnailFrame,{initial:'N',preview:'blob:local-preview'}));assert.match(image,/class="live-thumbnail"/);assert.match(image,/alt=""/);assert.equal(image.includes('<video'),false);
 const offline=renderToStaticMarkup(React.createElement(LiveThumbnail,{id,live:false,initial:'N'}));assert.equal(offline.includes('<img'),false);assert.match(offline,/thumbnail-surface/);
});
