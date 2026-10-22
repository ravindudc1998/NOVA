import {UnauthorizedException} from '@nestjs/common';
export function identitySession(identity:any):string|null{return typeof identity?.sid==='string'?identity.sid:typeof identity?.session_state==='string'?identity.session_state:null;}
export function assertSessionClaims(user:any,identity:any){
 const sessionId=identitySession(identity),cutoff=user.authNotBefore||0,authenticatedAt=Number.isFinite(identity.auth_time)?identity.auth_time:identity.iat;
 if(cutoff&&(!Number.isFinite(authenticatedAt)||authenticatedAt<=cutoff)&&(!sessionId||sessionId!==user.authAllowedSessionId))throw new UnauthorizedException('Your session ended. Sign in again.');
}
export async function assertSession(db:any,user:any,identity:any){
 assertSessionClaims(user,identity);const sessionId=identitySession(identity);
 if(sessionId&&await db.revokedSession.findFirst({where:{userId:user.id,sessionId,expiresAt:{gt:new Date()}}}))throw new UnauthorizedException('Your session ended. Sign in again.');
}
