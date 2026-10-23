import {BadRequestException,ConflictException,ForbiddenException,HttpException,Injectable,NotFoundException} from '@nestjs/common';
import {PlatformService,USER_INCLUDE} from './platform.service.js';
import {allowed} from './policy.js';

export function activeRestriction(value:any,now=Date.now()){return value&&(!value.expiresAt||new Date(value.expiresAt).getTime()>now)?{kind:value.kind,reason:value.reason,expiresAt:value.expiresAt}:null;}
export function normalizedWords(words:string[]){return [...new Set(words.map(word=>word.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'').toLowerCase().trim().replace(/\s+/g,' ')).filter(Boolean))];}
export function hasBlockedWord(text:string,words:string[]){
 const normalized=normalizedWords([text])[0]||'';
 return normalizedWords(words).some(word=>new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{M}\\p{N}_])`,'u').test(normalized));
}
@Injectable()
export class ChatService {
 constructor(private readonly platform:PlatformService){}
 private listeners=new Map<string,Set<(event:any)=>void>>();
 async access(identity:any,channelId:string,tx:any=this.platform.db){
  const user=await this.platform.actor(identity,tx);this.platform.require(user,'streams.view');
  const channel=await tx.channel.findUnique({where:{id:channelId},include:{chatRoom:true,chatRules:true,moderators:{where:{userId:user.id},select:{userId:true}},owner:{select:{status:true}}}});
  if(!channel?.chatRoom||channel.accessState!=='ready'||channel.owner.status!=='active')throw new NotFoundException();
  const settings=await this.platform.settings(tx);if(settings.maintenanceEnabled)throw new ForbiddenException('The platform is in maintenance mode.');
  const overrides=channel.settings as any,restriction=activeRestriction(await tx.chatRestriction.findUnique({where:{channelId_userId:{channelId,userId:user.id}}}));
  const canModerate=allowed(user,'chat.moderate_any')||channel.ownerId===user.id&&allowed(user,'channel.manage_own')||channel.moderators.length>0;
  const enabled=settings.chatEnabled&&overrides.chatEnabled!==false;
  return {user,channel,roomId:channel.chatRoom.id,epoch:channel.chatRoom.epoch,enabled,slowModeSeconds:Math.max(0,overrides.slowModeSeconds??settings.defaultSlowModeSeconds),canModerate,canManageModerators:allowed(user,'chat.moderate_any')||channel.ownerId===user.id&&allowed(user,'channel_moderators.manage_own'),restriction,canSend:enabled&&allowed(user,'chat.send')&&!restriction,canReport:allowed(user,'reports.create')};
 }
 private policy(value:any){return {epoch:value.epoch,enabled:value.enabled,slowModeSeconds:value.slowModeSeconds,canModerate:value.canModerate,canManageModerators:value.canManageModerators,canSend:value.canSend,canReport:value.canReport,restriction:value.restriction};}
 present(message:any){return {id:message.id,epoch:message.epoch,authorId:message.authorId,displayName:message.displayName,text:message.deleted?'':message.text,deleted:message.deleted,createdAt:message.createdAt};}
 emit(channelId:string,event:any){for(const send of this.listeners.get(channelId)||[])send(event);}
 subscribe(channelId:string,send:(event:any)=>void){const listeners=this.listeners.get(channelId)||new Set();listeners.add(send);this.listeners.set(channelId,listeners);return()=>{listeners.delete(send);if(!listeners.size)this.listeners.delete(channelId);};}
 async history(identity:any,channelId:string){const policy=await this.access(identity,channelId);const messages=await this.platform.db.chatMessage.findMany({where:{roomId:policy.roomId,epoch:policy.epoch},orderBy:{id:'desc'},take:100});return {messages:messages.reverse().map(message=>this.present(message)),...this.policy(policy)};}
 async send(identity:any,channelId:string,input:{text:string;clientMessageId:string;epoch?:number}){
  const policy=await this.access(identity,channelId);this.platform.require(policy.user,'chat.send');
  const text=input.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();if(!text)throw new BadRequestException('Write a message first.');
  const message=await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`chat-room:${policy.roomId}`}))`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`chat-rules:${channelId}`}))`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${policy.roomId}:${policy.user.id}`}))`;
   const current=await this.access(identity,channelId,tx);
   if(input.epoch!==undefined&&input.epoch!==current.epoch)throw new ConflictException('This stream chat ended. Send your message again in the new chat.');
   if(!current.enabled)throw new ForbiddenException('Chat is disabled for this channel.');
   if(current.restriction)throw new ForbiddenException(current.restriction.kind==='ban'?'You are banned from sending messages in this channel.':`You are timed out until ${new Date(current.restriction.expiresAt).toISOString()}.`);
   const existing=await tx.chatMessage.findUnique({where:{authorId_clientMessageId:{authorId:policy.user.id,clientMessageId:input.clientMessageId}}});if(existing){if(existing.roomId!==policy.roomId)throw new ForbiddenException();if(existing.epoch!==current.epoch)throw new ConflictException('This message belongs to an ended chat.');return existing;}
   if(hasBlockedWord(text,current.channel.chatRules?.blockedWords||[]))throw new ForbiddenException('Your message contains a word or phrase blocked by this channel.');
   const last=await tx.chatMessage.findFirst({where:{roomId:policy.roomId,authorId:policy.user.id},orderBy:{createdAt:'desc'}});
   if(last&&Date.now()-last.createdAt.getTime()<Math.max(1,current.slowModeSeconds)*1000)throw new HttpException('Wait a moment before sending another message.',429);
   return tx.chatMessage.create({data:{roomId:policy.roomId,epoch:current.epoch,authorId:policy.user.id,displayName:policy.user.displayName,text,clientMessageId:input.clientMessageId}});
  });const presented=this.present(message);this.emit(channelId,{type:'message',message:presented});return presented;
 }
 async remove(identity:any,channelId:string,id:number){
  const policy=await this.access(identity,channelId);if(!policy.canModerate)throw new ForbiddenException();
  await this.platform.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`chat-room:${policy.roomId}`}))`;const room=await tx.chatRoom.findUniqueOrThrow({where:{id:policy.roomId}});const changed=await tx.chatMessage.updateMany({where:{id,roomId:policy.roomId,epoch:room.epoch},data:{deleted:true,text:''}});if(!changed.count)throw new NotFoundException();await this.platform.audit(tx,policy.user.id,'chat.message_deleted',String(id),{channelId});});
  this.emit(channelId,{type:'deleted',id});return {deleted:true};
 }
 async moderation(identity:any,channelId:string){
  const policy=await this.access(identity,channelId);if(!policy.canModerate)throw new ForbiddenException();
  const [restrictions,moderators,reports]=await Promise.all([
   this.platform.db.chatRestriction.findMany({where:{channelId,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},include:{user:{select:{id:true,username:true,displayName:true}}},orderBy:{createdAt:'desc'},take:100}),
   this.platform.db.channelModerator.findMany({where:{channelId},include:{user:{select:{id:true,username:true,displayName:true}}},orderBy:{createdAt:'asc'},take:50}),
   this.platform.db.chatReport.findMany({where:{channelId,status:'open'},orderBy:{createdAt:'desc'},take:100,include:{reporter:{select:{username:true}}}})
  ]);
  return {rules:{version:policy.channel.chatRules?.version||0,blockedWords:policy.channel.chatRules?.blockedWords||[]},restrictions,moderators,reports,canManageModerators:policy.canManageModerators};
 }
 async saveRules(identity:any,channelId:string,input:{version:number;blockedWords:string[]}){
  const policy=await this.access(identity,channelId);if(!policy.canModerate)throw new ForbiddenException();
  const blockedWords=normalizedWords(input.blockedWords);
  const result=await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-rules:${channelId}`}))`;
   const current=await tx.chatRules.findUnique({where:{channelId}});if((current?.version||0)!==input.version)throw new ConflictException('Chat rules changed. Reload before saving.');
   const value=await tx.chatRules.upsert({where:{channelId},create:{channelId,blockedWords},update:{blockedWords,version:{increment:1}}});
   await this.platform.audit(tx,policy.user.id,'chat.rules_updated',channelId,{blockedWordCount:blockedWords.length});return value;
  });this.emit(channelId,{type:'refresh'});return result;
 }
 async restrict(identity:any,channelId:string,userId:string,input:{kind:'ban'|'timeout';seconds?:number;reason:string}){
  const policy=await this.access(identity,channelId);if(!policy.canModerate)throw new ForbiddenException();
  const value=await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${policy.roomId}:${userId}`}))`;
   const target=await tx.user.findUnique({where:{id:userId},include:USER_INCLUDE});if(!target)throw new NotFoundException('Account not found.');
   const moderator=await tx.channelModerator.findUnique({where:{channelId_userId:{channelId,userId}}});
   if(userId===policy.user.id||userId===policy.channel.ownerId||allowed(target,'chat.moderate_any')||moderator)throw new ForbiddenException('The channel owner and moderators cannot be restricted. Remove moderator access first.');
   const expiresAt=input.kind==='timeout'?new Date(Date.now()+(input.seconds||300)*1000):null;
   const fields={kind:input.kind,reason:input.reason,expiresAt,actorId:policy.user.id,createdAt:new Date()};
   const result=await tx.chatRestriction.upsert({where:{channelId_userId:{channelId,userId}},create:{channelId,userId,...fields},update:fields});
   await this.platform.audit(tx,policy.user.id,`chat.${input.kind}`,userId,{channelId,reason:input.reason,expiresAt:expiresAt?.toISOString()||null});return result;
  });this.emit(channelId,{type:'refresh'});return value;
 }
 async lift(identity:any,channelId:string,userId:string){
  const policy=await this.access(identity,channelId);if(!policy.canModerate)throw new ForbiddenException();
  await this.platform.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${policy.roomId}:${userId}`}))`;await tx.chatRestriction.deleteMany({where:{channelId,userId}});await this.platform.audit(tx,policy.user.id,'chat.restriction_lifted',userId,{channelId});});
  this.emit(channelId,{type:'refresh'});return {lifted:true};
 }
 async moderator(identity:any,channelId:string,target:string,add:boolean){
  const policy=await this.access(identity,channelId);if(!policy.canManageModerators)throw new ForbiddenException();
  await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-moderators:${channelId}`}))`;
   const user=await tx.user.findUnique({where:add?{username:target}:{id:target},include:USER_INCLUDE});if(!user)throw new NotFoundException('Account not found.');
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat:${policy.roomId}:${user.id}`}))`;
   if(add){
    if(user.id===policy.channel.ownerId||allowed(user,'chat.moderate_any'))throw new BadRequestException('This account already has moderation access.');
    if(!allowed(user,'streams.view'))throw new BadRequestException('Choose an active account with viewing access.');
    if(activeRestriction(await tx.chatRestriction.findUnique({where:{channelId_userId:{channelId,userId:user.id}}})))throw new BadRequestException('Lift this account’s restriction before assigning moderator access.');
    if(await tx.channelModerator.count({where:{channelId}})>=50)throw new BadRequestException('This channel already has 50 moderators.');
    await tx.channelModerator.upsert({where:{channelId_userId:{channelId,userId:user.id}},create:{channelId,userId:user.id},update:{}});
   }else await tx.channelModerator.deleteMany({where:{channelId,userId:user.id}});
   await this.platform.audit(tx,policy.user.id,add?'chat.moderator_added':'chat.moderator_removed',user.id,{channelId});
  });this.emit(channelId,{type:'refresh'});return {saved:true};
 }
 async report(identity:any,channelId:string,messageId:number,input:{reason:string;details:string}){
  const policy=await this.access(identity,channelId);this.platform.require(policy.user,'reports.create');
  return this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-report:${policy.user.id}`}))`;
   const existing=await tx.chatReport.findUnique({where:{reporterId_messageId:{reporterId:policy.user.id,messageId}}});if(existing){if(existing.channelId!==channelId)throw new NotFoundException();return {id:existing.id,status:existing.status};}
   const message=await tx.chatMessage.findFirst({where:{id:messageId,roomId:policy.roomId,deleted:false}});if(!message)throw new NotFoundException('Message is no longer available.');
   if(message.authorId===policy.user.id)throw new BadRequestException('You cannot report your own message.');
   if(await tx.chatReport.count({where:{reporterId:policy.user.id,createdAt:{gt:new Date(Date.now()-600000)}}})>=10)throw new HttpException('Report limit reached. Try again later.',429);
   const report=await tx.chatReport.create({data:{channelId,reporterId:policy.user.id,messageId,...input,snapshot:{displayName:message.displayName,text:message.text}}});
   await this.platform.audit(tx,policy.user.id,'chat.report_created',report.id,{channelId,messageId});return {id:report.id,status:report.status};
  });
 }
 async reports(identity:any){const user=await this.platform.actor(identity);this.platform.require(user,'reports.review');return this.platform.db.chatReport.findMany({where:{status:'open'},orderBy:{createdAt:'desc'},take:100,include:{reporter:{select:{username:true}},channel:{select:{id:true,slug:true}}}});}
 async review(identity:any,channelId:string,id:string,input:{status:'resolved'|'dismissed';resolution:string}){
  const user=await this.platform.actor(identity);
  if(!allowed(user,'reports.review')&&!(await this.access(identity,channelId)).canModerate)throw new ForbiddenException();
  return this.platform.db.$transaction(async tx=>{
   const changed=await tx.chatReport.updateMany({where:{id,channelId,status:'open'},data:{...input,reviewerId:user.id,reviewedAt:new Date()}});
   if(!changed.count)throw new ConflictException('This report was already reviewed or is unavailable.');
   await this.platform.audit(tx,user.id,'chat.report_reviewed',id,{channelId,...input});return {reviewed:true};
  });
 }
 async stream(identity:any,channelId:string,res:any){
  await this.access(identity,channelId);
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  const send=(event:any)=>{if(!res.destroyed&&!res.writableEnded){if(!res.write(`data: ${JSON.stringify(event)}\n\n`))res.end();}};
  const unsubscribe=this.subscribe(channelId,send);let busy=false;
  const timer=setInterval(async()=>{if(busy)return;busy=true;try{if(identity.exp*1000<Date.now())throw new Error();send({type:'policy',...this.policy(await this.access(identity,channelId))});}catch{res.end();}finally{busy=false;}},5000);
  const close=()=>{clearInterval(timer);unsubscribe();};res.once('close',close);
  try{send({type:'history',...await this.history(identity,channelId)});}catch{close();res.end();}
 }
}
