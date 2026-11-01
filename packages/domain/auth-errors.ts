import {randomUUID} from 'node:crypto';
export function authDiagnostic(stage:string,error:unknown){
 const codes:string[]=[];let claim:string|undefined,current=error;
 for(let depth=0;current&&typeof current==='object'&&depth<4;depth++){
  const e=current as {code?:unknown;claim?:unknown;cause?:unknown};
  if(typeof e.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(e.code))codes.push(e.code);
  if(typeof e.claim==='string'&&['iss','aud','exp','iat','nonce','auth_time'].includes(e.claim))claim=e.claim;
  current=e.cause;
 }
 return {reference:randomUUID(),time:new Date().toISOString(),stage,codes,claim};
}
export function authErrorMessage(stage:string){
 if(stage==='state')return 'This sign-in attempt no longer matches this browser. Start again from localhost:3000 in one tab; avoid the Back button.';
 if(stage==='flow')return 'This sign-in attempt expired or was already used. Start again from localhost:3000.';
 if(stage==='account')return 'Google verified the sign-in, but the workspace could not be opened. Retry and share the error reference if it continues.';
 return 'Google sign-in could not complete. Start a new sign-in attempt and share the error reference if it continues.';
}
