import {Pool} from 'pg';
import {pathToFileURL} from 'node:url';
// Archive commit precedes hot-message deletion. Duplicate delivery after a crash
// is safe because archive rows use (broadcast_id,message_id) as their key.
export async function archiveNext(main,archive,batchId=null){
 const client=await main.connect();let count=0;
 try{
  await client.query('BEGIN');
  const job=(await client.query('SELECT * FROM "ChatArchiveBatch" WHERE "completedAt" IS NULL AND ($1::uuid IS NULL OR id=$1) ORDER BY "endedAt" LIMIT 1 FOR UPDATE SKIP LOCKED',[batchId])).rows[0];
  if(!job){await client.query('COMMIT');return false;}
  const rows=(await client.query('SELECT * FROM "ChatMessage" WHERE "roomId"=$1 AND epoch=$2 ORDER BY id LIMIT 500',[job.roomId,job.epoch])).rows;
  const target=await archive.connect();
  try{
   await target.query('BEGIN');
   await target.query('INSERT INTO broadcasts (id,channel_id,room_id,slug,title,epoch,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[job.id,job.channelId,job.roomId,job.slug,job.title,job.epoch,job.endedAt]);
   if(rows.length)await target.query(`INSERT INTO messages(broadcast_id,message_id,author_id,client_message_id,display_name,body,deleted,created_at)
    SELECT $1,r.id,r."authorId",r."clientMessageId",r."displayName",r.text,r.deleted,r."createdAt"
    FROM jsonb_to_recordset($2::jsonb) AS r(id integer,"authorId" uuid,"clientMessageId" uuid,"displayName" text,text text,deleted boolean,"createdAt" timestamptz)
    ON CONFLICT(broadcast_id,message_id) DO NOTHING`,[job.id,JSON.stringify(rows)]);
   if(rows.length<500)await target.query('UPDATE broadcasts SET completed_at=COALESCE(completed_at,now()) WHERE id=$1',[job.id]);
   await target.query('COMMIT');
  }catch(error){await target.query('ROLLBACK');throw error;}finally{target.release();}
  if(rows.length)await client.query('DELETE FROM "ChatMessage" WHERE id=ANY($1::int[]) AND "roomId"=$2 AND epoch=$3',[rows.map(row=>row.id),job.roomId,job.epoch]);
  if(rows.length<500)await client.query('UPDATE "ChatArchiveBatch" SET "completedAt"=now() WHERE id=$1',[job.id]);
  await client.query('COMMIT');count=rows.length;console.log(JSON.stringify({event:'chat.archived',broadcastId:job.id,messages:count,complete:rows.length<500}));return true;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.DATABASE_URL||!process.env.CHAT_ARCHIVE_DATABASE_URL)throw Error('Chat archive database connections are required.');
 const main=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000}),archive=new Pool({connectionString:process.env.CHAT_ARCHIVE_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
 for(const pool of [main,archive])pool.on('error',()=>console.error('Chat archive database unavailable; pending messages are retained.'));
 let closing=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{closing=true;});
 try{while(!closing){try{if(await archiveNext(main,archive))continue;}catch{console.error('Chat archival delayed; pending messages are retained.');}await new Promise(resolve=>setTimeout(resolve,2000));}}finally{await Promise.all([main.end(),archive.end()]);}
}
