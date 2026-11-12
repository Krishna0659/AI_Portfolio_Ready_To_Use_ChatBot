/**
 * Phase 4 — Synchronization contract tests.
 * Verifies: KB events table uniqueness, superseding, stale generation rejection,
 * unapproved events stay blocked_configuration, mock adapter state transitions,
 * and that lower generations cannot overwrite higher ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
 KnowledgeBaseClient,
 MockKnowledgeBaseAdapter,
 DisabledKnowledgeBaseAdapter,
 OperationEvent,
 PublishEvent,
 PurgeEvent,
} from '../packages/domain/knowledge-base-client';

// --- Helper to build publish events ---
function publishEvent(generation:number,consent=true):PublishEvent{
 return{
  eventId:randomUUID(),
  contractVersion:'approved-profile-v1',
  type:'publish',
  generation,
  profileVersion:generation,
  content:{schemaVersion:1,displayName:'Alice',headline:'Engineer',sections:[]},
  contentHash:'abc123',
  publishConsent:consent,
 };
}
function purgeEvent(generation:number):PurgeEvent{
 return{eventId:randomUUID(),contractVersion:'approved-profile-v1',type:'purge',generation};
}

// --- DisabledKnowledgeBaseAdapter ---

test('Phase 4 Sync: disabled adapter always returns blocked_configuration', async()=>{
 const adapter=new DisabledKnowledgeBaseAdapter();
 const receipt=await adapter.submit('t1','p1',publishEvent(1));
 assert.equal(receipt.status,'blocked_configuration');
 assert.equal(receipt.generation,1);
});

test('Phase 4 Sync: disabled adapter getProfileState returns empty', async()=>{
 const adapter=new DisabledKnowledgeBaseAdapter();
 const state=await adapter.getProfileState('t1','p1');
 assert.equal(state.status,'empty');
 assert.equal(state.generation,0);
});

test('Phase 4 Sync: disabled adapter getOperation returns null', async()=>{
 const adapter=new DisabledKnowledgeBaseAdapter();
 const result=await adapter.getOperation('t1','p1',randomUUID());
 assert.equal(result,null);
});

// --- MockKnowledgeBaseAdapter ---

test('Phase 4 Sync: mock adapter accepts publish event with consent and returns mock_succeeded', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 const receipt=await adapter.submit('t1','p1',publishEvent(1));
 assert.equal(receipt.status,'mock_succeeded');
 assert.equal(receipt.generation,1);
});

test('Phase 4 Sync: mock adapter rejects publish without consent', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 await assert.rejects(
  ()=>adapter.submit('t1','p1',publishEvent(1,false)),
  /consent/i
 );
});

test('Phase 4 Sync: mock adapter rejects stale generation (lower than current)', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 await adapter.submit('t1','p1',publishEvent(5));
 // Attempt to submit a lower generation — must be rejected
 await assert.rejects(
  ()=>adapter.submit('t1','p1',publishEvent(3)),
  /stale generation/i
 );
});

test('Phase 4 Sync: mock adapter rejects same generation replay', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 await adapter.submit('t1','p1',publishEvent(2));
 await assert.rejects(
  ()=>adapter.submit('t1','p1',publishEvent(2)),
  /stale generation/i
 );
});

test('Phase 4 Sync: mock adapter accepts strictly increasing generations', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 const r1=await adapter.submit('t1','p1',publishEvent(1));
 const r2=await adapter.submit('t1','p1',publishEvent(2));
 const r3=await adapter.submit('t1','p1',purgeEvent(3));
 assert.equal(r1.status,'mock_succeeded');
 assert.equal(r2.status,'mock_succeeded');
 assert.equal(r3.status,'mock_succeeded');
 const state=await adapter.getProfileState('t1','p1');
 assert.equal(state.status,'purged');
 assert.equal(state.generation,3);
});

test('Phase 4 Sync: tenant isolation — different tenants have independent generation counters', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 await adapter.submit('tenantA','p1',publishEvent(10));
 // tenantB starts at 0 — generation 1 must be accepted
 const r=await adapter.submit('tenantB','p1',publishEvent(1));
 assert.equal(r.status,'mock_succeeded');
 // tenantA generation must still be 10
 const stateA=await adapter.getProfileState('tenantA','p1');
 assert.equal(stateA.generation,10);
});

test('Phase 4 Sync: getOperation retrieves the receipt by eventId', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 const event=publishEvent(1);
 await adapter.submit('t1','p1',event);
 const receipt=await adapter.getOperation('t1','p1',event.eventId);
 assert.ok(receipt,'should find receipt by eventId');
 assert.equal(receipt!.status,'mock_succeeded');
 assert.equal(receipt!.eventId,event.eventId);
});

test('Phase 4 Sync: getOperation returns null for unknown eventId', async()=>{
 const adapter=new MockKnowledgeBaseAdapter();
 const result=await adapter.getOperation('t1','p1',randomUUID());
 assert.equal(result,null);
});

// --- KnowledgeBaseClient dispatch ---

test('Phase 4 Sync: KnowledgeBaseClient dispatches to DisabledAdapter by default', async()=>{
 const client=new KnowledgeBaseClient();
 const receipt=await client.submit('t1','p1',publishEvent(1));
 assert.equal(receipt.status,'blocked_configuration');
});

test('Phase 4 Sync: KnowledgeBaseClient dispatches to MockAdapter when mode=mock', async()=>{
 const client=new KnowledgeBaseClient('mock');
 const receipt=await client.submit('t1','p1',publishEvent(1));
 assert.equal(receipt.status,'mock_succeeded');
});

test('Phase 4 Sync: KnowledgeBaseClient setAdapter overrides the adapter', async()=>{
 const client=new KnowledgeBaseClient();
 // start disabled
 const r1=await client.submit('t1','p1',publishEvent(1));
 assert.equal(r1.status,'blocked_configuration');
 // switch to mock
 client.setAdapter(new MockKnowledgeBaseAdapter());
 const r2=await client.submit('t1','p1',publishEvent(2));
 assert.equal(r2.status,'mock_succeeded');
});
