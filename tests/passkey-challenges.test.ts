import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {fixturePool} from './fixture-db';
import {pool,identityPool,workerPool} from '../packages/db';
import {issuePasskeyChallenge,consumePasskeyChallenge} from '../packages/domain/passkey-challenges';

after(()=>Promise.all([fixturePool.end(),pool.end(),identityPool.end(),workerPool.end()]));
test('passkey challenges bind account, session and purpose; expire and consume exactly once',async()=>{
 const user=randomUUID(),other=randomUUID(),session=randomBytes(32).toString('hex');
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'test',$2,'Passkey fixture')",[user,user]);
  await fixturePool.query('INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,$3)',[session,user,randomBytes(32).toString('hex')]);
  for(const db of [pool,workerPool])for(const table of ['passkeys','passkey_challenges'])await assert.rejects(db.query(`SELECT * FROM ${table}`),/permission denied/);
  await assert.rejects(issuePasskeyChallenge(session,other,'register'));
  const old=await issuePasskeyChallenge(session,user,'register');
  const current=await issuePasskeyChallenge(session,user,'register');
  assert.notEqual(current,old);
  await assert.rejects(consumePasskeyChallenge(session,other,'register'));
  await assert.rejects(consumePasskeyChallenge(session,user,'verify'));
  await assert.rejects(consumePasskeyChallenge('foreign-session',user,'register'));
  const results=await Promise.allSettled([consumePasskeyChallenge(session,user,'register'),consumePasskeyChallenge(session,user,'register')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='fulfilled')?.value,current);
  await issuePasskeyChallenge(session,user,'verify');
  await fixturePool.query("UPDATE passkey_challenges SET expires_at=now()-interval '1 second' WHERE session_hash=$1",[session]);
  await assert.rejects(consumePasskeyChallenge(session,user,'verify'));
  await issuePasskeyChallenge(session,user,'verify');
  await fixturePool.query("UPDATE sessions SET absolute_expires_at=now()-interval '1 second' WHERE token_hash=$1",[session]);
  await assert.rejects(consumePasskeyChallenge(session,user,'verify'));
  await assert.rejects(issuePasskeyChallenge(session,user,'verify'));
 }finally{
  await fixturePool.query('DELETE FROM sessions WHERE token_hash=$1',[session]);
  assert.equal((await fixturePool.query('SELECT * FROM passkey_challenges WHERE session_hash=$1',[session])).rowCount,0);
  await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);
 }
});
