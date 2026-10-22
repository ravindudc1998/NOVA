import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Home,Discover,FavouriteList} from '../apps/web/src/channel-pages.js';
const offline={id:'00000000-0000-4000-8000-000000000001',slug:'past_creator',title:'An earlier stream',bio:'',state:'offline',owner:{displayName:'Past creator'}};
const live={...offline,id:'00000000-0000-4000-8000-000000000002',slug:'live_creator',title:'Live now',state:'live'};
const library:any={favourites:[offline,live],recents:[offline,live],busy:new Set(),loading:false,error:'',reload:async()=>{}};

test('Home includes visited live and offline channels under recent channels',()=>{
 const markup=renderToStaticMarkup(React.createElement(Home,{user:null,signin:()=>{},run:()=>{},library,canFavourite:false,onToggle:()=>{}}));
 assert.match(markup,/Your recent channels/);assert.match(markup,/An earlier stream/);assert.match(markup,/Live now/);assert.match(markup,/Make yourself/);
});
test('Discover begins with the channel directory and omits the welcome hero',()=>{
 const markup=renderToStaticMarkup(React.createElement(Discover,{api:async()=>[],run:()=>{},library,canFavourite:false,onToggle:()=>{}}));
 assert.match(markup,/Your community’s channels/);assert.equal(markup.includes('Make yourself'),false);assert.equal(markup.includes('welcome-art'),false);
});
test('Sidebar favourites link to both live and offline saved channels',()=>{
 const markup=renderToStaticMarkup(React.createElement(FavouriteList,{library}));assert.match(markup,/FAVOURITES/);assert.match(markup,/An earlier stream/);assert.match(markup,/Live now/);assert.match(markup,/href="\/channel\//);
});
