import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealFlow,openFlow,providerAuthTime} from '../packages/domain/oidc-flow';
test('transient OIDC secrets are encrypted, authenticated and bound to their state',()=>{
 const previous=process.env.OIDC_FLOW_KEY;process.env.OIDC_FLOW_KEY=randomBytes(32).toString('hex');
 try{const flow={verifier:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url')},state=randomBytes(32).toString('hex'),sealed=sealFlow(flow,state);assert.deepEqual(openFlow(sealed,state),flow);assert.ok(!sealed.includes(flow.verifier));assert.notEqual(sealFlow(flow,state),sealed);assert.throws(()=>openFlow(sealed,'other-state'));const parts=sealed.split('.'),data=Buffer.from(parts[2],'base64url');data[0]^=1;parts[2]=data.toString('base64url');assert.throws(()=>openFlow(parts.join('.'),state));process.env.OIDC_FLOW_KEY=randomBytes(32).toString('hex');assert.throws(()=>openFlow(sealed,state));process.env.OIDC_FLOW_KEY='';assert.throws(()=>sealFlow(flow,state));}
 finally{if(previous===undefined)delete process.env.OIDC_FLOW_KEY;else process.env.OIDC_FLOW_KEY=previous;}
});
test('missing provider authentication time is never replaced with token issuance time',()=>{
 const now=1700000000000;assert.equal(providerAuthTime(undefined,now),null);assert.equal(providerAuthTime(1699999000,now)?.getTime(),1699999000000);
 for(const value of [null,'1700000000',0,-1,Infinity,NaN,1700000100])assert.throws(()=>providerAuthTime(value,now));
});
