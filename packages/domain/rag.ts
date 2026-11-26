import {spawn} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {workerPool,transaction} from '../db';
import {authorizedTransaction} from './authorization';

export function ragConfigured(){return !!(process.env.RAG_PYTHON&&process.env.RAG_KB_URL&&process.env.RAG_KB_API_KEY);}

/** Private bounded process transport; credentials never enter command arguments or replies. */
export async function ragBridge(input:Record<string,unknown>):Promise<Record<string,any>>{
 if(!ragConfigured())throw Error('Knowledge service is not configured');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.RAG_PYTHON!,[path.resolve('services/rag/website_bridge.py')],{
   cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe'],
   env:{...Object.fromEntries(['SYSTEMROOT','WINDIR','PATH','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]!])),
    NODE_ENV:process.env.NODE_ENV??'development',PYTHONDONTWRITEBYTECODE:'1',RAG_KB_URL:process.env.RAG_KB_URL!,RAG_KB_API_KEY:process.env.RAG_KB_API_KEY!,RAG_GENERATION_DISABLED:process.env.RAG_GENERATION_DISABLED??'0',
    GEMINI_API_KEY:process.env.GEMINI_API_KEY??'',GEMINI_API_KEY_FILE:process.env.GEMINI_API_KEY_FILE??'',
    GEMINI_MODEL:process.env.GEMINI_MODEL??'gemini-3.5-flash-lite'}});
  const output:Buffer[]=[];let size=0,settled=false;
  const done=(error?:Error,value?:Record<string,unknown>)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(value!);};
  const timer=setTimeout(()=>done(Error('Knowledge service timed out')),165000);
  child.on('error',()=>done(Error('Knowledge service could not start')));
  child.stdin.on('error',()=>done(Error('Knowledge service unavailable')));
  child.stdout.on('data',(data:Buffer)=>{size+=data.length;if(size>262144)done(Error('Knowledge response too large'));else output.push(data);});
  child.stderr.resume();
  child.on('close',code=>{if(code!==0)return done(Error('Knowledge service unavailable'));try{const value=JSON.parse(Buffer.concat(output).toString('utf8'));if(!value||typeof value!=='object'||value.error)throw Error();done(undefined,value);}catch{done(Error('Invalid knowledge response'));}});
  child.stdin.end(JSON.stringify(input));
 });
}

export async function deliverKnowledge(){
 if(!ragConfigured())return false;
 const token=randomUUID(),job=(await workerPool.query('SELECT * FROM worker_claim_kb($1)',[token])).rows[0];
 if(!job)return false;
 try{
  const receipt=await ragBridge({operation:job.operation,tenant_id:job.tenant_id,generation:job.generation,
   version_id:job.version_id,profile_version:job.profile_version,content:job.content});
  await workerPool.query('SELECT worker_finish_kb($1,$2,$3,$4,false)',[job.tenant_id,job.generation,token,receipt]);
 }catch{
  await workerPool.query('SELECT worker_finish_kb($1,$2,$3,$4,true)',[job.tenant_id,job.generation,token,{}]);
 }
 await workerPool.query('SELECT worker_complete_erasures()');return true;
}

export async function chat(tenant:string,user:string,question:string){
 if(!ragConfigured())throw Object.assign(Error('Knowledge service is not configured.'),{status:503});
 const token=randomUUID();
 const state=await authorizedTransaction(tenant,user,false,async db=>(await db.query('SELECT * FROM claim_kb_chat($1)',[token])).rows[0]);
 if(!state)throw Object.assign(Error('Chat is not ready. Finish synchronization of an approved version, or wait for the current answer.'),{status:409});
 try{
  const result=await ragBridge({operation:'chat',question,scope:{tenant_id:tenant,profile_id:'approved-profile',
   generation:state.generation,profile_version:state.profile_version,embedding_model:state.embedding_model,snapshot:state.snapshot}});
  if(typeof result._diagnostic==='string'&&/^[a-z0-9_]{1,80}$/.test(result._diagnostic))console.warn('RAG service outcome:',result._diagnostic);
  delete result._diagnostic;
  // Approval, erasure or membership may change while generation is running.
  await authorizedTransaction(tenant,user,false,async db=>{
   const valid=await db.query("SELECT k.tenant_id FROM kb_sync k JOIN drafts d USING(tenant_id) JOIN versions v ON v.id=k.version_id JOIN events e ON e.id=k.event_id WHERE k.generation=$1 AND k.snapshot=$2 AND k.chat_token=$3 AND d.current_version=k.version_id AND d.generation=k.generation AND d.settings->>'integration'='rag' AND k.status='succeeded' AND e.status='succeeded'",[state.generation,state.snapshot,token]);
   if(!valid.rowCount)throw Object.assign(Error('Your published profile changed. Ask again after synchronization.'),{status:409});
  });
  return result;
 }finally{await transaction(tenant,db=>db.query('SELECT release_kb_chat($1)',[token]));}
}
