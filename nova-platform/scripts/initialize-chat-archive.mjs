import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
const password=readFileSync('/run/secrets/chat_archive_db_password','utf8').trim();
if(!/^[A-Za-z0-9_-]{32,100}$/.test(password))throw Error('Invalid archive database credential.');
const admin=new Pool({host:'postgres',user:'postgres',database:'postgres',password:readFileSync('/run/secrets/postgres_password','utf8').trim(),max:1,connectionTimeoutMillis:5000});
try{
 if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='nova_chat_archive'")).rowCount)await admin.query(`CREATE ROLE nova_chat_archive LOGIN PASSWORD '${password}'`);
 if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='nova_chat_archive'")).rowCount)await admin.query('CREATE DATABASE nova_chat_archive OWNER nova_chat_archive');
 await admin.query('REVOKE CONNECT ON DATABASE nova_chat_archive FROM PUBLIC');
 const archive=new Pool({host:'postgres',user:'nova_chat_archive',database:'nova_chat_archive',password,max:1,connectionTimeoutMillis:5000});
 try{await archive.query(`
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  CREATE TABLE IF NOT EXISTS broadcasts (
   id uuid PRIMARY KEY, channel_id uuid NOT NULL, room_id uuid NOT NULL, slug text NOT NULL, title text NOT NULL,
   epoch integer NOT NULL, ended_at timestamptz NOT NULL, completed_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS broadcasts_channel_ended_idx ON broadcasts(channel_id,ended_at);
  CREATE TABLE IF NOT EXISTS messages (
   broadcast_id uuid NOT NULL REFERENCES broadcasts(id), message_id integer NOT NULL, author_id uuid,
   client_message_id uuid NOT NULL, display_name text NOT NULL, body text NOT NULL, deleted boolean NOT NULL,
   created_at timestamptz NOT NULL, PRIMARY KEY(broadcast_id,message_id)
  );
 `);console.log('Chat archive database initialized; existing credentials and messages preserved.');}finally{await archive.end();}
}finally{await admin.end();}
