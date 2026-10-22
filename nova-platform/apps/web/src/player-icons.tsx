import React from 'react';
export type PlayerIconName='play'|'pause'|'volume'|'muted'|'settings'|'fullscreen'|'exit-fullscreen'|'theater'|'chat'|'pip'|'check'|'close';
export function PlayerIcon({name}: {name:PlayerIconName}){
 const paths:Record<PlayerIconName,React.ReactNode>={
  play:<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>,
  pause:<><path d="M8 5v14M16 5v14" strokeWidth="4"/></>,
  volume:<><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  muted:<><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="m16 9 6 6m0-6-6 6"/></>,
  settings:<><circle cx="12" cy="12" r="3"/><path d="m10 2-.7 3-2 .9-2.7-.8-2 3.4 2.1 2.2v2.5l-2.1 2.1 2 3.5 2.8-.8 2 .9.6 3.1h4l.7-3.1 2-.9 2.7.8 2-3.5-2.1-2.1v-2.5l2.1-2.2-2-3.4-2.8.8-2-.9L14 2Z"/></>,
  fullscreen:<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
  'exit-fullscreen':<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>,
  theater:<><rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 15h20"/></>,
  chat:<><path d="M4 3h16v13H9l-5 5Z"/><path d="M8 7h8M8 11h6"/></>,
  pip:<><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="6" rx=".5" fill="currentColor" stroke="none"/></>,
  check:<path d="m5 12 4 4L19 6"/>,
  close:<path d="m6 6 12 12M18 6 6 18"/>,
 };
 return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
