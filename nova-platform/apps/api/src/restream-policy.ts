import {isIP} from 'node:net';
export const RESTREAM_PROVIDERS=['twitch','youtube','facebook','linkedin','custom'] as const;
export const RESTREAM_PROFILES={720:{width:1280,videoKbps:3000,maxKbps:4000},1080:{width:1920,videoKbps:5000,maxKbps:6000}} as const;
export const RESTREAM_ERRORS=['connecting','connection_failed','address_rejected','source_unavailable','source_audio_missing','output_failed','capacity','worker_unavailable'] as const;
export function publicIPv4(address:string){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||
  a===192&&(b===0||b===168||b===2||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function destinationUrl(value:string){
 if(value.length>500||/[\s\u0000-\u001f\u007f\\]/.test(value))throw new Error('Use a valid RTMP or RTMPS server URL.');
 let url:URL;try{url=new URL(value);}catch{throw new Error('Use a valid RTMP or RTMPS server URL.');}
 if(!['rtmp:','rtmps:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!url.pathname||url.pathname==='/')throw new Error('Enter the server URL separately from the stream key, using RTMP or RTMPS.');
 const host=url.hostname.toLowerCase(),port=Number(url.port||(url.protocol==='rtmps:'?443:1935));
 if(![443,1935].includes(port))throw new Error('This destination must use port 443 or 1935.');
 if(isIP(host)){if(!publicIPv4(host))throw new Error('Use a public streaming server address.');}
 else if(host.length>253||!host.includes('.')||!host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))||/\.(local|localhost|internal|test|invalid)$/.test(host)||host==='localhost')throw new Error('Use a public streaming server address.');
 url.pathname=url.pathname.replace(/\/+$/,'');return url.toString().replace(/\/$/,'');
}
export function destinationKey(value:string){
 if(!value||value.length>2048||/[\s\u0000-\u001f\u007f\\#]/.test(value))throw new Error('Enter a valid stream key without whitespace.');
 return value;
}
export function restreamState(destination:any,{enabled,live,now=Date.now()}:{enabled:boolean;live:boolean;now?:number}){
 if(!destination.enabled)return 'paused';if(!enabled)return 'blocked';if(!live)return 'waiting';
 if(destination.statusVersion!==destination.version||!destination.lastHeartbeatAt||now-new Date(destination.lastHeartbeatAt).getTime()>12000)return 'starting';
 return destination.status;
}
export function relayVariant(master:string,maxHeight:720|1080){
 const lines=master.split(/\r?\n/),variants=lines.flatMap((line,index)=>{
  const dimensions=/RESOLUTION=(\d+)x(\d+)/.exec(line),bandwidth=/\bBANDWIDTH=(\d+)/.exec(line),file=lines[index+1];
  return dimensions&&/^q\d+\.m3u8$/.test(file)?[{file,width:Number(dimensions[1]),height:Number(dimensions[2]),bandwidth:Number(bandwidth?.[1]||0),audio:/mp4a\./.test(line)}]:[];
 }).sort((a,b)=>Math.min(b.width,b.height)-Math.min(a.width,a.height));
 const choice=variants.find(v=>Math.min(v.width,v.height)<=maxHeight)||variants.at(-1);
 if(!choice)throw new Error('source_unavailable');if(!choice.audio)throw new Error('source_audio_missing');
 return {...choice,copy:choice.bandwidth>0&&choice.bandwidth<=RESTREAM_PROFILES[maxHeight].maxKbps*1000};
}
export function relayArguments(input:string,output:string,serverUrl:string,variant:{copy:boolean;width:number;height:number},height:720|1080){
 const profile=RESTREAM_PROFILES[height],portrait=variant.height>variant.width,boundWidth=portrait?height:profile.width,boundHeight=portrait?profile.width:height,args=['-hide_banner','-nostdin','-loglevel','error','-re','-live_start_index','-2','-i',input,'-map','0:v:0','-map','0:a:0'];
 if(variant.copy)args.push('-c','copy');
 else args.push('-vf',`scale=w='min(${boundWidth},iw)':h='min(${boundHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,'-c:v','libx264','-preset','veryfast','-threads','2','-pix_fmt','yuv420p','-r','30','-g','60','-keyint_min','60','-sc_threshold','0','-b:v',`${profile.videoKbps}k`,'-minrate',`${profile.videoKbps}k`,'-maxrate',`${profile.videoKbps}k`,'-bufsize',`${profile.videoKbps*2}k`,'-c:a','aac','-b:a','128k','-ar','48000','-ac','2');
 args.push('-rtmp_tcurl',serverUrl,'-avoid_negative_ts','make_zero','-flvflags','no_duration_filesize','-progress','pipe:1','-stats_period','1','-f','flv',output);return args;
}
