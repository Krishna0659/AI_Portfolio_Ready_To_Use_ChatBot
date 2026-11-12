/**
 * TR12 GitHub multi-doc import tests.
 * Tests appDocs file filtering, limit enforcement, and commit SHA recording
 * using a mock transport — no live GitHub calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {appDocs,AppConfig} from '../services/github/app';

// Generate a real RSA key pair for JWT signing (test only, never used for auth).
const {privateKey:testPrivateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const MOCK_CONFIG:AppConfig={appId:'12345',installationId:'67890',privateKey:testPrivateKey};

function makeEntry(path:string,size=100){return{path,type:'blob',sha:'abc',size};}

function mockTransport(overrides:{installation?:object;token?:object;tree?:object;files?:Record<string,object>}={}){
 return async(path:string,_cred:string,_body?:unknown)=>{
  // Order matters: more specific patterns first
  if(path.includes('/access_tokens'))return overrides.token??{token:'ghs_test',expires_at:new Date(Date.now()+3600000).toISOString()};
  if(path.includes('/installation'))return overrides.installation??{id:67890,suspended_at:null};
  if(path.includes('/git/trees/'))return overrides.tree??{sha:'deadbeef'.repeat(5).slice(0,40),tree:[],truncated:false};
  if(path.includes('/contents/')){
   const p=path.split('/contents/')[1];
   const files=overrides.files??{};
   if(files[p])return files[p];
   return{encoding:'base64',content:Buffer.from('# Hello').toString('base64'),size:7};
  }
  throw Error('Unexpected path: '+path);
 };
}

test('TR12 appDocs: returns empty docs for empty tree', async()=>{
 const transport=mockTransport({tree:{sha:'a'.repeat(40),tree:[],truncated:false}});
 const result=await appDocs('https://github.com/owner/repo',MOCK_CONFIG,{},transport as never);
 assert.equal(result.docs.length,0);
 assert.equal(result.truncated,false);
});

test('TR12 appDocs: fetches .md and .txt files from root and docs/', async()=>{
 const tree={sha:'a'.repeat(40),tree:[
  makeEntry('README.md',100),
  makeEntry('docs/guide.md',200),
  makeEntry('docs/notes.txt',50),
  makeEntry('src/index.ts',400),  // excluded: not .md/.txt
  makeEntry('src/utils.md',100),  // excluded: nested outside root/docs/
 ],truncated:false};
 const transport=mockTransport({tree});
 const result=await appDocs('https://github.com/owner/repo',MOCK_CONFIG,{},transport as never);
 const paths=result.docs.map(d=>d.path);
 assert.ok(paths.includes('README.md'),'README.md should be included');
 assert.ok(paths.includes('docs/guide.md'),'docs/guide.md should be included');
 assert.ok(paths.includes('docs/notes.txt'),'docs/notes.txt should be included');
 assert.ok(!paths.includes('src/index.ts'),'src/index.ts should be excluded');
 assert.ok(!paths.includes('src/utils.md'),'src/utils.md nested outside docs/ should be excluded');
 assert.equal(result.docs.length,3);
});

test('TR12 appDocs: enforces maxFiles limit and sets truncated=true', async()=>{
 const tree={sha:'b'.repeat(40),tree:Array.from({length:10},(_,i)=>makeEntry(`doc${i}.md`,10)),truncated:false};
 const transport=mockTransport({tree});
 const result=await appDocs('https://github.com/owner/repo',MOCK_CONFIG,{maxFiles:3},transport as never);
 assert.equal(result.docs.length,3,'should stop at maxFiles');
 assert.equal(result.truncated,true,'truncated must be true when capped at maxFiles');
});

test('TR12 appDocs: enforces maxRepoBytes limit and sets truncated=true', async()=>{
 const tree={sha:'c'.repeat(40),tree:Array.from({length:5},(_,i)=>makeEntry(`f${i}.md`,400)),truncated:false};
 const files:Record<string,object>={};
 for(let i=0;i<5;i++)files[`f${i}.md`]={encoding:'base64',content:Buffer.from('x'.repeat(400)).toString('base64'),size:400};
 const transport=mockTransport({tree,files});
 const result=await appDocs('https://github.com/owner/repo',MOCK_CONFIG,{maxRepoBytes:1000},transport as never);
 assert.ok(result.docs.length<5,'should stop before all files due to byte limit');
 assert.equal(result.truncated,true,'truncated must be true when byte cap hit');
});

test('TR12 appDocs: records commitSha from tree sha', async()=>{
 const sha='f'.repeat(40);
 const tree={sha,tree:[makeEntry('README.md',5)],truncated:false};
 const transport=mockTransport({tree});
 const result=await appDocs('https://github.com/owner/repo',MOCK_CONFIG,{},transport as never);
 assert.equal(result.commitSha,sha);
 if(result.docs.length>0)assert.equal(result.docs[0].commitSha,sha);
});

test('TR12 appDocs: rejects suspended installation', async()=>{
 const transport=mockTransport({installation:{id:67890,suspended_at:'2026-11-01T00:00:00Z'}});
 await assert.rejects(
  ()=>appDocs('https://github.com/owner/repo',MOCK_CONFIG,{},transport as never),
  /not available/
 );
});

test('TR12 appDocs: rejects mismatched installation ID', async()=>{
 const transport=mockTransport({installation:{id:99999,suspended_at:null}});
 await assert.rejects(
  ()=>appDocs('https://github.com/owner/repo',MOCK_CONFIG,{},transport as never),
  /not available/
 );
});
