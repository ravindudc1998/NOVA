import React,{useEffect,useState} from 'react';
export type Branding={avatar?:string;banner?:string;offline?:string};
export function ChannelAvatar({name,url}: {name:string;url?:string}){
 const [failed,setFailed]=useState(false);useEffect(()=>{setFailed(false);},[url]);
 return <span className="watch-avatar" aria-hidden="true">{url&&!failed?<img src={url} alt="" onError={()=>setFailed(true)}/>:name.slice(0,1).toUpperCase()}</span>;
}
export function ChannelBanner({url}: {url?:string}){
 const [failed,setFailed]=useState(false);useEffect(()=>{setFailed(false);},[url]);
 return url&&!failed?<div className="channel-banner"><img src={url} alt="Channel banner" onError={()=>setFailed(true)}/></div>:null;
}
export function CategorySelect({api,defaultValue,name='category',label='Category'}:any){
 const [categories,setCategories]=useState<any[]>([]),[value,setValue]=useState(defaultValue||'General');
 useEffect(()=>{let disposed=false;api('/categories').then((items:any[])=>{if(!disposed)setCategories(items);}).catch(()=>{});return()=>{disposed=true;};},[api]);
 return <label>{label}<select name={name} value={value} onChange={event=>setValue(event.target.value)} required>{!categories.some(item=>item.name===value)&&<option value={value}>{value}</option>}{categories.map(item=><option key={item.id} value={item.name}>{item.name}</option>)}</select></label>;
}
