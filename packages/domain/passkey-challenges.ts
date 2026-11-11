import {randomBytes} from 'node:crypto';
import {identityPool} from '../db';

type Purpose='register'|'verify';
// Keep at most one challenge per purpose/session. Replacing it invalidates older prompts.
export async function issuePasskeyChallenge(sessionHash:string,user:string,purpose:Purpose){
 const challenge=randomBytes(32).toString('base64url');
 const result=await identityPool.query(`INSERT INTO passkey_challenges(session_hash,purpose,challenge)
 SELECT token_hash,$3,$4 FROM sessions WHERE token_hash=$1 AND user_id=$2
 AND expires_at>now() AND absolute_expires_at>now()
 ON CONFLICT(session_hash,purpose) DO UPDATE SET challenge=excluded.challenge,expires_at=now()+interval '5 minutes'
 RETURNING challenge`,[sessionHash,user,purpose,challenge]);
 if(!result.rowCount)throw Error('Sign in again before verifying your identity.');
 return challenge;
}

export async function consumePasskeyChallenge(sessionHash:string,user:string,purpose:Purpose){
 // Consume before cryptographic verification: failed responses also invalidate the prompt.
 const result=await identityPool.query(`DELETE FROM passkey_challenges c USING sessions s
 WHERE c.session_hash=s.token_hash AND s.token_hash=$1 AND s.user_id=$2 AND c.purpose=$3
 AND c.expires_at>now() AND s.expires_at>now() AND s.absolute_expires_at>now()
 RETURNING c.challenge`,[sessionHash,user,purpose]);
 if(!result.rowCount)throw Error('Verification expired or was already used. Try again.');
 return result.rows[0].challenge as string;
}
