export function readRoute(pathname:string,hash=''){
 const candidate=(hash.startsWith('#/')?hash.slice(2):pathname.replace(/^\/+/,'' )).replace(/\/+$/,'');
 if(!candidate)return 'home';
 if(candidate==='channel')return 'discover';
 if(['home','discover','studio','admin','account','analytics'].includes(candidate)||/^channel\/[a-f0-9-]{36}$/i.test(candidate))return candidate;
 return 'home';
}
export function normalizeLocation(){
 const route=readRoute(location.pathname,location.hash),path=`/${route}`;
 if(location.pathname!==path||location.hash.startsWith('#/'))history.replaceState(null,'',path+location.search);
 return route;
}
export function navigateRoute(route:string){
 const path=`/${readRoute('/'+route)}`;if(location.pathname===path&&!location.hash)return;
 history.pushState(null,'',path);window.dispatchEvent(new PopStateEvent('popstate'));
}
export function interceptNavigation(event:MouseEvent){
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
 if(!anchor||anchor.hasAttribute('download')||(anchor.target&&anchor.target!=='_self'))return;
 const target=new URL(anchor.href,location.href);
 if(target.origin!==location.origin||target.search)return;
 const path=target.hash.startsWith('#/')?'/'+target.hash.slice(2):target.pathname;
 if(!/^\/(?:home|discover|studio|admin|account|analytics|channel(?:\/[a-f0-9-]{36})?)?\/?$/i.test(path))return;
 event.preventDefault();navigateRoute(readRoute(target.pathname,target.hash));
}
