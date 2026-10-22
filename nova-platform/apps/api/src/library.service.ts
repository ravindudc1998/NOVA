import {Injectable,NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PlatformService} from './platform.service.js';
import {AudienceService} from './audience.service.js';
import {brandingLinks} from './branding.js';

const visibleChannel={accessState:'ready',owner:{status:'active'}} satisfies Prisma.ChannelWhereInput;
const card={_count:{select:{followers:true}},category:{select:{id:true,name:true,slug:true}},brandingAssets:{select:{kind:true,revision:true}},id:true,slug:true,title:true,bio:true,state:true,owner:{select:{displayName:true}},sessions:{where:{endedAt:null},orderBy:{createdAt:'desc'},take:1,select:{id:true,status:true,startedAt:true,endedAt:true,peakViewers:true}}} satisfies Prisma.ChannelSelect;

@Injectable()
export class LibraryService {
 constructor(readonly platform:PlatformService,readonly audience:AudienceService=new AudienceService(platform)){}
 get db(){return this.platform.db;}
 private present(channel:any){const {sessions,brandingAssets,_count,...value}=channel;return {...value,followerCount:_count?.followers||0,branding:brandingLinks(channel.id,brandingAssets),audience:this.audience.stats(sessions?.[0],channel.state==='live')};}
 async channels(liveOnly=false,categoryId?:string){return (await this.db.channel.findMany({where:{...visibleChannel,...(liveOnly?{state:'live'}:{}),...(categoryId?{categoryId}:{})},select:card,take:100,orderBy:{createdAt:'desc'}})).map(channel=>this.present(channel));}
 async channel(id:string){const channel=await this.db.channel.findFirst({where:{...visibleChannel,id},select:card});if(!channel)throw new NotFoundException('This channel is unavailable.');return this.present(channel);}
 async lookup(ids:string[]){return (await this.db.channel.findMany({where:{...visibleChannel,id:{in:ids}},select:card})).map(channel=>this.present(channel));}
 async read(identity:any){
  const user=await this.platform.actor(identity);this.platform.require(user,'streams.view');
  const [favourites,recents]=await Promise.all([
   this.db.favouriteChannel.findMany({where:{userId:user.id,channel:visibleChannel},select:{channel:{select:card}},orderBy:[{createdAt:'desc'},{channelId:'asc'}]}),
   this.db.recentChannel.findMany({where:{userId:user.id,channel:visibleChannel},select:{channel:{select:card},lastViewedAt:true},orderBy:[{lastViewedAt:'desc'},{channelId:'asc'}],take:50})
  ]);
  return {favourites:favourites.map(item=>this.present(item.channel)),recents:recents.map(item=>({...this.present(item.channel),lastViewedAt:item.lastViewedAt}))};
 }
 async favourite(identity:any,channelId:string,add:boolean){
  const user=await this.platform.actor(identity);this.platform.require(user,'favourites.manage_own');
  if(add){await this.channel(channelId);await this.db.favouriteChannel.upsert({where:{userId_channelId:{userId:user.id,channelId}},create:{userId:user.id,channelId},update:{}});}
  else await this.db.favouriteChannel.deleteMany({where:{userId:user.id,channelId}});
  return {favourited:add};
 }
 async visited(identity:any,channelId:string){
  const user=await this.platform.actor(identity);this.platform.require(user,'streams.view');await this.channel(channelId);
  await this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recent:${user.id}`}))`;
   await tx.recentChannel.upsert({where:{userId_channelId:{userId:user.id,channelId}},create:{userId:user.id,channelId},update:{lastViewedAt:new Date()}});
   const stale=await tx.recentChannel.findMany({where:{userId:user.id},orderBy:[{lastViewedAt:'desc'},{channelId:'asc'}],skip:50,select:{channelId:true}});
   if(stale.length)await tx.recentChannel.deleteMany({where:{userId:user.id,channelId:{in:stale.map(item=>item.channelId)}}});
  });
  return {saved:true};
 }
}
