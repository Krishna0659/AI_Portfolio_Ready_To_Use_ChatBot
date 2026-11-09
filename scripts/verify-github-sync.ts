import {writeFile} from 'node:fs/promises';
import {identityPool as pool} from '../packages/db';
import {ownerAppEnabled} from '../services/github/app';

// Verify real imports through the UI API and worker without printing credentials or evidence.
async function verify(){
 const owner=(await pool.query("SELECT w.id FROM workspaces w JOIN accounts a ON a.id=w.owner_id WHERE a.issuer='local-development' AND a.subject='owner'")).rows[0];
 if(!owner||!ownerAppEnabled(owner.id))throw Error('Configure the GitHub App for the local owner before running this check');
 const origin=process.env.APP_ORIGIN!;
 const login=await fetch(origin+'/api/auth/local',{method:'POST',headers:{origin}});
 if(!login.ok)throw Error('Local development login unavailable');
 const cookie=login.headers.get('set-cookie')!.split(';')[0];let csrf='';
 async function api(path:string,data?:unknown){const r=await fetch(origin+'/api/v1/'+path,{method:data===undefined?'GET':'POST',headers:{origin,cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error??'Local API failed');return result;}
 let w=await api('workspace');csrf=w.csrf;
 const sources=w.sources.filter((s:{kind:string;status:string})=>s.kind==='github'&&s.status==='active');
 if(!sources.length)throw Error('Add a GitHub source before running this check');
 const jobs=new Map<string,string>();
 for(const source of sources){if(['queued','running'].includes(source.job?.status))await api(`sources/${source.id}/cancel`,{});await api(`sources/${source.id}/sync`,{});w=await api('workspace');jobs.set(source.id,w.sources.find((s:{id:string})=>s.id===source.id).job.id);}
 for(let i=0;i<24;i++){
  await new Promise(resolve=>setTimeout(resolve,2500));w=await api('workspace');
  const report=sources.map((source:{id:string;label:string})=>{const job=w.sources.find((s:{id:string})=>s.id===source.id)?.job;const snapshot=w.snapshots.find((s:{job_id:string})=>s.job_id===jobs.get(source.id));return {repository:source.label,status:job?.id===jobs.get(source.id)?job.status:'replaced',error:job?.error??null,newEvidenceCharacters:snapshot?.text.length??0};});
  if(i%6===0)console.log(report.map((r:{repository:string;status:string})=>`${r.repository}: ${r.status}`).join('\n'));
  if(report.every((r:{status:string})=>['succeeded','failed','cancelled','replaced'].includes(r.status))||i===23){
   await writeFile('.local/github-live-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),authentication:'workspace-bound GitHub App',report},null,2));
   console.log(report);
   if(report.some((r:{status:string;newEvidenceCharacters:number})=>r.status!=='succeeded'||!r.newEvidenceCharacters))throw Error('One or more authenticated imports did not complete successfully; see the source status');return;
  }
 }
}
try{await verify();}catch(e){console.error(e instanceof Error?e.message:'Verification failed');process.exitCode=1;}finally{await pool.end();}
