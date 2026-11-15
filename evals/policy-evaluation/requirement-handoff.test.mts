import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gradeRecords } from '../shared/record-grader.mts';
const contracts = JSON.parse(readFileSync(new URL('../shared/record-contracts.json', import.meta.url), 'utf8')) as Record<string, any>;
const spec = contracts['requirement-handoff'];
const original = readFileSync(new URL('./fixtures/requirement-handoff-positive.txt', import.meta.url), 'utf8');
test('canonical-handoff grader discriminates every critical decision', () => {
  assert.equal(gradeRecords(original, spec).at(-1), 'EVAL PASS');
  const lines = original.trimEnd().split(String.fromCharCode(10));
  for (let i=0; i<lines.length; i++) {
    const corrupt = lines.slice(); corrupt[i] = corrupt[i].replace(/=.*/, '=unknown');
    assert.equal(gradeRecords(corrupt.join(String.fromCharCode(10)) + String.fromCharCode(10), spec).at(-1), 'EVAL FAIL', 'line ' + (i+1));
  }
});
