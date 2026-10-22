// Private stdin protocol. Credentials stay in memory, never in arguments or output.
import {createInterface} from 'node:readline';
import {mkdtempSync,readFileSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLoad} from './load-client.mjs';
import {cohortSize} from './load-profile.mjs';
const input=createInterface({input:process.stdin}),abort=new AbortController();
let configured=false,sample,working=false;
const send=value=>process.stdout.write('NOVA_RESULT '+JSON.stringify(value)+'\n');
async function start(config){
 working=true;const directory=mkdtempSync(join(tmpdir(),'nova-load-worker-')),resultPath=join(directory,'result.json');
 try{
  const {plan,cohort,cohorts,totalViewers,streams,seconds,height,ca,clientLabel,fullProfile}=config;
  const viewers=cohortSize(totalViewers,cohort,cohorts);
  plan.viewerTokens=plan.viewerTokens.filter((_,index)=>index%cohorts===cohort);sample=config.resources;
  const resources=async()=>{if(!sample||!Number.isFinite(Date.parse(sample.at))||Math.abs(Date.now()-Date.parse(sample.at))>30000)throw Error('Resource monitor is stale');return sample;};
  const result=await runLoad({plan,ca,cohort,cohorts,resultPath,signal:abort.signal,fullProfile,maxHeight:height,clientLabel,stages:[{viewers,streams,seconds}],resources,control:async()=>{}});
  send({cohort,result});if(result.stopReason)process.exitCode=1;
 }catch(error){
  let result;try{result=JSON.parse(readFileSync(resultPath,'utf8'));}catch{}
  send({error:String(error.message),result});process.exitCode=1;
 }finally{
  working=false;rmSync(join(directory,'result.json'),{force:true});rmdirSync(directory);input.close();process.stdin.destroy();
 }
}
input.on('line',line=>{
 try{
  if(line.length>2_000_000)throw Error('Controller message too large');
  const message=JSON.parse(line);
  if(message.type==='config'&&!configured){configured=true;void start(message);}
  else if(message.type==='resources')sample=message.sample;
  else if(message.type==='stop')abort.abort();
  else throw Error('Invalid controller message');
 }catch(error){send({error:error.message});abort.abort();process.exitCode=1;}
});
input.on('close',()=>{if(working)abort.abort();});
for(const name of ['SIGTERM','SIGINT'])process.on(name,()=>abort.abort());
