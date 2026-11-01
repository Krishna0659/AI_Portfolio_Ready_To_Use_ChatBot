import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceDiff} from '../packages/contracts/evidence-diff';
test('sync reports changes without discarding repeated evidence',()=>{assert.deepEqual(evidenceDiff('A\nA\nB','A\nB\nC'),{added:['C'],removed:['A'],unchanged:false});});
test('unchanged captures have no inferred removals',()=>{assert.deepEqual(evidenceDiff('A\nB','A\nB'),{added:[],removed:[],unchanged:true});});
test('line endings and whitespace do not create changed facts',()=>{const result=evidenceDiff('A\r\n B','A\nB');assert.deepEqual(result.added,[]);assert.deepEqual(result.removed,[]);});
