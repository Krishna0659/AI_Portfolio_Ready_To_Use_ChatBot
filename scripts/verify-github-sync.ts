import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {ownerAppEnabled,ownerReadme} from '../services/github/app';
import {parse} from '../services/extraction';

process.loadEnvFile('.env.local');
// Live provider/parser acceptance only. Worker persistence is checked separately.
async function verify(){
 const tenant=process.env.GITHUB_OWNER_WORKSPACE_ID;
 if(!tenant||!ownerAppEnabled(tenant))throw Error('Configure the workspace-bound GitHub App first.');
 const repositories=process.argv.slice(2);
 if(!repositories.length)throw Error('Supply one or more authorized GitHub repository URLs.');
 const report=[];
 for(const repository of repositories){
  const body=await ownerReadme(repository,tenant);
  const text=await parse(body,'txt');
  assert.ok(text.trim().length,'README parsing returned no evidence');
  report.push({repository,status:'succeeded',evidenceCharacters:text.length});
 }
 await mkdir('.local',{recursive:true});
 await writeFile('.local/github-live-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'live GitHub App authorization and README parsing; no workspace mutation',report},null,2));
 console.log(report);
}
verify().catch(error=>{console.error(error instanceof Error?error.message:'GitHub verification failed');process.exitCode=1;});
