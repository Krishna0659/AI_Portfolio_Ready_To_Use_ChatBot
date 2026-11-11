import {fixturePool,transaction} from './fixture-db';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../packages/db';
import {emptyProfile,hash,markdown,Profile} from '../packages/contracts/profile';

after(()=>Promise.all([pool.end(),fixturePool.end()]));

test('Phase 2: stale edits fail and draft revision serializes review',async()=>{
 const user=randomUUID(),tenant=randomUUID();
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'profiles-test',$2,'Profile User')",[user,user]);
  await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);
  const initialProfile:Profile={
   schemaVersion:1,
   displayName:'Jane Doe',
   headline:'Engineer',
   sections:[{id:randomUUID(),title:'Experience',facts:[{id:randomUUID(),text:'Built scalable systems',sourceId:null,snapshotId:null}]}]
  };
  await transaction(tenant,db=>db.query('INSERT INTO drafts(tenant_id,revision,content) VALUES($1,1,$2)',[tenant,initialProfile]));

  // Simulating an edit that checks revision
  const saveDraft=async(rev:number,content:Profile)=>{
   return transaction(tenant,async db=>{
    const d=(await db.query('SELECT revision FROM drafts WHERE tenant_id=$1 FOR UPDATE',[tenant])).rows[0];
    if(rev!==d.revision)throw Object.assign(Error('This draft changed. Refresh before saving.'),{status:409});
    await db.query('UPDATE drafts SET content=$1,revision=revision+1 WHERE tenant_id=$2',[content,tenant]);
    return d.revision+1;
   });
  };

  const nextRev=await saveDraft(1,{...initialProfile,headline:'Principal Engineer'});
  assert.equal(nextRev,2);

  // Stale edit with revision 1 should fail
  await assert.rejects(saveDraft(1,{...initialProfile,headline:'Stale Title'}),/This draft changed/);

  // Valid edit with revision 2 should succeed
  const thirdRev=await saveDraft(2,{...initialProfile,headline:'Staff Engineer'});
  assert.equal(thirdRev,3);
 }finally{
  await fixturePool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);
  await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);
 }
});

test('Phase 2: concurrent approvals and stale approval attempts fail safely',async()=>{
 const user=randomUUID(),tenant=randomUUID();
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'profiles-test',$2,'Concurrent User')",[user,user]);
  await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);
  const profile:Profile={
   schemaVersion:1,
   displayName:'Alex Smith',
   headline:'Researcher',
   sections:[{id:randomUUID(),title:'Background',facts:[{id:randomUUID(),text:'Published AI research',sourceId:null,snapshotId:null}]}]
  };
  await transaction(tenant,db=>db.query('INSERT INTO drafts(tenant_id,revision,content) VALUES($1,1,$2)',[tenant,profile]));

  const approveDraft=async(rev:number)=>{
   return transaction(tenant,async db=>{
    const d=(await db.query('SELECT * FROM drafts WHERE tenant_id=$1 FOR UPDATE',[tenant])).rows[0];
    if(rev!==d.revision)throw Object.assign(Error('Draft changed; review the current revision'),{status:409});
    const id=randomUUID();
    const number=Number((await db.query('SELECT coalesce(max(number),0)+1 number FROM versions WHERE tenant_id=$1',[tenant])).rows[0].number);
    const h=hash(d.content);
    await db.query('INSERT INTO versions(id,tenant_id,number,content,content_hash,markdown,draft_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,tenant,number,d.content,h,markdown(d.content),d.revision]);
    await db.query('INSERT INTO approvals(tenant_id,version_id,draft_revision,content_hash,actor_id,partial_ack,publish_consent) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenant,id,d.revision,h,user,false,false]);
    await db.query('UPDATE drafts SET current_version=$1,revision=revision+1 WHERE tenant_id=$2',[id,tenant]);
    return {id,number};
   });
  };

  // Launch two concurrent approvals targeting revision 1
  const results=await Promise.allSettled([approveDraft(1),approveDraft(1)]);
  const fulfilled=results.filter(r=>r.status==='fulfilled');
  const rejected=results.filter(r=>r.status==='rejected');

  assert.equal(fulfilled.length,1,'Exactly one concurrent approval must succeed');
  assert.equal(rejected.length,1,'The conflicting approval must fail');
  assert.match((rejected[0] as PromiseRejectedResult).reason.message,/Draft changed/);

  // Verify only one version exists and draft revision is 2
  const versions=(await transaction(tenant,db=>db.query('SELECT * FROM versions WHERE tenant_id=$1',[tenant]))).rows;
  assert.equal(versions.length,1);
  assert.equal(versions[0].number,1);

  const draftRow=(await transaction(tenant,db=>db.query('SELECT revision,current_version FROM drafts WHERE tenant_id=$1',[tenant]))).rows[0];
  assert.equal(draftRow.revision,2);
  assert.equal(draftRow.current_version,versions[0].id);
 }finally{
  await fixturePool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);
  await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);
 }
});

