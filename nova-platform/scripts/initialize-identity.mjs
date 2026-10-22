import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const base='http://keycloak:8080/auth';
const secret=n=>readFileSync(`/run/secrets/${n}`,'utf8').trim();
let tokenResponse;
for(let attempt=0;attempt<12;attempt++){
  tokenResponse=await fetch(`${base}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'nova-bootstrap',password:secret('identity_admin_password')})});
  if(tokenResponse.ok)break;
  await new Promise(resolve=>setTimeout(resolve,1500));
}
if(!tokenResponse?.ok)throw new Error(`Local identity bootstrap authentication failed (${tokenResponse?.status})`);
const {access_token:token}=await tokenResponse.json();
async function admin(path,method='GET',body){const r=await fetch(`${base}/admin/realms/nova${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(`Identity setup failed (${r.status})`);return r.status===204?null:r.json();}
const [browserClient]=await admin('/clients?clientId=nova-web');
const scopes=await admin('/client-scopes');
const assigned=await admin(`/clients/${browserClient.id}/default-client-scopes`);
for(const name of ['basic','profile','email','web-origins']){const scope=scopes.find(s=>s.name===name);if(scope&&!assigned.some(s=>s.id===scope.id))await admin(`/clients/${browserClient.id}/default-client-scopes/${scope.id}`,'PUT');}
await admin('/users/profile','PUT',{attributes:[{name:'username',displayName:'Username',required:{roles:['user']},permissions:{view:['admin','user'],edit:['admin','user']},validations:{length:{min:3,max:25},pattern:{pattern:'^[a-z0-9_]+$','error-message':'Use lowercase letters, digits and underscores.'}}},{name:'firstName',displayName:'Display name',permissions:{view:['admin','user'],edit:['admin','user']},validations:{length:{max:80}}},{name:'lastName',displayName:'Last name',permissions:{view:['admin','user'],edit:['admin','user']}},{name:'email',displayName:'Email (optional)',permissions:{view:['admin','user'],edit:['admin','user']},validations:{email:{}}}]});
let identities=await admin('/users?username=nova_admin&exact=true');
if(!identities.length){const r=await fetch(`${base}/admin/realms/nova/users`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({username:'nova_admin',enabled:true,firstName:'NOVA Administrator',credentials:[{type:'password',value:secret('first_admin_password'),temporary:true}],requiredActions:['UPDATE_PASSWORD']})});if(!r.ok)throw new Error(`Initial administrator identity could not be created (${r.status})`);identities=await admin('/users?username=nova_admin&exact=true');}
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
try{await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('nova-initial-admin'))`;const existing=await tx.user.findUnique({where:{identitySubject:identities[0].id}});if(existing)return;const user=await tx.user.create({data:{identitySubject:identities[0].id,username:'nova_admin',displayName:'NOVA Administrator'}});const groups=await tx.group.findMany({where:{key:{in:['administrators','viewers']}}});await tx.membership.createMany({data:groups.map(g=>({userId:user.id,groupId:g.id}))});await tx.auditEvent.create({data:{actorId:'setup',action:'administrator.bootstrapped',targetId:user.id}});});console.log('Local identity configuration and initial NOVA administrator are ready. Existing access was preserved.');}finally{await db.$disconnect();}

await import('./configure-account-admin.mjs');
