import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoute} from '../apps/web/src/routes.js';
import {readGuestRecents,rememberRecent,saveGuestRecents,RECENT_LIMIT} from '../apps/web/src/guest-recents.js';
const id=(value:number)=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;

test('Home is the landing route and old bookmarks still resolve',()=>{
 assert.equal(readRoute('/'),'home');assert.equal(readRoute('/home'),'home');assert.equal(readRoute('/discover'),'discover');
 assert.equal(readRoute('/','#/channel/'+id(1)),'channel/'+id(1));assert.equal(readRoute('/channel'),'discover');
 assert.equal(readRoute('/home','#state=private&code=secret'),'home');
});
test('Guest history moves revisited channels to the front and retains at most 50 unique visits',()=>{
 let visits:any[]=[];for(let value=1;value<=55;value++)visits=rememberRecent(visits,id(value),value);
 assert.equal(visits.length,RECENT_LIMIT);assert.equal(visits[0].id,id(55));visits=rememberRecent(visits,id(20),100);
 assert.equal(visits[0].id,id(20));assert.equal(visits.filter(item=>item.id===id(20)).length,1);
});
test('Corrupt/blocked history storage never breaks navigation and no channel data is stored',()=>{
 assert.deepEqual(readGuestRecents({getItem:()=>'{broken'}),[]);assert.deepEqual(readGuestRecents({getItem:()=>{throw new Error('Blocked');}}),[]);
 const history=readGuestRecents({getItem:()=>JSON.stringify([{id:id(1),viewedAt:2,title:'private text'},{id:id(1),viewedAt:1},{id:'bad',viewedAt:4}])});
 assert.deepEqual(history,[{id:id(1),viewedAt:2}]);assert.doesNotThrow(()=>saveGuestRecents({setItem:()=>{throw new Error('Full');}},history));
});
