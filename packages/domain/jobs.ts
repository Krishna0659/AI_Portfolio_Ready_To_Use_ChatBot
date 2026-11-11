import {workerPool} from '../db';
import {hash} from '../contracts/profile';
import {SourceHttpError} from '../../services/fetch-broker/errors';

export type ImportJob={id:string;tenant_id:string;source_id:string;lease:string;attempt:number;kind:'web'|'github'|'upload';locator:string};
const transientCodes=new Set(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
export function retryDecision(error:unknown,attempt:number,now=Date.now(),random=Math.random){
 let cause=error,network=false;
 for(let depth=0;cause&&typeof cause==='object'&&depth<4;depth++){
  const e=cause as {code?:string;name?:string;cause?:unknown};if(transientCodes.has(e.code??'')||e.name==='TimeoutError')network=true;cause=e.cause;
 }
 const provider=error instanceof SourceHttpError,temporary=network||provider&&!!error.retryAt;
 const delay=Math.min(300000,5000*2**Math.min(Math.max(attempt-1,0),6))*(0.75+random()*0.5);
 const retryAt=temporary&&attempt<5?new Date(Math.max(now+delay,provider?error.retryAt?.getTime()??0:0)):null;
 const message=network?'The source connection was interrupted.':error instanceof Error?error.message:'Import failed';
 return {retryAt,message:(temporary&&!retryAt?'Retry limit reached. Try again later. ':'')+message.slice(0,200)};
}

export async function claimJob(tenant:string,authenticatedGithub:boolean){return (await workerPool.query('SELECT worker_claim($1,$2) job',[tenant,authenticatedGithub])).rows[0].job as ImportJob|null;}
export async function heartbeat(job:ImportJob){return (await workerPool.query('SELECT worker_heartbeat($1,$2,$3) ok',[job.tenant_id,job.id,job.lease])).rows[0].ok as boolean;}
export async function completeJob(job:ImportJob,text:string){return (await workerPool.query('SELECT worker_complete($1,$2,$3,$4,$5) ok',[job.tenant_id,job.id,job.lease,text,hash(text)])).rows[0].ok as boolean;}
export async function failJob(job:ImportJob,error:unknown,authenticatedGithub:boolean){
 const decision=retryDecision(error,job.attempt),cooldown=error instanceof SourceHttpError&&error.code==='RATE_LIMITED'&&job.kind==='github'&&!authenticatedGithub?error.retryAt:null;
 return (await workerPool.query('SELECT worker_fail($1,$2,$3,$4,$5,$6) ok',[job.tenant_id,job.id,job.lease,decision.message,decision.retryAt,cooldown])).rows[0].ok as boolean;
}
