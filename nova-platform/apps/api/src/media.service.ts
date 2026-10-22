import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,OnModuleDestroy,OnModuleInit,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import {SignJWT,jwtVerify} from 'jose';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {hlsReady,hlsRoot,isHlsFile} from './hls-files.js';
import {readStreamHealth} from './stream-health.js';
import {readThumbnail} from './thumbnails.js';
import {AudienceService} from './audience.service.js';
import {PlatformService,USER_INCLUDE} from './platform.service.js';
import {identitySession} from './account-security.js';
import {forwardedMediaPath,readPlaybackPolicy} from './playback-access.js';
import {mayPublish} from './policy.js';
import {encryptSecret,hashSecret,safeEqual} from './secrets.js';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ingestPattern=new RegExp(`^ingest/(${uuid})$`),outputPattern=new RegExp(`^live/(${uuid})/(${uuid})$`);
@Injectable()
export class MediaService implements OnModuleInit,OnModuleDestroy {
  constructor(readonly platform:PlatformService,readonly audience:AudienceService=new AudienceService(platform)){if((process.env.MEDIA_SERVICE_SECRET||'').length<32)throw new Error('A strong MEDIA_SERVICE_SECRET is required.');}
  private timer?:NodeJS.Timeout;private syncing=false;private failedSince=0;
  get db(){return this.platform.db;}
  private get signingKey(){return new TextEncoder().encode(process.env.MEDIA_SERVICE_SECRET);}
  internalAuth(header:string){const expected=`Basic ${Buffer.from(`nova-system:${process.env.MEDIA_SERVICE_SECRET}`).toString('base64')}`;if(!safeEqual(header||'',expected))throw new ForbiddenException();}
  private system(user:string,password:string){return ['nova-system','nova-worker'].includes(user)&&safeEqual(password||'',process.env.MEDIA_SERVICE_SECRET||'');}
  async control(path:string,method='GET'){
    const r=await fetch(`http://mediamtx:9997/v3/${path}`,{method,headers:{Authorization:`Basic ${Buffer.from(`nova-system:${process.env.MEDIA_SERVICE_SECRET}`).toString('base64')}`},signal:AbortSignal.timeout(4000)});
    if(r.status===404)return null;if(!r.ok)throw new ServiceUnavailableException('The media service is unavailable.');return r.headers.get('content-type')?.includes('json')?r.json():null;
  }
  async paths(){const items:any[]=[];for(let page=0;page<100;page++){const r=await this.control(`paths/list?itemsPerPage=100&page=${page}`);if(!r)break;items.push(...r.items);if(page+1>=r.pageCount)break;}return items;}
  async authorize(input:any){
    const {user='',password='',action='',path='',protocol='',id=''}=input;const query=new URLSearchParams(input.query||'');
    const worker=this.system(user,password);
    if(action==='api'){if(user==='nova-system'&&worker)return {};throw new ForbiddenException();}
    const raw=ingestPattern.exec(path),out=outputPattern.exec(path);
    if(action==='read'&&worker){
      if(raw&&protocol==='rtsp'&&user==='nova-worker'){if(await this.db.streamSession.count({where:{channelId:raw[1],endedAt:null}}))return {};}
      if(out&&protocol==='hls'&&user==='nova-system'){if(await this.db.streamSession.count({where:{id:out[2],channelId:out[1],endedAt:null,status:'live'}}))return {};}
      throw new ForbiddenException();
    }
    if(action!=='publish')throw new ForbiddenException();
    if(out&&worker&&user==='nova-worker'&&protocol==='rtsp'){
      const session=await this.db.streamSession.findFirst({where:{id:out[2],channelId:out[1],endedAt:null},include:{channel:{include:{owner:{include:USER_INCLUDE}}}}});
      if(session&&mayPublish(session.channel.owner,session.channel,await this.platform.settings()))return {};
      throw new ForbiddenException();
    }
    if(!raw||!['rtmp','webrtc'].includes(protocol)||!new RegExp(`^${uuid}$`).test(id))throw new ForbiddenException();
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media:${raw[1]}`}))`;
      const channel=await tx.channel.findUnique({where:{id:raw[1]},include:{credential:true,owner:{include:USER_INCLUDE}}});
      const settings=await this.platform.settings(tx);
      if(!channel||!mayPublish(channel.owner,channel,settings))throw new ForbiddenException('Publishing is not allowed.');
      if(protocol==='rtmp'){
        const key=query.get('key')||password;
        if(!key||key.length>200||!channel.credential||!safeEqual(hashSecret(key),channel.credential.lookupHash))throw new ForbiddenException();
      }else{
        if(!settings.browserPublishingEnabled)throw new ForbiddenException();
        try{const {payload}=await jwtVerify(input.token||'',this.signingKey,{issuer:'nova-media',audience:'publish',algorithms:['HS256']});if(payload.channelId!==channel.id||payload.generation!==channel.credential?.generation)throw new Error();}catch{throw new ForbiddenException();}
      }
      const current=await tx.streamSession.findFirst({where:{channelId:channel.id,endedAt:null}});
      if(current){if(current.publisherId===id&&current.protocol===protocol)return {};throw new ConflictException('This channel already has a publisher.');}
      const session=await tx.streamSession.create({data:{channelId:channel.id,publisherId:id,protocol,title:channel.title}});
      await tx.channel.update({where:{id:channel.id},data:{state:'starting'}});
      await this.platform.audit(tx,channel.ownerId,'stream.start_requested',session.id,{channelId:channel.id,protocol});return {};
    });
  }
  async stop(user:any,channelId:string,administrator=false){
    if(!administrator&&(!user.channel||user.channel.id!==channelId))throw new ForbiddenException();
    this.platform.require(user,administrator?'streams.stop_any':'streams.stop_own');
    const sessions=await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media:${channelId}`}))`;
      const channel=await tx.channel.findUnique({where:{id:channelId}});if(!channel)throw new NotFoundException();
      const active=await tx.streamSession.findMany({where:{channelId,endedAt:null}});const secret=randomBytes(32).toString('base64url');
      await tx.streamCredential.update({where:{channelId},data:{generation:{increment:1},lookupHash:hashSecret(secret),encryptedSecret:encryptSecret(secret)}});
      await tx.streamSession.updateMany({where:{channelId,endedAt:null},data:{endedAt:new Date(),status:'ended',endReason:'stopped'}});
      await tx.channel.update({where:{id:channelId},data:{state:'offline'}});await this.platform.audit(tx,user.id,'stream.stopped',channelId,{sessions:active.map(s=>s.id),credentialRotated:true});return active;
    });
    // Durable revocation precedes disconnection. Reconciliation retries kicks after any outage.
    await Promise.allSettled(sessions.map(s=>this.kick({type:s.protocol==='rtmp'?'rtmpConn':'webRTCSession',id:s.publisherId})));
    await this.reconcile();return {state:'offline',credentialRotated:true};
  }
  async rotate(user:any,identity:any){await this.platform.revealKey(user,identity);await this.stop({...user,memberships:user.memberships},user.channel.id);return {rotated:true};}
  async browserOffer(user:any,offer:string){
    if(!user.channel)throw new ForbiddenException();const settings=await this.platform.settings();if(!mayPublish(user,user.channel,settings)||!settings.browserPublishingEnabled)throw new ForbiddenException('Browser publishing is disabled.');
    if(await this.db.streamSession.count({where:{channelId:user.channel.id,endedAt:null}}))throw new ConflictException('Stop the current broadcast first.');
    const key=await this.db.streamCredential.findUniqueOrThrow({where:{channelId:user.channel.id}});
    const token=await new SignJWT({channelId:user.channel.id,generation:key.generation}).setProtectedHeader({alg:'HS256'}).setIssuer('nova-media').setAudience('publish').setIssuedAt().setExpirationTime('30s').sign(this.signingKey);
    let r:Response;try{r=await fetch(`http://mediamtx:8889/ingest/${user.channel.id}/whip`,{method:'POST',headers:{'Content-Type':'application/sdp',Authorization:`Bearer ${token}`},body:offer,signal:AbortSignal.timeout(20000)});}catch{throw new ServiceUnavailableException('The browser media handshake failed. Try again.');}
    if(!r.ok)throw new BadRequestException('The media server could not accept this broadcast. Stop other publishers and try again.');
    return {answer:await r.text()};
  }
  async viewAccess(channelId:string,identity?:any){
    const [settings,channel]=await Promise.all([this.platform.settings(),this.db.channel.findUnique({where:{id:channelId},include:{owner:{select:{status:true}}}})]);
    if(!channel||channel.accessState!=='ready'||channel.owner.status!=='active')throw new NotFoundException('Channel unavailable.');
    if(settings.maintenanceEnabled)throw new ServiceUnavailableException('The platform is in maintenance mode.');
    let viewerId:string|null=null;if(identity){const user=await this.platform.actor(identity);this.platform.require(user,'streams.view');viewerId=user.id;}else if(!settings.guestViewingEnabled)throw new UnauthorizedException('Sign in to watch this channel.');
    return {channel,viewerId};
  }
  async playbackTicket(channelId:string,identity?:any){const {viewerId}=await this.viewAccess(channelId,identity);
    return new SignJWT({channelId,viewerId,...(identity?{authIat:identity.iat,authTime:identity.auth_time,sid:identitySession(identity)}:{})}).setProtectedHeader({alg:'HS256'}).setIssuer('nova-media').setAudience('playback').setIssuedAt().setExpirationTime('5m').sign(this.signingKey);
  }
  async thumbnail(channelId:string,identity?:any){
    const {channel}=await this.viewAccess(channelId,identity);if(channel.state!=='live')throw new NotFoundException('Live preview unavailable.');
    const session=await this.db.streamSession.findFirst({where:{channelId,endedAt:null,status:'live'}});
    if(!session||!await hlsReady(session.id))throw new NotFoundException('Live preview unavailable.');
    const image=await readThumbnail(session.id);if(!image)throw new NotFoundException('Live preview unavailable.');return image;
  }
  private async playbackAccess(channelId:string,req:any){
    const cookie=String(req.headers.cookie||'').split(';').map((v:string)=>v.trim()).find((v:string)=>v.startsWith('nova_play='))?.slice(10);
    let payload:any;try{payload=(await jwtVerify(cookie||'',this.signingKey,{issuer:'nova-media',audience:'playback',algorithms:['HS256']})).payload;if(payload.channelId!==channelId)throw new Error();}catch{throw new UnauthorizedException('Playback access expired.');}
    const session=await readPlaybackPolicy(this.db,channelId,payload);return {...payload,session};
  }
  async gatewayAccess(req:any){
    const {channelId,file}=forwardedMediaPath(req.headers['x-forwarded-uri'],req.headers['x-forwarded-method']);
    const {session}=await this.playbackAccess(channelId,req);
    const verified=req.headers['x-forwarded-method']==='GET'&&file.endsWith('.m4s')&&this.audience.needsDelivery(req,session.id);
    return {path:`/${session.id}/${file}`,mode:verified?'verified':'direct'};
  }
  private readonly diagnosticLimits=new Map<string,{at:number,count:number}>();
  async playbackDiagnostic(channelId:string,req:any,report:any){
    const viewer=await this.playbackAccess(channelId,req),key=`${channelId}:${viewer.viewerId||'guest'}`,now=Date.now();
    let limit=this.diagnosticLimits.get(key);if(!limit||now-limit.at>60000){if(this.diagnosticLimits.size>=1000)this.diagnosticLimits.clear();limit={at:now,count:0};this.diagnosticLimits.set(key,limit);}
    if(++limit.count<=20)console.info(JSON.stringify({event:'viewer.player',channelId,...report}));
    return {received:true};
  }
  async viewerHeartbeat(channelId:string,req:any,identity:any,input:{leaseId:string;position:number}){
    const payload=await this.playbackAccess(channelId,req),actor=identity?await this.platform.actor(identity):null;
    if((payload.viewerId||null)!==(actor?.id||null))throw new UnauthorizedException('Reload the player after signing in or out.');
    return this.audience.beat(req,payload.session,payload.viewerId||null,input);
  }
  async playback(channelId:string,file:string,req:any,res:any){
    if(!/^[a-zA-Z0-9_.-]{1,160}\.(m3u8|mp4|m4s|ts)$/.test(file)||file.includes('..'))throw new NotFoundException();
    const {session}=await this.playbackAccess(channelId,req);
    if(file.endsWith('.m4s')||file.endsWith('.ts'))res.once('finish',()=>{if(res.statusCode===200)this.audience.delivered(req,session.id);});
    const abort=new AbortController();const onClose=()=>abort.abort();res.on('close',onClose);
    try{
      const directory=join(hlsRoot(),session.id);
      if(await stat(join(directory,'index.m3u8')).catch(()=>null)){
        if(!isHlsFile(file)){res.status(404).end();return;}
        const path=join(directory,file);
        res.setHeader('Cache-Control','private, no-store');
        if(file.endsWith('.m3u8')){
          const playlist=await readFile(path).catch(()=>null);if(!playlist){res.status(404).end();return;}
          res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(playlist);return;
        }
        const info=await stat(path).catch(()=>null);
        if(!info?.isFile()){res.status(404).end();return;}
        res.setHeader('Content-Type',file.endsWith('.mp4')?'video/mp4':'video/iso.segment');
        res.setHeader('Content-Length',info.size);res.setHeader('Cache-Control','private, no-store');
        await pipeline(createReadStream(path),res,{signal:abort.signal});return;
      }
      // Allows an existing single-quality worker to continue during a rolling upgrade.
      const query=new URLSearchParams();for(const name of ['_HLS_msn','_HLS_part','_HLS_skip'])if(typeof req.query[name]==='string'&&req.query[name].length<30)query.set(name,req.query[name]);
      const upstream=await fetch(`http://mediamtx:8888/live/${channelId}/${session.id}/${file}?${query}`,{headers:{Authorization:`Basic ${Buffer.from(`nova-system:${process.env.MEDIA_SERVICE_SECRET}`).toString('base64')}`},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
      if(!upstream.ok||!upstream.body){res.status(upstream.status).end();return;}
      res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/octet-stream');res.setHeader('Cache-Control','private, no-store');
      await pipeline(Readable.fromWeb(upstream.body as any),res);
    }catch{if(!res.headersSent&&!res.destroyed)res.status(503).end();}finally{res.off('close',onClose);}
  }
  async kick(source:any){const paths:Record<string,string>={rtmpConn:'rtmpconns',rtspSession:'rtspsessions',webRTCSession:'webrtcsessions'};if(source&&paths[source.type])await this.control(`${paths[source.type]}/kick/${encodeURIComponent(source.id)}`,'POST');}
  onModuleInit(){this.timer=setInterval(()=>{this.reconcile().catch(()=>console.error('Media reconciliation failed.'));},2000);}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async reconcile(){
    if(this.syncing)return;this.syncing=true;
    try{
      let paths:any[];try{paths=await this.paths();this.failedSince=0;}catch{this.failedSince||=Date.now();if(Date.now()-this.failedSince>15000){await this.db.channel.updateMany({where:{state:{in:['starting','live']}},data:{state:'offline'}});await this.db.streamSession.updateMany({where:{endedAt:null},data:{status:'error',endedAt:new Date(),endReason:'media_unavailable'}});}return;}
      const settings=await this.platform.settings();const sessions=await this.db.streamSession.findMany({where:{endedAt:null},include:{channel:{include:{owner:{include:USER_INCLUDE}}}}});
      for(const session of sessions){
        const raw=paths.find(p=>p.name===`ingest/${session.channelId}`&&p.ready&&p.source?.id===session.publisherId);
        const out=paths.some(p=>p.name===`live/${session.channelId}/${session.id}`&&p.ready)||await hlsReady(session.id);
        const eligible=mayPublish(session.channel.owner,session.channel,settings)&&(session.protocol!=='webrtc'||settings.browserPublishingEnabled);
        let endReason:string|undefined;if(!eligible)endReason='access_revoked';else if(!raw&&session.lastSeenAt&&Date.now()-session.lastSeenAt.getTime()>4000)endReason='publisher_disconnected';else if(!raw&&!session.lastSeenAt&&Date.now()-session.createdAt.getTime()>30000)endReason='publisher_timeout';else if(!out&&Date.now()-(session.lastOutputAt||session.createdAt).getTime()>45000)endReason='transcode_timeout';
        await this.db.$transaction(async tx=>{
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media:${session.channelId}`}))`;
          const current=await tx.streamSession.findFirst({where:{id:session.id,endedAt:null}});if(!current)return;
          if(endReason){await tx.streamSession.update({where:{id:session.id},data:{status:endReason.includes('timeout')?'error':'ended',endedAt:new Date(),endReason}});await tx.channel.update({where:{id:session.channelId},data:{state:'offline'}});await this.platform.audit(tx,null,'stream.ended',session.id,{reason:endReason});}
          else{const state=raw&&out?'live':'starting';await tx.streamSession.update({where:{id:session.id},data:{status:state,...(raw?{lastSeenAt:new Date()}:{}),...(out?{lastOutputAt:new Date()}:{}),...(state==='live'&&!current.startedAt?{startedAt:new Date(),title:session.channel.title,analyticsStartedAt:new Date(),lastAnalyticsAt:new Date()}: {})}});await tx.channel.update({where:{id:session.channelId},data:{state}});if(state==='live'&&!current.startedAt)await tx.liveNotificationEvent.upsert({where:{sessionId:session.id},create:{sessionId:session.id,channelId:session.channelId,...(!settings.liveNotificationsEnabled?{processedAt:new Date()}:{})},update:{}});}
        });
      }
      // This also cleans orphaned publishers after an API restart, stop or revoked access.
      const active=await this.db.streamSession.findMany({where:{endedAt:null}});
      for(const path of paths.filter(p=>p.ready)){
        const raw=ingestPattern.exec(path.name),out=outputPattern.exec(path.name);
        if(raw&&!active.some(s=>s.channelId===raw[1]&&s.publisherId===path.source?.id)||out&&!active.some(s=>s.channelId===out[1]&&s.id===out[2]))await this.kick(path.source);
      }
    }finally{this.syncing=false;}
  }
  async health(user:any){
    this.platform.require(user,'channel.manage_own');if(!user.channel)throw new NotFoundException('This account does not have a creator channel.');
    const session=await this.db.streamSession.findFirst({where:{channelId:user.channel.id},orderBy:{createdAt:'desc'}});
    const sessionInfo=session?{protocol:session.protocol,startedAt:(session.startedAt||session.createdAt).toISOString(),endedAt:session.endedAt?.toISOString()||null,endReason:session.endReason}:null;
    const audience=this.audience.stats(session,user.channel.state==='live',true);
    if(!session||session.endedAt)return {channelState:user.channel.state,session:sessionInfo,audience,monitor:'offline',checkedAt:null,report:null};
    return {channelState:user.channel.state,session:sessionInfo,audience,...await readStreamHealth(session.id,user.channel.id)};
  }
  async jobs(){const paths=await this.paths();const sessions=await this.db.streamSession.findMany({where:{endedAt:null}});return sessions.flatMap(s=>{const path=paths.find(p=>p.name===`ingest/${s.channelId}`&&p.ready&&p.source?.id===s.publisherId);return path?[{id:s.id,channelId:s.channelId,receivedBytes:Number.isSafeInteger(path.bytesReceived)?path.bytesReceived:0}]:[];});}
  async sessions(user:any){this.platform.require(user,'streams.stop_any');return this.db.streamSession.findMany({include:{channel:{select:{slug:true,title:true}}},orderBy:{createdAt:'desc'},take:100});}
}
