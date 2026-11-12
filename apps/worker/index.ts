import {readFile} from 'node:fs/promises';
import {workerPool as pool} from '../../packages/db/index';
import {fetchPublic,githubReadme,crawlPages} from '../../services/fetch-broker/fetch';
import {ownerAppEnabled,ownerReadme,ownerDocs} from '../../services/github/app';
import {cleanupOne,objectPath} from '../../packages/domain/lifecycle';
import {claimJob,heartbeat,completeJob,failJob} from '../../packages/domain/jobs';
import {parse} from '../../services/extraction';
process.loadEnvFile('.env.local');
if(!process.env.WORKER_DATABASE_URL)throw Error('WORKER_DATABASE_URL is required for the worker');
let stopped=false;process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
// One job per tenant per pass; separate identity/worker database roles remain a release gate.
async function tick(){
 await cleanupOne();const tenants=await pool.query('SELECT worker_tenants() AS id');
 for(const {id:tenant} of tenants.rows){
  if(stopped)break;const authenticatedGithub=ownerAppEnabled(tenant),job=await claimJob(tenant,authenticatedGithub);
  if(job){let heartbeatPending:Promise<void>|null=null;
   const timer=setInterval(()=>{if(!heartbeatPending)heartbeatPending=heartbeat(job).then(()=>{},()=>{}).finally(()=>{heartbeatPending=null;});},15000);
   try{let body:Buffer,kind:string;
    if(job.kind==='upload'){body=await readFile(objectPath(job.locator));kind=job.locator.split('.').pop()!;}
    else if(job.kind==='github'&&authenticatedGithub){
     // TR12: multi-doc import — concatenate all docs text
     try{
      const {docs}=await ownerDocs(job.locator,tenant,{maxFiles:50,maxRepoBytes:10*1024*1024});
      if(docs.length>0){
       body=Buffer.from(docs.map(d=>`## ${d.path}\n${d.text}`).join('\n\n'));
       kind='txt';
      }else{
       // Fallback to README only
       body=await ownerReadme(job.locator,tenant);kind='txt';
      }
     }catch{body=await ownerReadme(job.locator,tenant);kind='txt';}
    }
    else if(job.kind==='github'){const response=await fetchPublic(githubReadme(job.locator));const data=JSON.parse(response.body.toString());if(data.encoding!=='base64'||typeof data.content!=='string')throw Error('Repository README unavailable');body=Buffer.from(data.content,'base64');kind='txt';}
    else{
     // TR11: multi-page web crawl
     const {pages,partial}=await crawlPages(job.locator,{maxPages:25,maxDepth:2,delayMs:1000});
     if(pages.length===0)throw Error('Website returned no accessible pages');
     const combined=pages.map(p=>p.text).join('\n\n--- next page ---\n\n');
     body=Buffer.from(combined,'utf8');kind='html';
     if(partial){
      // Record as partial success — save what we got
      const text=await parse(body,kind);
      await pool.query('SELECT worker_partial($1,$2,$3,$4,$5,$6)',[job.tenant_id,job.id,job.lease,text,require('node:crypto').createHash('sha256').update(text).digest('hex'),pages.length]);
      continue;
     }
    }
    await completeJob(job,await parse(body,kind));
   }catch(error){await failJob(job,error,authenticatedGithub);}
   finally{clearInterval(timer);await heartbeatPending;}
  }
  await pool.query('SELECT worker_ack_mock($1)',[tenant]);
 }
}
console.log('PortfolioAI worker running');
while(!stopped){try{await tick();}catch{console.error('Worker tick failed; retrying on the next pass.');}if(!stopped)await new Promise(r=>setTimeout(r,1500));}await pool.end();
