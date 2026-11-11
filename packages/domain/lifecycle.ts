import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {pool,transaction,identityTransaction,workerPool} from '../db';
import {requireMembership} from './authorization';

const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export function objectPath(key:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(docx|pdf|txt|md)$/.test(key))throw Error('Invalid stored object key');
 return path.resolve('.local/objects',key);
}
export async function recentSession(db:PoolClient,user:string,tokenHash:string){
 const r=await db.query('SELECT session_recent($1,$2) recent',[tokenHash,user]);
 if(!r.rows[0].recent)throw Object.assign(Error('Verify with your passkey in Settings before deleting data.'),{status:403});
}
export async function queueErasure(db:PoolClient,tenant:string,user:string,source:string|null,keys:string[]){
 // Serialize receipt creation and completion across every deletion for one account.
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user]);
 keys.forEach(objectPath);const receipt=randomBytes(32).toString('base64url'),id=randomUUID();
 await db.query("INSERT INTO deletion_requests(id,receipt_hash,tenant_id,user_id,source_id,scope,status,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='completed' THEN now() END)",[id,digest(receipt),tenant,user,source,source?'source':'account',keys.length?'pending':'completed']);
 for(const key of keys)await db.query('INSERT INTO object_deletions(id,request_id,object_key) VALUES($1,$2,$3)',[randomUUID(),id,key]);
 if(!source)await db.query("UPDATE deletion_requests SET status='pending',completed_at=NULL WHERE id=$1 AND EXISTS(SELECT 1 FROM object_deletions o JOIN deletion_requests d ON d.id=o.request_id WHERE d.user_id=$2)",[id,user]);
 const status=(await db.query('SELECT status FROM deletion_requests WHERE id=$1',[id])).rows[0].status;
 return {receipt,status,requestId:id};
}
export async function eraseAccount(tenant:string,user:string,tokenHash:string){
 return identityTransaction(tenant,async db=>{
  const account=await db.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[user]);if(!account.rowCount)throw Object.assign(Error('Account not found'),{status:404});
  await recentSession(db,user,tokenHash);
  await requireMembership(db,tenant,user,true);
  const workspace=await db.query('SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2 FOR UPDATE',[tenant,user]);if(!workspace.rowCount)throw Object.assign(Error('Workspace not found'),{status:404});
  const files=(await db.query("SELECT locator FROM sources WHERE kind='upload'")).rows.map(s=>s.locator);
  const result=await queueErasure(db,tenant,user,null,files);
  await db.query('DELETE FROM sessions WHERE user_id=$1',[user]);
  // FK cascades remove draft, sources, snapshots, jobs, versions, approvals and events together.
  await db.query('DELETE FROM workspaces WHERE id=$1 AND owner_id=$2',[tenant,user]);
  await db.query('DELETE FROM accounts WHERE id=$1',[user]);return result;
 });
}
export async function deletionStatus(receipt:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(receipt))return null;
 const result=await pool.query('SELECT status,created_at,completed_at FROM deletion_requests WHERE receipt_hash=$1',[digest(receipt)]);return result.rows[0]??null;
}
export async function cleanupOne(remove:(file:string)=>Promise<void>=unlink,requestId:string|null=null){
 const pool=workerPool;const db=await pool.connect();let job;
 try{await db.query('BEGIN');const r=await db.query("SELECT * FROM object_deletions WHERE available_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND ($1::uuid IS NULL OR request_id=$1) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",[requestId]);job=r.rows[0];if(job){job.lease=randomUUID();await db.query("UPDATE object_deletions SET lease=$2,lease_until=now()+interval '30 seconds',attempt=attempt+1 WHERE id=$1",[job.id,job.lease]);}await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 if(!job)return false;
 try{
  const file=objectPath(job.object_key);
  try{const root=await lstat(path.resolve('.local/objects'));if(root.isSymbolicLink())throw Error('Object storage root must not be a symlink');await remove(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const db=await pool.connect();try{await db.query('BEGIN');const request=(await db.query('SELECT user_id FROM deletion_requests WHERE id=$1',[job.request_id])).rows[0];await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[request.user_id]);await db.query('DELETE FROM object_deletions WHERE id=$1 AND lease=$2',[job.id,job.lease]);await db.query("UPDATE deletion_requests SET status='completed',completed_at=now() WHERE id=$1 AND scope='source' AND NOT EXISTS(SELECT 1 FROM object_deletions WHERE request_id=$1)",[job.request_id]);await db.query("UPDATE deletion_requests SET status='completed',completed_at=now() WHERE user_id=$1 AND scope='account' AND status='pending' AND NOT EXISTS(SELECT 1 FROM object_deletions o JOIN deletion_requests d ON d.id=o.request_id WHERE d.user_id=$1)",[request.user_id]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }catch{await pool.query("UPDATE object_deletions SET lease=NULL,lease_until=NULL,last_error='object_cleanup_failed',available_at=now()+$3*interval '1 second' WHERE id=$1 AND lease=$2",[job.id,job.lease,Math.min(3600,5*2**Math.min(job.attempt,10))]);}
 return true;
}
