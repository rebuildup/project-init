import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runControls } from './shared/controls.mts';
import { gradeRecords } from './shared/record-grader.mts';
import { grade as gradeConstitution } from './policy-evaluation/constitutional-refinement-grade.mts';
import { check as checkRelease } from './release-batching/grade.mts';

test('record grader accepts CRLF but rejects embedded carriage returns', () => {
  const contract = {
    heading: 'fixture', required: [['required', 'layer=practice']] as Array<[string, string]>,
    forbid: [] as Array<[string, string]>, order: true,
  };
  assert.equal(gradeRecords('layer=practice\r\n', contract).at(-1), 'EVAL PASS');
  assert.equal(gradeRecords('layer=prac\rtice\n', contract).at(-1), 'EVAL FAIL');
});

test('constitutional grader rejects embedded CR while retaining CRLF support', () => {
  const records = [
    'layer=practice',
    'decision=candidate-refinement',
    'constitutional=identity,evidence,mutable-ownership,continuity',
    'evidence=implementation-conformance-required',
    'worktrunk=replaceable-not-invariant',
    'delivery.ticket_branch=preserve',
    'delivery.draft_pr=preserve',
    'delivery.draft_release_pr=preserve',
    'durable_update=practice-profile-adr',
    'risk=surface-unknowns',
  ];
  assert.equal(gradeConstitution(records.join('\r\n') + '\r\n').at(-1), 'EVAL PASS');
  assert.equal(gradeConstitution(records.join('\n').replace('layer=practice', 'layer=prac\rtice') + '\n').at(-1), 'EVAL FAIL');
});

const validCandidate = {
  trigger: 'manual', outcome: 'candidate', stage: 'frozen',
  basis: {
    scope: 'selected runtime gate', value: 'specific integration risk mitigated',
    waiting: 'unknown', change_risk: 'unknown', release_cost: 'unknown',
  },
  admission_passed: true, candidate_sha: 'a'.repeat(40), validated_sha: null,
  release_gate_passed: false, ticket_landing_requested: false,
  release_merge_requested: false, release_authorized: false, authorized_sha: null,
};
test('release candidate needs a real scope', () => {
  assert.deepEqual(checkRelease(validCandidate), []);
  const findings = checkRelease({
    ...validCandidate, basis: { ...validCandidate.basis, scope: 'n/a' },
  });
  assert.ok(findings.some(x => x.includes('candidate scope must be selected')));
});
test('multiple count phrases do not count as evidence', () => {
  const findings = checkRelease({
    ...validCandidate,
    basis: {
      scope: 'defined',
      value: '12 files changed, 3 PRs',
      waiting: 'unknown', change_risk: 'unknown', release_cost: 'unknown',
    },
  });
  assert.ok(findings.some(x => x.includes('substantive non-count evidence')));
});
test('blocked cannot be verified or frozen', () => {
  const findings = checkRelease({ ...validCandidate, outcome: 'blocked', stage: 'verified' });
  assert.ok(findings.some(x => x.includes('blocked cannot freeze/verify')));
});
test('control runner rejects absent negative fixture even if grader says FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-init-eval-'));
  try {
    writeFileSync(join(dir, 'grade.mts'), "console.log('FAIL no answer file at missing'); process.exitCode = 1;\n");
    const status = runControls(dir, 'grade.mts', [['missing fixture', 'missing.txt', 'FAIL']], 'PLAIN');
    assert.equal(status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
