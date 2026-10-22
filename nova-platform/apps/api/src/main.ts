import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {ApplicationModule,ErrorFilter} from './controllers.js';
const app=await NestFactory.create(ApplicationModule,{logger:['error','warn','log'],bodyParser:true});
app.setGlobalPrefix('');app.useGlobalFilters(new ErrorFilter());app.enableShutdownHooks();
app.use((req:any,res:any,next:any)=>{
 res.setHeader('X-Content-Type-Options','nosniff');if(req.headers.authorization||req.url.startsWith('/api/v1/me')||req.url.startsWith('/api/v1/admin'))res.setHeader('Cache-Control','no-store');
 const path=req.path||req.url.split('?')[0],ticket=/^\/api\/v1\/channels\/([a-f0-9-]{36})\/playback$/.exec(path),play=/^\/api\/v1\/play\/([a-f0-9-]{36})\/([a-zA-Z0-9_.-]+)$/.exec(path);
 if(ticket||play){
  const start=Date.now();res.once('finish',()=>{
   // Log access results, never authorization headers, cookies, query strings or stream keys.
   if(ticket||play?.[2].endsWith('.m3u8')||res.statusCode>=400)console.info(JSON.stringify({event:'viewer.playback',channelId:(ticket||play)![1],resource:ticket?'ticket':play![2].endsWith('.m3u8')?'playlist':'segment',status:res.statusCode,hasIdentity:Boolean(req.headers.authorization),hasPlaybackCookie:/(?:^|;\s*)nova_play=/.test(req.headers.cookie||''),durationMs:Date.now()-start}));
  });
 }
 next();
});
await app.listen(Number(process.env.PORT||3000),'0.0.0.0');
