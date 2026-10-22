import React,{useEffect,useId,useRef} from 'react';
import {PlayerIcon} from './player-icons';

export function ModalDialog({title,description,onClose,error,notice,wide=false,children}: {title:string;description:string;onClose:()=>void;error?:string;notice?:string;wide?:boolean;children:React.ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),descriptionId=useId();
 useEffect(()=>{
  const element=dialog.current!,previous=document.activeElement as HTMLElement|null;
  element.showModal();
  return()=>{element.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return <dialog ref={dialog} className={`studio-dialog${wide?' is-wide':''}`} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}}>
  <div className="studio-dialog-heading"><div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div><button type="button" className="studio-dialog-close" aria-label="Close dialog" onClick={onClose}><PlayerIcon name="close"/></button></div>
  <div className="studio-dialog-body">{error&&<div className="studio-dialog-error" role="alert">{error}</div>}{notice&&<div className="studio-dialog-notice" role="status">{notice}</div>}{children}</div>
 </dialog>;
}

