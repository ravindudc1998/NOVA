import {readFileSync,existsSync} from 'node:fs';
const secret=name=>readFileSync(`/run/secrets/${name}`,'utf8').trim();
if(existsSync('/run/secrets/app_db_password'))process.env.DATABASE_URL=`postgresql://nova:${encodeURIComponent(secret('app_db_password'))}@postgres:5432/nova`;
if(existsSync('/run/secrets/credential_key'))process.env.CREDENTIAL_ENCRYPTION_KEY=secret('credential_key');
if(existsSync('/run/secrets/media_secret'))process.env.MEDIA_SERVICE_SECRET=secret('media_secret');

if(existsSync('/run/secrets/identity_service_secret'))process.env.IDENTITY_SERVICE_SECRET=secret('identity_service_secret');

if(existsSync('/run/secrets/restream_service_secret'))process.env.RESTREAM_SERVICE_SECRET=secret('restream_service_secret');
if(existsSync('/run/secrets/chat_archive_db_password'))process.env.CHAT_ARCHIVE_DATABASE_URL=`postgresql://nova_chat_archive:${encodeURIComponent(secret('chat_archive_db_password'))}@postgres:5432/nova_chat_archive`;
