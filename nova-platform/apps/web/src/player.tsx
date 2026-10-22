import React,{useEffect,useRef,useState} from 'react';
import {levelOptions,nativeQualityOptions,qualityLabel,type QualityOption} from './playback-quality';
import {PlayerControls} from './player-controls';
import {PlayerIcon} from './player-icons';
import {trackViewer} from './viewer-presence';
import {liveWindow,playerShortcut,seekPosition,type LiveWindow,type TimeSpan} from './player-state';

export function LivePlayer({id,state,api,user,signin,monitor=false,offlineImage,fullscreenTarget,theater=false,chatOpen=true,onTheater,onChat}:any){
 const videoRef=useRef<HTMLVideoElement>(null),failures=useRef(0);
 const stageRef=useRef<HTMLDivElement>(null),engine=useRef<any>(null),hideTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),clickTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),mounted=useRef(true);
 const qualitySelector=useRef<((value:string)=>void)|null>(null);
 const [qualities,setQualities]=useState<QualityOption[]>([]),[selectedQuality,setSelectedQuality]=useState('auto'),[activeQuality,setActiveQuality]=useState('');
 const [phase,setPhase]=useState('loading'),[message,setMessage]=useState(''),[muted,setMuted]=useState(true),[retry,setRetry]=useState(0);
 const [volume,setVolume]=useState(1),[timeline,setTimeline]=useState<LiveWindow|null>(null),[buffering,setBuffering]=useState(false),[controlsShown,setControlsShown]=useState(true),[menuOpen,setMenuOpen]=useState(false),[fullscreen,setFullscreen]=useState(false),[fullscreenAvailable,setFullscreenAvailable]=useState(false),[pip,setPip]=useState(false),[pipAvailable,setPipAvailable]=useState(false),[uiNotice,setUiNotice]=useState('');
 const reveal=()=>{setControlsShown(true);if(hideTimer.current)clearTimeout(hideTimer.current);if(phase==='playing'&&!menuOpen)hideTimer.current=setTimeout(()=>setControlsShown(false),3000);};
 useEffect(()=>{reveal();return()=>{if(hideTimer.current)clearTimeout(hideTimer.current);};},[phase,menuOpen]);
 useEffect(()=>{
  mounted.current=true;const video=videoRef.current!;
  const spans=(ranges:TimeRanges)=>{const result:TimeSpan[]=[];for(let index=0;index<ranges.length;index++)result.push({start:ranges.start(index),end:ranges.end(index)});return result;};
  const update=()=>{const seekable=spans(video.seekable),details=engine.current?.latestLevelDetails;if(details?.fragments?.length&&seekable.length){const range=seekable[seekable.length-1],first=details.fragments.find((fragment:any)=>fragment);if(first&&Number.isFinite(details.edge)){range.start=Math.max(range.start,first.start);range.end=Math.min(range.end,details.edge);}}setTimeline(liveWindow(video.currentTime,seekable,spans(video.buffered),engine.current?.liveSyncPosition));};
  const volumeChanged=()=>{setVolume(video.volume);setMuted(video.muted);};
  const waiting=()=>{if(!video.paused&&video.readyState<3)setBuffering(true);};
  const resumed=()=>setBuffering(false),enteredPip=()=>setPip(true),leftPip=()=>setPip(false);
  const fullscreenChanged=()=>setFullscreen(Boolean(document.fullscreenElement&&(document.fullscreenElement===stageRef.current||document.fullscreenElement===fullscreenTarget?.current)));
  setFullscreenAvailable(Boolean(document.fullscreenEnabled));setPipAvailable(Boolean(document.pictureInPictureEnabled&&video.requestPictureInPicture));
  const stage=stageRef.current!,resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>stage.style.setProperty('--player-height',`${entries[0].contentRect.height}px`));stage.style.setProperty('--player-height',`${stage.clientHeight}px`);resize?.observe(stage);
  const events=['timeupdate','progress','loadedmetadata','durationchange','seeked'];events.forEach(event=>video.addEventListener(event,update));
  video.addEventListener('volumechange',volumeChanged);video.addEventListener('waiting',waiting);video.addEventListener('stalled',waiting);video.addEventListener('playing',resumed);video.addEventListener('pause',resumed);video.addEventListener('enterpictureinpicture',enteredPip);video.addEventListener('leavepictureinpicture',leftPip);document.addEventListener('fullscreenchange',fullscreenChanged);
  const interval=setInterval(update,1000);
  return()=>{mounted.current=false;clearInterval(interval);resize?.disconnect();if(clickTimer.current)clearTimeout(clickTimer.current);events.forEach(event=>video.removeEventListener(event,update));video.removeEventListener('volumechange',volumeChanged);video.removeEventListener('waiting',waiting);video.removeEventListener('stalled',waiting);video.removeEventListener('playing',resumed);video.removeEventListener('pause',resumed);video.removeEventListener('enterpictureinpicture',enteredPip);video.removeEventListener('leavepictureinpicture',leftPip);document.removeEventListener('fullscreenchange',fullscreenChanged);if(document.pictureInPictureElement===video)document.exitPictureInPicture().catch(()=>{});};
 },[]);
 useEffect(()=>{
  const video=videoRef.current!,nativeRequest=new AbortController();let disposed=false,hls:any,restart:ReturnType<typeof setTimeout>|undefined,renew:ReturnType<typeof setInterval>|undefined,started=false,recovered=false,hasTicket=false;const diagnostics:ReturnType<typeof setTimeout>[]=[];
  qualitySelector.current=null;engine.current=null;setQualities([]);setSelectedQuality('auto');setActiveQuality('');setTimeline(null);setBuffering(false);setUiNotice('');
  video.muted=true;setMuted(true);setMessage('');setPhase('loading');video.removeAttribute('src');video.load();
  if(state!=='live')return;
  const report=(stage:string,detail?:string)=>{if(disposed||!hasTicket)return;const box=video.getBoundingClientRect(),quality=video.getVideoPlaybackQuality?.();let pixelAverage=-1;
   if(video.readyState>=2&&video.videoWidth)try{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d');if(ctx){ctx.drawImage(video,0,0,8,8);const pixels=ctx.getImageData(0,0,8,8).data;let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];pixelAverage=Math.round(sum/192);}}catch{}
   fetch(`/api/v1/play/${id}/diagnostics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage,readyState:video.readyState,networkState:video.networkState,paused:video.paused,time:Number.isFinite(video.currentTime)?video.currentTime:0,bufferEnd:video.buffered.length?video.buffered.end(video.buffered.length-1):0,width:video.videoWidth,height:video.videoHeight,boxWidth:box.width,boxHeight:box.height,decodedFrames:quality?.totalVideoFrames||0,droppedFrames:quality?.droppedVideoFrames||0,pixelAverage,...(detail?{detail:detail.slice(0,100)}:{})}),signal:AbortSignal.timeout(3000)}).catch(()=>{});
  };
  const start=()=>{if(disposed||started)return;started=true;video.play().catch(error=>{if(!disposed&&error.name!=='AbortError'){setPhase('ready');setMessage('Press Play to watch this live stream.');}});};
  const fail=(text:string,automatic=true)=>{if(disposed)return;setMessage(text);setPhase('error');if(automatic&&!restart&&failures.current<3){failures.current++;restart=setTimeout(()=>{if(!disposed)setRetry(value=>value+1);},4000);}};
  const onPlaying=()=>{if(restart){clearTimeout(restart);restart=undefined;}failures.current=0;setPhase('playing');setMessage('');};
  const onPause=()=>{if(!disposed&&video.readyState>=2)setPhase('ready');};
  const onSize=()=>{if(!disposed&&video.videoWidth&&video.videoHeight)setActiveQuality(qualityLabel(video.videoWidth,video.videoHeight));};
  const onError=()=>{if(!disposed)fail('The browser could not decode this stream. Retry playback, or reload NOVA if the player was updated.');};
  video.addEventListener('playing',onPlaying);video.addEventListener('pause',onPause);video.addEventListener('error',onError);video.addEventListener('loadedmetadata',start);video.addEventListener('resize',onSize);
  const ticket=()=>api(`/channels/${id}/playback`,'POST');
  (async()=>{try{
   const {url}=await ticket();if(disposed)return;hasTicket=true;
   diagnostics.push(setTimeout(()=>report('snapshot'),6000),setTimeout(()=>report('snapshot'),16000));
   renew=setInterval(()=>ticket().catch(()=>fail('Playback access expired. Sign in again and retry.',false)),180000);
   const {default:Hls}=await import('hls.js');if(disposed)return;
   // Prefer the bundled MSE player when available, with native HLS as a fallback.
   if(Hls.isSupported()){
    hls=new Hls({liveSyncDurationCount:2,maxBufferLength:20,maxMaxBufferLength:40,capLevelToPlayerSize:true,xhrSetup:(xhr:XMLHttpRequest)=>{xhr.withCredentials=true;}});engine.current=hls;
    qualitySelector.current=(value:string)=>{if(disposed)return;const index=value==='auto'?-1:Number(value);if(index!==-1&&(!Number.isInteger(index)||!hls.levels[index]))return;hls.currentLevel=index;setSelectedQuality(value);};
    hls.on(Hls.Events.MEDIA_ATTACHED,()=>hls.loadSource(url));hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(disposed)return;setQualities(levelOptions(hls.levels));report('manifest');start();});
    hls.on(Hls.Events.LEVEL_SWITCHED,(_event:any,data:any)=>{if(disposed)return;const level=hls.levels[data.level];if(level?.width&&level?.height)setActiveQuality(qualityLabel(level.width,level.height));});
    hls.on(Hls.Events.ERROR,(_event:any,data:any)=>{
     if(disposed||!data.fatal)return;report('error',data.details);
     if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&!recovered){recovered=true;setMessage('Recovering video playback…');hls.recoverMediaError();return;}
     const code=data.response?.code;fail(code===401||code===403?'Playback access was denied. Sign in again and retry.':`Live video could not load (${data.details}${code?`, HTTP ${code}`:''}). Retrying…`,code!==401&&code!==403);
    });hls.attachMedia(video);
   }else if(video.canPlayType('application/vnd.apple.mpegurl')){
    qualitySelector.current=(value:string)=>{if(disposed)return;const target=value==='auto'?url:new URL(value,new URL(url,location.origin)).href;setSelectedQuality(value);setPhase('loading');started=false;video.src=target;start();};
    video.src=url;
    fetch(url,{credentials:'same-origin',signal:nativeRequest.signal}).then(response=>response.ok?response.text():'').then(master=>{if(!disposed)setQualities(nativeQualityOptions(master));}).catch(()=>{});
   }
   else fail('This browser does not support live video playback.',false);
  }catch(error:any){fail(error.message||'The player could not load. Reload NOVA and retry.',false);}})();
  return()=>{disposed=true;nativeRequest.abort();qualitySelector.current=null;engine.current=null;diagnostics.forEach(clearTimeout);if(restart)clearTimeout(restart);if(renew)clearInterval(renew);video.removeEventListener('playing',onPlaying);video.removeEventListener('pause',onPause);video.removeEventListener('error',onError);video.removeEventListener('loadedmetadata',start);video.removeEventListener('resize',onSize);hls?.destroy();video.removeAttribute('src');video.load();};
 },[id,state,retry,user?.id]);
 useEffect(()=>{if(monitor||state!=='live')return;return trackViewer(videoRef.current!,id,api);},[id,state,retry,user?.id,monitor]);
 const play=()=>videoRef.current?.play().catch(()=>{setMessage('Playback could not start. Retry or check the browser media permissions.');setPhase('error');});
 const togglePlay=()=>{if(state!=='live')return;if(phase==='error'){failures.current=0;setRetry(value=>value+1);return;}const video=videoRef.current;if(!video)return;if(video.paused)play();else video.pause();reveal();};
 const setSound=(value:number)=>{const video=videoRef.current;if(!video)return;video.volume=Math.max(0,Math.min(1,value));video.muted=value===0;setVolume(video.volume);setMuted(video.muted);reveal();};
 const toggleMute=()=>{const video=videoRef.current;if(!video)return;if(video.muted||video.volume===0){if(video.volume===0)video.volume=0.5;video.muted=false;}else video.muted=true;setMuted(video.muted);setVolume(video.volume);reveal();};
 const seek=(value:number)=>{if(!timeline||!videoRef.current)return;try{videoRef.current.currentTime=seekPosition(timeline,value);}catch{}reveal();};
 const goLive=()=>{const video=videoRef.current;if(!video||!timeline)return;try{engine.current?.startLoad();video.currentTime=engine.current?.liveSyncPosition??timeline.target;play();}catch{setUiNotice('Live playback could not resume. Retry playback.');}reveal();};
 const toggleFullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await (fullscreenTarget?.current||stageRef.current)?.requestFullscreen();}catch{if(mounted.current)setUiNotice('Fullscreen is unavailable here. Try theater mode or open NOVA directly in your browser.');}};
 const togglePip=async()=>{const video=videoRef.current;if(!video)return;try{if(document.pictureInPictureElement===video)await document.exitPictureInPicture();else await video.requestPictureInPicture();}catch{if(mounted.current)setUiNotice('Picture in picture is unavailable for this video.');}};
 const keyDown=(event:React.KeyboardEvent)=>{const target=event.target as HTMLElement,action=playerShortcut(event.key,target.tagName,target.isContentEditable,event.altKey||event.ctrlKey||event.metaKey);if(!action)return;event.preventDefault();if(event.repeat&&!action.startsWith('volume')&&!['back','forward'].includes(action))return;reveal();if(action==='play')togglePlay();else if(action==='mute')toggleMute();else if(action==='fullscreen')void toggleFullscreen();else if(action==='theater')onTheater?.();else if(action==='live')goLive();else if(action==='volume-up')setSound(volume+0.05);else if(action==='volume-down')setSound(volume-0.05);else if(action==='back'&&timeline)seek(timeline.position-5);else if(action==='forward'&&timeline)seek(timeline.position+5);};
 const videoClick=(event:React.MouseEvent)=>{stageRef.current?.focus({preventScroll:true});reveal();if(clickTimer.current)clearTimeout(clickTimer.current);if(event.detail===1)clickTimer.current=setTimeout(togglePlay,200);};
 return <section className="player-panel"><div ref={stageRef} className={`player nova-player ${controlsShown||phase!=='playing'||menuOpen?'is-controls-visible':''}`} tabIndex={0} role="region" aria-label="Live video player" onKeyDown={keyDown} onPointerMove={reveal} onPointerDown={reveal} onMouseLeave={()=>{if(phase==='playing'&&!menuOpen)setControlsShown(false);}} onFocus={reveal}>
 <video ref={videoRef} autoPlay muted={muted} playsInline aria-label="Live stream" onClick={videoClick} onDoubleClick={()=>{if(clickTimer.current)clearTimeout(clickTimer.current);void toggleFullscreen();}}/>
 {state!=='live'?<div className="player-overlay">{state==='offline'&&offlineImage&&<img className="player-offline-image" src={offlineImage} alt=""/>}<span>◈</span><h2>{state==='starting'?'Getting the stream ready…':'This channel is offline.'}</h2><p>{state==='starting'?'Video processing is starting. Playback appears here automatically.':'Start a broadcast to see live video here.'}</p></div>:phase==='error'?<div className="player-overlay player-failure" role="alert"><h2>{/Sign in|access.*denied|expired/i.test(message)?'Sign in to watch live':'Live video is unavailable'}</h2><p>{message}</p><div className="actions">{signin&&(!user||/access|Sign in|expired/i.test(message))&&<button className="primary" onClick={()=>signin()}>Sign in to watch</button>}<button className="secondary" onClick={()=>{failures.current=0;setRetry(value=>value+1);}}>Retry playback</button></div></div>:phase==='ready'?<div className="player-start"><button className="nova-center-play" aria-label="Play live video" onClick={play}><PlayerIcon name="play"/></button></div>:phase==='loading'||buffering?<div className="nova-player-loading" role="status"><span className="nova-spinner"/><span className="sr-only">{buffering?'Waiting for live video…':'Connecting to live video…'}</span></div>:null}
 {state==='live'&&phase==='playing'&&muted&&!monitor&&!buffering&&<button className="nova-sound-hint" onClick={toggleMute}><PlayerIcon name="muted"/> Click to unmute</button>}
 <PlayerControls live={state==='live'} playing={phase==='playing'} muted={muted} volume={volume} qualities={qualities} selected={selectedQuality} active={activeQuality} timeline={timeline} fullscreen={fullscreen} fullscreenAvailable={fullscreenAvailable} pipAvailable={pipAvailable} pip={pip} theater={theater} chatOpen={chatOpen} onPlay={togglePlay} onMute={toggleMute} onVolume={setSound} onQuality={(value:string)=>qualitySelector.current?.(value)} onSeek={seek} onLive={goLive} onFullscreen={()=>void toggleFullscreen()} onPip={()=>void togglePip()} onTheater={onTheater} onChat={onChat} onMenuChange={setMenuOpen}/>
 </div>
 {uiNotice&&<div className="nova-player-notice" role="status">{uiNotice}<button type="button" aria-label="Dismiss player notice" onClick={()=>setUiNotice('')}><PlayerIcon name="close"/></button></div>}
 {message&&phase!=='error'&&<div className="playback-notice" role="status">{message}<div className="actions"><button className="secondary" onClick={()=>{failures.current=0;setRetry(value=>value+1);}}>Retry playback</button></div></div>}
 <p className="help nova-player-help">{monitor?'Monitor starts muted to prevent microphone feedback.':'Video starts muted. Click the speaker to enable sound.'} · Quality follows the source, up to 4K. <span className="nova-keyboard-hint">Space / K: play · M: mute · F: fullscreen · L: live</span></p></section>;
}
