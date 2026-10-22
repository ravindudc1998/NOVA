import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const hashSecret=(value:string)=>createHash('sha256').update(value).digest('hex');
function encryptionKey(){const value=process.env.CREDENTIAL_ENCRYPTION_KEY||'';if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain 32 random bytes in hex');return Buffer.from(value,'hex');}
export function encryptSecret(secret:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const payload=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),payload].map(b=>b.toString('base64url')).join('.');}
export function decryptSecret(value:string){const [iv,tag,payload]=value.split('.').map(b=>Buffer.from(b,'base64url'));const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(payload),decipher.final()]).toString('utf8');}
export function safeEqual(a:string,b:string){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
