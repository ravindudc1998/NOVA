import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hlsArguments,selectRenditions,sourceInfo} from '../scripts/quality-ladder.mjs';
import {hlsReady,isHlsFile} from '../apps/api/src/hls-files';
import {levelOptions,nativeQualityOptions} from '../apps/web/src/playback-quality';

test('A 4K source supplies six descending player choices; 720p never advertises higher qualities',()=>{
 const source=sourceInfo({streams:[{codec_type:'video',width:3840,height:2160},{codec_type:'audio'}]});
 const variants=selectRenditions(source);
 assert.deepEqual(levelOptions(variants).map(option=>option.label),['4K (2160p)','1440p','1080p','720p','480p','360p']);
 assert.deepEqual(selectRenditions({width:1280,height:720}).map(variant=>variant.height),[360,480,720]);
 assert.equal(new Set(variants.map(variant=>variant.id)).size,6);
});
test('Portrait, low-resolution and nonstandard sources keep their aspect and never upscale',()=>{
 for(const source of [{width:1080,height:1920},{width:320,height:180},{width:1600,height:900},{width:1920,height:800}]){
  const variants=selectRenditions(source);
  for(const variant of variants){assert.ok(variant.width<=source.width&&variant.height<=source.height);assert.ok(Math.abs(variant.width/variant.height-source.width/source.height)<0.02);assert.equal(variant.width%2,0);assert.equal(variant.height%2,0);}
  assert.equal(new Set(variants.map(variant=>`${variant.width}x${variant.height}`)).size,variants.length);
 }
 assert.equal(selectRenditions({width:3840,height:2160},1080).at(-1)?.height,1080);
 assert.throws(()=>sourceInfo({streams:[{codec_type:'audio'}]}));
});
test('Native HLS choices accept only local rendition filenames, retaining actual resolution',()=>{
 const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360\nq360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=25000000,RESOLUTION=3840x2160\nq2160.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nhttps://untrusted.example/steal.m3u8';
 assert.deepEqual(nativeQualityOptions(master).map(option=>[option.value,option.label]),[['q2160.m3u8','4K (2160p)'],['q360.m3u8','360p']]);
});
test('Video-only publishing omits audio mappings and every rendition uses aligned two-second keyframes',()=>{
 const source={width:1280,height:720,audio:false},variants=selectRenditions(source),args=hlsArguments('rtsp://example/ingest','/tmp/hls',source,variants);
 assert.equal(args.some(value=>value==='0:a:0'),false);
 assert.equal(args.filter(value=>value==='expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+2-0.000001))').length,variants.length);
 assert.match(args[args.indexOf('-var_stream_map')+1],/^v:0,name:q360 v:1,name:q480 v:2,name:q720$/);
 assert.ok(args.includes('delete_segments+independent_segments+temp_file+omit_endlist'));
});
test('A single quality uses a concrete init filename rather than the unexpanded FFmpeg variant token',()=>{
 const source={width:320,height:180,audio:true,copySafe:true},variants=selectRenditions(source),args=hlsArguments('rtsp://example','/tmp/hls',source,variants);
 assert.equal(variants.length,1);assert.equal(args[args.indexOf('-hls_fmp4_init_filename')+1],'init-q180.mp4');
});

test('Only H.264/30fps with observed two-second keyframes can preserve the source rendition',()=>{
 const probe={streams:[{index:0,codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:3840,height:2160,r_frame_rate:'30/1'}],packets:[0,2,4].map(pts=>({stream_index:0,pts_time:String(pts),flags:'K_',size:'100000'}))};
 const source=sourceInfo(probe),variants=selectRenditions(source),args=hlsArguments('rtsp://example','/tmp/hls',source,variants);
 assert.equal(source.copySafe,true);assert.equal(args[args.indexOf('-c:v:5')+1],'copy');assert.equal(args.filter(value=>value==='expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+2-0.000001))').length,5);
 assert.equal(sourceInfo({...probe,packets:probe.packets.slice(0,2)}).copySafe,false);
 assert.equal(sourceInfo({...probe,packets:probe.packets.map((packet,index)=>({...packet,pts_time:String(index*3)}))}).copySafe,false);
 assert.equal(sourceInfo({...probe,streams:[{...probe.streams[0],codec_name:'vp8'}]}).copySafe,false);
 assert.equal(sourceInfo({...probe,streams:[{...probe.streams[0],r_frame_rate:'60/1'}]}).copySafe,false);
 assert.equal(sourceInfo({...probe,packets:probe.packets.map((packet,index)=>({...packet,pts_time:String(1.567+index*2)}))}).copySafe,true);
 const capped=hlsArguments('rtsp://example','/tmp/hls',source,selectRenditions(source,1080));assert.equal(capped.includes('copy'),false);
});
test('Only expected HLS assets are permitted; readiness needs fresh segments for every advertised quality',async()=>{
 for(const file of ['../index.m3u8','/index.m3u8','q360.m3u8.tmp','settings.json','secret.mp4','q360.m3u8/../index.m3u8'])assert.equal(isHlsFile(file),false,file);
 for(const file of ['index.m3u8','q2160.m3u8','init-q2160.mp4','seg-q2160-1792578200123456.m4s'])assert.equal(isHlsFile(file),true,file);
 const root=await mkdtemp(join(tmpdir(),'nova-hls-test-')),session='a-session',directory=join(root,session);
 try{
  await mkdir(directory);await writeFile(join(directory,'index.m3u8'),'#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\nq360.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nq720.m3u8');
  for(const quality of [360,720])await writeFile(join(directory,`q${quality}.m3u8`),`#EXTM3U\n#EXTINF:2.0,\nseg-q${quality}-1.m4s\n`);
  assert.equal(await hlsReady(session,root),false);
  for(const quality of [360,720])await writeFile(join(directory,`seg-q${quality}-1.m4s`),'test-segment');
  assert.equal(await hlsReady(session,root),true);
  const stale=new Date(Date.now()-20000);await utimes(join(directory,'q720.m3u8'),stale,stale);assert.equal(await hlsReady(session,root),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
