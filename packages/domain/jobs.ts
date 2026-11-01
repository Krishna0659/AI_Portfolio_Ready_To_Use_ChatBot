import {randomUUID} from 'node:crypto';
import {transaction} from '../db';
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
export async function claimJob(tenant:string,authenticatedGithub:boolean){
 return transaction(tenant,async db=>{
  await db.query("UPDATE jobs SET status=CASE WHEN attempt>=5 THEN 'failed' ELSE 'queued' END,error=CASE WHEN attempt>=5 THEN 'Retry limit reached after worker interruption.' ELSE 'Worker interrupted. Retrying automatically.' END,lease=NULL,lease_until=NULL,available_at=now()+least(300,5*power(2,least(attempt,6))) * interval '1 second' WHERE status='running' AND lease_until<now()");
  const r=await db.query("SELECT j.*,s.kind,s.locator FROM jobs j JOIN sources s ON s.id=j.source_id AND s.tenant_id=j.tenant_id WHERE j.status='queued' AND j.available_at<=now() AND s.status='active' AND (s.kind<>'github' OR $1::boolean OR NOT EXISTS(SELECT 1 FROM fetch_cooldowns WHERE host='api.github.com' AND retry_at>now())) ORDER BY j.available_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1",[authenticatedGithub]);
  if(!r.rowCount)return null;const job=r.rows[0];job.lease=randomUUID();job.attempt++;
  await db.query("UPDATE jobs SET status='running',attempt=$3,lease=$2,lease_until=now()+interval '60 seconds' WHERE id=$1",[job.id,job.lease,job.attempt]);return job as ImportJob;
 });
}
export async function heartbeat(job:ImportJob){return transaction(job.tenant_id,async db=>(await db.query("UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now()",[job.id,job.lease])).rowCount===1);}
export async function completeJob(job:ImportJob,text:string){return transaction(job.tenant_id,async db=>{
 // Match source mutation lock order so erasure can safely race a late result.
 const source=await db.query("SELECT id FROM sources WHERE id=$1 AND status='active' FOR KEY SHARE",[job.source_id]);if(!source.rowCount)return false;
 const active=await db.query("SELECT id FROM jobs WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now() FOR UPDATE",[job.id,job.lease]);if(!active.rowCount)return false;
 await db.query('INSERT INTO snapshots(id,tenant_id,source_id,job_id,text,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),job.tenant_id,job.source_id,job.id,text,hash(text)]);
 await db.query("UPDATE jobs SET status='succeeded',lease=NULL,lease_until=NULL,error=NULL WHERE id=$1",[job.id]);return true;
});}
export async function failJob(job:ImportJob,error:unknown,authenticatedGithub:boolean){return transaction(job.tenant_id,async db=>{
 const active=await db.query("SELECT id FROM jobs WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now() FOR UPDATE",[job.id,job.lease]);if(!active.rowCount)return false;
 const decision=retryDecision(error,job.attempt);
 if(error instanceof SourceHttpError&&error.code==='RATE_LIMITED'&&job.kind==='github'&&!authenticatedGithub&&error.retryAt)await db.query("INSERT INTO fetch_cooldowns(host,retry_at) VALUES('api.github.com',$1) ON CONFLICT(host) DO UPDATE SET retry_at=greatest(fetch_cooldowns.retry_at,excluded.retry_at)",[error.retryAt]);
 await db.query("UPDATE jobs SET status=$2,error=$3,lease=NULL,lease_until=NULL,available_at=coalesce($4,available_at) WHERE id=$1",[job.id,decision.retryAt?'queued':'failed',decision.message,decision.retryAt]);return true;
});}
