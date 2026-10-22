import test from 'node:test';
import assert from 'node:assert/strict';
import {safeErrorText,routeKind} from '../apps/web/src/client-errors.js';

test('Client error reports remove URL credentials, query strings, fragments and bearer tokens',()=>{
 const result=safeErrorText('Load https://account:password@nova.local/assets/app.js?code=secret#token Bearer private-value eyJheader.eyJpayload.signature');
 assert.match(result,/https:\/\/nova.local\/assets\/app.js/);
 for(const secret of ['account:','password','code=secret','#token','private-value','eyJheader'])assert.equal(result.includes(secret),false);
});
test('Reported routes exclude channel identifiers and sign-in parameters',()=>{
 assert.equal(routeKind('#/channel/private-id?code=secret'),'channel');
 assert.equal(routeKind('#/studio'),'studio');
 assert.equal(routeKind('#access_token=secret'),'other');
 assert.equal(safeErrorText('x'.repeat(4000),1000).length,1000);
});
