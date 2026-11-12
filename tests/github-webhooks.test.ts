import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {fixturePool, transaction} from './fixture-db';
import {pool} from '../packages/db';
import {
  verifyWebhookSignature,
  recordDelivery,
  clearDeliveries,
  processWebhookEvent
} from '../services/github/webhooks';

after(() => Promise.all([pool.end(), fixturePool.end()]));

test('GitHub Webhooks: signature verification and delivery deduplication', () => {
  clearDeliveries();
  const secret = 'webhook-secret-key-12345';
  const body = JSON.stringify({action: 'deleted', installation: {id: 999}});
  const validSignature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  // Valid signature
  assert.equal(verifyWebhookSignature(body, secret, validSignature), true);

  // Altered body
  assert.equal(verifyWebhookSignature(body + ' ', secret, validSignature), false);

  // Wrong secret
  assert.equal(verifyWebhookSignature(body, 'wrong-secret', validSignature), false);

  // Missing or malformed header
  assert.equal(verifyWebhookSignature(body, secret, null), false);
  assert.equal(verifyWebhookSignature(body, secret, 'invalid-prefix'), false);

  // Deduplication
  const deliveryId = randomUUID();
  assert.equal(recordDelivery(deliveryId), true);
  assert.equal(recordDelivery(deliveryId), false); // Second attempt is duplicate
});

test('GitHub Webhooks: installation revocation detaches sources and cancels jobs', async () => {
  const user = randomUUID(), tenant = randomUUID();
  const source1 = randomUUID(), source2 = randomUUID(), sourceUpload = randomUUID();
  const job1 = randomUUID(), job2 = randomUUID(), jobUpload = randomUUID();

  try {
    await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'github-test',$2,'GH User')", [user, user]);
    await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)', [tenant, user]);

    await transaction(tenant, async db => {
      // 2 GitHub sources and 1 upload source
      await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'github','PaySure','https://github.com/Krishna0659/PaySure')", [source1, tenant]);
      await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'github','OtherRepo','https://github.com/Krishna0659/OtherRepo')", [source2, tenant]);
      await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'upload','Resume','mock.pdf')", [sourceUpload, tenant]);

      await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)', [job1, tenant, source1]);
      await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)', [job2, tenant, source2]);
      await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)', [jobUpload, tenant, sourceUpload]);
    });

    const client = await fixturePool.connect();
    try {
      // Process installation.deleted event
      const res = await processWebhookEvent('installation', {action: 'deleted', installation: {id: 12345}}, client);
      assert.equal(res.action, 'installation_deleted');
      assert.equal(res.affectedSources >= 2, true);

      // Verify GitHub sources are detached
      const sources = (await transaction(tenant, db => db.query('SELECT id, status FROM sources WHERE id = ANY($1::uuid[])', [[source1, source2]]))).rows;
      assert.ok(sources.every(s => s.status === 'detached'));

      // Verify upload source is still active
      const upload = (await transaction(tenant, db => db.query('SELECT status FROM sources WHERE id = $1', [sourceUpload]))).rows[0];
      assert.equal(upload.status, 'active');

      // Verify GitHub jobs were cancelled
      const jobs = (await transaction(tenant, db => db.query('SELECT status FROM jobs WHERE id = ANY($1::uuid[])', [[job1, job2]]))).rows;
      assert.ok(jobs.every(j => j.status === 'cancelled'));

      // Verify upload job is still queued
      const uploadJob = (await transaction(tenant, db => db.query('SELECT status FROM jobs WHERE id = $1', [jobUpload]))).rows[0];
      assert.equal(uploadJob.status, 'queued');
    } finally {
      client.release();
    }
  } finally {
    await fixturePool.query('DELETE FROM workspaces WHERE id = $1', [tenant]);
    await fixturePool.query('DELETE FROM accounts WHERE id = $1', [user]);
  }
});

test('GitHub Webhooks: repository removal detaches only the removed repository', async () => {
  const user = randomUUID(), tenant = randomUUID();
  const sRemoved = randomUUID(), sKept = randomUUID();
  const jRemoved = randomUUID(), jKept = randomUUID();

  try {
    await fixturePool.query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,'github-test',$2,'GH User 2')", [user, user]);
    await fixturePool.query('INSERT INTO workspaces(id,owner_id) VALUES($1,$2)', [tenant, user]);

    await transaction(tenant, async db => {
      await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'github','PaySure','https://github.com/Krishna0659/PaySure')", [sRemoved, tenant]);
      await db.query("INSERT INTO sources(id,tenant_id,kind,label,locator) VALUES($1,$2,'github','KeptRepo','https://github.com/Krishna0659/KeptRepo')", [sKept, tenant]);
      await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)', [jRemoved, tenant, sRemoved]);
      await db.query('INSERT INTO jobs(id,tenant_id,source_id) VALUES($1,$2,$3)', [jKept, tenant, sKept]);
    });

    const client = await fixturePool.connect();
    try {
      const res = await processWebhookEvent(
        'installation_repositories',
        {
          action: 'removed',
          repositories_removed: [{id: 111, full_name: 'Krishna0659/PaySure'}]
        },
        client
      );
      assert.equal(res.action, 'repositories_removed');
      assert.equal(res.affectedSources, 1);

      // Verify removed repo is detached and its job cancelled
      const removedSource = (await transaction(tenant, db => db.query('SELECT status FROM sources WHERE id = $1', [sRemoved]))).rows[0];
      assert.equal(removedSource.status, 'detached');
      const removedJob = (await transaction(tenant, db => db.query('SELECT status FROM jobs WHERE id = $1', [jRemoved]))).rows[0];
      assert.equal(removedJob.status, 'cancelled');

      // Verify kept repo is still active and its job queued
      const keptSource = (await transaction(tenant, db => db.query('SELECT status FROM sources WHERE id = $1', [sKept]))).rows[0];
      assert.equal(keptSource.status, 'active');
      const keptJob = (await transaction(tenant, db => db.query('SELECT status FROM jobs WHERE id = $1', [jKept]))).rows[0];
      assert.equal(keptJob.status, 'queued');
    } finally {
      client.release();
    }
  } finally {
    await fixturePool.query('DELETE FROM workspaces WHERE id = $1', [tenant]);
    await fixturePool.query('DELETE FROM accounts WHERE id = $1', [user]);
  }
});
