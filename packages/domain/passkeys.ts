import {generateRegistrationOptions,generateAuthenticationOptions,verifyRegistrationResponse,verifyAuthenticationResponse} from '@simplewebauthn/server';
import type {RegistrationResponseJSON,AuthenticationResponseJSON} from '@simplewebauthn/server';
import {identityPool} from '../db';
import {issuePasskeyChallenge,consumePasskeyChallenge} from './passkey-challenges';

type Actor={token_hash:string;user_id:string;name:string};
const denied=()=>Object.assign(Error('Verification failed or expired. Start again.'),{status:400});
function relyingParty(){const origin=new URL(process.env.APP_ORIGIN!);return {origin:origin.origin,rpID:origin.hostname};}
async function freshGoogle(actor:Actor){
 const r=await identityPool.query(`SELECT 1 FROM sessions s JOIN accounts a ON a.id=s.user_id
 WHERE s.token_hash=$1 AND s.user_id=$2 AND a.issuer='https://accounts.google.com'
 AND s.expires_at>now() AND s.absolute_expires_at>now()
 AND s.passkey_enrollment_verified_at>now()-interval '5 minutes' AND s.passkey_enrollment_verified_at<=now()`,[actor.token_hash,actor.user_id]);
 if(!r.rowCount)throw Object.assign(Error('Choose Verify with Google in Settings, use the same account, then add your passkey within five minutes.'),{status:403});
}
export async function passkeyOptions(actor:Actor,purpose:'register'|'verify'){
 if(purpose==='register')await freshGoogle(actor);
 const credentials=(await identityPool.query('SELECT id FROM passkeys WHERE user_id=$1',[actor.user_id])).rows;
 if(purpose==='register'&&credentials.length>=5)throw Object.assign(Error('This account already has five passkeys.'),{status:400});
 if(purpose==='verify'&&!credentials.length)throw Object.assign(Error('Add a passkey first.'),{status:400});
 const challenge=new Uint8Array(Buffer.from(await issuePasskeyChallenge(actor.token_hash,actor.user_id,purpose),'base64url')),{rpID}=relyingParty();
 return purpose==='register'
 ?generateRegistrationOptions({rpName:'PortfolioAI',rpID,userName:actor.name,userID:new TextEncoder().encode(actor.user_id),challenge,attestationType:'none',excludeCredentials:credentials,authenticatorSelection:{residentKey:'preferred',userVerification:'required'}})
 :generateAuthenticationOptions({rpID,challenge,allowCredentials:credentials,userVerification:'required'});
}
export async function finishPasskey(actor:Actor,purpose:'register'|'verify',response:RegistrationResponseJSON|AuthenticationResponseJSON){
 const expectedChallenge=await consumePasskeyChallenge(actor.token_hash,actor.user_id,purpose);
 const {origin:expectedOrigin,rpID:expectedRPID}=relyingParty();
 if(purpose==='register'){
  await freshGoogle(actor);
  const result=await verifyRegistrationResponse({response:response as RegistrationResponseJSON,expectedChallenge,expectedOrigin,expectedRPID,requireUserPresence:true,requireUserVerification:true});
  if(!result.verified)throw denied();
  const c=result.registrationInfo.credential;
  const db=await identityPool.connect();try{
   await db.query('BEGIN');
   await db.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[actor.user_id]);
   const active=await db.query("UPDATE sessions SET passkey_enrollment_verified_at=NULL WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() AND absolute_expires_at>now() AND passkey_enrollment_verified_at>now()-interval '5 minutes' AND passkey_enrollment_verified_at<=now() RETURNING token_hash",[actor.token_hash,actor.user_id]);
   if(!active.rowCount)throw denied();
   if(Number((await db.query('SELECT count(*) FROM passkeys WHERE user_id=$1',[actor.user_id])).rows[0].count)>=5)throw denied();
   await db.query('INSERT INTO passkeys(id,user_id,public_key,counter,transports) VALUES($1,$2,$3,$4,$5)',[c.id,actor.user_id,Buffer.from(c.publicKey),c.counter,c.transports??[]]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  return;
 }
 const db=await identityPool.connect();try{
  await db.query('BEGIN');
  const credential=(await db.query('SELECT * FROM passkeys WHERE id=$1 AND user_id=$2 FOR UPDATE',[response.id,actor.user_id])).rows[0];
  if(!credential)throw denied();
  const assertion=response as AuthenticationResponseJSON;
  if(assertion.response.userHandle&&assertion.response.userHandle!==Buffer.from(actor.user_id).toString('base64url'))throw denied();
  const result=await verifyAuthenticationResponse({response:assertion,expectedChallenge,expectedOrigin,expectedRPID,requireUserVerification:true,credential:{id:credential.id,publicKey:new Uint8Array(credential.public_key),counter:Number(credential.counter)}});
  if(!result.verified)throw denied();
  await db.query('UPDATE passkeys SET counter=$2 WHERE id=$1',[credential.id,result.authenticationInfo.newCounter]);
  const grant=await db.query('UPDATE sessions SET passkey_verified_at=now() WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() AND absolute_expires_at>now()',[actor.token_hash,actor.user_id]);
  if(!grant.rowCount)throw denied();
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
