import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import pg from 'pg';
import {chromium} from '@playwright/test';
import {pool,identityPool,workerPool} from '../packages/db';
import {deliverKnowledge,ragBridge} from '../packages/domain/rag';
import {claimJob,completeJob} from '../packages/domain/jobs';
import {cleanupOne,objectPath} from '../packages/domain/lifecycle';
import {parse} from '../services/extraction';

const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const origin=process.env.APP_ORIGIN!,checks:string[]=[],fixtures:{user:string;tenant:string;token:string;csrf:string}[]=[];
const check=(name:string)=>{checks.push(name);console.log(name);};
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function fixture(){
 const f={user:randomUUID(),tenant:randomUUID(),token:randomBytes(32).toString('hex'),csrf:randomBytes(32).toString('hex')};fixtures.push(f);
 await admin.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'rag-integration-test',$2,'Disposable RAG test')",[f.user,f.user]);
 await admin.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[f.tenant,f.user]);
 await admin.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2)',[f.tenant,{schemaVersion:1,displayName:'',headline:'',sections:[]}]);
 await admin.query('INSERT INTO sessions(token_hash,user_id,csrf,authenticated_at) VALUES($1,$2,$3,now())',[createHash('sha256').update(f.token).digest('hex'),f.user,f.csrf]);return f;
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function request(f:Fixture,route:string,data?:unknown,extra:Record<string,string>={}){
 const response=await fetch(origin+'/api/v1/'+route,{method:data===undefined?'GET':'POST',headers:{origin,cookie:`portfolio_local_session=${f.token}`,'x-csrf-token':f.csrf,'content-type':'application/json',...extra},body:data===undefined?undefined:JSON.stringify(data)});
 return {status:response.status,data:await response.json()};
}
async function ok(f:Fixture,route:string,data?:unknown,extra?:Record<string,string>){const r=await request(f,route,data,extra);assert.ok(r.status<300,`${route}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
async function publish(f:Fixture){const w=await ok(f,'workspace');return ok(f,'approve',{revision:w.draft.revision,reviewed:true,publish:true,partialAcknowledged:false},{'idempotency-key':randomUUID()});}
async function drain(f:Fixture){
 for(let i=0;i<8;i++){await deliverKnowledge();const state=(await admin.query('SELECT * FROM kb_sync WHERE tenant_id=$1',[f.tenant])).rows[0];if(state?.status==='succeeded')return state;if(state?.last_error)throw Error('Delivery failed: '+state.last_error);}
 throw Error('Delivery did not complete');
}
try{
 const a=await fixture(),b=await fixture();
 await assert.rejects(workerPool.query('SELECT * FROM kb_sync'),/permission denied/);
 await assert.rejects(pool.query('SELECT * FROM worker_claim_kb($1)',[randomUUID()]),/permission denied/);
 assert.equal((await fetch(origin+'/api/v1/chat',{method:'POST'})).status,401);
 assert.equal((await request(a,'chat',{question:'Hello'},{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await request(a,'chat',{question:'Hello',tenant_id:b.tenant})).status,400);
 assert.equal((await request(a,'chat',{question:'Hello'})).status,409);check('Authentication, CSRF, caller-scope rejection and unpublished-profile guard');
 const form=new FormData();form.append('file',new File(['Mira Vale coordinates the campus robotics club.\n\nMira Vale solved 430 DSA questions.\n\nHer fourth-semester CGPA is 8.7.'],'integration.txt',{type:'text/plain'}));form.append('consent','true');
 const upload=await fetch(origin+'/api/v1/upload',{method:'POST',headers:{origin,cookie:`portfolio_local_session=${a.token}`,'x-csrf-token':a.csrf},body:form});assert.equal(upload.status,200);const source=(await upload.json()).id;
 const job=await claimJob(a.tenant,false);assert.ok(job);assert.equal(await completeJob(job,await parse(await readFile(objectPath(job.locator)),'txt')),true);
 let w=await ok(a,'workspace');const evidence=w.snapshots.find((s:any)=>s.source_id===source);assert.ok(evidence);
 const content={schemaVersion:1,displayName:'Mira Vale',headline:'Student engineer',sections:[{id:randomUUID(),title:'Education and leadership',facts:[{id:randomUUID(),text:evidence.text,sourceId:source,snapshotId:evidence.id}]}]};
 await ok(a,'draft',{revision:w.draft.revision,content});
 await ok(a,'settings',{theme:'light',greeting:'Ask about this approved profile',position:'bottom_right',integration:'rag'});
 w=await ok(a,'workspace');await ok(a,'approve',{revision:w.draft.revision,reviewed:true,publish:false,partialAcknowledged:false},{'idempotency-key':randomUUID()});
 assert.equal((await request(a,'chat',{question:'How many questions?'})).status,409);check('Upload, extraction, evidence-linked draft and non-publishing approval');
 await publish(a);assert.equal((await request(a,'chat',{question:'How many questions?'})).status,409);
 let indexed=await drain(a);assert.match(indexed.snapshot,/^[a-f0-9]{64}$/);assert.equal(indexed.content,null);check('Approved publication delivered to persistent Chroma; receipt saved and outbox content cleared');
 const known=await ok(a,'chat',{question:'How many DSA questions has Mira Vale solved?'});assert.equal(known.status,'answered');assert.match(known.answer,/430/);assert.ok(known.citations.length);check('Live website → retrieval → Gemini → cited answer');
 const missing=await ok(a,'chat',{question:'What is Mira Vale\'s third-semester CGPA?'});assert.equal(missing.status,'insufficient_evidence');assert.match(missing.answer,/knowledge base/);check('Unavailable semester information gives the explicit knowledge-base fallback');
 assert.equal((await request(b,'chat',{question:'How many DSA questions has Mira Vale solved?'})).status,409);
 const foreign=await ragBridge({operation:'chat',question:'How many DSA questions?',scope:{tenant_id:b.tenant,profile_id:'approved-profile',generation:indexed.generation,profile_version:indexed.profile_version,embedding_model:indexed.embedding_model,snapshot:indexed.snapshot}});assert.equal(foreign.status,'profile_unavailable');check('Second workspace cannot retrieve the first workspace snapshot');
 // Durable lease recovery and idempotent indexing after a worker loses its receipt.
 await publish(a);const staleToken=randomUUID();const claimed=(await workerPool.query('SELECT * FROM worker_claim_kb($1)',[staleToken])).rows[0];assert.equal(claimed.tenant_id,a.tenant);
 const receipt=await ragBridge({operation:'publish',...claimed});
 await admin.query("UPDATE kb_sync SET lease_until=now()-interval '1 second' WHERE tenant_id=$1",[a.tenant]);
 indexed=await drain(a);assert.equal(indexed.snapshot,receipt.snapshot);
 await workerPool.query('SELECT worker_finish_kb($1,$2,$3,$4,true)',[a.tenant,indexed.generation,staleToken,{}]);assert.equal((await admin.query('SELECT status FROM kb_sync WHERE tenant_id=$1',[a.tenant])).rows[0].status,'succeeded');check('Lost receipt replay, expired lease recovery and stale-worker rejection');
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'portfolio_local_session',value:a.token,url:origin,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByRole('heading',{name:'Ask your profile',exact:true}).waitFor();await page.getByLabel('Your question').fill('What leadership role does Mira Vale hold?');await page.getByRole('button',{name:'Ask question',exact:true}).click();await page.locator('.profile-answer').waitFor({timeout:170000});assert.match(await page.locator('.profile-answer').innerText(),/robotics club/i);
 await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/rag-chat-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Ask your profile',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/screenshots/rag-chat-mobile.png',fullPage:true});assert.deepEqual(errors,[]);check('Real chat UI answer, Settings entry, desktop/mobile layout and no browser errors');
 const inFlight=request(a,'chat',{question:'How many DSA questions has Mira Vale solved?'});
 let acquired=false;for(let i=0;i<100;i++){const row=(await admin.query('SELECT chat_token FROM kb_sync WHERE tenant_id=$1',[a.tenant])).rows[0];if(row.chat_token){acquired=true;break;}await new Promise(r=>setTimeout(r,25));}
 assert.equal(acquired,true);await admin.query('UPDATE memberships SET active=false WHERE tenant_id=$1',[a.tenant]);
 const revoked=await inFlight;assert.equal(revoked.status,404);assert.equal(revoked.data.answer,undefined);await admin.query('UPDATE memberships SET active=true WHERE tenant_id=$1',[a.tenant]);check('Membership revoked during generation suppresses the in-flight answer');
 await ok(a,`sources/${source}/erase`,{confirm:'ERASE'});assert.equal((await request(a,'chat',{question:'What leadership role?'})).status,409);
 let deletion=(await admin.query("SELECT * FROM deletion_requests WHERE tenant_id=$1 AND scope='source' ORDER BY created_at DESC LIMIT 1",[a.tenant])).rows[0];assert.equal(deletion.status,'pending');assert.equal(deletion.kb_pending,true);
 await cleanupOne(undefined,deletion.id);assert.equal((await admin.query('SELECT status FROM deletion_requests WHERE id=$1',[deletion.id])).rows[0].status,'pending');
 await drain(a);deletion=(await admin.query('SELECT * FROM deletion_requests WHERE id=$1',[deletion.id])).rows[0];assert.equal(deletion.status,'completed');check('Source erasure blocks chat immediately and receipt waits for files plus Chroma purge');
 // Republish clean approved content before testing account-cascade durability.
 w=await ok(a,'workspace');await ok(a,'draft',{revision:w.draft.revision,content:{...content,sections:[{id:randomUUID(),title:'Skills',facts:[{id:randomUUID(),text:'Mira Vale uses Python.',sourceId:null,snapshotId:null}]}]}});await publish(a);await drain(a);
 const erased=await ok(a,'account/erase',{confirm:'DELETE MY ACCOUNT'});assert.equal(erased.status,'pending');assert.equal((await request(a,'workspace')).status,401);assert.equal((await admin.query('SELECT id FROM workspaces WHERE id=$1',[a.tenant])).rowCount,0);
 await drain(a);assert.equal((await admin.query('SELECT status FROM deletion_requests WHERE id=$1',[erased.requestId])).rows[0].status,'completed');check('Account erasure revokes access and durable Chroma purge survives workspace cascade');
 await writeFile('docs/WEBSITE_RAG_INTEGRATION.json',JSON.stringify({verified_at:new Date().toISOString(),checks,live_gemini_requests:4,delivered_answers:3,in_flight_revocation_checks:1,browser_errors:errors,public_deployment:false},null,2));
}finally{
 await browser?.close();
 for(const f of fixtures){
  const state=(await admin.query('SELECT generation FROM kb_sync WHERE tenant_id=$1',[f.tenant])).rows[0];
  if(state)await ragBridge({operation:'purge',tenant_id:f.tenant,generation:state.generation+1});
  for(const source of (await admin.query("SELECT locator FROM sources WHERE tenant_id=$1 AND kind='upload'",[f.tenant])).rows){const {unlink}=await import('node:fs/promises');await unlink(objectPath(source.locator)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  await admin.query('DELETE FROM object_deletions WHERE request_id IN(SELECT id FROM deletion_requests WHERE user_id=$1)',[f.user]);
  await admin.query('DELETE FROM deletion_requests WHERE user_id=$1',[f.user]);await admin.query('DELETE FROM kb_sync WHERE tenant_id=$1',[f.tenant]);
  await admin.query('DELETE FROM sessions WHERE user_id=$1',[f.user]);await admin.query('DELETE FROM workspaces WHERE id=$1',[f.tenant]);await admin.query('DELETE FROM accounts WHERE id=$1',[f.user]);
 }
 await Promise.all([admin.end(),pool.end(),identityPool.end(),workerPool.end()]);
}
