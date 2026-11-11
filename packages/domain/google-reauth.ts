import {identityPool} from '../db';

export async function completeGoogleReauth(binding:{user:string;session:string},current:{user_id:string;token_hash:string}|null,identity:{issuer:string;subject:string;authenticatedAt:Date|null}){
 if(!current||current.user_id!==binding.user||current.token_hash!==binding.session||identity.issuer!=='https://accounts.google.com')throw Error('Google confirmation is unavailable. Start again from Settings.');
 // OAuth confirmation permits enrollment only; it does not prove a fresh Google password check.
 const result=await identityPool.query(`UPDATE sessions s SET passkey_enrollment_verified_at=now() FROM accounts a
 WHERE s.token_hash=$1 AND s.user_id=$2 AND a.id=s.user_id AND a.issuer=$3 AND a.subject=$4
 AND s.expires_at>now() AND s.absolute_expires_at>now()`,[binding.session,binding.user,identity.issuer,identity.subject]);
 if(!result.rowCount)throw Error('Verify with the same Google account that is signed in.');
}
