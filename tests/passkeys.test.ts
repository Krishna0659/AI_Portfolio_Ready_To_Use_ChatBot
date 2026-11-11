import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {fixturePool} from './fixture-db';
import {pool,identityPool,workerPool} from '../packages/db';
import {passkeyOptions,finishPasskey} from '../packages/domain/passkeys';
import {consumePasskeyChallenge} from '../packages/domain/passkey-challenges';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';
after(()=>Promise.all([fixturePool.end(),pool.end(),identityPool.end(),workerPool.end()]));
test('enrollment requires fresh Google proof, preserves challenge encoding, rejects malformed proofs; grants expire',async()=>{
 const user=randomUUID(),token=randomBytes(32).toString('hex'),actor={user_id:user,token_hash:token,name:'Test'};
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'https://accounts.google.com',$2,'Test')",[user,user]);
  await fixturePool.query("INSERT INTO sessions(token_hash,user_id,csrf,created_at) VALUES($1,$2,'fixture',now()-interval '1 hour')",[token,user]);
  await assert.rejects(passkeyOptions(actor,'register'),/verified recent/);
  await assert.rejects(passkeyOptions(actor,'verify'),/Add a passkey/);
  await fixturePool.query('UPDATE sessions SET authenticated_at=now() WHERE token_hash=$1',[token]);
  const options=await passkeyOptions(actor,'register');
  assert.equal(options.challenge,await consumePasskeyChallenge(token,user,'register'));
  await passkeyOptions(actor,'register');
  await assert.rejects(finishPasskey(actor,'register',{} as RegistrationResponseJSON));
  await assert.rejects(consumePasskeyChallenge(token,user,'register'));
  assert.equal((await fixturePool.query('SELECT * FROM passkeys WHERE user_id=$1',[user])).rowCount,0);
  const recent=async()=> (await pool.query('SELECT session_recent($1,$2) recent',[token,user])).rows[0].recent;
  assert.equal(await recent(),false);
  const key=generateKeyPairSync('ed25519'),jwk=key.publicKey.export({format:'jwk'}),id=randomBytes(24).toString('base64url');
  const cose=Buffer.concat([Buffer.from('a4010103272006215820','hex'),Buffer.from(jwk.x!,'base64url')]);
  const registrationOptions=await passkeyOptions(actor,'register'),site=new URL(process.env.APP_ORIGIN!);
  const credentialId=Buffer.from(id,'base64url');
  const registrationData=Buffer.concat([createHash('sha256').update(site.hostname).digest(),Buffer.from([0x45,0,0,0,0]),Buffer.alloc(16),Buffer.from([0,credentialId.length]),credentialId,cose]);
  // CBOR map: fmt="none", attStmt={}, authData=<bytes>. No device attestation is requested.
  const attestation=Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746158','hex'),Buffer.from([registrationData.length]),registrationData]);
  const registration:RegistrationResponseJSON={id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:Buffer.from(JSON.stringify({type:'webauthn.create',challenge:registrationOptions.challenge,origin:site.origin})).toString('base64url'),attestationObject:attestation.toString('base64url')}};
  await finishPasskey(actor,'register',registration);
  const stored=(await fixturePool.query('SELECT user_id,public_key,counter FROM passkeys WHERE id=$1',[id])).rows[0];
  assert.equal(stored.user_id,user);assert.deepEqual(stored.public_key,cose);assert.equal(Number(stored.counter),0);
  assert.equal(await recent(),false,'registration alone must not grant sensitive-action verification');
  await assert.rejects(finishPasskey(actor,'register',registration));
  for(const fault of ['origin','rp','signature','user-verification','user-presence','user-handle','challenge','credential']){
   const challenge=(await passkeyOptions(actor,'verify')).challenge;
   const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:fault==='challenge'?'wrong':challenge,origin:fault==='origin'?'https://foreign.example':site.origin}));
   const authenticator=Buffer.concat([createHash('sha256').update(fault==='rp'?'foreign.example':site.hostname).digest(),Buffer.from([fault==='user-verification'?1:fault==='user-presence'?4:5,0,0,0,1])]);
   const signed=sign(null,Buffer.concat([authenticator,createHash('sha256').update(client).digest()]),key.privateKey);
   if(fault==='signature')signed[0]^=1;
   const response:AuthenticationResponseJSON={id:fault==='credential'?'foreign':id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:client.toString('base64url'),authenticatorData:authenticator.toString('base64url'),signature:signed.toString('base64url'),userHandle:Buffer.from(fault==='user-handle'?'foreign':user).toString('base64url')}};
   await assert.rejects(finishPasskey(actor,'verify',response),fault);
   assert.equal(await recent(),false,fault+' must not grant verification');
   assert.equal(Number((await fixturePool.query('SELECT counter FROM passkeys WHERE id=$1',[id])).rows[0].counter),0);
   await assert.rejects(consumePasskeyChallenge(token,user,'verify'));
  }
  const assertionOptions=await passkeyOptions(actor,'verify'),origin=new URL(process.env.APP_ORIGIN!);
  const clientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:assertionOptions.challenge,origin:origin.origin}));
  const authData=Buffer.concat([createHash('sha256').update(origin.hostname).digest(),Buffer.from([5,0,0,0,1])]);
  const signature=sign(null,Buffer.concat([authData,createHash('sha256').update(clientData).digest()]),key.privateKey);
  const assertion:AuthenticationResponseJSON={id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:signature.toString('base64url'),userHandle:Buffer.from(user).toString('base64url')}};
  await finishPasskey(actor,'verify',assertion);
  assert.equal(await recent(),true);
  assert.equal(Number((await fixturePool.query('SELECT counter FROM passkeys WHERE id=$1',[id])).rows[0].counter),1);
  await assert.rejects(finishPasskey(actor,'verify',assertion));
  await fixturePool.query('UPDATE sessions SET passkey_verified_at=now() WHERE token_hash=$1',[token]);
  assert.equal(await recent(),true);
  assert.equal((await pool.query('SELECT session_recent($1,$2) recent',[token,randomUUID()])).rows[0].recent,false);
  await fixturePool.query("UPDATE sessions SET passkey_verified_at=now()-interval '6 minutes' WHERE token_hash=$1",[token]);
  assert.equal(await recent(),false);
  await fixturePool.query("UPDATE sessions SET passkey_verified_at=now(),expires_at=now()-interval '1 second' WHERE token_hash=$1",[token]);
  assert.equal(await recent(),false);
 }finally{await fixturePool.query('DELETE FROM sessions WHERE token_hash=$1',[token]);await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);}
});
