import {ForbiddenException,Injectable,OnModuleDestroy,OnModuleInit,UnauthorizedException} from '@nestjs/common';
import {createHmac,randomUUID} from 'node:crypto';
import {PlatformService} from './platform.service.js';
import {safeEqual} from './secrets.js';
import {AudienceStore} from './audience-store.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const cookieValue=(header:string,name:string)=>String(header||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1)||'';
export function browserCookie(id:string,secret:string){return `${id}.${createHmac('sha256',secret).update(`audience:${id}`).digest('base64url')}`;}
export function browserFromCookie(value:string,secret:string){const id=value.split('.')[0];return uuid.test(id)&&safeEqual(value,browserCookie(id,secret))?id:null;}
@Injectable()
export class AudienceService implements OnModuleInit,OnModuleDestroy {
 readonly store=new AudienceStore();private timer?:NodeJS.Timeout;private pruning=false;
 constructor(readonly platform:PlatformService){}
 private get secret(){return process.env.MEDIA_SERVICE_SECRET||'';}
 browser(req:any){return browserFromCookie(cookieValue(req.headers.cookie,'nova_audience'),this.secret);}
 ensureBrowser(req:any,res:any){if(this.browser(req))return;res.cookie('nova_audience',browserCookie(randomUUID(),this.secret),{httpOnly:true,secure:true,sameSite:'strict',maxAge:365*86400000,path:'/api/v1'});}
 delivered(req:any,sessionId:string){const browser=this.browser(req);if(browser)this.store.delivery(sessionId,browser);}
 needsDelivery(req:any,sessionId:string){const browser=this.browser(req);return Boolean(browser&&this.store.needsDelivery(sessionId,browser));}
 async beat(req:any,session:any,viewerId:string|null,input:{leaseId:string;position:number}){
  const browserId=this.browser(req);if(!browserId)throw new UnauthorizedException('Reload the player to start viewing.');
  const result=this.store.beat({sessionId:session.id,channelId:session.channelId,browserId,leaseId:input.leaseId,viewerId,position:input.position,peak:session.peakViewers||0});
  if(!result)throw new ForbiddenException('Active video playback could not be verified.');
  if(result.peak>result.stream.persistedPeak){await this.platform.db.streamSession.updateMany({where:{id:session.id,peakViewers:{lt:result.peak}},data:{peakViewers:result.peak}});result.stream.persistedPeak=Math.max(result.stream.persistedPeak,result.peak);}
  return {received:true};
 }
 leave(req:any,channelId:string,leaseId:string){const browser=this.browser(req);if(browser)this.store.leave(channelId,browser,leaseId);}
 stats(session:any,live:boolean,includePeak=false){
  const active=Boolean(live&&session&&!session.endedAt&&session.status==='live');
  return {live:active,current:active?this.store.current(session.id):0,startedAt:session?.startedAt?.toISOString()||null,endedAt:session?.endedAt?.toISOString()||null,serverTime:new Date().toISOString(),...(includePeak?{peak:Math.max(session?.peakViewers||0,session?this.store.streams.get(session.id)?.peak||0:0)}:{})};
 }
 onModuleInit(){this.timer=setInterval(()=>void this.prune().catch(()=>console.error('Audience cleanup unavailable.')),5000);}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async prune(){
  if(this.pruning)return;this.pruning=true;try{
   this.store.prune();const ids=[...this.store.streams.keys()];if(!ids.length)return;
   const [settings,sessions,users]=await Promise.all([this.platform.settings(),this.platform.db.streamSession.findMany({where:{id:{in:ids},endedAt:null,status:'live',channel:{state:'live',accessState:'ready',owner:{status:'active'}}},select:{id:true}}),this.platform.db.user.findMany({where:{id:{in:this.store.userIds()},status:'active',memberships:{some:{group:{permissions:{some:{permissionCode:{in:['platform.admin','streams.view']}}}}}}},select:{id:true}})]);
   this.store.prune(new Set(settings.maintenanceEnabled?[]:sessions.map(session=>session.id)),new Set(users.map(user=>user.id)),Boolean(settings.guestViewingEnabled));
  }finally{this.pruning=false;}
 }
}
