import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

export function ingestRate(previous,bytes,now){
 if(!previous||bytes<previous.bytes||now<=previous.at)return null;
 return Math.round((bytes-previous.bytes)*8/(now-previous.at));
}
export function pcmLevels(pcm){
 let sum=0,peak=0;const samples=Math.floor(pcm.length/4);
 if(!samples)throw new Error('No decoded audio samples.');
 for(let offset=0;offset<samples*4;offset+=4){const value=pcm.readFloatLE(offset);if(!Number.isFinite(value))throw new Error('Invalid audio samples.');sum+=value*value;peak=Math.max(peak,Math.abs(value));}
 const db=value=>value>0?Math.max(-120,Math.min(12,Math.round(20*Math.log10(value)*10)/10)):null;
 return {peakDbfs:db(peak),rmsDbfs:db(Math.sqrt(sum/samples))};
}
export function audioReading(levels,previous,now){
 const quiet=levels.peakDbfs===null||levels.peakDbfs< -60;
 const continuous=previous?.sampledAt&&now-Date.parse(previous.sampledAt)<20000;
 const quietSince=quiet?(continuous&&previous.quietSince||new Date(now).toISOString()):null;
 return {...levels,state:quiet?(now-Date.parse(quietSince)>=20000?'silent':'quiet'):'active',sampledAt:new Date(now).toISOString(),quietSince};
}
export async function boundedFile(path,max=65536){
 const info=await stat(path);if(!info.isFile()||info.size>max)throw new Error('Invalid media file.');return readFile(path);
}
export async function outputSnapshot(directory,now=Date.now()){
 const master=(await boundedFile(join(directory,'index.m3u8'))).toString();
 const variants=[...master.matchAll(/#EXT-X-STREAM-INF:[^\r\n]*RESOLUTION=(\d+)x(\d+)[^\r\n]*\r?\n(q\d{1,4}\.m3u8)/g)].map(match=>({width:Number(match[1]),height:Number(match[2]),file:match[3]}));
 if(!master.startsWith('#EXTM3U')||!variants.length||variants.length>6||new Set(variants.map(v=>v.file)).size!==variants.length||variants.some(v=>v.width<2||v.height<2||v.width>8192||v.height>8192))throw new Error('No valid renditions.');
 const files=await Promise.all(variants.map(async variant=>{
  const path=join(directory,variant.file),playlist=(await boundedFile(path)).toString();
  const init=/#EXT-X-MAP:URI="(init-q\d{1,4}\.mp4)"/.exec(playlist)?.[1];
  const segment=playlist.split(/\r?\n/).filter(line=>/^seg-q\d{1,4}-\d{1,20}\.m4s$/.test(line)).at(-1);
  const quality=variant.file.slice(0,-5);if(!init||!segment||init!==`init-${quality}.mp4`||!segment.startsWith(`seg-${quality}-`)||playlist.includes('#EXT-X-ENDLIST'))throw new Error('Incomplete rendition.');
  const [playlistInfo,segmentInfo]=await Promise.all([stat(path),stat(join(directory,segment))]);
  return {...variant,init,segment,at:Math.min(playlistInfo.mtimeMs,segmentInfo.mtimeMs),fresh:now-playlistInfo.mtimeMs<15000&&now-segmentInfo.mtimeMs<15000&&segmentInfo.size>0};
 }));
 files.sort((a,b)=>a.width*a.height-b.width*b.height);
 return {ready:files.every(file=>file.fresh),at:Math.min(...files.map(file=>file.at)),files};
}
export async function segmentInput(directory,file){
 return Buffer.concat(await Promise.all([boundedFile(join(directory,file.init),1048576),boundedFile(join(directory,file.segment),67108864)]));
}
export function mediaCommand(binary,args,input){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{stdio:['pipe','pipe','ignore']}),chunks=[];let size=0;
  const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Media check timed out.'));},8000);
  child.stdin.on('error',()=>{});child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576){child.kill('SIGKILL');reject(new Error('Media check too large.'));}else chunks.push(chunk);});
  child.once('error',()=>{clearTimeout(timeout);reject(new Error('Media check unavailable.'));});
  child.once('close',code=>{clearTimeout(timeout);if(code!==0)reject(new Error('Media check failed.'));else resolve(Buffer.concat(chunks));});child.stdin.end(input);
 });
}
export async function sampleOutput(input){
 const probe=JSON.parse((await mediaCommand('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,r_frame_rate','-of','json','pipe:0'],input)).toString());
 const video=probe.streams?.find(stream=>stream.codec_type==='video'),hasAudio=probe.streams?.some(stream=>stream.codec_type==='audio');
 if(!video)throw new Error('No output video track.');
 const [numerator,denominator]=String(video.r_frame_rate).split('/').map(Number),rate=numerator/denominator;
 const result={codec:String(video.codec_name).slice(0,24),fps:Number.isFinite(rate)&&rate>0?Math.round(rate*100)/100:null,audio:null};
 if(hasAudio){
  // Keep both channels: downmixing anti-phase stereo could falsely report silence.
  const pcm=await mediaCommand('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-threads','1','-i','pipe:0','-map','0:a:0','-vn','-ac','2','-ar','16000','-t','2','-f','f32le','pipe:1'],input);
  result.audio=pcmLevels(pcm);
 }
 return result;
}

export async function thumbnailImage(input){
 const jpeg=await mediaCommand('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-threads','1','-filter_threads','1','-i','pipe:0','-map','0:v:0','-an','-frames:v','1','-vf','scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,setsar=1','-threads','1','-q:v','5','-vcodec','mjpeg','-f','image2pipe','pipe:1'],input);
 if(jpeg.length<4||jpeg.length>524288||jpeg[0]!==0xff||jpeg[1]!==0xd8||jpeg[2]!==0xff||jpeg.at(-2)!==0xff||jpeg.at(-1)!==0xd9)throw new Error('Invalid preview image.');
 return jpeg;
}
