import React from 'react';
export function WatchSurface({id,theater,chatOpen,surfaceRef,player,details,chat}: {id:string;theater:boolean;chatOpen:boolean;surfaceRef:React.Ref<HTMLDivElement>;player:React.ReactNode;details?:React.ReactNode;chat:React.ReactNode}){
 return <div ref={surfaceRef} className={`watch-grid watch-surface ${theater?'is-theater':''} ${chatOpen?'':'is-chat-hidden'}`}><div className="watch-main">{player}{details}</div><div id={`watch-chat-${id}`} className="watch-chat" hidden={!chatOpen}>{chat}</div></div>;
}
