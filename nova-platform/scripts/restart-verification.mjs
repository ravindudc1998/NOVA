// Prepare/verify a small private fixture around a full no-pull Compose restart.
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PlatformService} from '../apps/api/dist/platform.service.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const service=new PlatformService(db),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
 if(process.argv[2]==='prepare'){
  const username=`restart_${Date.now().toString(36)}`,sub=`test-restart-${randomUUID()}`;
  const user=await service.bootstrap({sub,preferred_username:username},{accountType:'creator'});
  const room=await db.chatRoom.findUniqueOrThrow({where:{channelId:user.channel.id}});
  const message=await db.chatMessage.create({data:{roomId:room.id,authorId:user.id,clientMessageId:randomUUID(),displayName:user.displayName,text:'Persistent restart verification message'}});
  const session=await db.streamSession.create({data:{channelId:user.channel.id,publisherId:randomUUID(),protocol:'rtmp',status:'ended',endedAt:new Date(),endReason:'restart_fixture'}});
  const credential=await db.streamCredential.findUniqueOrThrow({where:{channelId:user.channel.id}});
  const settings=await db.setting.findMany({orderBy:{key:'asc'}});
  console.log(JSON.stringify({userId:user.id,channelId:user.channel.id,roomId:room.id,messageId:message.id,sessionId:session.id,credentialDigest:digest(credential),settingsDigest:digest(settings)}));
 }else if(process.argv[2]==='verify'){
  const snapshot=JSON.parse(readFileSync(0,'utf8'));
  assert.ok(await db.user.findUnique({where:{id:snapshot.userId}}));
  assert.ok(await db.channel.findUnique({where:{id:snapshot.channelId}}));
  assert.equal((await db.chatMessage.findUniqueOrThrow({where:{id:snapshot.messageId}})).text,'Persistent restart verification message');
  assert.equal((await db.streamSession.findUniqueOrThrow({where:{id:snapshot.sessionId}})).endReason,'restart_fixture');
  assert.equal(digest(await db.streamCredential.findUniqueOrThrow({where:{channelId:snapshot.channelId}})),snapshot.credentialDigest);
  assert.equal(digest(await db.setting.findMany({orderBy:{key:'asc'}})),snapshot.settingsDigest);
  await db.channel.delete({where:{id:snapshot.channelId}});await db.user.delete({where:{id:snapshot.userId}});
  console.log('PASS Full no-pull restart preserves account, channel, encrypted credential, chat, session history and platform settings. Restart fixture removed.');
 }else throw new Error('Use prepare or verify.');
}finally{await db.$disconnect();}
