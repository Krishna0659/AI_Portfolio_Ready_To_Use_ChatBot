import https from 'node:https';
import {lookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {httpFailure} from './errors';
export function publicAddress(address:string){try{const a=ipaddr.process(address);return a.range()==='unicast';}catch{return false;}}
export function safeUrl(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.hostname.endsWith('.')||u.hostname==='localhost')throw Error('Only public HTTPS URLs without credentials are supported');u.hash='';return u;}
export async function fetchPublic(raw:string,redirects=0):Promise<{body:Buffer;type:string;url:string}>{
 if(redirects>4)throw Error('Too many redirects');const u=safeUrl(raw);
 const addresses=await lookup(u.hostname.replace(/^\[|\]$/g,''),{all:true});
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Private or special network addresses are blocked');
 const address=addresses[0];
 return new Promise((resolve,reject)=>{const req=https.get(u,{agent:false,headers:{'User-Agent':'PortfolioAI/1.0 (owner-requested profile import)','Accept-Encoding':'identity'},lookup:((_host:unknown,opts:{all?:boolean},cb:Function)=>opts.all?cb(null,[address]):cb(null,address.address,address.family)) as never},res=>{
 if([301,302,303,307,308].includes(res.statusCode!)){res.resume();if(!res.headers.location)return reject(Error('Redirect missing location'));fetchPublic(new URL(res.headers.location,u).href,redirects+1).then(resolve,reject);return;}
 if(res.statusCode!==200){res.resume();return reject(httpFailure(res.statusCode??502,u.hostname,res.headers));}
 if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();return reject(Error('Compressed HTTP responses are not accepted'));}
 let bytes=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){res.destroy(Error('Page exceeds 2 MB'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({body:Buffer.concat(chunks),type:res.headers['content-type']??'',url:u.href}));
 });const timer=setTimeout(()=>req.destroy(Object.assign(Error('Source timed out after 15 seconds'),{code:'ETIMEDOUT'})),15000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);});
}
export function githubReadme(raw:string){const u=safeUrl(raw);const match=u.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);if(u.hostname!=='github.com'||!match||u.search)throw Error('Use a GitHub repository URL, such as https://github.com/owner/repository');return `https://api.github.com/repos/${match[1]}/${match[2]}/readme`;}


