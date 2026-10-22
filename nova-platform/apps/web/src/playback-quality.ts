export type QualityOption={value:string,label:string,width:number,height:number};
export function qualityLabel(width:number,height:number){
 const size=Math.min(width,height);
 return size>=2160?`4K (${size}p)`:`${size}p`;
}
export function levelOptions(levels:Array<{width:number,height:number}>):QualityOption[]{
 return levels.flatMap((level,index)=>level.width>0&&level.height>0?[{value:String(index),label:qualityLabel(level.width,level.height),width:level.width,height:level.height}]:[]).sort((a,b)=>b.height*b.width-a.height*a.width);
}
export function nativeQualityOptions(master:string):QualityOption[]{
 const lines=master.split(/\r?\n/),result:QualityOption[]=[];
 for(let index=0;index<lines.length;index++){
  if(!lines[index].startsWith('#EXT-X-STREAM-INF:'))continue;
  const dimensions=/\bRESOLUTION=(\d+)x(\d+)/.exec(lines[index]),file=lines[index+1]?.trim();
  if(!dimensions||!/^q\d{1,4}\.m3u8$/.test(file||''))continue;
  const width=Number(dimensions[1]),height=Number(dimensions[2]);
  if(width>0&&height>0)result.push({value:file,label:qualityLabel(width,height),width,height});
 }
 return result.sort((a,b)=>b.height*b.width-a.height*a.width);
}
