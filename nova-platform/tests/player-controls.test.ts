import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveWindow,seekPosition,playerShortcut,timeLabel} from '../apps/web/src/player-state';
import {PlaybackSettings,PlayerControls} from '../apps/web/src/player-controls';
import {WatchSurface} from '../apps/web/src/watch-layout';
import {LivePlayer} from '../apps/web/src/player';

test('Live controls use the latest seekable window and ignore expired buffer ranges',()=>{
 const window=liveWindow(112,[{start:0,end:40},{start:100,end:120}],[{start:0,end:40},{start:110,end:118}],116)!;
 assert.deepEqual(window,{start:100,end:120,target:116,position:112,buffer:118,behind:4});
 assert.equal(seekPosition(window,40),100);assert.equal(seekPosition(window,10000),116);assert.equal(seekPosition(window,NaN),112);
 assert.equal(liveWindow(Infinity,[],[]),null);assert.equal(liveWindow(10,[{start:0,end:Infinity}],[]),null);
 assert.equal(timeLabel(3661),'61:01');assert.equal(timeLabel(NaN),'0:00');
});
test('Playback keys map to player actions without capturing unrelated keys',()=>{
 assert.equal(playerShortcut('k','DIV'),'play');assert.equal(playerShortcut('M','VIDEO'),'mute');assert.equal(playerShortcut('ArrowUp','DIV'),'volume-up');
 assert.equal(playerShortcut('Escape','DIV'),null);
});
test('Editable elements and browser shortcuts remain untouched',()=>{
 for(const tag of ['INPUT','TEXTAREA','BUTTON','A','SELECT'])assert.equal(playerShortcut(' ',tag),null);
 assert.equal(playerShortcut('m','DIV',true),null);assert.equal(playerShortcut('f','DIV',false,true),null);assert.equal(playerShortcut('x','DIV'),null);
});
test('Quality settings show source-supplied resolutions and the actual selected radio option',()=>{
 const markup=renderToStaticMarkup(React.createElement(PlaybackSettings,{qualities:[{value:'0',label:'720p',width:1280,height:720}],selected:'0',active:'720p',onSelect:()=>{}}));
 assert.match(markup,/Auto · 720p/);assert.match(markup,/checked="" value="0"|value="0" checked=""/);assert.equal(markup.includes('2160p'),false);
});
test('Player controls expose live, sound, quality and chat actions without a fake VOD duration',()=>{
 const markup=renderToStaticMarkup(React.createElement(PlayerControls,{live:true,playing:true,muted:true,volume:1,qualities:[],selected:'auto',active:'1080p',timeline:null,fullscreen:false,fullscreenAvailable:false,pipAvailable:false,chatOpen:true,onPlay:()=>{},onMute:()=>{},onVolume:()=>{},onQuality:()=>{},onSeek:()=>{},onLive:()=>{},onFullscreen:()=>{},onChat:()=>{},onMenuChange:()=>{}}));
 for(const label of ['Pause','Unmute','Playback settings','Hide chat','Fullscreen'])assert.ok(markup.includes(`aria-label="${label}"`));assert.match(markup,/>LIVE</);assert.equal(markup.includes('NaN'),false);assert.equal(markup.includes('Infinity'),false);
});
test('Hiding chat keeps its DOM inside the fullscreen surface and the custom player uses local video',()=>{
 const surface=renderToStaticMarkup(React.createElement(WatchSurface,{id:'channel',theater:true,chatOpen:false,surfaceRef:()=>{},player:React.createElement('div',null,'player'),chat:React.createElement('textarea',{defaultValue:'draft'})}));
 assert.match(surface,/watch-surface is-theater is-chat-hidden/);assert.match(surface,/class="watch-chat" hidden=""/);assert.match(surface,/>draft<\/textarea>/);
 const player=renderToStaticMarkup(React.createElement(LivePlayer,{id:'channel',state:'offline',api:async()=>{},user:null}));assert.match(player,/<video/);assert.match(player,/aria-label="Live video player"/);assert.equal(/\scontrols(?:=|[ >])/.test(player),false);assert.equal(player.includes('<iframe'),false);
});
