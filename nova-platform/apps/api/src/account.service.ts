import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import {PlatformService,USER_INCLUDE} from './platform.service.js';
import {IdentityAdminService} from './identity-admin.service.js';
import {identitySession} from './account-security.js';
import {validSlug} from './policy.js';
import {encryptSecret,hashSecret} from './secrets.js';
@Injectable()
export class AccountService implements OnModuleInit,OnModuleDestroy {
 private cleanup?:NodeJS.Timeout;
 onModuleInit(){this.cleanup=setInterval(()=>void this.platform.db.revokedSession.deleteMany({where:{expiresAt:{lt:new Date()}}}).catch(()=>{}),3600000);}
 onModuleDestroy(){if(this.cleanup)clearInterval(this.cleanup);}
 constructor(readonly platform:PlatformService,readonly identity:IdentityAdminService){}
 async profile(identity:any,input:{version:number;displayName:string;bio:string}){
  const user=await this.platform.actor(identity);this.platform.require(user,'profile.edit_own');
  return this.platform.db.$transaction(async tx=>{const result=await tx.user.updateMany({where:{id:user.id,profileVersion:input.version},data:{displayName:input.displayName,bio:input.bio,profileVersion:{increment:1}}});if(!result.count)throw new ConflictException('Your profile changed. Reload before saving.');await this.platform.audit(tx,user.id,'account.profile_updated',user.id);return this.platform.present(await tx.user.findUniqueOrThrow({where:{id:user.id},include:USER_INCLUDE}));});
 }
 async upgrade(identity:any,targetId?:string){
  const actor=await this.platform.actor(identity);this.platform.require(actor,targetId?'users.manage':'profile.edit_own');const id=targetId||actor.id;
  return this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`upgrade:${id}`}))`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-platform-settings'))`;
   const user=await tx.user.findUnique({where:{id},include:USER_INCLUDE});if(!user)throw new NotFoundException();if(user.status!=='active')throw new ForbiddenException('Activate this account before upgrading it.');
   if(user.channel)return this.platform.present(user);
   const settings=await this.platform.settings(tx);if(!targetId&&!settings.creatorSignupEnabled)throw new ForbiddenException('Creator upgrades are currently disabled.');
   if(!validSlug(user.username))throw new BadRequestException('This username cannot be used for a creator channel.');
   const category=await tx.category.findFirst({where:{name:settings.defaultCategory,enabled:true}}),group=await tx.group.findUniqueOrThrow({where:{key:'creators'}}),secret=randomBytes(32).toString('base64url');
   await tx.membership.upsert({where:{userId_groupId:{userId:id,groupId:group.id}},create:{userId:id,groupId:group.id},update:{}});
   await tx.channel.create({data:{ownerId:id,slug:user.username,title:`${user.displayName}'s live stream`,accessState:settings.creatorApprovalRequired?'pending_approval':'ready',categoryId:category?.id,credential:{create:{lookupHash:hashSecret(secret),encryptedSecret:encryptSecret(secret)}},chatRoom:{create:{}}}});
   await this.platform.audit(tx,actor.id,'account.upgraded_to_creator',id);
   return this.platform.present(await tx.user.findUniqueOrThrow({where:{id},include:USER_INCLUDE}));
  },{timeout:15000});
 }
 async list(identity:any,input:{page:number;query:string;status?:string;groupId?:string}){
  const actor=await this.platform.actor(identity);this.platform.require(actor,'users.manage');
  const where={...(input.query?{OR:[{username:{contains:input.query,mode:'insensitive' as const}},{displayName:{contains:input.query,mode:'insensitive' as const}}]}:{}),...(input.status?{status:input.status}:{}),...(input.groupId?{memberships:{some:{groupId:input.groupId}}}:{})};
  const [total,items,groups]=await Promise.all([this.platform.db.user.count({where}),this.platform.db.user.findMany({where,include:USER_INCLUDE,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*25,take:25}),this.platform.db.group.findMany({select:{id:true,name:true,key:true},orderBy:{name:'asc'}})]);return {total,groups,page:input.page,pageSize:25,items:items.map(user=>this.platform.present(user))};
 }
 async create(identity:any,input:{username:string;displayName:string;accountType:'viewer'|'creator'}){
  const actor=await this.platform.actor(identity);this.platform.require(actor,'users.manage');
  if(!validSlug(input.username))throw new BadRequestException('Choose a username with 3–25 lowercase letters, digits or underscores.');
  if(await this.platform.db.user.findUnique({where:{username:input.username}}))throw new ConflictException('That username is already taken.');
  const temporaryPassword='Nova1!'+randomBytes(24).toString('base64url'),created=await this.identity.create(input.username,input.displayName,temporaryPassword);if(!created?.id)throw new ConflictException('Identity creation did not return an account identifier.');
  try{const user=await this.platform.bootstrap({sub:created.id,preferred_username:input.username,name:input.displayName},{accountType:input.accountType},actor.id);return {user,temporaryPassword};}
  catch(error){try{await this.identity.remove(created.id);}catch{console.error('Account provisioning compensation needs attention.');}throw error;}
 }
 private async target(identity:any,targetId?:string){
  const actor=await this.platform.actor(identity);if(targetId)this.platform.require(actor,'users.manage');
  const user=targetId?await this.platform.db.user.findUnique({where:{id:targetId},include:USER_INCLUDE}):actor;if(!user)throw new NotFoundException();
  // Check stored grants even for suspended administrators; password resets must not promote delegated account managers.
  if(user.id!==actor.id&&user.memberships.some((membership:any)=>membership.group.permissions.some((permission:any)=>permission.permissionCode==='platform.admin')))this.platform.require(actor,'platform.admin');
  return {actor,user};
 }
 async sessions(identity:any,targetId?:string){const {user}=await this.target(identity,targetId),current=identitySession(identity);return (await this.identity.sessions(user.identitySubject)).map((session:any)=>({id:session.id,current:session.id===current,startedAt:this.date(session.start),lastAccessAt:this.date(session.lastAccess),clients:Object.values(session.clients||{}).filter((client:any)=>client==='nova-web')}));}
 private date(value:any){const number=Number(value);return Number.isFinite(number)&&number>0?new Date(number<1e12?number*1000:number).toISOString():null;}
 async revoke(identity:any,input:{sessionId?:string;others?:boolean},targetId?:string){
  const {actor,user}=await this.target(identity,targetId),current=identitySession(identity),keep=input.others?current:null;
  if(input.others&&targetId)throw new BadRequestException('Other-session logout is only available for your own account.');
  if(input.sessionId){
   const sessions=await this.identity.sessions(user.identitySubject);if(!sessions.some((session:any)=>session.id===input.sessionId))throw new NotFoundException('Session not found for this account.');
   await this.identity.logoutSession(input.sessionId);
   await this.platform.db.revokedSession.upsert({where:{userId_sessionId:{userId:user.id,sessionId:input.sessionId}},create:{userId:user.id,sessionId:input.sessionId,expiresAt:new Date(Date.now()+86400000)},update:{expiresAt:new Date(Date.now()+86400000)}});
  }else{
   // The durable barrier also invalidates already issued NOVA access/playback tokens.
   await this.platform.db.user.update({where:{id:user.id},data:{authNotBefore:Math.floor(Date.now()/1000),authAllowedSessionId:keep}});
   if(keep){for(const session of await this.identity.sessions(user.identitySubject))if(session.id!==keep)await this.identity.logoutSession(session.id);}
   else await this.identity.logoutAll(user.identitySubject);
  }
  await this.platform.audit(this.platform.db,actor.id,'account.sessions_revoked',user.id,{scope:input.sessionId?'one':keep?'others':'all'});
  return {signedOut:user.id===actor.id&&(!keep&&!input.sessionId||input.sessionId===current)};
 }
 async resetPassword(identity:any,targetId:string){
  const {actor,user}=await this.target(identity,targetId);if(actor.id===user.id)throw new BadRequestException('Use My account → Change password for your own account.');const temporaryPassword='Nova1!'+randomBytes(24).toString('base64url');
  await this.platform.db.user.update({where:{id:user.id},data:{authNotBefore:Math.floor(Date.now()/1000),authAllowedSessionId:null}});
  await this.identity.reset(user.identitySubject,temporaryPassword);
  await this.platform.audit(this.platform.db,actor.id,'account.password_reset',user.id);
  return {temporaryPassword};
 }
}
