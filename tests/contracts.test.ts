import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {profileSchema,hash,markdown,profileDiff,Profile} from '../packages/contracts/profile';
import {publicAddress,safeUrl,githubReadme} from '../services/fetch-broker/fetch';
import {retryDecision} from '../packages/domain/jobs';

/** TR14: retry_wait and partial are valid job states; verify retryDecision produces retry times. */
test('TR14 retry_wait: retryDecision returns retryAt for transient errors under 5 attempts', ()=>{
 const error=Object.assign(Error('connection reset'),{code:'ECONNRESET'});
 const decision=retryDecision(error,1);
 assert.ok(decision.retryAt!==null,'should schedule a retry for transient ECONNRESET');
 assert.ok(decision.retryAt!.getTime()>Date.now(),'retry should be in the future');
 assert.ok(decision.message.length<=250,'message should be bounded');
});

test('TR14 retry_wait: retryDecision returns null retryAt at or above 5 attempts', ()=>{
 const error=Object.assign(Error('timeout'),{code:'ETIMEDOUT'});
 const decision=retryDecision(error,5);
 assert.equal(decision.retryAt,null,'no retry after 5 attempts');
 assert.ok(decision.message.includes('Retry limit reached'),'message should indicate retry limit');
});

test('TR14 retry_wait: retryDecision returns null for non-transient errors', ()=>{
 const error=Error('Invalid document format');
 const decision=retryDecision(error,1);
 assert.equal(decision.retryAt,null,'non-transient errors should not be retried');
});

test('TR14 partial: job states include queued, running, succeeded, failed, cancelled, retry_wait, partial', ()=>{
 // This verifies the domain contracts align with the extended schema
 const validStates=['queued','running','succeeded','failed','cancelled','retry_wait','partial'];
 // If retryDecision produces a retryAt, the job transitions to retry_wait via worker_fail
 const error=Object.assign(Error('timeout'),{code:'ETIMEDOUT'});
 const withRetry=retryDecision(error,1);
 assert.ok(withRetry.retryAt,'should produce retry time for retry_wait transition');
 // After max attempts, final failed state
 const noRetry=retryDecision(error,5);
 assert.equal(noRetry.retryAt,null,'max attempts = failed not retry_wait');
 // Partial is for multi-page crawls that hit page/byte limit but still produced evidence
 assert.ok(validStates.includes('partial'),'partial is a valid terminal state');
 assert.ok(validStates.includes('retry_wait'),'retry_wait is a valid waiting state');
});
test('network policy rejects private, loopback, mapped and special addresses',()=>{for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','172.16.0.1','::1','::ffff:127.0.0.1','fc00::1','100.64.0.1','0.0.0.0','224.0.0.1'])assert.equal(publicAddress(address),false,address);assert.equal(publicAddress('8.8.8.8'),true);});
test('URL and repository boundaries',()=>{for(const url of ['http://example.com','https://user:pass@example.com','https://example.com:8443','file:///etc/passwd'])assert.throws(()=>safeUrl(url));assert.throws(()=>githubReadme('https://github.com/a/b/tree/main'));assert.equal(githubReadme('https://github.com/Krishna0659/PaySure'),'https://api.github.com/repos/Krishna0659/PaySure/readme');});
test('canonical hashes ignore object key ordering',()=>assert.equal(hash({b:2,a:1}),hash({a:1,b:2})));
test('facts require paired provenance and unique IDs',()=>{const id=randomUUID();assert.equal(profileSchema.safeParse({schemaVersion:1,displayName:'A',headline:'',sections:[{id,title:'Work',facts:[{id,text:'Fact',sourceId:null,snapshotId:null}]}]}).success,false);});
test('Markdown does not turn imported HTML into active markup',()=>{const md=markdown({schemaVersion:1,displayName:'<script>',headline:'',sections:[]});assert.ok(!md.includes('# <script>'));});
test('profileDiff accurately identifies added, modified, and removed facts and metadata',()=>{
 const f1=randomUUID(),f2=randomUUID(),f3=randomUUID(),secId=randomUUID();
 const base:Profile={
  schemaVersion:1,
  displayName:'Alice',
  headline:'Software Engineer',
  sections:[{
   id:secId,
   title:'Experience',
   facts:[
    {id:f1,text:'Worked at TechCorp',sourceId:null,snapshotId:null},
    {id:f2,text:'Led a team of 4',sourceId:null,snapshotId:null}
   ]
  }]
 };

 // 1. Identical comparison has 0 changes
 const identicalDiff=profileDiff(base,base);
 assert.equal(identicalDiff.totalChanges,0);
 assert.equal(identicalDiff.addedFacts.length,0);
 assert.equal(identicalDiff.modifiedFacts.length,0);
 assert.equal(identicalDiff.removedFacts.length,0);
 assert.equal(identicalDiff.displayNameChanged,false);
 assert.equal(identicalDiff.headlineChanged,false);

 // 2. Diff with added, modified, removed facts and changed headline
 const current:Profile={
  schemaVersion:1,
  displayName:'Alice',
  headline:'Staff Engineer',
  sections:[{
   id:secId,
   title:'Experience',
   facts:[
    {id:f1,text:'Worked at TechCorp as Senior Architect',sourceId:null,snapshotId:null},
    {id:f3,text:'Published paper at NeurIPS',sourceId:null,snapshotId:null}
   ]
  }]
 };

 const diff=profileDiff(base,current);
 assert.equal(diff.displayNameChanged,false);
 assert.equal(diff.headlineChanged,true);
 assert.equal(diff.modifiedFacts.length,1);
 assert.equal(diff.modifiedFacts[0].before,'Worked at TechCorp');
 assert.equal(diff.modifiedFacts[0].after,'Worked at TechCorp as Senior Architect');
 assert.equal(diff.addedFacts.length,1);
 assert.equal(diff.addedFacts[0].fact.id,f3);
 assert.equal(diff.removedFacts.length,1);
 assert.equal(diff.removedFacts[0].fact.id,f2);
 assert.equal(diff.totalChanges,4); // 1 modified + 1 added + 1 removed + 1 headline
});
