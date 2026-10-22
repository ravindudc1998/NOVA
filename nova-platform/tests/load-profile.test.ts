import test from 'node:test';
import assert from 'node:assert/strict';
import {cohortSize,cohortChannel,fixtureStreamCount} from '../scripts/load-profile.mjs';

test('Five streams receive exactly 100 viewers each across even and uneven worker cohorts',()=>{
 for(const workers of [1,2,3,4]){
  const counts=[0,0,0,0,0],indices=new Set();
  for(let worker=0;worker<workers;worker++)for(let index=0;index<cohortSize(500,worker,workers);index++){
   indices.add(index*workers+worker);counts[cohortChannel(index,5,worker,workers)]++;
  }
  assert.equal(indices.size,500);assert.equal(Math.max(...indices),499);assert.deepEqual(counts,[100,100,100,100,100]);
 }
});

test('Fixture stream limits preserve the historical four-stream default and allow the operator five-stream profile',()=>{
 assert.equal(fixtureStreamCount(),4);for(const value of ['1','2','3','4','5'])assert.equal(fixtureStreamCount(value),Number(value));
 for(const value of ['0','6','-1','NaN','1.5',''])assert.throws(()=>fixtureStreamCount(value));
 for(const parameters of [[0,0,2],[500,2,2],[500,-1,2],[500,0,0]])assert.throws(()=>cohortSize(...parameters));
});
