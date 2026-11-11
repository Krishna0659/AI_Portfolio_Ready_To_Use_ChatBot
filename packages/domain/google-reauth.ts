import {identityPool} from '../db';

export async function completeGoogleReauth(binding:{user:string;session:string},current:{user_id:string;token_hash:string}|null,identity:{issuer:string;subject:string;authenticatedAt:Date|null}){
 const time=identity.authenticatedAt?.getTime(),now=Date.now();
 if(!current||current.user_id!==binding.user||current.token_hash!==binding.session||!time||time<now-300000||time>now+60000)throw Error('Recent Google verification is unavailable. Start again from Settings.');
 const result=await identityPool.query(`UPDATE sessions s SET authenticated_at=$3 FROM accounts a
 WHERE s.token_hash=$1 AND s.user_id=$2 AND a.id=s.user_id AND a.issuer=$4 AND a.subject=$5
 AND s.expires_at>now() AND s.absolute_expires_at>now()`,[binding.session,binding.user,identity.authenticatedAt,identity.issuer,identity.subject]);
 if(!result.rowCount)throw Error('Verify with the same Google account that is signed in.');
}
