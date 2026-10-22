import type {KeycloakInitOptions} from 'keycloak-js';

export async function initializeIdentity(identity:{init(options:KeycloakInitOptions):Promise<boolean>},origin:string,timeoutMs=15000){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([
  identity.init({onLoad:'check-sso',pkceMethod:'S256',checkLoginIframe:false,silentCheckSsoRedirectUri:`${origin}/silent-check-sso.html`,silentCheckSsoFallback:false}),
  new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('The account session check timed out. Reload NOVA to try again.')),timeoutMs);})
 ]);}finally{if(timer)clearTimeout(timer);}
}
