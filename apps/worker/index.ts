import {readFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../../packages/db/index';
import {hash} from '../../packages/contracts/profile';
import {fetchPublic,githubReadme} from '../../services/fetch-broker/fetch';
import {SourceHttpError} from '../../services/fetch-broker/errors';
import {ownerAppEnabled,ownerReadme} from '../../services/github/app';
import {cleanupOne} from '../../packages/domain/lifecycle';
import {parse} from '../../services/extraction';
process.loadEnvFile('.env.local');
// Worker discovers tenant IDs only; all content operations use the scoped runtime role.
async function tick(){await cleanupOne();const tenants=await pool.query('SELECT id FROM workspaces');for(const {id:tenant} of tenants.rows){
 const job=await transaction(tenant,async db=>{await db.query("UPDATE jobs SET status=CASE WHEN attempt>=5 THEN 'failed' ELSE 'queued' END,error='Worker lease expired',lease=NULL WHERE status='running' AND lease_until<now()");const r=await db.query("SELECT j.*,s.kind,s.locator FROM jobs j JOIN sources s ON s.id=j.source_id AND s.tenant_id=j.tenant_id WHERE j.status='queued' AND j.available_at<=now() AND s.status='active' AND (s.kind<>'github' OR $1::boolean OR NOT EXISTS(SELECT 1 FROM fetch_cooldowns WHERE host='api.github.com' AND retry_at>now())) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1",[ownerAppEnabled(tenant)]);if(!r.rows.length)return null;const job=r.rows[0];job.lease=randomUUID();await db.query("UPDATE jobs SET status='running',attempt=attempt+1,lease=$2,lease_until=now()+interval '60 seconds' WHERE id=$1",[job.id,job.lease]);return job;});
 if(job){try{let body:Buffer,kind:string;
 if(job.kind==='upload'){body=await readFile(`.local/objects/${job.locator}`);kind=job.locator.split('.').pop();}
 else if(job.kind==='github'&&ownerAppEnabled(tenant)){body=await ownerReadme(job.locator,tenant);kind='txt';}
 else if(job.kind==='github'){const response=await fetchPublic(githubReadme(job.locator));const data=JSON.parse(response.body.toString());if(data.encoding!=='base64'||typeof data.content!=='string')throw Error('Repository README unavailable');body=Buffer.from(data.content,'base64');kind='txt';}
 else{const response=await fetchPublic(job.locator);if(!response.type.includes('text/html')&&!response.type.includes('text/plain'))throw Error('Website must return HTML or plain text');body=response.body;kind=response.type.includes('html')?'html':'txt';}
 const text=await parse(body,kind);
 await transaction(tenant,async db=>{const active=await db.query("SELECT id FROM jobs WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now() FOR UPDATE",[job.id,job.lease]);if(!active.rowCount)return;await db.query('INSERT INTO snapshots(id,tenant_id,source_id,job_id,text,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),tenant,job.source_id,job.id,text,hash(text)]);await db.query("UPDATE jobs SET status='succeeded',lease=NULL,error=NULL WHERE id=$1",[job.id]);});
 }catch(e){const message=e instanceof Error?e.message:'Import failed';await transaction(tenant,async db=>{
 const retryAt=e instanceof SourceHttpError?e.retryAt:null;const retry=!!retryAt&&job.attempt+1<5;
 if(e instanceof SourceHttpError&&e.code==='RATE_LIMITED'&&job.kind==='github'&&!ownerAppEnabled(tenant)&&retryAt)await db.query("INSERT INTO fetch_cooldowns(host,retry_at) VALUES('api.github.com',$1) ON CONFLICT(host) DO UPDATE SET retry_at=greatest(fetch_cooldowns.retry_at,excluded.retry_at)",[retryAt]);
 await db.query("UPDATE jobs SET status=$3,error=$4,lease=NULL,available_at=coalesce($5,available_at) WHERE id=$1 AND lease=$2 AND status='running'",[job.id,job.lease,retry?'queued':'failed',retry?message.slice(0,250):(retryAt?'Retry limit reached. Try again later. ': '')+message.slice(0,200),retryAt]);});}}
 await transaction(tenant,async db=>{await db.query("UPDATE events SET status='mock_succeeded' WHERE status='pending' AND mode='mock'");});
}}
console.log('PortfolioAI worker running');let stopped=false;process.on('SIGINT',()=>stopped=true);while(!stopped){try{await tick();}catch(e){console.error('Worker tick failed:',e instanceof Error?e.message:'unknown');}await new Promise(r=>setTimeout(r,1500));}await pool.end();

