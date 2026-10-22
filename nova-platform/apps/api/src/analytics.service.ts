import {Injectable,NotFoundException,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PlatformService} from './platform.service.js';
import {AudienceService} from './audience.service.js';
export function observationWindow(previous:Date|null,now:Date){return previous?Math.max(0,Math.min(30,(now.getTime()-previous.getTime())/1000)):0;}
@Injectable()
export class AnalyticsService implements OnModuleInit,OnModuleDestroy {
 constructor(readonly platform:PlatformService,readonly audience:AudienceService){}
 private timer?:NodeJS.Timeout;private recording=false;
 onModuleInit(){this.timer=setInterval(()=>void this.sample().catch(()=>console.error('Audience analytics sampling unavailable.')),15000);}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async sample(now=new Date()){
  if(this.recording)return;this.recording=true;
  try{await this.audience.prune();const sessions=await this.platform.db.streamSession.findMany({where:{status:'live',endedAt:null,channel:{state:'live',accessState:'ready',owner:{status:'active'}}}});for(const session of sessions)await this.record(session.id,this.audience.store.current(session.id),now);}finally{this.recording=false;}
 }
 async record(sessionId:string,viewers:number,now=new Date()){
  await this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`analytics:${sessionId}`}))`;
   const session=await tx.streamSession.findUnique({where:{id:sessionId}});if(!session||session.status!=='live'||session.endedAt)return;
   const seconds=observationWindow(session.lastAnalyticsAt,now);if(session.lastAnalyticsAt&&now<=session.lastAnalyticsAt)return;
   await tx.streamSession.update({where:{id:sessionId},data:{lastAnalyticsAt:now,...(!session.analyticsStartedAt?{analyticsStartedAt:now}:{})}});
   if(!seconds)return;const bucketAt=new Date(Math.floor(now.getTime()/60000)*60000),viewerSeconds=Math.max(0,viewers)*seconds;
   await tx.audienceSample.upsert({where:{sessionId_bucketAt:{sessionId,bucketAt}},create:{sessionId,bucketAt,viewerSeconds,observedSeconds:seconds},update:{viewerSeconds:{increment:viewerSeconds},observedSeconds:{increment:seconds}}});
  });
 }
 async access(identity:any,all=false,channelId?:string){
  const user=await this.platform.actor(identity);this.platform.require(user,all?'analytics.read_any':'analytics.read_own');
  const scope=all?channelId:user.channel?.id;if(!all&&!scope)throw new NotFoundException('This account does not have a creator channel.');
  if(scope&&!await this.platform.db.channel.findUnique({where:{id:scope}}))throw new NotFoundException();return scope as string|undefined;
 }
 async report(identity:any,days:number,page:number,all=false,requestedChannel?:string){
  const channelId=await this.access(identity,all,requestedChannel),now=new Date(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-days+1)),db=this.platform.db;
  const scope=channelId?Prisma.sql`AND s."channelId"=${channelId}::uuid`:Prisma.empty,activityScope=channelId?{channelId}:{},sessionWhere=channelId?{channelId}:{};
  const [summaryRows,sampleRows,dailySamples,starts,activity,followers,total,history]=await Promise.all([
   db.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) FILTER (WHERE s."startedAt">=${from})::int AS broadcasts, COALESCE(MAX(s."peakViewers") FILTER (WHERE s."startedAt">=${from}),0)::int AS peak, COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(s."endedAt",${now}),${now})-GREATEST(s."startedAt",${from})))),0)::float8 AS seconds FROM "StreamSession" s WHERE s."startedAt" IS NOT NULL AND s."startedAt"<=${now} AND COALESCE(s."endedAt",${now})>=${from} ${scope}`),
   db.$queryRaw<any[]>(Prisma.sql`SELECT COALESCE(SUM(a."viewerSeconds"),0)::float8 AS "viewerSeconds",COALESCE(SUM(a."observedSeconds"),0)::float8 AS "observedSeconds",MIN(a."bucketAt") AS "trackingSince" FROM "AudienceSample" a JOIN "StreamSession" s ON s.id=a."sessionId" WHERE a."bucketAt">=${from} ${scope}`),
   db.$queryRaw<any[]>(Prisma.sql`SELECT DATE_TRUNC('day',a."bucketAt") AS day,SUM(a."viewerSeconds")::float8 AS "viewerSeconds",SUM(a."observedSeconds")::float8 AS "observedSeconds" FROM "AudienceSample" a JOIN "StreamSession" s ON s.id=a."sessionId" WHERE a."bucketAt">=${from} ${scope} GROUP BY day ORDER BY day`),
   db.streamSession.findMany({where:{...sessionWhere,startedAt:{gte:from}},select:{startedAt:true}}),
   db.followActivity.findMany({where:{...activityScope,createdAt:{gte:from}},select:{kind:true,createdAt:true}}),
   db.follow.count({where:activityScope}),db.streamSession.count({where:sessionWhere}),
   db.streamSession.findMany({where:sessionWhere,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:20,select:{id:true,title:true,status:true,protocol:true,createdAt:true,startedAt:true,endedAt:true,endReason:true,peakViewers:true,analyticsStartedAt:true,channel:{select:{slug:true}}}})
  ]);
  const sums=history.length?await db.audienceSample.groupBy({by:['sessionId'],where:{sessionId:{in:history.map(item=>item.id)}},_sum:{viewerSeconds:true,observedSeconds:true}}):[],bySession=new Map(sums.map(item=>[item.sessionId,item._sum]));
  const chart=Array.from({length:days},(_,index)=>{const date=new Date(from.getTime()+index*86400000).toISOString().slice(0,10);return {date,broadcasts:0,viewerSeconds:0,observedSeconds:0,gained:0,lost:0};}),byDate=new Map(chart.map(item=>[item.date,item]));
  for(const row of dailySamples){const day=byDate.get(new Date(row.day).toISOString().slice(0,10));if(day){day.viewerSeconds=Number(row.viewerSeconds);day.observedSeconds=Number(row.observedSeconds);}}
  for(const row of starts){const day=byDate.get(row.startedAt!.toISOString().slice(0,10));if(day)day.broadcasts++;}
  for(const row of activity){const day=byDate.get(row.createdAt.toISOString().slice(0,10));if(day)row.kind==='follow'?day.gained++:day.lost++;}
  const sample=sampleRows[0],summary=summaryRows[0];return {days,page,pageSize:20,total,scope:channelId||'platform',from:from.toISOString(),timezone:'UTC',summary:{broadcasts:summary.broadcasts,liveSeconds:Math.max(0,summary.seconds),peakViewers:summary.peak,followers,gained:activity.filter(item=>item.kind==='follow').length,lost:activity.filter(item=>item.kind==='unfollow').length,viewerSeconds:sample.viewerSeconds,observedSeconds:sample.observedSeconds,averageViewers:sample.observedSeconds?sample.viewerSeconds/sample.observedSeconds:null,trackingSince:sample.trackingSince},chart,history:history.map(item=>{const sum=bySession.get(item.id);return {...item,durationSeconds:item.startedAt?Math.max(0,((item.endedAt||now).getTime()-item.startedAt.getTime())/1000):0,viewerSeconds:sum?.viewerSeconds||0,observedSeconds:sum?.observedSeconds||0,averageViewers:sum?.observedSeconds?(sum.viewerSeconds||0)/sum.observedSeconds:null};})};
 }
}
