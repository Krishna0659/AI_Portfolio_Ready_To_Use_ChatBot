import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1'],{stdio:'ignore',windowsHide:true});
function check(file){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${file} failed`)));});}
try{
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){if(server.exitCode!==null)throw Error('Built server stopped before readiness');try{const response=await fetch('http://localhost:3000/api/v1/workspace',{signal:AbortSignal.timeout(1000)});if(response.status===401){ready=true;break;}}catch{}await delay(500);}
 if(!ready)throw Error('Built server did not become ready');
 await check('scripts/api-check.mjs');await check('scripts/membership-check.mjs');await check('scripts/worker-check.mjs');
}finally{server.kill('SIGTERM');}
