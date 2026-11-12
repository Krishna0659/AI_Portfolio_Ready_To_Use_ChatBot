import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  KnowledgeBaseClient,
  DisabledKnowledgeBaseAdapter,
  MockKnowledgeBaseAdapter,
  PublishEvent,
  PurgeEvent
} from '../packages/domain/knowledge-base-client';
import {emptyProfile} from '../packages/contracts/profile';

test('TR15 KnowledgeBaseClient: Disabled adapter returns blocked_configuration', async () => {
  const client = new KnowledgeBaseClient('disabled');
  const tenantId = randomUUID();
  const profileId = 'main-profile';

  const event: PublishEvent = {
    eventId: randomUUID(),
    contractVersion: 'approved-profile-v1',
    type: 'publish',
    generation: 1,
    profileVersion: 1,
    content: emptyProfile,
    contentHash: 'hash123',
    publishConsent: true
  };

  const receipt = await client.submit(tenantId, profileId, event);
  assert.equal(receipt.status, 'blocked_configuration');
  assert.equal(receipt.generation, 1);
  assert.ok(receipt.message?.includes('disabled'));

  const state = await client.getProfileState(tenantId, profileId);
  assert.equal(state.status, 'empty');
});

test('TR15 KnowledgeBaseClient: Mock adapter enforces consent and generation order', async () => {
  const client = new KnowledgeBaseClient('mock');
  const tenantId = randomUUID();
  const profileId = 'main-profile';

  // 1. Publishing without consent must fail with 400
  const eventNoConsent: PublishEvent = {
    eventId: randomUUID(),
    contractVersion: 'approved-profile-v1',
    type: 'publish',
    generation: 1,
    profileVersion: 1,
    content: emptyProfile,
    contentHash: 'hash123',
    publishConsent: false
  };

  await assert.rejects(
    client.submit(tenantId, profileId, eventNoConsent),
    /Publication requires explicit user consent/
  );

  // 2. Publishing with consent succeeds with mock_succeeded
  const eventWithConsent: PublishEvent = {
    ...eventNoConsent,
    publishConsent: true
  };
  const receipt1 = await client.submit(tenantId, profileId, eventWithConsent);
  assert.equal(receipt1.status, 'mock_succeeded');
  assert.equal(receipt1.generation, 1);

  // Verify operation retrieval
  const op = await client.getOperation(tenantId, profileId, eventWithConsent.eventId);
  assert.ok(op);
  assert.equal(op.status, 'mock_succeeded');

  // Verify state
  const state1 = await client.getProfileState(tenantId, profileId);
  assert.equal(state1.status, 'mock_indexed');
  assert.equal(state1.generation, 1);

  // 3. Stale generation replay (same or lower generation) must be rejected with 409
  const staleEvent: PublishEvent = {
    eventId: randomUUID(),
    contractVersion: 'approved-profile-v1',
    type: 'publish',
    generation: 1,
    profileVersion: 1,
    content: emptyProfile,
    contentHash: 'hash123',
    publishConsent: true
  };
  await assert.rejects(
    client.submit(tenantId, profileId, staleEvent),
    /Stale generation rejected/
  );

  // 4. Purge event with higher generation succeeds and marks state purged
  const purgeEvent: PurgeEvent = {
    eventId: randomUUID(),
    contractVersion: 'approved-profile-v1',
    type: 'purge',
    generation: 2
  };
  const purgeReceipt = await client.submit(tenantId, profileId, purgeEvent);
  assert.equal(purgeReceipt.status, 'mock_succeeded');
  assert.equal(purgeReceipt.generation, 2);

  const state2 = await client.getProfileState(tenantId, profileId);
  assert.equal(state2.status, 'purged');
  assert.equal(state2.generation, 2);
});

