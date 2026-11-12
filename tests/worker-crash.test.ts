import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixturePool, transaction} from './fixture-db';
import {pool} from '../packages/db';
import {claimJob, completeJob, heartbeat} from '../packages/domain/jobs';
import {hash} from '../packages/contracts/profile';

after(() => Promise.all([pool.end(), fixturePool.end()]));

test('Phase 3 Ingestion: Worker crash recovery and lease expiry prevent late writes', async () => {
  const user = randomUUID(), tenant = randomUUID(), sourceId = randomUUID(), jobId = randomUUID();

  try {
    // Setup test account and workspace
    await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'worker-test',$2,'Worker User')", [user, user]);
    await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)', [tenant, user]);

    await transaction(tenant, async db => {
      await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'upload','resume.txt',$3)", [sourceId, tenant, `${randomUUID()}.txt`]);
      await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)', [jobId, tenant, sourceId]);
    });

    // 1. Worker 1 claims the job
    const job1 = await claimJob(tenant, false);
    assert.ok(job1, 'Worker 1 should claim the queued job');
    assert.equal(job1.id, jobId);
    assert.equal(job1.attempt, 1);
    const lease1 = job1.lease;

    // 2. Simulate Worker 1 crashing:
    // Its lease expires into the past without completing or sending heartbeats
    await fixturePool.query(
      "UPDATE jobs SET lease_until = now() - interval '5 seconds' WHERE id = $1",
      [jobId]
    );

    // 3. Worker 2 inspects queue: worker_claim cleans up expired running job and schedules backoff
    const claimPass1 = await claimJob(tenant, false);
    assert.equal(claimPass1, null, 'Expired running job is recovered to queued status with retry backoff');

    // Simulate backoff timer elapsing
    await fixturePool.query(
      "UPDATE jobs SET available_at = now() - interval '1 second' WHERE id = $1",
      [jobId]
    );
    const job2 = await claimJob(tenant, false);
    assert.ok(job2, 'Worker 2 should claim the recovered job after lease expiry');
    assert.equal(job2.id, jobId);
    assert.equal(job2.attempt, 2);
    assert.notEqual(job2.lease, lease1, 'Worker 2 must receive a new distinct lease token');

    // 4. Stale/crashed Worker 1 wakes up late and attempts to complete with its expired lease token
    const staleEvidence = 'Stale extracted text from Worker 1';
    const staleResult = await completeJob(job1, staleEvidence);
    assert.equal(staleResult, false, 'Late complete attempt from crashed worker with stale lease must be rejected');

    // Verify no snapshot was persisted by the stale worker
    const snapshotCount = await transaction(tenant, async db => {
      const res = await db.query('SELECT count(*) FROM snapshots WHERE job_id = $1', [jobId]);
      return Number(res.rows[0].count);
    });
    assert.equal(snapshotCount, 0, 'No snapshot should be created by expired lease');

    // 5. Active Worker 2 completes cleanly with its valid lease
    const validEvidence = 'Verified extracted text from Worker 2';
    const validResult = await completeJob(job2, validEvidence);
    assert.equal(validResult, true, 'Active worker with valid lease must succeed');

    // Verify exactly one snapshot was recorded
    const finalSnapshots = await transaction(tenant, async db => {
      const res = await db.query('SELECT text, content_hash FROM snapshots WHERE job_id = $1', [jobId]);
      return res.rows;
    });
    assert.equal(finalSnapshots.length, 1);
    assert.equal(finalSnapshots[0].text, validEvidence);
    assert.equal(finalSnapshots[0].content_hash, hash(validEvidence));

    // Verify job status is succeeded
    const jobStatus = await transaction(tenant, async db => {
      const res = await db.query('SELECT status, lease FROM jobs WHERE id = $1', [jobId]);
      return res.rows[0];
    });
    assert.equal(jobStatus.status, 'succeeded');
    assert.equal(jobStatus.lease, null);
  } finally {
    await fixturePool.query('DELETE FROM workspaces WHERE id = $1', [tenant]);
    await fixturePool.query('DELETE FROM accounts WHERE id = $1', [user]);
  }
});
