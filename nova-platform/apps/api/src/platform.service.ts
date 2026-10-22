import {ConflictException,ForbiddenException,Injectable,NotFoundException,UnauthorizedException,BadRequestException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {randomBytes} from 'node:crypto';
import {Database} from './database.js';
import {allowed,DEFAULT_SETTINGS,effectivePermissions,validSlug,mayPublish} from './policy.js';
import {decryptSecret,encryptSecret,hashSecret} from './secrets.js';
import {brandingLinks} from './branding.js';
import {assertSession} from './account-security.js';
export const USER_INCLUDE={memberships:{include:{group:{include:{permissions:true}}}},channel:{include:{chatRoom:true,category:true,brandingAssets:{select:{kind:true,revision:true}}}}} as const;
@Injectable()
export class PlatformService {
  constructor(readonly db:Database){}
  async settings(tx:any=this.db){const rows=await tx.setting.findMany();return Object.assign({...DEFAULT_SETTINGS},...rows.map((s:any)=>({[s.key]:s.value})));}
  async actor(identity:any,tx:any=this.db){const user=await tx.user.findUnique({where:{identitySubject:identity.sub},include:USER_INCLUDE});
    if(!user)throw new ConflictException('ACCOUNT_SETUP_REQUIRED');if(user.status!=='active')throw new ForbiddenException('Your account is not active.');await assertSession(tx,user,identity);return user;}
  require(user:any,permission:string){if(!allowed(user,permission))throw new ForbiddenException('You do not have permission for this action.');}
  async audit(tx:any,actorId:string|null,action:string,targetId:string|null,details:any={}){return tx.auditEvent.create({data:{actorId,action,targetId,details}});}
  async bootstrap(identity:any,input:{accountType:'viewer'|'creator',slug?:string},administratorId?:string){
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity.sub}))`;
      const existing=await tx.user.findUnique({where:{identitySubject:identity.sub},include:USER_INCLUDE});
      if(existing){if(existing.status!=='active')throw new ForbiddenException('Your account is not active.');await assertSession(tx,existing,identity);return this.present(existing);}
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-platform-settings'))`;
      const settings=await this.settings(tx);if(!administratorId&&!settings.registrationEnabled)throw new ForbiddenException('Registration is currently closed.');
      if(!administratorId&&input.accountType==='creator'&&!settings.creatorSignupEnabled)throw new ForbiddenException('Creator registration is currently closed.');
      const username=String(input.slug||identity.preferred_username||'').toLowerCase();if(!validSlug(username))throw new BadRequestException('Choose a unique username with 3–25 lowercase letters, digits or underscores.');
      const other=await tx.user.findUnique({where:{username}});if(other)throw new ConflictException('That username is already taken.');
      const displayName=String(identity.name||identity.preferred_username||username).slice(0,80);
      const user=await tx.user.create({data:{identitySubject:identity.sub,username,displayName}});
      const groupKeys=input.accountType==='creator'?['viewers','creators']:['viewers'];
      const groups=await tx.group.findMany({where:{key:{in:groupKeys}}});if(groups.length!==groupKeys.length)throw new Error('Required groups have not been seeded');
      await tx.membership.createMany({data:groups.map(g=>({userId:user.id,groupId:g.id}))});
      if(input.accountType==='creator'){
        const secret=randomBytes(32).toString('base64url');
        const category=await tx.category.findFirst({where:{name:settings.defaultCategory,enabled:true}});
        await tx.channel.create({data:{ownerId:user.id,slug:username,title:`${displayName}'s live stream`,accessState:settings.creatorApprovalRequired?'pending_approval':'ready',
          categoryId:category?.id,
          credential:{create:{lookupHash:hashSecret(secret),encryptedSecret:encryptSecret(secret)}},chatRoom:{create:{}}}});
      }
      await this.audit(tx,administratorId||user.id,'account.provisioned',user.id,{accountType:input.accountType});
      return this.present(await tx.user.findUniqueOrThrow({where:{id:user.id},include:USER_INCLUDE}));
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:15000});
  }
  present(user:any){return {id:user.id,username:user.username,displayName:user.displayName,status:user.status,createdAt:user.createdAt,bio:user.bio||'',profileVersion:user.profileVersion||1,
    groups:user.memberships.map((m:any)=>({id:m.group.id,key:m.group.key,name:m.group.name})),permissions:effectivePermissions(user),channel:user.channel};}
  async studio(user:any){if(!user.channel)throw new NotFoundException('This account does not have a creator channel.');this.require(user,'channel.manage_own');
    const settings=await this.settings();const overrides=user.channel.settings as any;return {channel:user.channel,branding:brandingLinks(user.channel.id,user.channel.brandingAssets),effectiveSettings:{language:settings.defaultLanguage,slowModeSeconds:settings.defaultSlowModeSeconds,...overrides,category:user.channel.category?.name||overrides.category||settings.defaultCategory,chatEnabled:settings.chatEnabled&&overrides.chatEnabled!==false},platform:settings,
      broadcasting:{available:mayPublish(user,user.channel,settings),browserAvailable:settings.browserPublishingEnabled&&mayPublish(user,user.channel,settings),server:`rtmp://${process.env.NOVA_HOST}:1935/ingest`,ingestPath:`ingest/${user.channel.id}`,keyPrefix:`${user.channel.id}?key=`}};}
  async updateStudio(user:any,input:any,targetChannelId?:string){this.require(user,targetChannelId?'channels.manage_any':'channel.manage_own');const channelId=targetChannelId||user.channel?.id;if(!channelId)throw new NotFoundException();
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-categories'))`;
      const current=await tx.channel.findUniqueOrThrow({where:{id:channelId},include:{category:true}});
      const categoryName=input.settings.category||current.category?.name||(await this.settings(tx)).defaultCategory;
      const category=await tx.category.findFirst({where:{name:categoryName}});
      if(!category||!category.enabled&&category.id!==current.categoryId)throw new BadRequestException('Select an available category.');
      const changed=await tx.channel.updateMany({where:{id:channelId,version:input.version},data:{title:input.title,bio:input.bio,categoryId:category.id,settings:{...(current.settings as any),...input.settings,category:category.name},version:{increment:1}}});
      if(!changed.count)throw new ConflictException('Settings changed. Refresh before saving again.');await this.audit(tx,user.id,'channel.updated',channelId);return tx.channel.findUnique({where:{id:channelId}});
    });}
  async revealKey(user:any,identity:any){this.require(user,'stream_keys.manage_own');if(!user.channel)throw new NotFoundException();
    if(!identity.auth_time||Date.now()/1000-Number(identity.auth_time)>300)throw new UnauthorizedException('REAUTHENTICATION_REQUIRED');
    const credential=await this.db.streamCredential.findUniqueOrThrow({where:{channelId:user.channel.id}});await this.audit(this.db,user.id,'stream_key.revealed',user.channel.id);return {key:decryptSecret(credential.encryptedSecret),generation:credential.generation};}
  async groups(user:any){this.require(user,'groups.manage');return this.db.group.findMany({include:{permissions:true,_count:{select:{memberships:true}}},orderBy:{name:'asc'}});}
  async users(user:any){this.require(user,'users.manage');const users=await this.db.user.findMany({include:USER_INCLUDE,orderBy:{createdAt:'desc'},take:200});return users.map(u=>this.present(u));}
  async ensureAdmin(tx:any){const n=await tx.user.count({where:{status:'active',memberships:{some:{group:{permissions:{some:{permissionCode:'platform.admin'}}}}}}});if(n===0)throw new ConflictException('The last active administrator cannot lose access.');}
  async updateUser(user:any,id:string,input:{status?:string,groupIds?:string[]}){
    this.require(user,'users.manage');if(input.groupIds)this.require(user,'groups.manage');
    return this.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-admin-policy'))`;
      const target=await tx.user.findUnique({where:{id}});if(!target)throw new NotFoundException();
      // Media reconciliation rechecks current membership/status and disconnects revoked publishers.
      await tx.user.update({where:{id},data:{status:input.status}});
      if(input.groupIds){const ids=[...new Set(input.groupIds)];const count=await tx.group.count({where:{id:{in:ids}}});if(count!==ids.length)throw new BadRequestException('Unknown group.');await tx.membership.deleteMany({where:{userId:id}});if(ids.length)await tx.membership.createMany({data:ids.map(groupId=>({userId:id,groupId}))});}
      await this.ensureAdmin(tx);await this.audit(tx,user.id,'user.access_updated',id,input);return this.present(await tx.user.findUniqueOrThrow({where:{id},include:USER_INCLUDE}));
    });
  }
  async saveGroup(user:any,id:string|undefined,input:{name:string,description:string,permissions:string[]}){
    this.require(user,'groups.manage');return this.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-admin-policy'))`;
      const existing=id?await tx.group.findUnique({where:{id}}):null;if(id&&!existing)throw new NotFoundException();if(existing?.protected)throw new ForbiddenException('This built-in administrator group is protected.');
      const codes=[...new Set(input.permissions)];if(await tx.permission.count({where:{code:{in:codes}}})!==codes.length)throw new BadRequestException('Unknown permission.');
      const group=existing?await tx.group.update({where:{id},data:{name:input.name,description:input.description}}):await tx.group.create({data:{key:`custom_${randomBytes(8).toString('hex')}`,name:input.name,description:input.description}});
      await tx.groupPermission.deleteMany({where:{groupId:group.id}});if(codes.length)await tx.groupPermission.createMany({data:codes.map(permissionCode=>({groupId:group.id,permissionCode}))});await this.ensureAdmin(tx);await this.audit(tx,user.id,existing?'group.updated':'group.created',group.id,{name:input.name,permissions:codes});return group;
    });
  }
  async saveSettings(user:any,input:Record<string,any>){this.require(user,'settings.manage');
    const {expectedVersion,...changes}=input;
    return this.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-platform-settings'))`;const current=await this.settings(tx);if(input.defaultCategory&&!await tx.category.findFirst({where:{name:input.defaultCategory,enabled:true}}))throw new BadRequestException('Choose an available default category.');if(current._revision!==expectedVersion)throw new ConflictException('Platform settings changed. Refresh before saving.');for(const [key,value] of Object.entries(changes))await tx.setting.upsert({where:{key},create:{key,value},update:{value,version:{increment:1}}});await tx.setting.upsert({where:{key:'_revision'},create:{key:'_revision',value:current._revision+1},update:{value:current._revision+1}});await this.audit(tx,user.id,'platform.settings_updated',null,changes);return this.settings(tx);});}
  async approveChannel(user:any,id:string,input:{accessState:'ready'|'disabled'|'pending_approval'}){this.require(user,'channels.manage_any');return this.db.$transaction(async tx=>{const c=await tx.channel.update({where:{id},data:{accessState:input.accessState,version:{increment:1}}});await this.audit(tx,user.id,'channel.access_updated',id,input);return c;});}
}
