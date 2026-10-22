import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
const dimension=z.number().int().min(2).max(8192),dbfs=z.number().finite().min(-120).max(12).nullable(),time=z.string().datetime();
export const healthReport=z.object({version:z.literal(1),sessionId:z.string().uuid(),channelId:z.string().uuid(),checkedAt:time,
 ingest:z.object({state:z.enum(['receiving','stalled']),bitrateKbps:z.number().int().min(0).max(10000000).nullable()}).strict(),
 video:z.object({state:z.enum(['waiting','ready','stalled','unverified']),width:dimension.nullable(),height:dimension.nullable(),codec:z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/).nullable(),fps:z.number().finite().positive().max(240).nullable(),qualities:z.array(z.object({width:dimension,height:dimension}).strict()).max(6),lastSegmentAt:time.nullable()}).strict(),
 audio:z.object({state:z.enum(['checking','missing','active','quiet','silent','unavailable']),peakDbfs:dbfs,rmsDbfs:dbfs,sampledAt:time.nullable(),quietSince:time.nullable()}).strict()
}).strict();
export async function readStreamHealth(sessionId:string,channelId:string,root=process.env.NOVA_HEALTH_ROOT||'/var/lib/nova-health',now=Date.now()){
 try{
  z.string().uuid().parse(sessionId);const path=join(root,sessionId+'.json'),info=await stat(path);if(!info.isFile()||info.size>65536)throw new Error();
  const report=healthReport.parse(JSON.parse(await readFile(path,'utf8')));
  if(report.sessionId!==sessionId||report.channelId!==channelId)throw new Error();
  const age=now-Date.parse(report.checkedAt);if(age< -5000||age>20000)return {monitor:'stale',checkedAt:report.checkedAt,report:null};
  if(report.video.state==='ready'&&(!report.video.lastSegmentAt||now-Date.parse(report.video.lastSegmentAt)>15000))report.video.state='stalled';
  if(report.audio.sampledAt&&(now-Date.parse(report.audio.sampledAt)>20000||Date.parse(report.audio.sampledAt)>now+5000))report.audio={state:'unavailable',peakDbfs:null,rmsDbfs:null,sampledAt:null,quietSince:null};
  return {monitor:'fresh',checkedAt:report.checkedAt,report};
 }catch{return {monitor:'waiting',checkedAt:null,report:null};}
}
