import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollChatToEnd} from '../apps/web/src/chat-scroll.js';

test('Promise-returning browser scrolling never supplies React with a non-function cleanup',()=>{
 const scroll=Promise.resolve({interrupted:false});
 const cleanup=scrollChatToEnd({scrollIntoView:()=>scroll});
 assert.equal(cleanup,undefined);
});
test('Legacy scrolling remains safe and detached chat targets can be removed',()=>{
 let called=false;assert.equal(scrollChatToEnd({scrollIntoView:()=>{called=true;}}),undefined);
 assert.equal(called,true);assert.equal(scrollChatToEnd(null),undefined);
 assert.doesNotThrow(()=>scrollChatToEnd({scrollIntoView:()=>{throw new Error('Detached target');}}));
});
test('Interrupted asynchronous scrolling cannot cause an unhandled rejection on navigation',async()=>{
 assert.equal(scrollChatToEnd({scrollIntoView:()=>Promise.reject(new Error('Scroll interrupted'))}),undefined);
 await new Promise(resolve=>setImmediate(resolve));
});
