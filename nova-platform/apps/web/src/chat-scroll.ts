type ScrollTarget={scrollIntoView(options:ScrollIntoViewOptions):unknown};

// Browser scrolling may return a Promise. React effects must only return cleanup functions.
export function scrollChatToEnd(target:ScrollTarget|null):void{
 if(!target)return;
 try{
  const result=target.scrollIntoView({block:'nearest'});
  if(result&&typeof(result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});
 }catch{
  // A detached/unavailable scroll target must not prevent leaving the channel.
 }
}
