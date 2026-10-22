import {ForbiddenException,NotFoundException,ServiceUnavailableException,UnauthorizedException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {DEFAULT_SETTINGS} from './policy.js';
import {assertSessionClaims,identitySession} from './account-security.js';
import {isHlsFile} from './hls-files.js';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const mediaPath=new RegExp(`^/api/v1/play/(${uuid})/([a-zA-Z0-9_.-]{1,160})$`),idPattern=new RegExp(`^${uuid}$`);
export function forwardedMediaPath(uri:unknown,method:unknown){
 if(method!=='GET'&&method!=='HEAD')throw new NotFoundException();
 if(typeof uri!=='string'||uri.length>2048)throw new NotFoundException();
 const match=mediaPath.exec(uri.split('?')[0]);if(!match||!isHlsFile(match[2]))throw new NotFoundException();return {channelId:match[1],file:match[2]};
}
export function validatePlaybackPolicy(row:any,payload:any){
 if(!row||row.accessState!=='ready'||row.ownerStatus!=='active')throw new NotFoundException('Channel unavailable.');
 if(row.settings.maintenanceEnabled??DEFAULT_SETTINGS.maintenanceEnabled)throw new ServiceUnavailableException('The platform is in maintenance mode.');
 if(payload.viewerId){
  if(!row.viewerId)throw new UnauthorizedException();
  if(row.viewerStatus!=='active')throw new ForbiddenException('Your account is not active.');
  const identity={iat:payload.authIat??payload.iat,auth_time:payload.authTime,sid:identitySession(payload)};
  assertSessionClaims({authNotBefore:row.authNotBefore,authAllowedSessionId:row.authAllowedSessionId},identity);
  if(row.revoked)throw new UnauthorizedException('Your session ended. Sign in again.');
  if(!row.canView)throw new ForbiddenException('You do not have permission for this action.');
 }else if(!(row.settings.guestViewingEnabled??DEFAULT_SETTINGS.guestViewingEnabled))throw new UnauthorizedException('Sign in to watch this channel.');
 if(!row.sessionId)throw new NotFoundException('The channel is offline.');
 return {id:row.sessionId,channelId:row.channelId,peakViewers:row.peakViewers};
}
export async function readPlaybackPolicy(db:any,channelId:string,payload:any){
 const viewerId=payload.viewerId??null;if(viewerId!==null&&(typeof viewerId!=='string'||!idPattern.test(viewerId)))throw new UnauthorizedException();
 // One current MVCC snapshot; no cached permission or revocation decisions.
 const query=Prisma.sql`
  SELECT c.id AS "channelId",c."accessState",o.status AS "ownerStatus",
   s.id AS "sessionId",s."peakViewers",v.id AS "viewerId",v.status AS "viewerStatus",v."authNotBefore",v."authAllowedSessionId",
   COALESCE((SELECT jsonb_object_agg(key,value) FROM "Setting" WHERE key IN ('maintenanceEnabled','guestViewingEnabled')),'{}'::jsonb) AS settings,
   EXISTS(SELECT 1 FROM "Membership" m JOIN "GroupPermission" p ON p."groupId"=m."groupId" WHERE m."userId"=v.id AND p."permissionCode" IN ('streams.view','platform.admin')) AS "canView",
   EXISTS(SELECT 1 FROM "RevokedSession" r WHERE r."userId"=v.id AND r."sessionId"=${identitySession(payload)} AND r."expiresAt">CURRENT_TIMESTAMP) AS revoked
  FROM "Channel" c JOIN "User" o ON o.id=c."ownerId"
  LEFT JOIN "User" v ON v.id=${viewerId}::uuid
  LEFT JOIN LATERAL(SELECT id,"peakViewers" FROM "StreamSession" WHERE "channelId"=c.id AND "endedAt" IS NULL AND status='live' ORDER BY "createdAt" DESC LIMIT 1) s ON true
  WHERE c.id=${channelId}::uuid`;
 const rows=await (db.mediaQuery?db.mediaQuery(query):db.$queryRaw(query));
 return validatePlaybackPolicy(rows[0],payload);
}
