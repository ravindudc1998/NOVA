import {readFileSync,existsSync} from 'node:fs';
const secret=name=>readFileSync(`/run/secrets/${name}`,'utf8').trim();
if(existsSync('/run/secrets/app_db_password'))process.env.DATABASE_URL=`postgresql://nova:${encodeURIComponent(secret('app_db_password'))}@postgres:5432/nova`;
if(existsSync('/run/secrets/credential_key'))process.env.CREDENTIAL_ENCRYPTION_KEY=secret('credential_key');
if(existsSync('/run/secrets/media_secret'))process.env.MEDIA_SERVICE_SECRET=secret('media_secret');

if(existsSync('/run/secrets/identity_service_secret'))process.env.IDENTITY_SERVICE_SECRET=secret('identity_service_secret');
