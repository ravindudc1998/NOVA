export type CaptureSource='camera'|'screen';
export class CaptureFailure extends Error {
 constructor(readonly stage:string,error:any){super(error?.message||'Media capture failed.');this.name=error?.name||'Error';}
}
export function captureHelp(error:any){
 const stage=error?.stage||'connection',device=stage==='microphone'?'microphone':stage==='screen'?'screen':'camera';
 switch(error?.name){
  case 'NotAllowedError':case 'SecurityError':return `${device==='screen'?'Screen selection was cancelled or access was denied.':'Allow '+device+' access in your browser site settings.'} Use trusted HTTPS. You can turn off “Include microphone” to broadcast video without a microphone.`;
  case 'NotFoundError':return `No ${device} is available. ${device==='microphone'?'Turn off “Include microphone” for a video-only broadcast.':'Connect a camera or choose Screen.'}`;
  case 'NotReadableError':return `Your ${device} is busy or blocked by Windows. Close other apps using it and check Windows camera/microphone privacy settings.`;
  case 'OverconstrainedError':return `The selected ${device} cannot use these settings. Select another device and retry.`;
  case 'AbortError':return 'Broadcast cancelled.';
  default:return error?.message||'The browser connection failed. Retry after checking camera/microphone permissions.';
 }
}
// Capture video first, so a missing microphone can be diagnosed separately.
// Report the stream immediately so cancelling during a permission prompt releases it.
export async function captureMedia(devices:MediaDevices,source:CaptureSource,microphone:boolean,onStream:(stream:MediaStream)=>void,cancelled:()=>boolean){
 let stream:MediaStream|undefined,stage:string=source;
 const check=()=>{if(cancelled())throw Object.assign(new Error('Cancelled'),{name:'AbortError'});};
 try{
  check();stream=source==='screen'?await devices.getDisplayMedia({video:{frameRate:30},audio:false}):await devices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});
  onStream(stream);check();
  if(microphone){stage='microphone';const audio=await devices.getUserMedia({video:false,audio:true});audio.getTracks().forEach(track=>stream!.addTrack(track));check();}
  return stream;
 }catch(error){stream?.getTracks().forEach(track=>track.stop());throw new CaptureFailure(stage,error);}
}
export function waitForPeer(peer:RTCPeerConnection,event:'icegatheringstatechange'|'connectionstatechange',ready:()=>boolean,timeoutMs:number){
 return new Promise<void>((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>;
  const finish=(error?:Error)=>{clearTimeout(timer);peer.removeEventListener(event,check);error?reject(error):resolve();};
  const check=()=>{if(['failed','closed'].includes(peer.connectionState))finish(new Error('The browser could not connect to the local media server. Check that this computer can reach the NOVA server and retry.'));else if(ready())finish();};
  timer=setTimeout(()=>finish(new Error('The browser media connection timed out. Check the local connection to NOVA and retry.')),timeoutMs);peer.addEventListener(event,check);check();
 });
}
