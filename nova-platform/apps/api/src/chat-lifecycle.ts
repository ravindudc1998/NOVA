// Called in the same transaction that ends a session. The shared send lock
// ensures every message belongs to exactly one visible chat generation.
export async function closeStreamChat(tx:any,session:any){
 const room=await tx.chatRoom.findUnique({where:{channelId:session.channelId}});if(!room)return null;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-room:${room.id}`}))`;
 const existing=await tx.chatArchiveBatch.findUnique({where:{id:session.id}});if(existing)return null;
 const current=await tx.chatRoom.findUniqueOrThrow({where:{id:room.id}}),channel=await tx.channel.findUniqueOrThrow({where:{id:session.channelId}});
 await tx.chatArchiveBatch.create({data:{id:session.id,roomId:room.id,channelId:session.channelId,slug:channel.slug,title:session.title||channel.title,epoch:current.epoch,endedAt:session.endedAt||new Date()}});
 const updated=await tx.chatRoom.update({where:{id:room.id},data:{epoch:{increment:1}}});
 return {channelId:session.channelId,epoch:updated.epoch};
}
