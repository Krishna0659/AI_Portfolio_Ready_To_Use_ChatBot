import {spawn} from 'node:child_process';
import path from 'node:path';
export async function parse(data:Buffer,kind:string):Promise<string>{return new Promise((resolve,reject)=>{
 const child=spawn(process.env.PYTHON_PATH??'python',['-I',path.resolve('services/extraction/parse.py'),kind],{cwd:process.cwd(),windowsHide:true,env:{NODE_ENV:process.env.NODE_ENV,SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});let out='';
 const timer=setTimeout(()=>{child.kill();reject(Error('Document parsing exceeded 20 seconds'));},20000);
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.stdout.on('data',chunk=>{out+=chunk;if(out.length>1500000){child.kill();reject(Error('Parser output exceeds limit'));}});child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.end(data);
 child.on('close',()=>{clearTimeout(timer);try{const value=JSON.parse(out);if(value.error)reject(Error(value.error));else resolve(value.text);}catch{reject(Error('Document could not be parsed'));}});
});}

