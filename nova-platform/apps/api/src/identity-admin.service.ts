import {ConflictException,Injectable,ServiceUnavailableException} from '@nestjs/common';
@Injectable()
export class IdentityAdminService {
 private accessToken='';private expiresAt=0;private renewing?:Promise<string>;
 private base=process.env.IDENTITY_INTERNAL_URL||'http://keycloak:8080/auth';
 private async token(){
  if(this.accessToken&&this.expiresAt>Date.now())return this.accessToken;
  if(this.renewing)return this.renewing;
  this.renewing=(async()=>{
   if(!process.env.IDENTITY_SERVICE_SECRET)throw new ServiceUnavailableException('Local account management is not configured.');
   const response=await fetch(`${this.base}/realms/nova/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'nova-account-admin',client_secret:process.env.IDENTITY_SERVICE_SECRET,grant_type:'client_credentials'}),signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new ServiceUnavailableException('Local account management is unavailable.');
   const value=await response.json();this.accessToken=value.access_token;this.expiresAt=Date.now()+Math.max(1,value.expires_in-20)*1000;return this.accessToken;
  })();try{return await this.renewing;}finally{this.renewing=undefined;}
 }
 async request(path:string,method='GET',body?:unknown,retry=true):Promise<any>{
  let response:Response;
  try{response=await fetch(`${this.base}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${await this.token()}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}catch(error){if(error instanceof ServiceUnavailableException)throw error;throw new ServiceUnavailableException('The local identity service is unavailable.');}
  if(response.status===401&&retry){this.accessToken='';return this.request(path,method,body,false);}
  if(response.status===409)throw new ConflictException('That identity username is already taken.');
  if(!response.ok)throw new ServiceUnavailableException('The local identity operation could not be completed.');
  if(response.status===201){const location=response.headers.get('location');return {id:location?.split('/').at(-1)};}
  const text=await response.text();return text?JSON.parse(text):null;
 }
 async create(username:string,displayName:string,password:string){return this.request('/users','POST',{username,firstName:displayName,enabled:true,credentials:[{type:'password',value:password,temporary:true}],requiredActions:['UPDATE_PASSWORD']});}
 async remove(id:string){return this.request(`/users/${encodeURIComponent(id)}`,'DELETE');}
 async reset(id:string,password:string){await this.request(`/users/${encodeURIComponent(id)}/reset-password`,'PUT',{type:'password',value:password,temporary:true});await this.request(`/users/${encodeURIComponent(id)}/logout`,'POST');}
 async sessions(id:string){return this.request(`/users/${encodeURIComponent(id)}/sessions`);}
 async logoutAll(id:string){return this.request(`/users/${encodeURIComponent(id)}/logout`,'POST');}
 async logoutSession(id:string){return this.request(`/sessions/${encodeURIComponent(id)}?isOffline=false`,'DELETE');}
}
