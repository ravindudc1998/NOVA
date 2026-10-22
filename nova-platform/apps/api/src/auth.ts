import {CanActivate,ExecutionContext,Injectable,UnauthorizedException} from '@nestjs/common';
import {createRemoteJWKSet,jwtVerify} from 'jose';
@Injectable()
export class IdentityGuard implements CanActivate {
  private readonly jwks=createRemoteJWKSet(new URL(process.env.IDENTITY_JWKS_URL||'http://localhost:8080/auth/realms/nova/protocol/openid-connect/certs'));
  async canActivate(context:ExecutionContext){
    return this.authenticate(context.switchToHttp().getRequest());
  }
  async authenticate(req:any){const header=String(req.headers.authorization||'');
    if(!header.startsWith('Bearer '))throw new UnauthorizedException('Sign in to continue.');
    try{const {payload}=await jwtVerify(header.slice(7),this.jwks,{issuer:process.env.IDENTITY_ISSUER,audience:'nova-api',algorithms:['RS256'],clockTolerance:5});
      if(!payload.sub)throw new Error('Missing subject');req.identity=payload;return true;
    }catch{throw new UnauthorizedException('Your session is invalid or has expired.');}
  }
}
@Injectable()
export class OptionalIdentityGuard implements CanActivate {
  constructor(private readonly identity:IdentityGuard){}
  canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest();return req.headers.authorization?this.identity.authenticate(req):true;}
}
