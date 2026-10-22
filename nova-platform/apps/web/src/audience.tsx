import React,{useEffect,useState} from 'react';
export type Audience={live:boolean;current:number;peak?:number;startedAt:string|null;endedAt?:string|null;serverTime:string};
export function elapsedSeconds(stats?:Audience,elapsedMs=0){
 if(!stats?.startedAt)return 0;const end=stats.live?Date.parse(stats.serverTime)+elapsedMs:Date.parse(stats.endedAt||stats.serverTime),seconds=Math.floor((end-Date.parse(stats.startedAt))/1000);return Number.isFinite(seconds)?Math.max(0,seconds):0;
}
export function durationLabel(seconds:number){const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0)),hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),rest=String(value%60).padStart(2,'0');return hours?`${hours}:${String(minutes).padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;}
function useAudienceClock(stats?:Audience){
 const key=stats?.serverTime||'',initial={key,seconds:elapsedSeconds(stats),stale:false};const [clock,setClock]=useState(initial);
 useEffect(()=>{if(!stats?.live)return;const began=performance.now();const timer=setInterval(()=>{const elapsed=performance.now()-began;setClock({key,seconds:elapsedSeconds(stats,elapsed),stale:elapsed>30000});},1000);return()=>{clearInterval(timer);};},[key,stats?.startedAt,stats?.endedAt,stats?.live]);
 return clock.key===key?clock:initial;
}
const count=(value:number)=>Math.max(0,value).toLocaleString('en-US');
export function ViewerCount({stats,card=false}: {stats?:Audience;card?:boolean}){
 const clock=useAudienceClock(stats);if(!stats?.live)return null;
 return <span className={card?'card-viewers':'watch-viewers'} aria-label={clock.stale?'Viewer count unavailable':`${stats.current} active viewers`}>{clock.stale?'—':count(stats.current)} {stats.current===1?'viewer':'viewers'}</span>;
}
export function WatchAudience({stats}: {stats?:Audience}){
 const clock=useAudienceClock(stats);if(!stats?.live)return null;
 return <div className="watch-audience"><ViewerCount stats={stats}/><span className="live-duration" aria-label="Time live">◷ {durationLabel(clock.seconds)} live</span></div>;
}
export function StudioAudience({stats}: {stats?:Audience}){
 const clock=useAudienceClock(stats);if(!stats)return null;const known=!clock.stale;
 return <div className="studio-audience" aria-label="Stream audience"><div><span>Current viewers</span><strong>{known?count(stats.current):'—'}</strong></div><div><span>{stats.live?'Peak viewers':'Last stream peak'}</span><strong>{known?count(stats.peak||0):'—'}</strong></div><div><span>{stats.live?'Live time':'Last stream duration'}</span><strong>{known?durationLabel(clock.seconds):'—'}</strong></div></div>;
}
