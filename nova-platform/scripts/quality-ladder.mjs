// One clock and aligned two-second GOPs keep every HLS rendition switchable.
export const QUALITY_LADDER=[
 {height:360,width:640,bitrate:800,maxrate:1000},
 {height:480,width:854,bitrate:1400,maxrate:1800},
 {height:720,width:1280,bitrate:2800,maxrate:3500},
 {height:1080,width:1920,bitrate:5500,maxrate:7000},
 {height:1440,width:2560,bitrate:10000,maxrate:12500},
 {height:2160,width:3840,bitrate:20000,maxrate:25000},
];
export function sourceInfo(probe){
 const video=probe.streams?.find(stream=>stream.codec_type==='video');
 if(!video||!Number.isInteger(video.width)||!Number.isInteger(video.height)||video.width<2||video.height<2||video.width>8192||video.height>8192)throw new Error('The source video dimensions are unsupported.');
 const packets=(probe.packets||[]).filter(packet=>packet.stream_index===video.index),keys=packets.filter(packet=>packet.flags?.includes('K')).map(packet=>Number(packet.pts_time)).filter(Number.isFinite).sort((a,b)=>a-b);
 const [numerator,denominator]=String(video.r_frame_rate||'0/1').split('/').map(Number),fps=numerator/denominator;
 const aligned=keys.length>=3&&keys.every((time,index)=>index===0||Math.abs(time-keys[index-1]-2)<0.005);
 const timestamps=packets.map(packet=>Number(packet.pts_time)).filter(Number.isFinite),duration=timestamps.length?(Math.max(...timestamps)-Math.min(...timestamps)+1/(fps||30)):0;
 const bitrate=duration>0?Math.ceil(packets.reduce((sum,packet)=>sum+Number(packet.size||0),0)*8/duration/1000):0;
 return {width:video.width,height:video.height,audio:probe.streams.some(stream=>stream.codec_type==='audio'),copySafe:video.codec_name==='h264'&&video.pix_fmt==='yuv420p'&&Math.abs(fps-30)<0.001&&aligned,bitrate};
}
export function selectRenditions(source,maxHeight=2160){
 const portrait=source.height>source.width,result=[];
 for(const rung of QUALITY_LADDER.filter(rung=>rung.height<=maxHeight)){
  const boundWidth=portrait?rung.height:rung.width,boundHeight=portrait?rung.width:rung.height;
  const ratio=Math.min(1,boundWidth/source.width,boundHeight/source.height);
  const width=Math.max(2,Math.floor(source.width*ratio/2)*2),height=Math.max(2,Math.floor(source.height*ratio/2)*2);
  if(result.some(variant=>variant.width===width&&variant.height===height))continue;
  const id=`q${Math.min(width,height)}`,duplicate=result.findIndex(variant=>variant.id===id);
  if(duplicate!==-1)result.splice(duplicate,1);
  result.push({...rung,width,height,id});
 }
 if(!result.length)throw new Error('No supported video qualities.');
 return result;
}
export function hlsArguments(input,output,source,variants,{preset='veryfast'}={}){
 const top=variants.at(-1),passthrough=Boolean(source.copySafe&&top.width===source.width&&top.height===source.height),encoded=variants.filter((_,index)=>!passthrough||index!==variants.length-1),count=encoded.length;
 const filters=count?[`[0:v:0]select='if(isnan(prev_selected_t),key,1)',fps=30,split=${count}${encoded.map((_,index)=>`[in${index}]`).join('')}`]:[];
 for(const [index,variant] of encoded.entries())filters.push(`[in${index}]scale=${variant.width}:${variant.height}:flags=fast_bilinear,setsar=1[v${index}]`);
 const args=['-hide_banner','-nostdin','-loglevel','warning','-y','-rtsp_transport','tcp','-timeout','10000000','-threads:v','4','-i',input];
 if(count)args.push('-filter_complex_threads','4','-filter_complex',filters.join(';'));
 for(const [index,variant] of variants.entries()){
  const copy=passthrough&&index===variants.length-1;
  args.push('-map',copy?'0:v:0':`[v${index}]`);
  if(source.audio)args.push('-map','0:a:0');
  if(copy)args.push(`-c:v:${index}`,'copy',`-b:v:${index}`,`${Math.max(1,Math.ceil((source.bitrate||variant.maxrate)*1.2))}k`);
  else args.push(`-c:v:${index}`,'libx264',`-preset:v:${index}`,preset,`-profile:v:${index}`,'high',`-pix_fmt:v:${index}`,'yuv420p',`-threads:v:${index}`,variant.height>=1440?'4':'2',`-fps_mode:v:${index}`,'passthrough',`-b:v:${index}`,`${variant.bitrate}k`,`-maxrate:v:${index}`,`${variant.maxrate}k`,`-bufsize:v:${index}`,`${variant.maxrate*2}k`,`-g:v:${index}`,'60',`-keyint_min:v:${index}`,'60',`-sc_threshold:v:${index}`,'0',`-flags:v:${index}`,'+cgop',`-force_key_frames:v:${index}`,'expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+2-0.000001))');
  if(source.audio)args.push(`-c:a:${index}`,'aac',`-b:a:${index}`,'128k',`-ar:a:${index}`,'48000',`-ac:a:${index}`,'2');
 }
 // FFmpeg 5 leaves %v literal in init names when there is only one variant.
 const initName=variants.length===1?`init-${variants[0].id}.mp4`:'init-%v.mp4';
 args.push('-f','hls','-hls_time','2','-hls_list_size','7','-hls_delete_threshold','3','-hls_segment_type','fmp4','-hls_flags','delete_segments+independent_segments+temp_file+omit_endlist','-hls_start_number_source','epoch_us','-hls_fmp4_init_filename',initName,'-hls_segment_filename',`${output}/seg-%v-%d.m4s`,'-master_pl_name','index.m3u8','-var_stream_map',variants.map((variant,index)=>`v:${index}${source.audio?`,a:${index}`:''},name:${variant.id}`).join(' '),`${output}/%v.m3u8`);
 return args;
}