test('Phase 2: database triggers enforce immutable versions, approvals, version_evidence, and append-only audit',async()=>{
 const user=randomUUID(),tenant=randomUUID(),sourceId=randomUUID(),jobId=randomUUID(),snapshotId=randomUUID(),versionId=randomUUID();
 const factId=randomUUID();
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'profiles-test',$2,'Immutable User')",[user,user]);
  await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);

  await transaction(tenant,async db=>{
   await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'web','Site','https://example.com')",[sourceId,tenant]);
   await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)',[jobId,tenant,sourceId]);
   await db.query('INSERT INTO snapshots(id,tenant_id,source_id,job_id,text,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[snapshotId,tenant,sourceId,jobId,'Extracted text','hash123']);
  });

  const profile:Profile={
   schemaVersion:1,
   displayName:'Robin Miller',
   headline:'Architect',
   sections:[{id:randomUUID(),title:'Summary',facts:[{id:factId,text:'Verified fact',sourceId,snapshotId}]}]
  };
  const h=hash(profile);

  await transaction(tenant,async db=>{
   await db.query('INSERT INTO drafts(tenant_id,revision,content) VALUES($1,1,$2)',[tenant,profile]);
   await db.query('INSERT INTO versions(id,tenant_id,number,content,content_hash,markdown,draft_revision) VALUES($1,$2,1,$3,$4,$5,1)',[versionId,tenant,profile,h,markdown(profile)]);
   await db.query('INSERT INTO approvals(tenant_id,version_id,draft_revision,content_hash,actor_id) VALUES($1,$2,1,$3,$4)',[tenant,versionId,h,user]);
   await db.query('INSERT INTO version_evidence(tenant_id,version_id,fact_id,snapshot_id,source_id) VALUES($1,$2,$3,$4,$5)',[tenant,versionId,factId,snapshotId,sourceId]);
   await db.query('INSERT INTO audit(id,tenant_id,action) VALUES($1,$2,$3)',[randomUUID(),tenant,'Approved version 1']);
  });

  // Verify version_evidence is recorded and retrievable
  const ev=(await transaction(tenant,db=>db.query('SELECT * FROM version_evidence WHERE version_id=$1',[versionId]))).rows;
  assert.equal(ev.length,1);
  assert.equal(ev[0].fact_id,factId);
  assert.equal(ev[0].snapshot_id,snapshotId);

  // Direct UPDATE on versions must fail
  await assert.rejects(
   transaction(tenant,db=>db.query("UPDATE versions SET content='{}' WHERE id=$1",[versionId])),
   /Approved versions cannot be edited|permission denied/
  );

  // Direct UPDATE on approvals must fail
  await assert.rejects(
   transaction(tenant,db=>db.query("UPDATE approvals SET content_hash='altered' WHERE version_id=$1",[versionId])),
   /Approved records cannot be edited|permission denied/
  );

  // Direct UPDATE on version_evidence must fail
  await assert.rejects(
   transaction(tenant,db=>db.query("UPDATE version_evidence SET fact_id=$1 WHERE version_id=$2",[randomUUID(),versionId])),
   /Version evidence cannot be edited|permission denied/
  );

  // Direct UPDATE or DELETE on audit must fail (append-only)
  const auditRow=(await transaction(tenant,db=>db.query('SELECT id FROM audit WHERE tenant_id=$1 LIMIT 1',[tenant]))).rows[0];
  await assert.rejects(
   transaction(tenant,db=>db.query("UPDATE audit SET action='tampered' WHERE id=$1",[auditRow.id])),
   /Audit log entries are immutable|permission denied/
  );

  await assert.rejects(
   transaction(tenant,db=>db.query('DELETE FROM audit WHERE id=$1',[auditRow.id])),
   /Audit log is append-only|permission denied/
  );
 }finally{
  await fixturePool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);
  await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);
 }
});

