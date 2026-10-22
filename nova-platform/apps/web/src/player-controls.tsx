import React,{useEffect,useId,useRef,useState} from 'react';
import {PlayerIcon} from './player-icons';
import {seekPosition,timeLabel,type LiveWindow} from './player-state';
import type {QualityOption} from './playback-quality';

export function PlaybackSettings({qualities,selected,active,onSelect}: {qualities:QualityOption[];selected:string;active:string;onSelect:(value:string)=>void}){
 const name=useId();return <fieldset className="nova-quality-menu"><legend>Quality</legend>{[{value:'auto',label:active?`Auto · ${active}`:'Auto'},...qualities].map(option=><label key={option.value} className={selected===option.value?'is-selected':''}><input type="radio" name={name} value={option.value} checked={selected===option.value} onChange={()=>onSelect(option.value)}/><span>{option.label}</span>{selected===option.value&&<PlayerIcon name="check"/>}</label>)}</fieldset>;
}
export function PlayerControls({live,playing,muted,volume,qualities,selected,active,timeline,fullscreen,fullscreenAvailable,pipAvailable,pip,theater,chatOpen,onPlay,onMute,onVolume,onQuality,onSeek,onLive,onFullscreen,onPip,onTheater,onChat,onMenuChange}:any){
 const [settings,setSettings]=useState(false),settingsId=useId(),settingsRef=useRef<HTMLDivElement>(null),settingsButton=useRef<HTMLButtonElement>(null);
 const close=()=>{setSettings(false);onMenuChange(false);};
 useEffect(()=>{if(!settings)return;const outside=(event:PointerEvent)=>{if(!settingsRef.current?.contains(event.target as Node))close();};document.addEventListener('pointerdown',outside);return()=>{document.removeEventListener('pointerdown',outside);};},[settings]);
 useEffect(()=>{if(!live)close();},[live]);
 const window=timeline as LiveWindow|null,span=window?window.target-window.start:0,percent=(value:number)=>span&&window?Math.max(0,Math.min(100,(value-window.start)/span*100)):100;
 const select=(value:string)=>{onQuality(value);close();settingsButton.current?.focus();};
 return <div className="nova-controls" onKeyDown={event=>{if(event.key==='Escape'&&settings){event.preventDefault();event.stopPropagation();close();settingsButton.current?.focus();}}}>
  <div className={`nova-live-track ${!window?'is-unavailable':''}`} style={{'--played':`${window?percent(window.position):100}%`,'--buffered':`${window?percent(window.buffer):100}%`} as React.CSSProperties}>
   {window&&<input aria-label="Seek within available live video" type="range" min={window.start} max={window.target} step="0.1" value={Math.min(window.position,window.target)} disabled={span<=0} onChange={event=>onSeek(seekPosition(window,Number(event.target.value)))}/>}
  </div>
  <div className="nova-control-row"><div className="nova-control-group">
   <button type="button" className="nova-icon-button" aria-label={playing?'Pause':'Play'} title={playing?'Pause (k)':'Play (k)'} disabled={!live} onClick={onPlay}><PlayerIcon name={playing?'pause':'play'}/></button>
   <div className="nova-volume"><button type="button" className="nova-icon-button" aria-label={muted||volume===0?'Unmute':'Mute'} title="Mute / unmute (m)" onClick={onMute}><PlayerIcon name={muted||volume===0?'muted':'volume'}/></button><input aria-label="Volume" type="range" min="0" max="100" step="1" value={muted?0:Math.round(volume*100)} onChange={event=>onVolume(Number(event.target.value)/100)}/></div>
   <button type="button" className={`nova-live-button ${live?'is-live':''} ${window&&window.behind>2?'is-behind':''}`} title="Return to live (l)" disabled={!live||!window} onClick={onLive}><i/>{live?'LIVE':'OFFLINE'}{window&&window.behind>2&&<span>−{timeLabel(window.behind)}</span>}</button>
  </div><div className="nova-control-group">
   {active&&<span className="nova-quality-label">{active}</span>}
   <div className="nova-settings" ref={settingsRef}><button type="button" ref={settingsButton} className={`nova-icon-button ${settings?'is-active':''}`} aria-label="Playback settings" title="Quality settings" aria-expanded={settings} aria-controls={settingsId} disabled={!live||!qualities.length} onClick={()=>{setSettings(!settings);onMenuChange(!settings);}}><PlayerIcon name="settings"/></button>{settings&&<div id={settingsId} className="nova-settings-popover" role="group" aria-label="Playback settings"><PlaybackSettings qualities={qualities} selected={selected} active={active} onSelect={select}/></div>}</div>
   {onChat&&<button type="button" className={`nova-icon-button ${chatOpen?'is-active':''}`} aria-label={chatOpen?'Hide chat':'Show chat'} title={chatOpen?'Hide chat':'Show chat'} aria-pressed={chatOpen} onClick={onChat}><PlayerIcon name="chat"/></button>}
   {pipAvailable&&<button type="button" className="nova-icon-button nova-pip-button" aria-label={pip?'Exit picture in picture':'Picture in picture'} title="Picture in picture" disabled={!live} onClick={onPip}><PlayerIcon name="pip"/></button>}
   {onTheater&&<button type="button" className={`nova-icon-button nova-theater-button ${theater?'is-active':''}`} aria-label={theater?'Exit theater mode':'Theater mode'} title="Theater mode (t)" aria-pressed={theater} onClick={onTheater}><PlayerIcon name="theater"/></button>}
   <button type="button" className="nova-icon-button" aria-label={fullscreen?'Exit fullscreen':'Fullscreen'} title="Fullscreen (f)" disabled={!fullscreenAvailable} onClick={onFullscreen}><PlayerIcon name={fullscreen?'exit-fullscreen':'fullscreen'}/></button>
  </div></div>
 </div>;
}
