import {useCallback,useEffect,useRef,useState} from 'react';
import {GUEST_HISTORY_KEY,guestStorage,readGuestRecents,rememberRecent,saveGuestRecents} from './guest-recents';
import type {Audience} from './audience';
export type ChannelSummary={id:string;slug:string;title:string;bio:string;state:string;owner:{displayName:string};category?:{id:string;name:string;slug:string};branding?:{avatar?:string;banner?:string;offline?:string};followerCount?:number;lastViewedAt?:string;audience?:Audience};
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type LibraryData={favourites:ChannelSummary[];recents:ChannelSummary[]};
const empty:LibraryData={favourites:[],recents:[]};

export function useChannelLibrary(user:any,api:Api){
 const owner=user?.id||'guest',currentOwner=useRef(owner),mounted=useRef(true),sequence=useRef(0),guestHistory=useRef(readGuestRecents(guestStorage()));currentOwner.current=owner;
 const [resource,setResource]=useState({owner,data:empty,loading:true,error:''}),[busy,setBusy]=useState<Set<string>>(new Set());
 const current=resource.owner===owner?resource:{owner,data:empty,loading:true,error:''};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const reload=useCallback(async()=>{
  const request=++sequence.current;
  try{let data:LibraryData;
   if(user)data=await api('/me/library');
   else{const visits=guestHistory.current,channels:ChannelSummary[]=visits.length?await api('/channels/lookup','POST',{ids:visits.map(item=>item.id)}):[];const byId=new Map(channels.map(channel=>[channel.id,channel]));data={favourites:[],recents:visits.flatMap(item=>{const channel=byId.get(item.id);return channel?[channel]:[];})};}
   if(mounted.current&&currentOwner.current===owner&&request===sequence.current)setResource({owner,data,loading:false,error:''});return data;
  }catch(error:any){if(mounted.current&&currentOwner.current===owner&&request===sequence.current)setResource(previous=>({owner,data:previous.owner===owner?previous.data:empty,loading:false,error:error.message||'Your channels could not load.'}));throw error;}
 },[owner,api]);
 useEffect(()=>{
  setResource({owner,data:empty,loading:true,error:''});setBusy(new Set());reload().catch(()=>{});
  const interval=setInterval(()=>{if(document.visibilityState==='visible')reload().catch(()=>{});},10000);
  const storage=(event:StorageEvent)=>{if(owner==='guest'&&event.key===GUEST_HISTORY_KEY){guestHistory.current=readGuestRecents(guestStorage());reload().catch(()=>{});}};window.addEventListener('storage',storage);
  return()=>{clearInterval(interval);window.removeEventListener('storage',storage);};
 },[owner,reload]);
 const visit=useCallback(async(channel:ChannelSummary)=>{
  if(user)await api(`/me/library/recents/${channel.id}`,'PUT');
  else{guestHistory.current=rememberRecent(guestHistory.current,channel.id);saveGuestRecents(guestStorage(),guestHistory.current);}
  await reload();
 },[owner,api,reload]);
 const toggle=async(channel:ChannelSummary)=>{
  if(!user)return;const wasFavourite=current.data.favourites.some(item=>item.id===channel.id);setBusy(previous=>new Set(previous).add(channel.id));
  try{await api(`/me/library/favourites/${channel.id}`,wasFavourite?'DELETE':'PUT');await reload();}
  finally{if(mounted.current)setBusy(previous=>{const next=new Set(previous);next.delete(channel.id);return next;});}
 };
 return {...current.data,loading:current.loading,error:current.error,busy,visit,toggle,reload};
}
export type ChannelLibrary=ReturnType<typeof useChannelLibrary>;