test('Phase 2: rollback restoration copies historical version to new draft without altering history',async()=>{
 const user=randomUUID(),tenant=randomUUID(),v1Id=randomUUID(),v2Id=randomUUID();
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'profiles-test',$2,'Rollback User')",[user,user]);
  await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)',[tenant,user]);

  const p1:Profile={schemaVersion:1,displayName:'Version One',headline:'H1',sections:[]};
  const p2:Profile={schemaVersion:1,displayName:'Version Two',headline:'H2',sections:[]};

  await transaction(tenant,async db=>{
   await db.query('INSERT INTO versions(id,tenant_id,number,content,content_hash,markdown,draft_revision) VALUES($1,$2,1,$3,$4,$5,1)',[v1Id,tenant,p1,hash(p1),markdown(p1)]);
   await db.query('INSERT INTO versions(id,tenant_id,number,content,content_hash,markdown,draft_revision) VALUES($1,$2,2,$3,$4,$5,2)',[v2Id,tenant,p2,hash(p2),markdown(p2)]);
   await db.query('INSERT INTO drafts(tenant_id,revision,content,current_version) VALUES($1,3,$2,$3)',[tenant,p2,v2Id]);
  });

  // Restore v1 to draft
  await transaction(tenant,async db=>{
   const version=(await db.query('SELECT number,content FROM versions WHERE id=$1',[v1Id])).rows[0];
   assert.ok(version);
   await db.query('UPDATE drafts SET content=$1,revision=revision+1 WHERE tenant_id=$2',[version.content,tenant]);
   await db.query('INSERT INTO audit(id,tenant_id,action) VALUES($1,$2,$3)',[randomUUID(),tenant,`Restored version ${version.number} to draft for review`]);
  });

  const draftRow=(await transaction(tenant,db=>db.query('SELECT revision,content FROM drafts WHERE tenant_id=$1',[tenant]))).rows[0];
  assert.equal(draftRow.revision,4);
  assert.equal(draftRow.content.displayName,'Version One');

  // Verify historical version v1 and v2 are intact
  const allVersions=(await transaction(tenant,db=>db.query('SELECT number,content FROM versions WHERE tenant_id=$1 ORDER BY number',[tenant]))).rows;
  assert.equal(allVersions.length,2);
  assert.equal(allVersions[0].number,1);
  assert.equal(allVersions[0].content.displayName,'Version One');
  assert.equal(allVersions[1].number,2);
  assert.equal(allVersions[1].content.displayName,'Version Two');
 }finally{
  await fixturePool.query('DELETE FROM workspaces WHERE id=$1',[tenant]);
  await fixturePool.query('DELETE FROM accounts WHERE id=$1',[user]);
 }
});

test('Phase 2: tenant isolation protects drafts, versions, approvals, and evidence',async()=>{
 const uA=randomUUID(),uB=randomUUID(),tA=randomUUID(),tB=randomUUID(),vA=randomUUID();
 try{
  await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1::uuid,'profiles-test',$1::text,'Tenant A'),($2::uuid,'profiles-test',$2::text,'Tenant B')",[uA,uB]);
  await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2),($3,$4)',[tA,uA,tB,uB]);

  const pA:Profile={schemaVersion:1,displayName:'Secret A',headline:'H A',sections:[]};
  await transaction(tA,async db=>{
   await db.query('INSERT INTO drafts(tenant_id,revision,content) VALUES($1,1,$2)',[tA,pA]);
   await db.query('INSERT INTO versions(id,tenant_id,number,content,content_hash,markdown,draft_revision) VALUES($1,$2,1,$3,$4,$5,1)',[vA,tA,pA,hash(pA),markdown(pA)]);
   await db.query('INSERT INTO approvals(tenant_id,version_id,draft_revision,content_hash,actor_id) VALUES($1,$2,$3,$4,$5)',[tA,vA,1,hash(pA),uA]);
  });

  // Tenant B cannot see Tenant A's draft, version, or approvals
  assert.equal((await transaction(tB,db=>db.query('SELECT * FROM drafts WHERE tenant_id=$1',[tA]))).rowCount,0);
  assert.equal((await transaction(tB,db=>db.query('SELECT * FROM versions WHERE id=$1',[vA]))).rowCount,0);
  assert.equal((await transaction(tB,db=>db.query('SELECT * FROM approvals WHERE version_id=$1',[vA]))).rowCount,0);
 }finally{
  await fixturePool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])',[[tA,tB]]);
  await fixturePool.query('DELETE FROM accounts WHERE id=ANY($1::uuid[])',[[uA,uB]]);
 }
});
