import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../packages/domain/filestore';

test('FileStore: putImmutable writes file with SHA-256 and atomic durability', async () => {
  const testDir = join('.local', 'test-objects-' + randomUUID());
  const store = new FileStore(testDir);
  try {
    const key = `${randomUUID()}.txt`;
    const content = Buffer.from('Hello PortfolioAI FileStore', 'utf8');

    const putRes = await store.putImmutable(key, content);
    assert.equal(putRes.key, key);
    assert.equal(putRes.size, content.length);
    assert.ok(putRes.hash.length === 64);

    // Read back content
    const readData = await store.read(key);
    assert.deepEqual(readData, content);

    // Stat metadata
    const statRes = await store.stat(key);
    assert.equal(statRes.key, key);
    assert.equal(statRes.size, content.length);
    assert.equal(statRes.hash, putRes.hash);

    // Immutability: overwriting same key must fail with 409
    await assert.rejects(
      store.putImmutable(key, Buffer.from('Altered content')),
      /Object already exists/
    );

    // Delete
    const deleted = await store.delete(key);
    assert.equal(deleted, true);

    // Second delete returns false
    const deletedAgain = await store.delete(key);
    assert.equal(deletedAgain, false);
  } finally {
    await rm(testDir, {recursive: true, force: true});
  }
});

test('FileStore: rejects path traversal and malformed keys', async () => {
  const testDir = join('.local', 'test-objects-' + randomUUID());
  const store = new FileStore(testDir);
  try {
    const content = Buffer.from('test');

    // Directory traversal in key
    await assert.rejects(
      store.putImmutable('../escape.txt', content),
      /traversal/i
    );
    await assert.rejects(
      store.putImmutable('..\\escape.txt', content),
      /traversal/i
    );
    await assert.rejects(
      store.read('../../secrets.json'),
      /traversal/i
    );

    // Malformed extension / characters
    await assert.rejects(
      store.putImmutable('invalid-key.exe', content),
      /Invalid object key format/
    );
    await assert.rejects(
      store.putImmutable('not-a-uuid.pdf', content),
      /Invalid object key format/
    );
  } finally {
    await rm(testDir, {recursive: true, force: true});
  }
});

test('FileStore: verifies SHA-256 hash when provided and rejects mismatches', async () => {
  const testDir = join('.local', 'test-objects-' + randomUUID());
  const store = new FileStore(testDir);
  try {
    const key = `${randomUUID()}.md`;
    const content = Buffer.from('# Verified Content');
    const wrongHash = '0000000000000000000000000000000000000000000000000000000000000000';

    await assert.rejects(
      store.putImmutable(key, content, wrongHash),
      /hash mismatch/i
    );

    // File should not exist in storage
    await assert.rejects(store.read(key));
  } finally {
    await rm(testDir, {recursive: true, force: true});
  }
});

test('FileStore: enforces 10 MiB maximum file limit', async () => {
  const testDir = join('.local', 'test-objects-' + randomUUID());
  const store = new FileStore(testDir);
  try {
    const key = `${randomUUID()}.docx`;
    // 10 MiB + 1 byte
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);

    await assert.rejects(
      store.putImmutable(key, oversized),
      /exceeds 10 MiB/i
    );
  } finally {
    await rm(testDir, {recursive: true, force: true});
  }
});

test('FileStore: listForReconciliation accurately lists valid stored objects', async () => {
  const testDir = join('.local', 'test-objects-' + randomUUID());
  const store = new FileStore(testDir);
  try {
    const k1 = `${randomUUID()}.pdf`;
    const k2 = `${randomUUID()}.docx`;

    await store.putImmutable(k1, Buffer.from('PDF data'));
    await store.putImmutable(k2, Buffer.from('DOCX data'));

    const list = await store.listForReconciliation();
    assert.equal(list.length, 2);
    const keys = list.map(item => item.key);
    assert.ok(keys.includes(k1));
    assert.ok(keys.includes(k2));
  } finally {
    await rm(testDir, {recursive: true, force: true});
  }
});

