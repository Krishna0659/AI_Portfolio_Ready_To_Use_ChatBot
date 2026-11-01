import {fixturePool} from './fixture-db';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../packages/db';
import {claimJob,heartbeat,completeJob,failJob,retryDecision} from '../packages/domain/jobs';
import {httpFailure} from '../services/fetch-broker/errors';
after(()=>Promise.all([pool.end(),fixturePool.end()]));
test('retry policy backs off transient connections and respects provider waits',()=>{
 const network=new TypeError('fetch failed',{cause:Object.assign(Error('private connection details'),{code:'ECONNRESET'})});
 assert.equal(retryDecision(network,1,0,()=>0.5).retryAt?.getTime(),5000);assert.equal(retryDecision(network,3,0,()=>0.5).retryAt?.getTime(),20000);assert.equal(retryDecision(network,5,0).retryAt,null);
 assert.equal(retryDecision(httpFailure(429,'example.com',{'retry-after':'120'},0),1,0).retryAt?.getTime(),120000);
 for(const error of [Error('Invalid document'),httpFailure(403,'example.com',{},0),Object.assign(Error('bad hostname'),{code:'ENOTFOUND'})])assert.equal(retryDecision(error,1).retryAt,null);
 assert.equal(retryDecision(network,1).message,'The source connection was interrupted.');
});
test('job leases renew, recover and reject late success/failure after cancellation or reassignment',async()=>{
 const user=randomUUID(),tenant=randomUUID(),source=randomUUID(),jobId=randomUUID();
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'jobs-test',$2,'Job fixture')",[user,user]);await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);
  await transaction(tenant,async db=>{await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'web','Job fixture','https://example.com')",[source,tenant]);await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)',[jobId,tenant,source]);});
  const old=(await claimJob(tenant,false))!;assert.equal(old.attempt,1);assert.equal(await claimJob(tenant,false),null);
  await transaction(tenant,db=>db.query("UPDATE jobs SET lease_until=now()+interval '1 second' WHERE id=$1",[jobId]));assert.equal(await heartbeat(old),true);
  assert.equal((await transaction(tenant,db=>db.query("SELECT lease_until>now()+interval '50 seconds' renewed FROM jobs WHERE id=$1",[jobId]))).rows[0].renewed,true);
  await transaction(tenant,db=>db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[jobId]));assert.equal(await heartbeat(old),false);assert.equal(await completeJob(old,'Expired result'),false);assert.equal(await failJob(old,Error('Expired failure'),false),false);
  assert.equal(await claimJob(tenant,false),null);await transaction(tenant,db=>db.query('UPDATE jobs SET available_at=now() WHERE id=$1',[jobId]));const current=(await claimJob(tenant,false))!;assert.equal(current.attempt,2);assert.notEqual(current.lease,old.lease);
  assert.equal(await completeJob(old,'Late result'),false);assert.equal(await failJob(old,Error('Late failure'),false),false);
  assert.equal(await completeJob({...current,tenant_id:randomUUID()},'Foreign result'),false);
  assert.equal(await failJob(current,Object.assign(Error('Temporary network loss'),{code:'ECONNRESET'}),false),true);
  const queued=(await transaction(tenant,db=>db.query('SELECT status,available_at>now() delayed FROM jobs WHERE id=$1',[jobId]))).rows[0];assert.equal(queued.status,'queued');assert.equal(queued.delayed,true);
  await transaction(tenant,db=>db.query('UPDATE jobs SET available_at=now() WHERE id=$1',[jobId]));const cancelled=(await claimJob(tenant,false))!;
  await transaction(tenant,db=>db.query("UPDATE jobs SET status='cancelled',lease=NULL WHERE id=$1",[jobId]));assert.equal(await heartbeat(cancelled),false);assert.equal(await completeJob(cancelled,'Cancelled result'),false);assert.equal(await failJob(cancelled,Error('Cancelled failure'),false),false);
  await transaction(tenant,db=>db.query("UPDATE jobs SET status='queued',available_at=now() WHERE id=$1",[jobId]));const valid=(await claimJob(tenant,false))!;assert.equal(await completeJob(valid,'Valid evidence'),true);assert.equal(await completeJob(valid,'Duplicate evidence'),false);
  assert.equal((await transaction(tenant,db=>db.query('SELECT text FROM snapshots WHERE source_id=$1',[source]))).rows[0].text,'Valid evidence');
 }finally{await fixturePool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);}
});
