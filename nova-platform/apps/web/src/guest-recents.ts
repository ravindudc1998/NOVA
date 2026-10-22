export const GUEST_HISTORY_KEY='nova.guest.recents.v1';
export const RECENT_LIMIT=50;
export type RecentVisit={id:string;viewedAt:number};
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function readGuestRecents(storage?:Pick<Storage,'getItem'>):RecentVisit[]{
 try{const text=storage?.getItem(GUEST_HISTORY_KEY);if(!text||text.length>20000)return [];const data=JSON.parse(text);if(!Array.isArray(data))return [];
  const seen=new Set<string>();return data.filter((item:any)=>{if(!item||!uuid.test(item.id)||!Number.isFinite(item.viewedAt)||item.viewedAt<0||seen.has(item.id))return false;seen.add(item.id);return true;}).slice(0,RECENT_LIMIT).map(item=>({id:item.id,viewedAt:item.viewedAt}));
 }catch{return [];}
}
export function rememberRecent(history:RecentVisit[],id:string,now=Date.now()):RecentVisit[]{if(!uuid.test(id))return history;return [{id,viewedAt:now},...history.filter(item=>item.id!==id)].slice(0,RECENT_LIMIT);}
export function saveGuestRecents(storage:Pick<Storage,'setItem'>|undefined,history:RecentVisit[]){try{storage?.setItem(GUEST_HISTORY_KEY,JSON.stringify(history));}catch{}}
export function guestStorage(){try{return window.localStorage;}catch{return undefined;}}
