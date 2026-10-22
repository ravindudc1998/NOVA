export const PERMISSIONS: Record<string,string> = {
  'analytics.read_own':'Read own channel analytics', 'analytics.read_any':'Read platform and channel analytics',
  'streams.view':'Watch streams', 'chat.send':'Send chat messages', 'follows.manage_own':'Manage own follows', 'favourites.manage_own':'Manage own favourite channels',
  'reports.create':'Report content', 'profile.edit_own':'Edit own profile', 'channel.manage_own':'Edit own channel',
  'streams.publish_own':'Broadcast to own channel', 'streams.stop_own':'Stop own broadcast',
  'stream_keys.manage_own':'Manage own stream key', 'recordings.manage_own':'Manage own recordings',
  'channel_moderators.manage_own':'Manage own channel moderators', 'reports.review':'Review reports',
  'chat.moderate_any':'Moderate all chat rooms', 'streams.stop_any':'Stop any stream', 'channels.moderate_any':'Moderate channels',
  'users.manage':'Manage users', 'groups.manage':'Manage groups', 'settings.manage':'Manage platform settings',
  'categories.manage':'Manage categories', 'channels.manage_any':'Manage all channels', 'recordings.manage_any':'Manage recordings',
  'audit.read':'Read audit history', 'operations.read':'Read service status', 'platform.admin':'Full platform administration'
};
export const VIEWER_PERMISSIONS = ['streams.view','chat.send','follows.manage_own','favourites.manage_own','reports.create','profile.edit_own'];
export const GROUPS = [
  {key:'administrators',name:'Administrators',protected:true,permissions:['platform.admin']},
  {key:'moderators',name:'Moderators',protected:false,permissions:[...VIEWER_PERMISSIONS,'reports.review','chat.moderate_any','streams.stop_any','channels.moderate_any']},
  {key:'creators',name:'Creators',protected:false,permissions:['channel.manage_own','streams.publish_own','streams.stop_own','stream_keys.manage_own','recordings.manage_own','channel_moderators.manage_own','analytics.read_own']},
  {key:'viewers',name:'Viewers',protected:false,permissions:VIEWER_PERMISSIONS}
];
export const DEFAULT_SETTINGS = {
  _revision:1,
  registrationEnabled:true, creatorSignupEnabled:true, creatorApprovalRequired:false,
  publishingEnabled:false, browserPublishingEnabled:false, guestViewingEnabled:false,
  liveNotificationsEnabled:true, chatEnabled:true, recordingAllowed:false, defaultLanguage:'en', defaultCategory:'General',
  defaultSlowModeSeconds:0, platformName:'NOVA', announcement:'', maintenanceEnabled:false
};
export const RESERVED_SLUGS = new Set(['home','discover','account','analytics','follows','notifications','admin','api','auth','studio','settings','channels','login','register','health']);
export function validSlug(slug:string){return /^[a-z0-9_]{3,25}$/.test(slug)&&!RESERVED_SLUGS.has(slug);}
export function effectivePermissions(user:any):string[]{
  if(user.status!=='active')return [];
  return [...new Set<string>(user.memberships.flatMap((m:any)=>m.group.permissions.map((p:any)=>p.permissionCode)))].sort();
}
export function allowed(user:any,permission:string){const p=effectivePermissions(user);return p.includes('platform.admin')||p.includes(permission);}
export function mayPublish(user:any,channel:any,settings:any){
  return Boolean(user.status==='active'&&channel?.ownerId===user.id&&channel?.accessState==='ready'&&settings.publishingEnabled&&!settings.maintenanceEnabled&&allowed(user,'streams.publish_own'));
}
