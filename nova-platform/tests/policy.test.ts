import test from 'node:test';
import assert from 'node:assert/strict';
import {allowed,effectivePermissions,mayPublish,validSlug} from '../apps/api/src/policy.js';
import {encryptSecret,decryptSecret,hashSecret} from '../apps/api/src/secrets.js';
const actor=(codes:string[],status='active')=>({id:'creator-a',status,memberships:[{group:{permissions:codes.map(permissionCode=>({permissionCode}))}}]});
test('Suspension overrides administrator and publishing privileges',()=>{const u=actor(['platform.admin'],'suspended');assert.deepEqual(effectivePermissions(u),[]);assert.equal(allowed(u,'groups.manage'),false);});
test('A publishing grant cannot authorize another owner or a pending creator',()=>{const u=actor(['streams.publish_own']);assert.equal(mayPublish(u,{ownerId:'creator-b',accessState:'ready'},{publishingEnabled:true}),false);assert.equal(mayPublish(u,{ownerId:u.id,accessState:'pending_approval'},{publishingEnabled:true}),false);assert.equal(mayPublish(u,{ownerId:u.id,accessState:'ready'},{publishingEnabled:true}),true);});
test('Slug validation reserves platform routes and normalizes before use',()=>{assert.equal(validSlug('admin'),false);assert.equal(validSlug('../owner'),false);assert.equal(validSlug('Creator'),false);assert.equal(validSlug('creator_42'),true);});
test('Stored publishing credentials are authenticated ciphertext',()=>{process.env.CREDENTIAL_ENCRYPTION_KEY='a'.repeat(64);const value='random-owner-credential';const encrypted=encryptSecret(value);assert.equal(encrypted.includes(value),false);assert.equal(decryptSecret(encrypted),value);const bits=encrypted.split('.');bits[2]=(bits[2][0]==='A'?'B':'A')+bits[2].slice(1);assert.throws(()=>decryptSecret(bits.join('.')));assert.equal(hashSecret(value).length,64);});
