import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {z} from 'zod';
import * as oidc from 'openid-client';
const flowSchema=z.object({verifier:z.string().min(32).max(256),nonce:z.string().min(16).max(256)}).strict();
function key(){const value=process.env.OIDC_FLOW_KEY;if(!value||!/^[0-9a-f]{64}$/i.test(value))throw Error('Login encryption key is not configured');return Buffer.from(value,'hex');}
export function sealFlow(flow:z.infer<typeof flowSchema>,state:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(state));const data=Buffer.concat([cipher.update(JSON.stringify(flowSchema.parse(flow)),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(part=>part.toString('base64url')).join('.');
}
export function openFlow(value:string,state:string){
 const parts=value.split('.');if(parts.length!==3)throw Error('Invalid login flow');const [iv,tag,data]=parts.map(part=>Buffer.from(part,'base64url'));if(iv.length!==12||tag.length!==16)throw Error('Invalid login flow');const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAAD(Buffer.from(state));decipher.setAuthTag(tag);return flowSchema.parse(JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString()));
}
export function providerAuthTime(value:unknown,now=Date.now()){
 if(value===undefined)return null;
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value*1000>now+60000)throw Error('Invalid provider authentication time');
 return new Date(value*1000);
}
export async function verifyGoogleCallback(config:oidc.Configuration,url:URL,flow:z.infer<typeof flowSchema>,state:string){
 oidc.enableNonRepudiationChecks(config);
 const tokens=await oidc.authorizationCodeGrant(config,url,{pkceCodeVerifier:flow.verifier,expectedState:state,expectedNonce:flow.nonce});
 const claims=tokens.claims();if(!claims)throw Error('Missing identity token');
 return {issuer:claims.iss,subject:claims.sub,name:typeof claims.name==='string'?claims.name:'Portfolio owner',authenticatedAt:providerAuthTime(claims.auth_time)};
}
