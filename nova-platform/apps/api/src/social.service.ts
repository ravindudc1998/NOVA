import {BadRequestException,ForbiddenException,Injectable,NotFoundException,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {PlatformService} from './platform.service.js';
import {LibraryService} from './library.service.js';
const visible={accessState:'ready',owner:{status:'active'}};
@Injectable()
export class SocialService implements OnModuleInit,OnModuleDestroy {
 constructor(readonly platform:PlatformService,readonly library:LibraryService){}
 private timer?:NodeJS.Timeout;private processing=false;private listeners=new Map<string,Set<()=>void>>();
 async follows(identity:any){
  const user=await this.platform.actor(identity);this.platform.require(user,'follows.manage_own');
  const follows=await this.platform.db.follow.findMany({where:{userId:user.id,channel:visible},orderBy:{createdAt:'desc'},take:500});
  const channels=await this.library.lookup(follows.map(follow=>follow.channelId)),byId=new Map(channels.map(channel=>[channel.id,channel]));
  return follows.flatMap(follow=>{const channel=byId.get(follow.channelId);return channel?[{...channel,notifyLive:follow.notifyLive,followedAt:follow.createdAt}]:[];});
 }
 async follow(identity:any,channelId:string,add:boolean,notifyLive?:boolean){
  const user=await this.platform.actor(identity);this.platform.require(user,'follows.manage_own');
  await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`follow:${user.id}`}))`;
   const existing=await tx.follow.findUnique({where:{userId_channelId:{userId:user.id,channelId}}});
   if(add){
    const channel=await tx.channel.findFirst({where:{id:channelId,...visible}});if(!channel)throw new NotFoundException('Channel unavailable.');
    if(channel.ownerId===user.id)throw new BadRequestException('You cannot follow your own channel.');
    if(!existing&&await tx.follow.count({where:{userId:user.id}})>=500)throw new BadRequestException('You are already following 500 channels.');
    await tx.follow.upsert({where:{userId_channelId:{userId:user.id,channelId}},create:{userId:user.id,channelId,notifyLive:notifyLive??true},update:notifyLive===undefined?{}:{notifyLive}});
   }else await tx.follow.deleteMany({where:{userId:user.id,channelId}});
   if(add&&!existing||!add&&existing)await tx.followActivity.create({data:{channelId,kind:add?'follow':'unfollow'}});
   if(add||existing)await this.platform.audit(tx,user.id,add?'follow.saved':'follow.removed',channelId,{...(notifyLive===undefined?{}:{notifyLive})});
  });return {following:add};
 }
 async alerts(identity:any,channelId:string,notifyLive:boolean){
  const user=await this.platform.actor(identity);this.platform.require(user,'follows.manage_own');
  const result=await this.platform.db.follow.updateMany({where:{userId:user.id,channelId},data:{notifyLive}});if(!result.count)throw new NotFoundException('Follow this channel before changing its alerts.');return {notifyLive};
 }
 async notifications(identity:any,cursor?:string){
  const user=await this.platform.actor(identity);this.platform.require(user,'streams.view');
  let before:any;
  if(cursor){before=await this.platform.db.notification.findFirst({where:{id:cursor,userId:user.id}});if(!before)throw new NotFoundException();}
  const where={userId:user.id,channel:visible},page=before?{OR:[{createdAt:{lt:before.createdAt}},{createdAt:before.createdAt,id:{lt:before.id}}]}:{};
  const [items,unread,settings]=await Promise.all([
   this.platform.db.notification.findMany({where:{...where,...page},orderBy:[{createdAt:'desc'},{id:'desc'}],take:31,include:{channel:{select:{id:true,slug:true,state:true}},session:{select:{endedAt:true,status:true}}}}),
   this.platform.db.notification.count({where:{...where,readAt:null}}),this.platform.settings()
  ]);
  return {enabled:Boolean(settings.liveNotificationsEnabled),unread,nextCursor:items.length>30?items[29].id:null,items:items.slice(0,30).map(({session,...item})=>({...item,live:item.channel.state==='live'&&session.status==='live'&&!session.endedAt}))};
 }
 async read(identity:any,id?:string){
  const user=await this.platform.actor(identity);this.platform.require(user,'streams.view');
  const changed=await this.platform.db.notification.updateMany({where:{userId:user.id,...(id?{id}:{createdAt:{lte:new Date()}})},data:{readAt:new Date()}});if(id&&!changed.count)throw new NotFoundException();this.emit(user.id);return {read:true};
 }
 private emit(userId:string){for(const listener of this.listeners.get(userId)||[])listener();}
 async events(identity:any,res:any){
  const user=await this.platform.actor(identity);this.platform.require(user,'streams.view');
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  let disposed=false,busy=false,last='';
  const refresh=async()=>{if(disposed||busy)return;busy=true;try{if(identity.exp*1000<Date.now())throw new Error();const data=await this.notifications(identity),signature=JSON.stringify(data);if(!disposed&&signature!==last){last=signature;if(!res.write(`data: ${JSON.stringify({type:'notifications',...data})}\n\n`))res.end();}}catch{res.end();}finally{busy=false;}};
  const callback=()=>void refresh(),listeners=this.listeners.get(user.id)||new Set();listeners.add(callback);this.listeners.set(user.id,listeners);
  const timer=setInterval(callback,5000);res.once('close',()=>{disposed=true;clearInterval(timer);listeners.delete(callback);if(!listeners.size)this.listeners.delete(user.id);});await refresh();
 }
 onModuleInit(){this.timer=setInterval(()=>void this.dispatch().catch(()=>console.error('Live notification dispatch unavailable.')),3000);}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async dispatch(){
  if(this.processing)return;this.processing=true;
  try{const pending=await this.platform.db.liveNotificationEvent.findMany({where:{processedAt:null,createdAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:4});for(const event of pending){const users=await this.dispatchEvent(event.sessionId);users.forEach(id=>this.emit(id));}}finally{this.processing=false;}
 }
 async dispatchEvent(sessionId:string){
  return this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`live-event:${sessionId}`}))`;
   const event=await tx.liveNotificationEvent.findUnique({where:{sessionId},include:{session:true,channel:{include:{owner:{select:{status:true,displayName:true}}}}}});if(!event||event.processedAt)return [];
   const settings=await this.platform.settings(tx);
   if(!settings.liveNotificationsEnabled||settings.maintenanceEnabled||event.session.endedAt||event.session.status!=='live'||event.channel.state!=='live'||event.channel.accessState!=='ready'||event.channel.owner.status!=='active'){
    await tx.liveNotificationEvent.update({where:{sessionId},data:{processedAt:new Date()}});return [];
   }
   const follows=await tx.follow.findMany({where:{channelId:event.channelId,notifyLive:true,createdAt:{lte:event.createdAt},...(event.cursor?{userId:{gt:event.cursor}}:{}),user:{status:'active',memberships:{some:{group:{permissions:{some:{permissionCode:{in:['streams.view','platform.admin']}}}}}}}},orderBy:{userId:'asc'},take:250});
   if(follows.length)await tx.notification.createMany({data:follows.map(follow=>({userId:follow.userId,channelId:event.channelId,sessionId,title:event.session.title||event.channel.title,creatorName:event.channel.owner.displayName})),skipDuplicates:true});
   await tx.liveNotificationEvent.update({where:{sessionId},data:{...(follows.length?{cursor:follows.at(-1)!.userId}:{}),...(follows.length<250?{processedAt:new Date()}: {})}});
   return follows.map(follow=>follow.userId);
  });
 }
}
