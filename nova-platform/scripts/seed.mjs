import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PERMISSIONS,GROUPS,DEFAULT_SETTINGS} from '../apps/api/dist/policy.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
try{
  await db.$transaction(async tx=>{
    for(const [code,description] of Object.entries(PERMISSIONS))await tx.permission.upsert({where:{code},create:{code,description},update:{description}});
    for(const g of GROUPS){const existing=await tx.group.findUnique({where:{key:g.key}});if(existing)continue;const group=await tx.group.create({data:{key:g.key,name:g.name,protected:g.protected}});await tx.groupPermission.createMany({data:g.permissions.map(permissionCode=>({groupId:group.id,permissionCode}))});}
    for(const [key,value] of Object.entries(DEFAULT_SETTINGS))await tx.setting.upsert({where:{key},create:{key,value},update:{}});
  });console.log('NOVA permission catalog, groups and defaults are ready.');
}finally{await db.$disconnect();}
