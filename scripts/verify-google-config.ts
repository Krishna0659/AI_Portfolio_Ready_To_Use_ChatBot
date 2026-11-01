import assert from 'node:assert/strict';
import {identityPool as pool} from '../packages/db';
import {openFlow} from '../packages/domain/oidc-flow';
let state:string|undefined;
try{
 const response=await fetch('http://localhost:3000/api/auth/google',{redirect:'manual'});assert.equal(response.status,307,'Google sign-in must start successfully');
 const url=new URL(response.headers.get('location')!);assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('client_id'),process.env.GOOGLE_CLIENT_ID);assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3000/api/auth/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('prompt'),'select_account');assert.ok(!url.searchParams.has('client_secret'));state=url.searchParams.get('state')!;
 const row=(await pool.query('SELECT verifier,nonce FROM auth_flows WHERE state=$1',[state])).rows[0];assert.equal(row.nonce,'sealed-v1');const flow=openFlow(row.verifier,state);assert.equal(flow.nonce,url.searchParams.get('nonce'));assert.ok(!row.verifier.includes(flow.verifier));
 const invalid=await fetch('http://localhost:3000/api/auth/callback?state='+encodeURIComponent(state)+'&code=invalid',{redirect:'manual'});assert.equal(invalid.status,400);assert.equal((await pool.query('SELECT state FROM auth_flows WHERE state=$1',[state])).rowCount,1,'Cookie mismatch must not consume another browser flow');
 console.log('Google discovery and authorization redirect passed; exact callback, PKCE, nonce, encrypted flow and cookie-state rejection verified. This automated check does not complete interactive sign-in.');
}finally{if(state)await pool.query('DELETE FROM auth_flows WHERE state=$1',[state]);await pool.end();}
