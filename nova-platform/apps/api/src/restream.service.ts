import {BadRequestException,ConflictException,Injectable,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {PlatformService,USER_INCLUDE} from './platform.service.js';
import {allowed,mayPublish} from './policy.js';
import {decryptSecret,encryptSecret,safeEqual} from './secrets.js';
import {destinationKey,destinationUrl,restreamState} from './restream-policy.js';

@Injectable()
export class RestreamService {
 constructor(readonly platform:PlatformService){}
 internalAuth(value:string){const secret=process.env.RESTREAM_SERVICE_SECRET;if(!secret||!safeEqual(value||'',`Bearer ${secret}`))throw new UnauthorizedException();}
 async channel(user:any,id?:string){
  const target=id||user.channel?.id;if(!target)throw new NotFoundException('A creator channel is required.');
  this.platform.require(user,id?'restreams.manage_any':'restreams.manage_own');
  const channel=await this.platform.db.channel.findUnique({where:{id:target},include:{owner:{include:USER_INCLUDE},sessions:{where:{endedAt:null,status:'live'},take:1,orderBy:{createdAt:'desc'}}}});
  if(!channel)throw new NotFoundException();return channel;
 }
 eligible(channel:any,settings:any){return Boolean(settings.restreamingEnabled&&mayPublish(channel.owner,channel,settings)&&allowed(channel.owner,'restreams.manage_own')&&channel.state==='live'&&channel.sessions?.[0]?.lastOutputAt&&Date.now()-channel.sessions[0].lastOutputAt.getTime()<15000);}
 async list(user:any,id?:string){
  const channel=await this.channel(user,id),settings=await this.platform.settings(),rows=await this.platform.db.restreamDestination.findMany({where:{channelId:channel.id},orderBy:{createdAt:'asc'}}),session=channel.sessions[0];
  return {channel:{id:channel.id,slug:channel.slug,state:channel.state},policy:{enabled:settings.restreamingEnabled,maxDestinations:settings.restreamMaxDestinations,maxActive:settings.restreamMaxActive},destinations:rows.map(row=>({
   id:row.id,provider:row.provider,name:row.name,serverUrl:row.serverUrl,keyConfigured:true,enabled:row.enabled,maxHeight:row.maxHeight,version:row.version,
   status:restreamState({...row,...(row.sessionId!==session?.id?{lastHeartbeatAt:null}:{})},{enabled:settings.restreamingEnabled,live:this.eligible(channel,settings)}),
   errorCode:row.errorCode,bitrateKbps:row.bitrateKbps,bytesSent:Number(row.bytesSent),startedAt:row.startedAt,lastHeartbeatAt:row.lastHeartbeatAt,
  }))};
 }
 async save(user:any,destinationId:string|undefined,input:any,channelId?:string){
  const channel=await this.channel(user,channelId);let server:string|undefined,key:string|undefined;
  try{if(input.serverUrl!==undefined)server=destinationUrl(input.serverUrl);if(input.streamKey!==undefined)key=destinationKey(input.streamKey);}catch(error:any){throw new BadRequestException(error.message);}
  await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restream:${channel.id}`}))`;
   const settings=await this.platform.settings(tx);
   if(destinationId){
    const existing=await tx.restreamDestination.findFirst({where:{id:destinationId,channelId:channel.id}});if(!existing)throw new NotFoundException();
    if(input.version!==existing.version)throw new ConflictException('This destination changed. Reload it before saving.');
    if(server!==undefined&&server!==existing.serverUrl&&!key)throw new BadRequestException('Enter a new stream key when changing the server URL.');
    await tx.restreamDestination.update({where:{id:existing.id},data:{...Object.fromEntries(['provider','name','enabled','maxHeight'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]])),...(server?{serverUrl:server}:{}),...(key?{encryptedKey:encryptSecret(key)}:{}),version:{increment:1},status:'waiting',errorCode:null,lastHeartbeatAt:null,startedAt:null,bitrateKbps:0,bytesSent:0}});
   }else{
    if(await tx.restreamDestination.count({where:{channelId:channel.id}})>=settings.restreamMaxDestinations)throw new ConflictException('This channel has reached the destination limit.');
    if(!server||!key)throw new BadRequestException('A server URL and stream key are required.');
    const created=await tx.restreamDestination.create({data:{channelId:channel.id,provider:input.provider,name:input.name,serverUrl:server,encryptedKey:encryptSecret(key),enabled:input.enabled,maxHeight:input.maxHeight}});destinationId=created.id;
   }
   await this.platform.audit(tx,user.id,'restream.destination_saved',destinationId!,{channelId:channel.id,provider:input.provider||null});
  });
  return this.list(user,channelId);
 }
 async remove(user:any,id:string,version:number,channelId?:string){
  const channel=await this.channel(user,channelId);
  await this.platform.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restream:${channel.id}`}))`;const result=await tx.restreamDestination.deleteMany({where:{id,channelId:channel.id,version}});if(!result.count)throw new ConflictException('This destination changed or was removed. Reload before trying again.');await this.platform.audit(tx,user.id,'restream.destination_removed',id,{channelId:channel.id});});
  return this.list(user,channelId);
 }
 async jobs(){
  const settings=await this.platform.settings();if(!settings.restreamingEnabled)return {maxActive:0,jobs:[]};
  const rows=await this.platform.db.restreamDestination.findMany({where:{enabled:true,channel:{state:'live',accessState:'ready',owner:{status:'active'},sessions:{some:{endedAt:null,status:'live',lastOutputAt:{gt:new Date(Date.now()-15000)}}}}},orderBy:{createdAt:'asc'},include:{channel:{include:{owner:{include:USER_INCLUDE},sessions:{where:{endedAt:null,status:'live'},take:1,orderBy:{createdAt:'desc'}}}}}});
  let index=0;const jobs=rows.filter(row=>this.eligible(row.channel,settings)).map(row=>({id:row.id,channelId:row.channelId,sessionId:row.channel.sessions[0].id,version:row.version,maxHeight:row.maxHeight,...(index++<settings.restreamMaxActive?{serverUrl:row.serverUrl,streamKey:decryptSecret(row.encryptedKey)}:{queued:true})}));
  return {maxActive:settings.restreamMaxActive,jobs};
 }
 async report(id:string,input:any){
  const destination=await this.platform.db.restreamDestination.findFirst({where:{id,version:input.version,enabled:true},include:{channel:{include:{owner:{include:USER_INCLUDE},sessions:{where:{id:input.sessionId,endedAt:null,status:'live'},take:1}}}}});
  if(!destination||!this.eligible(destination.channel,await this.platform.settings()))return {accepted:false};
  await this.platform.db.restreamDestination.updateMany({where:{id,version:input.version,enabled:true},data:{status:input.status,errorCode:input.errorCode||null,sessionId:input.sessionId,statusVersion:input.version,lastHeartbeatAt:new Date(),...(input.status==='sending'&&destination.sessionId!==input.sessionId||input.status==='sending'&&!destination.startedAt?{startedAt:new Date()}:{}),bitrateKbps:Math.round(input.bitrateKbps),bytesSent:BigInt(Math.floor(input.bytesSent))}});
  return {accepted:true};
 }
}
