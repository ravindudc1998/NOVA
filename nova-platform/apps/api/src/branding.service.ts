import {BadRequestException,ForbiddenException,HttpException,Injectable,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PlatformService} from './platform.service.js';
import {allowed} from './policy.js';
import {brandingLinks,normalizeBranding,type BrandingKind} from './branding.js';

@Injectable()
export class BrandingService {
 constructor(readonly platform:PlatformService){}
 private processing=0;
 async manage(user:any,channelId:string){
  if(!allowed(user,'channels.manage_any')&&!(user.channel?.id===channelId&&allowed(user,'channel.manage_own')))throw new ForbiddenException();
  const channel=await this.platform.db.channel.findUnique({where:{id:channelId}});if(!channel)throw new NotFoundException();return channel;
 }
 async metadata(user:any,channelId:string){await this.manage(user,channelId);return brandingLinks(channelId,await this.platform.db.channelAsset.findMany({where:{channelId},select:{kind:true,revision:true}}));}
 async put(user:any,channelId:string,kind:BrandingKind,file?:{buffer:Buffer}){
  await this.manage(user,channelId);
  if(!file)throw new BadRequestException('Choose an image to upload.');
  if(this.processing>=2)throw new HttpException('Images are being processed. Try again shortly.',429);
  this.processing++;
  try{
   const bytes=await normalizeBranding(file.buffer,kind),revision=createHash('sha256').update(bytes).digest('hex').slice(0,24);
   await this.platform.db.$transaction(async tx=>{
    await tx.channelAsset.upsert({where:{channelId_kind:{channelId,kind}},create:{channelId,kind,bytes,revision},update:{bytes,revision}});
    await this.platform.audit(tx,user.id,'channel.branding_uploaded',channelId,{kind,revision});
   });
   return {branding:await this.metadata(user,channelId)};
  }finally{this.processing--;}
 }
 async remove(user:any,channelId:string,kind:BrandingKind){await this.manage(user,channelId);await this.platform.db.$transaction(async tx=>{await tx.channelAsset.deleteMany({where:{channelId,kind}});await this.platform.audit(tx,user.id,'channel.branding_removed',channelId,{kind});});return {branding:await this.metadata(user,channelId)};}
 async read(channelId:string,kind:BrandingKind,res:any,user?:any){
  const channel=user?await this.manage(user,channelId):await this.platform.db.channel.findFirst({where:{id:channelId,accessState:'ready',owner:{status:'active'}},select:{id:true}});
  if(!channel)throw new NotFoundException();
  const asset=await this.platform.db.channelAsset.findUnique({where:{channelId_kind:{channelId,kind}}});if(!asset)throw new NotFoundException();
  res.setHeader('Content-Type','image/webp');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.send(Buffer.from(asset.bytes));
 }
}
