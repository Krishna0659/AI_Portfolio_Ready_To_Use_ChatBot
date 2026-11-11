import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
// This process starts a worker: only run against the disposable Compose database.
if(new URL(process.env.ADMIN_DATABASE_URL).hostname!=='database')throw Error('Worker smoke check requires the isolated Compose database');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const user=randomUUID(),tenant=randomUUID(),source=randomUUID(),job=randomUUID(),key=randomUUID()+'.txt';
const file='.local/objects/'+key,text='Disposable worker fixture: verified document ingestion.';
let worker,exited;
try{
 await mkdir('.local/objects',{recursive:true});await writeFile(file,text,{flag:'wx'});
 await db.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'test',$2,'Worker smoke fixture')",[user,user]);
 await db.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);
 await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'upload','Worker fixture',$3)",[source,tenant,key]);
 await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)',[job,tenant,source]);
 worker=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/worker/index.ts'],{stdio:'inherit',windowsHide:true});
 exited=new Promise((resolve,reject)=>{worker.once('exit',resolve);worker.once('error',reject);});
 let complete=false;
 for(let i=0;i<60;i++){
  if(worker.exitCode!==null)throw Error('Worker exited before completing import');
  const row=(await db.query('SELECT status,error FROM jobs WHERE id=$1',[job])).rows[0];
  if(row.status==='failed')throw Error('Fixture import failed: '+row.error);
  if(row.status==='succeeded'){complete=true;break;}
  await delay(500);
 }
 assert.ok(complete,'worker must complete the queued import within 30 seconds');
 const snapshots=(await db.query('SELECT text FROM snapshots WHERE job_id=$1 AND tenant_id=$2',[job,tenant])).rows;
 assert.equal(snapshots.length,1);assert.ok(snapshots[0].text.includes(text));
 console.log('Worker process imported a queued document and persisted one matching evidence snapshot.');
}finally{
 if(worker&&worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([exited,delay(5000)]);if(worker.exitCode===null)worker.kill('SIGKILL');await exited;}
 await db.query('DELETE FROM workspaces WHERE id=$1',[tenant]);
 await db.query('DELETE FROM accounts WHERE id=$1',[user]);
 await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await db.end();
}
