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

/** Parse same-origin href links from an HTML page body. */
export function extractLinks(html:string,base:URL):string[]{
 const links:string[]=[];
 const re=/<a\s[^>]*href=["']([^"'#?][^"']*?)["']/gi;
 let m:RegExpExecArray|null;
 while((m=re.exec(html))!==null){
  try{
   const target=new URL(m[1],base);
   if(target.hostname===base.hostname&&target.protocol==='https:')links.push(target.href);
  }catch{}
 }
 return links;
}

/** Parse robots.txt Disallow directives for User-agent: * or PortfolioAI. */
export function parseRobots(text:string,userAgent='PortfolioAI'):{disallow:RegExp[];crawlDelay:number}{
 const disallow:string[]=[];let crawlDelay=0;let relevant=false;
 for(const line of text.split(/\r?\n/)){
  const l=line.replace(/#.*/,'').trim();
  if(!l)continue;
  if(/^user-agent:/i.test(l)){const ua=l.replace(/^user-agent:\s*/i,'').trim();relevant=ua==='*'||ua.toLowerCase()===userAgent.toLowerCase();}
  else if(relevant&&/^disallow:/i.test(l)){const p=l.replace(/^disallow:\s*/i,'').trim();if(p)disallow.push(p);}
  else if(relevant&&/^crawl-delay:/i.test(l)){const d=parseFloat(l.replace(/^crawl-delay:\s*/i,''));if(!isNaN(d))crawlDelay=Math.max(crawlDelay,d);}
 }
 const patterns=disallow.map(p=>{const escaped=p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?$/,'$');return new RegExp('^'+escaped);});
 return{disallow:patterns,crawlDelay};
}

function sleep(ms:number):Promise<void>{return new Promise(r=>setTimeout(r,ms));}

export type CrawledPage={url:string;text:string};

/**
 * TR11 Multi-page website crawl.
 * Crawls same-origin pages starting from startUrl, respecting robots.txt,
 * depth <= maxDepth (default 2), page count <= maxPages (default 25),
 * per-page and total byte limits, 1s minimum delay between requests.
 * No cookies, no browser execution. Only same-origin HTTPS links followed.
 */
export async function crawlPages(
 startUrl:string,
 opts:{maxPages?:number;maxDepth?:number;maxBytesPerPage?:number;maxBytesTotal?:number;delayMs?:number}={}
):Promise<{pages:CrawledPage[];partial:boolean}>{
 const maxPages=opts.maxPages??25;
 const maxDepth=opts.maxDepth??2;
 const maxBytesPerPage=opts.maxBytesPerPage??(2*1024*1024);
 const maxBytesTotal=opts.maxBytesTotal??(20*1024*1024);
 const minDelayMs=opts.delayMs??1000;

 const start=safeUrl(startUrl);
 const origin=start.origin;

 // Fetch robots.txt
 let robots:{disallow:RegExp[];crawlDelay:number}={disallow:[],crawlDelay:0};
 try{
  const r=await fetchPublic(`${origin}/robots.txt`);
  robots=parseRobots(r.body.toString('utf8'));
 }catch{/* absent or unreachable — no restrictions */}
 const delayMs=Math.max(minDelayMs,robots.crawlDelay*1000);

 function isAllowed(url:URL):boolean{
  const path=url.pathname+(url.search?url.search:'');
  return !robots.disallow.some(re=>re.test(path));
 }

 const visited=new Set<string>();
 const bfsQueue:Array<[string,number]>=[[start.href,0]];
 const pages:CrawledPage[]=[];
 let totalBytes=0;
 let partial=false;
 let lastFetch=0;

 while(bfsQueue.length>0){
  if(pages.length>=maxPages){partial=true;break;}
  const [rawUrl,depth]=bfsQueue.shift()!;
  let url:URL;
  try{url=new URL(rawUrl);}catch{continue;}
  if(url.origin!==origin)continue;
  if(visited.has(url.href))continue;
  if(!isAllowed(url))continue;
  visited.add(url.href);

  // Throttle between requests
  const now=Date.now();const wait=delayMs-(now-lastFetch);
  if(wait>0)await sleep(wait);
  lastFetch=Date.now();

  let result:{body:Buffer;type:string;url:string};
  try{result=await fetchPublic(url.href);}catch{continue;}

  const pageBytes=result.body.length;
  if(pageBytes>maxBytesPerPage)continue;
  if(totalBytes+pageBytes>maxBytesTotal){partial=true;break;}
  totalBytes+=pageBytes;
  const text=result.body.toString('utf8');
  pages.push({url:url.href,text});

  if(depth<maxDepth&&result.type.includes('text/html')){
   for(const link of extractLinks(text,url)){
    if(!visited.has(link))bfsQueue.push([link,depth+1]);
   }
  }
 }
 if(!partial&&bfsQueue.length>0&&pages.length>=maxPages)partial=true;
 return{pages,partial};
}
