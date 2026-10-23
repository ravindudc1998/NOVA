import net,{type AddressInfo,type Socket} from 'node:net';
import tls from 'node:tls';
import {resolve4} from 'node:dns/promises';
import {destinationUrl,publicIPv4} from './restream-policy.js';
type Target={url:URL;address:string;port:number};
type Options={resolveIPv4?:(host:string)=>Promise<string[]>;connect?:(target:Target)=>Socket};

export async function publicDestination(serverUrl:string,{resolveIPv4=(host:string)=>resolve4(host)}:Options={}):Promise<Target>{
 const url=new URL(destinationUrl(serverUrl)),host=url.hostname;let addresses:string[];
 try{addresses=net.isIP(host)?[host]:await Promise.race([resolveIPv4(host),new Promise<string[]>((_,reject)=>{const timer=setTimeout(()=>reject(Error('connection_failed')),5000);timer.unref();})]);}catch{throw Error('connection_failed');}
 if(!addresses.length||addresses.some(address=>!publicIPv4(address)))throw Error('address_rejected');
 return {url,address:addresses[0],port:Number(url.port||(url.protocol==='rtmps:'?443:1935))};
}
export function destinationConnectOptions(target:Target){return {host:target.address,port:target.port,...(target.url.protocol==='rtmps:'?{servername:net.isIP(target.url.hostname)?undefined:target.url.hostname,rejectUnauthorized:true}:{})};}
function connectDestination(target:Target){return target.url.protocol==='rtmps:'?tls.connect(destinationConnectOptions(target)):net.connect(destinationConnectOptions(target));}

// The socket dials the validated IP once. TLS retains the original hostname for
// SNI and certificate checks; only a private loopback proxy is given to FFmpeg.
export async function createDestinationProxy(serverUrl:string,{resolveIPv4,connect=connectDestination}:Options={}){
 const target=await publicDestination(serverUrl,{resolveIPv4}),sockets=new Set<Socket>();let remote:Socket|undefined,lastError:string|null=null,closed=false;
 const server=net.createServer(client=>{
  if(closed||remote){client.destroy();return;}client.pause();sockets.add(client);let outgoing:Socket;
  try{outgoing=connect(target);remote=outgoing;}catch{lastError='connection_failed';client.destroy();return;}
  sockets.add(outgoing);outgoing.setTimeout(15000,()=>outgoing.destroy(Error('connection_failed')));outgoing.setKeepAlive(true,10000);client.setNoDelay(true);outgoing.setNoDelay(true);
  const fail=()=>{lastError='connection_failed';client.destroy();outgoing.destroy();};
  client.on('error',fail);outgoing.on('error',fail);client.on('close',()=>{sockets.delete(client);outgoing.destroy();});outgoing.on('close',()=>{sockets.delete(outgoing);client.destroy();});
  outgoing.once(target.url.protocol==='rtmps:'?'secureConnect':'connect',()=>{if(closed)return fail();client.pipe(outgoing);outgoing.pipe(client);client.resume();});
 });
 server.maxConnections=1;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});server.on('error',()=>{lastError='connection_failed';});
 return {port:(server.address() as AddressInfo).port,get bytesSent(){return remote?.bytesWritten||0;},get errorCode(){return lastError;},async close(){closed=true;for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
