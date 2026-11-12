import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  chunkTextToFacts,
  diffEvidenceFacts,
  applySuggestionsToProfile
} from '../packages/domain/suggestions';
import type {Fact, Profile} from '../packages/contracts/profile';

test('TR13 Suggestions: chunkTextToFacts attaches provenance and respects bounds', () => {
  const sourceId = randomUUID();
  const snapshotId = randomUUID();
  const text = 'Line 1: Education background\nLine 2: Professional work\nLine 3: Open source projects';

  const facts = chunkTextToFacts(text, sourceId, snapshotId, 10);
  assert.equal(facts.length > 0, true);
  for (const f of facts) {
    assert.equal(f.sourceId, sourceId);
    assert.equal(f.snapshotId, snapshotId);
    assert.ok(f.text.length > 0);
    assert.ok(f.text.length <= 10000);
  }
});

test('TR13 Suggestions: diffEvidenceFacts preserves user manual edits and categorizes changes', () => {
  const sourceId = randomUUID();
  const oldSnapId = randomUUID();
  const newSnapId = randomUUID();

  const priorText = [
    'Managed team of 5 engineers',
    'Deployed microservices on AWS',
    'Deprecated legacy service'
  ].join('\n');

  const newText = [
    'Managed team of 5 engineers', // Unchanged
    'Deployed microservices on GCP', // Changed in source
    'Built real-time streaming pipeline' // Brand new addition
    // 'Deprecated legacy service' removed from source
  ].join('\n');

  // Existing facts in user's draft:
  // User manually edited fact 2: "Deployed microservices on AWS and Azure"
  const fact1: Fact = {
    id: randomUUID(),
    text: 'Managed team of 5 engineers',
    sourceId,
    snapshotId: oldSnapId
  };
  const fact2UserEdited: Fact = {
    id: randomUUID(),
    text: 'Deployed microservices on AWS and Azure (custom edit)',
    sourceId,
    snapshotId: oldSnapId
  };
  const fact3: Fact = {
    id: randomUUID(),
    text: 'Deprecated legacy service',
    sourceId,
    snapshotId: oldSnapId
  };

  const existingFacts = [fact1, fact2UserEdited, fact3];

  const diff = diffEvidenceFacts(existingFacts, priorText, newText, sourceId, newSnapId);

  // 1. User manual edit must be preserved (not overwritten by new evidence)
  const userEditedRetained = diff.retainedFacts.find(f => f.id === fact2UserEdited.id);
  assert.ok(userEditedRetained, 'User manual edit must be retained');
  assert.equal(userEditedRetained.text, fact2UserEdited.text);

  // 2. Unchanged fact retained with updated snapshot ID
  const unchangedRetained = diff.retainedFacts.find(f => f.id === fact1.id);
  assert.ok(unchangedRetained, 'Unchanged fact must be retained');
  assert.equal(unchangedRetained.snapshotId, newSnapId);

  // 3. Removed fact proposed for deletion (not silently destroyed)
  const proposedDel = diff.proposedDeletions.find(f => f.id === fact3.id);
  assert.ok(proposedDel, 'Disappeared evidence should be a proposed deletion');

  // 4. Added lines in new evidence proposed as additions
  assert.equal(diff.proposedAdditions.length >= 2, true);
  const addedTexts = diff.proposedAdditions.map(f => f.text);
  assert.ok(addedTexts.some(t => t.includes('streaming pipeline')));
  assert.ok(addedTexts.some(t => t.includes('GCP')));
});

test('TR13 Suggestions: applySuggestionsToProfile merges into sections safely', () => {
  const sourceId = randomUUID();
  const snapId = randomUUID();

  const profile: Profile = {
    schemaVersion: 1,
    displayName: 'Test Dev',
    headline: 'Senior Lead',
    sections: [
      {
        id: randomUUID(),
        title: 'Projects',
        facts: []
      }
    ]
  };

  const newFacts: Fact[] = [
    {id: randomUUID(), text: 'Project PaySure', sourceId, snapshotId: snapId},
    {id: randomUUID(), text: 'Project Zomato Clone', sourceId, snapshotId: snapId}
  ];

  const updated = applySuggestionsToProfile(profile, 'Projects', {
    retainedFacts: [],
    proposedAdditions: newFacts,
    proposedDeletions: []
  });

  const projSection = updated.sections.find(s => s.title === 'Projects');
  assert.ok(projSection);
  assert.equal(projSection.facts.length, 2);
  assert.equal(projSection.facts[0].text, 'Project PaySure');
});
