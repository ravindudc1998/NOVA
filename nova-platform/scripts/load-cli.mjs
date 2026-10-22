// Backend HTTP load client. Plan contains temporary credentials: keep it outside source/artifacts.
import {readFileSync} from 'node:fs';
import {runLoad} from './load-client.mjs';
const args=process.argv.slice(2),get=(name,fallback)=>{const index=args.indexOf('--'+name);return index<0?fallback:args[index+1];};
const plan=JSON.parse(readFileSync(get('plan'),'utf8')),cohort=Number(get('cohort',0)),cohorts=Number(get('cohorts',1));
plan.viewerTokens=plan.viewerTokens.filter((_,index)=>index%cohorts===cohort);
async function resources(){
 for(let attempt=0;attempt<5;attempt++){
  try{const sample=JSON.parse(readFileSync(get('resources'),'utf8'));if(!Number.isFinite(Date.parse(sample.at))||Math.abs(Date.now()-Date.parse(sample.at))>30000)throw new Error('Resource monitor is stale');return sample;}
  catch(error){if(attempt===4)throw new Error('Resource monitor unavailable: '+error.message);await new Promise(resolve=>setTimeout(resolve,100));}
 }
}
const result=await runLoad({plan,ca:readFileSync(get('ca')),resultPath:get('out'),cohort,cohorts,clientLabel:get('label'),fullProfile:!args.includes('--media-only'),maxHeight:Number(get('height',Infinity)),stages:[{viewers:Number(get('viewers',100)),streams:Number(get('streams',1)),seconds:Number(get('seconds',60))}],control:async()=>{},resources});
console.log(JSON.stringify({completedStages:result.results.length,stopReason:result.stopReason}));
if(result.stopReason)process.exitCode=1;
