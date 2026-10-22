// Configure only NOVA's account-management service account; preserve existing realm/users/clients.
import {readFileSync} from 'node:fs';
const base='http://keycloak:8080/auth',secret=name=>readFileSync(`/run/secrets/${name}`,'utf8').trim();
const response=await fetch(`${base}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:secret('identity_admin_password')}),signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error(`Local identity configuration authentication failed (${response.status})`);
const {access_token:token}=await response.json();
async function admin(path,method='GET',body){const result=await fetch(`${base}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!result.ok)throw new Error(`Account service configuration failed (${result.status})`);const text=await result.text();return text?JSON.parse(text):null;}
let client=(await admin('/clients?clientId=nova-account-admin'))[0];
const configuration={clientId:'nova-account-admin',name:'NOVA local account management',enabled:true,protocol:'openid-connect',publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false,implicitFlowEnabled:false,directAccessGrantsEnabled:false,secret:secret('identity_service_secret')};
if(client)await admin(`/clients/${client.id}`,'PUT',{...client,...configuration});else{await admin('/clients','POST',configuration);client=(await admin('/clients?clientId=nova-account-admin'))[0];}
const serviceUser=await admin(`/clients/${client.id}/service-account-user`),realmManagement=(await admin('/clients?clientId=realm-management'))[0];
const roles=await Promise.all(['view-users','manage-users'].map(name=>admin(`/clients/${realmManagement.id}/roles/${name}`)));
await admin(`/users/${serviceUser.id}/role-mappings/clients/${realmManagement.id}`,'POST',roles);
console.log('Local account-management service account is configured. Existing realm users and NOVA access were preserved.');
