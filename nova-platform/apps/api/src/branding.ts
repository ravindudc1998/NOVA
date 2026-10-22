import {BadRequestException} from '@nestjs/common';
import sharp from 'sharp';

export const BRANDING_SIZES={avatar:{width:256,height:256},banner:{width:1600,height:400},offline:{width:1280,height:720}} as const;
export type BrandingKind=keyof typeof BRANDING_SIZES;
export function brandingLinks(channelId:string,assets:{kind:string;revision:string}[]=[]){return Object.fromEntries(assets.filter(asset=>Object.hasOwn(BRANDING_SIZES,asset.kind)).map(asset=>[asset.kind,`/api/v1/channels/${channelId}/branding/${asset.kind}?v=${asset.revision}`]));}
export async function normalizeBranding(input:Buffer,kind:BrandingKind){
 if(!input?.length||input.length>5*1024*1024)throw new BadRequestException('Choose a JPG, PNG or WebP image up to 5 MB.');
 const raster=input.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))||input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP');
 if(!raster)throw new BadRequestException('Only JPG, PNG and WebP images are supported.');
 try{
  const image=sharp(input,{limitInputPixels:20_000_000,failOn:'warning',animated:false});
  const metadata=await image.metadata();
  if(!metadata.width||!metadata.height||!['jpeg','png','webp'].includes(metadata.format||'')||(metadata.pages||1)>1)throw new Error();
  const bytes=await image.rotate().resize({...BRANDING_SIZES[kind],fit:'cover',position:'centre'}).webp({quality:85}).toBuffer();
  if(bytes.length>1024*1024)throw new Error();
  return bytes;
 }catch{throw new BadRequestException('This image could not be processed. Use a still JPG, PNG or WebP image under 20 megapixels.');}
}
