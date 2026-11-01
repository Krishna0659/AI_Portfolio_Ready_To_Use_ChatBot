import {pool} from '../packages/db';
import {ownerAppEnabled,appJwt} from '../services/github/app';
import {readFile} from 'node:fs/promises';
try{
const local=(await pool.query("SELECT w.id FROM workspaces w JOIN accounts a ON a.id=w.owner_id WHERE a.issuer='local-development' AND a.subject='owner'")).rows[0];
if(!local)throw Error('Open the local development workspace first');
console.log('Local owner workspace ID:',local.id);
const names=['GITHUB_APP_ID','GITHUB_INSTALLATION_ID','GITHUB_PRIVATE_KEY_PATH','GITHUB_OWNER_WORKSPACE_ID'];const missing=names.filter(n=>!process.env[n]);
if(missing.length){console.log('Not configured. Set these fields in .env.local:',missing.join(', '));}
else if(!ownerAppEnabled(local.id)){console.log('The configured owner workspace does not match the local owner.');process.exitCode=1;}
else{const privateKey=await readFile(process.env.GITHUB_PRIVATE_KEY_PATH!,'utf8');appJwt({appId:process.env.GITHUB_APP_ID!,installationId:process.env.GITHUB_INSTALLATION_ID!,privateKey});console.log('Local key and workspace binding are valid. Live installation access is not verified; restart the worker and sync a selected repository.');}
}catch{console.error('Could not validate local GitHub configuration. Check the database, private key file and setup guide.');process.exitCode=1;}finally{await pool.end();}
