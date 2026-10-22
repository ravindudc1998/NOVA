export const VIEWER_TTL=35000,DELIVERY_TTL=45000;
type Lease={browserId:string;leaseId:string;viewerId:string|null;position:number;observedAt:number;progressAt:number|null;createdAt:number};
type Stream={channelId:string;leases:Map<string,Lease>;peak:number;persistedPeak:number};
export class AudienceStore {
 readonly streams=new Map<string,Stream>();
 private deliveries=new Map<string,number>();private closed=new Map<string,number>();private total=0;
 constructor(readonly now:()=>number=Date.now){}
 delivery(sessionId:string,browserId:string){const key=`${sessionId}:${browserId}`;if(this.deliveries.size<50000||this.deliveries.has(key))this.deliveries.set(key,this.now());}
 needsDelivery(sessionId:string,browserId:string){const at=this.deliveries.get(`${sessionId}:${browserId}`);return at===undefined||this.now()-at>=20000;}
 current(sessionId:string){const stream=this.streams.get(sessionId),now=this.now();return stream?new Set([...stream.leases.values()].filter(lease=>lease.progressAt!==null&&now-lease.progressAt<VIEWER_TTL).map(lease=>lease.viewerId?`u:${lease.viewerId}`:`g:${lease.browserId}`)).size:0;}
 beat(input:{sessionId:string;channelId:string;browserId:string;leaseId:string;viewerId:string|null;position:number;peak:number}){
  const now=this.now(),closedKey=`${input.channelId}:${input.browserId}:${input.leaseId}`,delivered=this.deliveries.get(`${input.sessionId}:${input.browserId}`);
  if(this.closed.has(closedKey)||delivered===undefined||now-delivered>DELIVERY_TTL)return null;
  let stream=this.streams.get(input.sessionId);if(!stream){stream={channelId:input.channelId,leases:new Map(),peak:input.peak,persistedPeak:input.peak};this.streams.set(input.sessionId,stream);}
  const key=`${input.browserId}:${input.leaseId}`,previous=stream.leases.get(key);if(!previous&&this.total>=50000)return null;
  // A shared browser changes identity as one group, so sign-in does not leave a guest duplicate.
  for(const lease of stream.leases.values())if(lease.browserId===input.browserId)lease.viewerId=input.viewerId;
  const lease:Lease=previous||{browserId:input.browserId,leaseId:input.leaseId,viewerId:input.viewerId,position:input.position,observedAt:now,progressAt:null,createdAt:now};
  if(previous&&input.position>previous.position+0.25&&now-previous.observedAt>=500)lease.progressAt=now;
  lease.position=input.position;lease.observedAt=now;stream.leases.set(key,lease);if(!previous)this.total++;
  const current=this.current(input.sessionId);stream.peak=Math.max(stream.peak,input.peak,current);return {current,peak:stream.peak,stream};
 }
 leave(channelId:string,browserId:string,leaseId:string){
  const key=`${channelId}:${browserId}:${leaseId}`;if(this.closed.size>=50000)this.closed.delete(this.closed.keys().next().value!);this.closed.set(key,this.now());
  for(const stream of this.streams.values())if(stream.channelId===channelId&&stream.leases.delete(`${browserId}:${leaseId}`))this.total--;
 }
 userIds(){return [...new Set([...this.streams.values()].flatMap(stream=>[...stream.leases.values()].map(lease=>lease.viewerId).filter((id):id is string=>Boolean(id))))];}
 prune(active?:Set<string>,validUsers?:Set<string>,allowGuests=true){
  const now=this.now();for(const [id,stream]of this.streams){
   if(active&&!active.has(id)){this.total-=stream.leases.size;this.streams.delete(id);continue;}
   for(const [key,lease]of stream.leases){const ineligible=lease.viewerId?(validUsers!==undefined&&!validUsers.has(lease.viewerId)):!allowGuests;if(now-(lease.progressAt??lease.createdAt)>=VIEWER_TTL||ineligible){stream.leases.delete(key);this.total--;}}
  }
  for(const [key,at]of this.deliveries)if(now-at>DELIVERY_TTL)this.deliveries.delete(key);
  for(const [key,at]of this.closed)if(now-at>60000)this.closed.delete(key);
 }
}
