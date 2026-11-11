import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {fixturePool} from './fixture-db';
import {pool,identityPool,workerPool} from '../packages/db';
import {completeGoogleReauth} from '../packages/domain/google-reauth';
after(()=>Promise.all([fixturePool.end(),pool.end(),identityPool.end(),workerPool.end()]));
for(const account of ['first','second'])test(`Google confirmation isolates ${account} account and session without auth_time`,async()=>{
 const user=randomUUID(),token=randomBytes(32).toString('hex'),binding={user,session:token},current={user_id:user,token_hash:token};
 const proof={issuer:'https://accounts.google.com',subject:user,authenticatedAt:new Date()};
 try{
  await fixturePool.query('INSERT INTO accounts(id,issuer,subject,name) VALUES($1,$2,$3,$4)',[user,proof.issuer,user,'Reauth fixture']);
  await fixturePool.query("INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,'fixture')",[token,user]);
  const sibling=randomBytes(32).toString('hex');
  await fixturePool.query("INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,'fixture')",[sibling,user]);
  for(const actor of [null,{...current,user_id:randomUUID()},{...current,token_hash:'other'}])await assert.rejects(completeGoogleReauth(binding,actor,proof));

  await assert.rejects(completeGoogleReauth(binding,current,{...proof,subject:'other-account'}));
  await assert.rejects(completeGoogleReauth(binding,current,{...proof,issuer:'https://other.example'}));
  assert.equal((await fixturePool.query('SELECT authenticated_at FROM sessions WHERE token_hash=$1',[token])).rows[0].authenticated_at,null);
  await completeGoogleReauth(binding,current,{...proof,authenticatedAt:null});
  const grant=(await fixturePool.query('SELECT authenticated_at,passkey_enrollment_verified_at FROM sessions WHERE token_hash=$1',[token])).rows[0];
  assert.equal(grant.authenticated_at,null);
  assert.ok(grant.passkey_enrollment_verified_at);
  assert.equal((await fixturePool.query('SELECT passkey_enrollment_verified_at FROM sessions WHERE token_hash=$1',[sibling])).rows[0].passkey_enrollment_verified_at,null);
  await fixturePool.query('UPDATE sessions SET authenticated_at=now() WHERE token_hash=$1',[token]);
  assert.equal((await pool.query('SELECT session_recent($1,$2) recent',[token,user])).rows[0].recent,false);
  await fixturePool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[token]);
  await assert.rejects(completeGoogleReauth(binding,current,proof));
 }finally{await fixturePool.query('DELETE FROM sessions WHERE user_id=$1',[user]);await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);}
});
