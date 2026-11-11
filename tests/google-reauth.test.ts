import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {fixturePool} from './fixture-db';
import {pool,identityPool,workerPool} from '../packages/db';
import {completeGoogleReauth} from '../packages/domain/google-reauth';
after(()=>Promise.all([fixturePool.end(),pool.end(),identityPool.end(),workerPool.end()]));
test('Google re-verification cannot change accounts or grant proof to another session',async()=>{
 const user=randomUUID(),token=randomBytes(32).toString('hex'),binding={user,session:token},current={user_id:user,token_hash:token};
 const proof={issuer:'https://accounts.google.com',subject:user,authenticatedAt:new Date()};
 try{
  await fixturePool.query('INSERT INTO accounts(id,issuer,subject,name) VALUES($1,$2,$3,$4)',[user,proof.issuer,user,'Reauth fixture']);
  await fixturePool.query("INSERT INTO sessions(token_hash,user_id,csrf) VALUES($1,$2,'fixture')",[token,user]);
  for(const actor of [null,{...current,user_id:randomUUID()},{...current,token_hash:'other'}])await assert.rejects(completeGoogleReauth(binding,actor,proof));
  for(const authenticatedAt of [null,new Date(Date.now()-360000),new Date(Date.now()+120000)])await assert.rejects(completeGoogleReauth(binding,current,{...proof,authenticatedAt}));
  await assert.rejects(completeGoogleReauth(binding,current,{...proof,subject:'other-account'}));
  await assert.rejects(completeGoogleReauth(binding,current,{...proof,issuer:'https://other.example'}));
  assert.equal((await fixturePool.query('SELECT authenticated_at FROM sessions WHERE token_hash=$1',[token])).rows[0].authenticated_at,null);
  await completeGoogleReauth(binding,current,proof);
  assert.equal((await fixturePool.query('SELECT authenticated_at FROM sessions WHERE token_hash=$1',[token])).rows[0].authenticated_at.getTime(),proof.authenticatedAt.getTime());
  await fixturePool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[token]);
  await assert.rejects(completeGoogleReauth(binding,current,proof));
 }finally{await fixturePool.query('DELETE FROM sessions WHERE token_hash=$1',[token]);await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);}
});
