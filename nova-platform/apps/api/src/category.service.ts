import {BadRequestException,ConflictException,Injectable,NotFoundException} from '@nestjs/common';
import {PlatformService} from './platform.service.js';

@Injectable()
export class CategoryService {
 constructor(readonly platform:PlatformService){}
 async list(admin=false){
  const rows=await this.platform.db.category.findMany({where:admin?{}:{enabled:true},orderBy:{name:'asc'},include:{_count:{select:{channels:{where:{state:'live',accessState:'ready',owner:{status:'active'}}}}}}});
  return rows.map(({_count,...row})=>({...row,liveChannels:_count.channels}));
 }
 async save(user:any,id:string|undefined,input:{name:string;slug:string;description:string;enabled:boolean;version?:number}){
  this.platform.require(user,'categories.manage');
  return this.platform.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-platform-settings'))`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-categories'))`;
   const previous=id?await tx.category.findUnique({where:{id}}):null;
   if(id&&!previous)throw new NotFoundException('Category not found.');
   if(previous&&previous.version!==input.version)throw new ConflictException('This category changed. Reload before saving.');
   const duplicate=await tx.category.findFirst({where:{name:{equals:input.name,mode:'insensitive'},...(id?{id:{not:id}}:{})}});
   if(duplicate)throw new ConflictException('A category with that name already exists.');
   const settings=await this.platform.settings(tx);
   if(previous?.name===settings.defaultCategory&&!input.enabled)throw new BadRequestException('Choose another default category in Platform settings before archiving this category.');
   const fields={name:input.name,slug:input.slug,description:input.description,enabled:input.enabled};
   const category=previous?await tx.category.update({where:{id},data:{...fields,version:{increment:1}}}):await tx.category.create({data:fields});
   if(previous&&previous.name===settings.defaultCategory&&previous.name!==category.name){
    await tx.setting.upsert({where:{key:'defaultCategory'},create:{key:'defaultCategory',value:category.name},update:{value:category.name,version:{increment:1}}});
    await tx.setting.upsert({where:{key:'_revision'},create:{key:'_revision',value:settings._revision+1},update:{value:settings._revision+1}});
   }
   await this.platform.audit(tx,user.id,previous?'category.updated':'category.created',category.id,fields);
   return category;
  });
 }
}
