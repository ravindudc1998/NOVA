import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaAuthorizationInput} from '../apps/api/src/media-input.js';
test('MediaMTX control/HLS callbacks accept the documented null connection ID',()=>{
  assert.equal(mediaAuthorizationInput.parse({action:'api',id:null,protocol:'',path:'',user:'nova-system',password:'example'}).id,null);
  assert.equal(mediaAuthorizationInput.parse({action:'read',protocol:'hls',id:null,path:'live/channel/session'}).id,null);
});
test('Malformed media connection IDs and unsupported actions are rejected',()=>{
  assert.equal(mediaAuthorizationInput.safeParse({action:'publish',id:'../../another-session'}).success,false);
  assert.equal(mediaAuthorizationInput.safeParse({action:'admin-everything',id:null}).success,false);
});
