import test from 'node:test';
import assert from 'node:assert/strict';
import {authDiagnostic,authErrorMessage} from '../packages/domain/auth-errors';
test('authentication diagnostics retain error codes without credentials or identity claims',()=>{
 const error={code:'OAUTH_INVALID_RESPONSE',message:'token-secret',cause:{code:'ERR_JWT_CLAIM',claim:'nonce',value:'secret-nonce',response:{email:'private@example.com',id_token:'token-secret'}}};const diagnostic=authDiagnostic('provider',error);assert.deepEqual(diagnostic.codes,['OAUTH_INVALID_RESPONSE','ERR_JWT_CLAIM']);assert.equal(diagnostic.claim,'nonce');assert.ok(!JSON.stringify(diagnostic).includes('secret'));assert.ok(!JSON.stringify(diagnostic).includes('private@'));assert.match(authErrorMessage('state'),/one tab/);
});
