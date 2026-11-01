import {createPrivateKey,createSign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {githubReadme} from '../fetch-broker/fetch';
import {httpFailure} from '../fetch-broker/errors';

export type AppConfig={appId:string;installationId:string;privateKey:string};
export function ownerAppEnabled(tenant:string){return tenant===process.env.GITHUB_OWNER_WORKSPACE_ID&&!!process.env.GITHUB_APP_ID&&!!process.env.GITHUB_INSTALLATION_ID&&!!process.env.GITHUB_PRIVATE_KEY_PATH;}
export function appJwt(config:AppConfig,now=Date.now()){
 const key=createPrivateKey(config.privateKey);if(key.asymmetricKeyType!=='rsa')throw Error('GitHub App requires an RSA private key');
 const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const body=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:Math.floor(now/1000)-60,exp:Math.floor(now/1000)+540,iss:config.appId});
 return body+'.'+createSign('RSA-SHA256').update(body).sign(key).toString('base64url');
}
type Transport=(path:string,credential:string,body?:unknown)=>Promise<unknown>;
// Only fixed GitHub API paths are accepted; credentials never follow redirects.
export async function githubRequest(path:string,credential:string,body?:unknown){
 if(!/^\/(repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(installation|readme)|app\/installations\/[0-9]+\/access_tokens)$/.test(path))throw Error('Unsupported GitHub API operation');
 const response=await fetch('https://api.github.com'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${credential}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'PortfolioAI/1.0','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!response.ok)throw httpFailure(response.status,'api.github.com',Object.fromEntries(response.headers));
 const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw Error('GitHub response exceeds 2 MB');}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString());
}
export async function appReadme(url:string,config:AppConfig,request:Transport=githubRequest){
 const endpoint=new URL(githubReadme(url)).pathname;const repo=endpoint.split('/')[3];
 const jwt=appJwt(config);const installation=z.object({id:z.number().int().positive(),suspended_at:z.string().nullable().optional()}).parse(await request(endpoint.replace(/\/readme$/,'/installation'),jwt));
 if(String(installation.id)!==config.installationId||installation.suspended_at)throw Error('Repository is not available through the configured GitHub App installation');
 const token=z.object({token:z.string().min(1),expires_at:z.string().datetime()}).parse(await request(`/app/installations/${config.installationId}/access_tokens`,jwt,{repositories:[repo],permissions:{contents:'read'}}));
 if(Date.parse(token.expires_at)<=Date.now())throw Error('GitHub returned an expired installation token');
 const readme=z.object({encoding:z.literal('base64'),content:z.string().max(2000000),size:z.number().max(1500000)}).parse(await request(endpoint,token.token));
 return Buffer.from(readme.content,'base64');
}
export async function ownerReadme(url:string,tenant:string){
 if(!ownerAppEnabled(tenant))throw Error('GitHub App is not configured for this workspace');
 const appId=z.string().regex(/^\d+$/).parse(process.env.GITHUB_APP_ID);const installationId=z.string().regex(/^\d+$/).parse(process.env.GITHUB_INSTALLATION_ID);
 let privateKey:string;try{privateKey=await readFile(process.env.GITHUB_PRIVATE_KEY_PATH!,'utf8');}catch{throw Error('GitHub private key file could not be read. Check the local configuration.');}
 return appReadme(url,{appId,installationId,privateKey});
}
