export type TimeSpan={start:number,end:number};
export type LiveWindow={start:number,end:number,target:number,position:number,buffer:number,behind:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function liveWindow(time:number,ranges:TimeSpan[],buffers:TimeSpan[],sync?:number|null):LiveWindow|null{
 const range=ranges.filter(item=>Number.isFinite(item.start)&&Number.isFinite(item.end)&&item.end>item.start).at(-1);
 if(!range)return null;
 const target=Number.isFinite(sync)?clamp(sync!,range.start,range.end):Math.max(range.start,range.end-1);
 const position=clamp(Number.isFinite(time)?time:range.start,range.start,range.end);
 const buffer=buffers.filter(item=>item.end>=position&&item.start<=position+0.1).at(-1)?.end||position;
 return {...range,target,position,buffer:clamp(buffer,range.start,range.end),behind:Math.max(0,target-position)};
}
export function seekPosition(window:LiveWindow,value:number){return clamp(Number.isFinite(value)?value:window.position,window.start,Math.min(window.end-0.05,window.target));}
export function playerShortcut(key:string,tagName:string,editable=false,modified=false){
 if(editable||modified||['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(tagName.toUpperCase()))return null;
 const actions:Record<string,string>={' ':'play',k:'play',m:'mute',f:'fullscreen',t:'theater',l:'live',ArrowUp:'volume-up',ArrowDown:'volume-down',ArrowLeft:'back',ArrowRight:'forward'};
 return actions[key.length===1?key.toLowerCase():key]||null;
}
export function timeLabel(seconds:number){const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;}
