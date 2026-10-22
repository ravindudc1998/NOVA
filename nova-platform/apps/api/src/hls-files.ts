import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';

export const hlsRoot=()=>process.env.NOVA_HLS_ROOT||'/var/lib/nova-hls';
export const isHlsFile=(file:string)=>/^(?:index\.m3u8|q\d{1,4}\.m3u8|init-q\d{1,4}\.mp4|seg-q\d{1,4}-\d{1,20}\.m4s)$/.test(file);
export function variantFiles(master:string){return master.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^q\d{1,4}\.m3u8$/.test(line));}
export async function hlsReady(sessionId:string,root=hlsRoot(),now=Date.now()){
 try{
  const directory=join(root,sessionId),master=await readFile(join(directory,'index.m3u8'),'utf8'),variants=variantFiles(master);
  if(!master.startsWith('#EXTM3U')||!variants.length||variants.length>6)return false;
  const ready=await Promise.all(variants.map(async file=>{
   const path=join(directory,file),[playlist,info]=await Promise.all([readFile(path,'utf8'),stat(path)]);
   if(now-info.mtimeMs>15000||playlist.includes('#EXT-X-ENDLIST'))return false;
   const segment=playlist.split(/\r?\n/).filter(line=>/^seg-q\d{1,4}-\d{1,20}\.m4s$/.test(line)).at(-1);
   if(!segment)return false;
   return (await stat(join(directory,segment))).size>0;
  }));
  return ready.every(Boolean);
 }catch{return false;}
}
