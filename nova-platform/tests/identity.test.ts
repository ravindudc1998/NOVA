import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeIdentity} from '../apps/web/src/identity.js';

test('Session discovery stays in an iframe, with PKCE and no foreground redirect fallback',async()=>{
 let captured:any;const identity={init:async(options:any)=>{captured=options;return true;}};
 assert.equal(await initializeIdentity(identity,'https://nova.local'),true);
 assert.equal(captured.silentCheckSsoRedirectUri,'https://nova.local/silent-check-sso.html');
 assert.equal(captured.silentCheckSsoFallback,false);assert.equal(captured.pkceMethod,'S256');
});
test('An account check that never answers cannot leave startup pending indefinitely',async()=>{
 await assert.rejects(initializeIdentity({init:()=>new Promise(()=>{})},'https://nova.local',15),/session check timed out/);
});
test('Identity startup errors propagate to the visible recovery screen',async()=>{
 await assert.rejects(initializeIdentity({init:async()=>{throw new Error('Identity unavailable');}},'https://nova.local'),/Identity unavailable/);
});
