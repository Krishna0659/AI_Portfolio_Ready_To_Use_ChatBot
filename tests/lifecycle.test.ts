import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,access,unlink} from 'node:fs/promises';
import {pool,transaction} from '../packages/db';
import {emptyProfile} from '../packages/contracts/profile';
import {objectPath,queueErasure,eraseAccount,cleanupOne,deletionStatus} from '../packages/domain/lifecycle';
after(()=>pool.end());

test('local object keys cannot escape the storage directory',()=>{for(const key of ['../secret.pem','C:\\secret.txt','a/../../secret','bad.txt','00000000-0000-0000-0000-000000000000.exe'])assert.throws(()=>objectPath(key));});
test('account erasure is fenced, revokes sessions, and waits for durable source cleanup',async()=>{
 const tenant=randomUUID(),user=randomUUID(),tokenHash=createHash('sha256').update(randomUUID()).digest('hex'),source=randomUUID(),job=randomUUID(),key=randomUUID()+'.txt';
 let requestId:string|undefined,accountRequest:string|undefined;
 try{
 await pool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'test',$2,'Deletion fixture')",[user,user]);await pool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);
 await pool.query("INSERT INTO sessions(token_hash,user_id,csrf,created_at) VALUES($1,$2,'fixture',now()-interval '11 minutes')",[tokenHash,user]);
 await transaction(tenant,async db=>{await db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2)',[tenant,emptyProfile]);await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'upload','Fixture',$3)",[source,tenant,key]);await db.query("INSERT INTO jobs(id,tenant_id,source_id,status,lease,lease_until) VALUES($1,$2,$3,'running',$4,now()+interval '1 minute')",[job,tenant,source,randomUUID()]);});
 await mkdir('.local/objects',{recursive:true});await writeFile(objectPath(key),'Disposable lifecycle fixture');
 await assert.rejects(eraseAccount(tenant,user,tokenHash),/Sign in again/);assert.equal((await pool.query('SELECT id FROM accounts WHERE id=$1',[user])).rowCount,1);
 await pool.query('UPDATE sessions SET created_at=now() WHERE token_hash=$1',[tokenHash]);
 await assert.rejects(eraseAccount(randomUUID(),user,tokenHash),/Workspace not found/);
 const pending=await transaction(tenant,async db=>{const receipt=await queueErasure(db,tenant,user,source,[key]);await db.query('DELETE FROM sources WHERE id=$1',[source]);return receipt;});requestId=pending.requestId;
 assert.equal((await deletionStatus(pending.receipt))?.status,'pending');assert.equal(await deletionStatus('not-a-receipt'),null);
 const account=await eraseAccount(tenant,user,tokenHash);accountRequest=account.requestId;assert.equal(account.status,'pending');
 assert.equal((await pool.query('SELECT * FROM sessions WHERE user_id=$1',[user])).rowCount,0);assert.equal((await pool.query('SELECT * FROM accounts WHERE id=$1',[user])).rowCount,0);
 assert.equal((await transaction(tenant,db=>db.query('SELECT * FROM jobs WHERE id=$1',[job]))).rowCount,0);
 await cleanupOne(async()=>{throw Error('simulated locked file');},requestId);
 assert.equal((await deletionStatus(account.receipt)).status,'pending');await access(objectPath(key));
 const retry=(await pool.query('SELECT attempt,last_error,lease FROM object_deletions WHERE request_id=$1',[requestId])).rows[0];assert.equal(retry.attempt,1);assert.equal(retry.last_error,'object_cleanup_failed');assert.equal(retry.lease,null);
 // A restarted worker sees the durable row and can finish after the retry delay.
 await pool.query('UPDATE object_deletions SET available_at=now() WHERE request_id=$1',[requestId]);await cleanupOne(unlink,requestId);
 await assert.rejects(access(objectPath(key)));assert.equal((await deletionStatus(pending.receipt)).status,'completed');assert.equal((await deletionStatus(account.receipt)).status,'completed');
 assert.equal(await cleanupOne(unlink,requestId),false);
 }finally{
 await unlink(objectPath(key)).catch(()=>{});
 await pool.query('DELETE FROM object_deletions WHERE request_id=ANY($1::uuid[])',[[requestId,accountRequest].filter(Boolean)]);await pool.query('DELETE FROM deletion_requests WHERE user_id=$1',[user]);await pool.query('DELETE FROM sessions WHERE user_id=$1',[user]);await pool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);await pool.query('DELETE FROM accounts WHERE id=$1',[user]);
 }
});
test('concurrent cleanup of separate sources completes the account receipt',async()=>{
 const tenant=randomUUID(),user=randomUUID();
 try{
 const sources=await Promise.all([0,1].map(()=>transaction(tenant,db=>queueErasure(db,tenant,user,randomUUID(),[randomUUID()+'.txt']))));
 const account=await transaction(tenant,db=>queueErasure(db,tenant,user,null,[]));assert.equal(account.status,'pending');
 let release:()=>void=()=>{},arrivals=0;const gate=new Promise<void>(resolve=>{release=resolve;});
 const remove=async()=>{if(++arrivals===2)release();await gate;};
 await Promise.all(sources.map(source=>cleanupOne(remove,source.requestId)));
 assert.equal((await deletionStatus(account.receipt)).status,'completed');
 for(const source of sources)assert.equal((await deletionStatus(source.receipt)).status,'completed');
 }finally{await pool.query('DELETE FROM object_deletions WHERE request_id IN (SELECT id FROM deletion_requests WHERE user_id=$1)',[user]);await pool.query('DELETE FROM deletion_requests WHERE user_id=$1',[user]);}
});
