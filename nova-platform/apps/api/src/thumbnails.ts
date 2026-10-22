import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';

export async function readThumbnail(sessionId:string,root=process.env.NOVA_HEALTH_ROOT||'/var/lib/nova-health',now=Date.now()){
 try{
  z.string().uuid().parse(sessionId);const path=join(root,sessionId+'.jpg'),info=await stat(path);
  if(!info.isFile()||info.size<4||info.size>524288||now-info.mtimeMs>45000||info.mtimeMs>now+5000)return null;
  const image=await readFile(path);
  if(image.length>524288||image[0]!==0xff||image[1]!==0xd8||image[2]!==0xff||image.at(-2)!==0xff||image.at(-1)!==0xd9)return null;
  return image;
 }catch{return null;}
}
