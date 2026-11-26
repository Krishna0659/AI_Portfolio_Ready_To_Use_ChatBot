import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
process.loadEnvFile('.env.local');
const origin=process.env.APP_ORIGIN!;
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});
await db.connect();
const fixtures:{user:string,tenant:string,token:string,csrf:string}[]=[];
const checks:string[]=[];
const check=(name:string)=>{checks.push(name);console.log('PASS: '+name);};
async function fixture(){
 const f={user:randomUUID(),tenant:randomUUID(),token:randomBytes(32).toString('hex'),csrf:randomBytes(32).toString('hex')};fixtures.push(f);
 await db.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'cloud-verification',$2,'Disposable cloud check')",[f.user,f.user]);
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[f.tenant,f.user]);
 await db.query('INSERT INTO drafts(tenant_id,content) VALUES($1,$2)',[f.tenant,{schemaVersion:1,displayName:'',headline:'',sections:[]}]);
 await db.query('INSERT INTO sessions(token_hash,user_id,csrf,authenticated_at) VALUES($1,$2,$3,now())',[createHash('sha256').update(f.token).digest('hex'),f.user,f.csrf]);return f;
}
type Fixture=typeof fixtures[number];
async function request(f:Fixture,route:string,data?:unknown,extra:Record<string,string>={}){
 const response=await fetch(origin+'/api/v1/'+route,{method:data===undefined?'GET':'POST',headers:{origin,cookie:`__Host-portfolio_session=${f.token}`,'x-csrf-token':f.csrf,'content-type':'application/json',...extra},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(115000)});
 return {status:response.status,data:await response.json()};
}
async function ok(f:Fixture,route:string,data?:unknown,extra?:Record<string,string>){const r=await request(f,route,data,extra);assert.ok(r.status<300,`${route}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
async function until<T>(read:()=>Promise<T>,accept:(v:T)=>boolean){for(let i=0;i<90;i++){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,2000));}throw Error('Background processing timed out');}
try{
 assert.equal((await fetch(origin+'/api/health')).status,200);
 assert.equal((await fetch(origin+'/')).status,200);check('Public HTTPS website and database readiness');
 const login=await fetch(origin+'/api/auth/google',{redirect:'manual'});
 assert.equal(login.status,307);const location=new URL(login.headers.get('location')!);
 assert.equal(location.hostname,'accounts.google.com');assert.equal(location.searchParams.get('redirect_uri'),origin+'/api/auth/callback');
 assert.match(login.headers.get('set-cookie')??'',/Secure/i);check('Google authorization redirect, canonical callback and secure login cookie');
 const a=await fixture(),b=await fixture();
 assert.equal((await fetch(origin+'/api/v1/workspace')).status,401);
 assert.equal((await request(a,'chat',{question:'Hello'},{'x-csrf-token':'wrong'})).status,403);
 assert.equal((await request(a,'chat',{question:'Hello',tenant_id:b.tenant})).status,400);
 assert.equal((await request(a,'chat',{question:'Hello'})).status,409);check('Authentication, CSRF, tenant-input rejection and unpublished guard');
 const form=new FormData();form.append('file',new File(['Mira Vale coordinates the campus robotics club.\n\nMira Vale solved 430 DSA questions.\n\nHer fourth-semester CGPA is 8.7.'],'cloud-check.txt',{type:'text/plain'}));form.append('consent','true');
 const uploaded=await fetch(origin+'/api/v1/upload',{method:'POST',headers:{origin,cookie:`__Host-portfolio_session=${a.token}`,'x-csrf-token':a.csrf},body:form});assert.equal(uploaded.status,200);const source=(await uploaded.json()).id;
 let w=await until(()=>ok(a,'workspace'),w=>w.snapshots.some((s:any)=>s.source_id===source));
 const evidence=w.snapshots.find((s:any)=>s.source_id===source);assert.match(evidence.text,/430/);check('Persistent upload and autonomous background extraction');
 const content={schemaVersion:1,displayName:'Mira Vale',headline:'Student engineer',sections:[{id:randomUUID(),title:'Education and leadership',facts:[{id:randomUUID(),text:evidence.text,sourceId:source,snapshotId:evidence.id}]}]};
 await ok(a,'draft',{revision:w.draft.revision,content});
 await ok(a,'settings',{theme:'light',greeting:'Ask about this approved profile',position:'bottom_right',integration:'rag'});
 w=await ok(a,'workspace');await ok(a,'approve',{revision:w.draft.revision,reviewed:true,publish:true,partialAcknowledged:false},{'idempotency-key':randomUUID()});
 await until(()=>ok(a,'workspace'),w=>w.kbDelivery.status==='succeeded');check('Approval automatically indexed into persistent Chroma');
 const known=await ok(a,'chat',{question:'How many DSA questions has Mira Vale solved?'});assert.equal(known.status,'answered');assert.match(known.answer,/430/);assert.ok(known.citations.length);check('Live Gemini answer with citations through Vercel and Azure');
 const missing=await ok(a,'chat',{question:"What is Mira Vale's third-semester CGPA?"});assert.equal(missing.status,'insufficient_evidence');assert.match(missing.answer,/knowledge base/);check('Missing information produces the knowledge-base fallback');
 assert.equal((await request(b,'chat',{question:'How many DSA questions has Mira Vale solved?'})).status,409);check('Separate account cannot access published profile');
 await ok(a,`sources/${source}/erase`,{confirm:'ERASE'});
 assert.equal((await request(a,'chat',{question:'How many DSA questions?'})).status,409);check('Source deletion immediately invalidates chat');
}finally{
 for(const f of fixtures){
  const r=await request(f,'account/erase',{confirm:'DELETE MY ACCOUNT'});assert.equal(r.status,202);
  await until(async()=> (await db.query('SELECT status FROM deletion_requests WHERE id=$1',[r.data.requestId])).rows[0]?.status,s=>s==='completed');
  await db.query('DELETE FROM object_deletions WHERE request_id=$1',[r.data.requestId]);
  await db.query('DELETE FROM deletion_requests WHERE id=$1',[r.data.requestId]);
  await db.query('DELETE FROM kb_sync WHERE tenant_id=$1',[f.tenant]);
 }
 await db.end();
}
check('Disposable account cleanup and durable erasure completed');
console.log(JSON.stringify({origin,verifiedAt:new Date().toISOString(),checks,googleInteractiveLogin:'requires browser verification'},null,2));
