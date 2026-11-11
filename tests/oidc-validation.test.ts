import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import * as oidc from 'openid-client';
import {verifyGoogleCallback} from '../packages/domain/oidc-flow';
const keys=generateKeyPairSync('rsa',{modulusLength:2048}),foreign=generateKeyPairSync('rsa',{modulusLength:2048});
const flow={verifier:'v'.repeat(43),nonce:'n'.repeat(32)},state='s'.repeat(32),callback=new URL('http://localhost:3000/api/auth/callback?code=fixture&state='+state);
function config(claimOverrides:Record<string,unknown>={},wrongSignature=false){
 const now=Math.floor(Date.now()/1000),claims={iss:'https://accounts.google.com',sub:'fixture-subject',aud:'fixture-client',iat:now-10,exp:now+300,nonce:flow.nonce,...claimOverrides};
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url'),body=encode({alg:'RS256',kid:'fixture-key'})+'.'+encode(claims),jwt=body+'.'+createSign('RSA-SHA256').update(body).sign(wrongSignature?foreign.privateKey:keys.privateKey).toString('base64url');
 const c=new oidc.Configuration({issuer:'https://accounts.google.com',token_endpoint:'https://oauth2.googleapis.com/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs'},'fixture-client',{client_secret:'fixture-secret'});
 c[oidc.customFetch]=async(url,options)=>{
  if(String(url)==='https://oauth2.googleapis.com/token'){assert.equal(new URLSearchParams(String(options?.body)).get('code_verifier'),flow.verifier);return Response.json({access_token:'fixture-access-token',token_type:'Bearer',id_token:jwt});}
  assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'}]});
 };return c;
}
test('Google callback validates signatures, audience, issuer, nonce, expiry and state',async()=>{
 const identity=await verifyGoogleCallback(config(),callback,flow,state);assert.equal(identity.subject,'fixture-subject');assert.equal(identity.authenticatedAt,null);
 const confirmationFlow={...flow,reauth:{user:'00000000-0000-4000-8000-000000000001',session:'a'.repeat(64)}};
 assert.equal((await verifyGoogleCallback(config(),callback,confirmationFlow,state)).authenticatedAt,null);
 await assert.rejects(verifyGoogleCallback(config({},true),callback,confirmationFlow,state));
 for(const claims of [{aud:'another-client'},{iss:'https://attacker.example'},{nonce:'replayed-nonce'},{exp:Math.floor(Date.now()/1000)-300}])await assert.rejects(verifyGoogleCallback(config(claims),callback,flow,state));
 await assert.rejects(verifyGoogleCallback(config({},true),callback,flow,state));await assert.rejects(verifyGoogleCallback(config(),callback,flow,'another-state'));
});
