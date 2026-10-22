// Offline synthetic 4K encoding/packaging check; never touches a real channel.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hlsArguments,selectRenditions} from './quality-ladder.mjs';
function command(binary,args,timeout=120000){return new Promise((resolve,reject)=>{
 const child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr=(stderr+data).slice(-4000));
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`${binary} timed out.`));},timeout);
 child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);if(code)reject(new Error(`${binary} exited ${code}: ${stderr}`));else resolve(stdout);});
});}
const directory=await mkdtemp(join(tmpdir(),'nova-quality-')),source={width:3840,height:2160,audio:false},variants=selectRenditions(source);
try{
 const common=hlsArguments('synthetic',directory,source,variants,{preset:process.env.NOVA_VIDEO_PRESET||'veryfast'}),outputArgs=common.slice(common.indexOf('-filter_complex_threads'));
 const started=Date.now();await command('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=3840x2160:rate=30','-t','12',...outputArgs]);
 const elapsed=(Date.now()-started)/1000,master=await readFile(join(directory,'index.m3u8'),'utf8');
 assert.equal((master.match(/#EXT-X-STREAM-INF/g)||[]).length,6);assert.match(master,/RESOLUTION=3840x2160/);
 for(const variant of variants){
  const playlist=await readFile(join(directory,variant.id+'.m3u8'),'utf8');assert.match(playlist,/#EXT-X-INDEPENDENT-SEGMENTS/);assert.ok((playlist.match(/#EXTINF:2\.000000/g)||[]).length>=5);
  const streams=JSON.parse(await command('ffprobe',['-v','error','-read_intervals','%+1','-show_entries','stream=codec_name,width,height','-of','json',join(directory,variant.id+'.m3u8')],20000)).streams;
  assert.ok(streams.some(stream=>stream.codec_name==='h264'&&stream.width===variant.width&&stream.height===variant.height));
  // The decoder must produce actual frames, not merely recognize the headers.
  await command('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-xerror','-i',join(directory,variant.id+'.m3u8'),'-t','0.2','-f','null','-'],20000);
 }
 console.log(JSON.stringify({check:'Six-rendition 4K HLS encoding and decoding',passed:true,sourceSeconds:12,encodingSeconds:elapsed,encodingSpeed:Number((12/elapsed).toFixed(2)),qualities:variants.map(({width,height})=>({width,height}))}));
}finally{await rm(directory,{recursive:true,force:true});}
