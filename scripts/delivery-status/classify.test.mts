import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  classifyPr,
  classifyReleaseBranch,
  ciFromRollup,
  type PrFacts,
  type ReleaseBranchFacts,
} from './classify.mts';

const NOW = new Date('2026-11-05T00:00:00Z');

function pr(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 1,
    title: 'fixture',
    isDraft: false,
    base: 'main',
    headSha: 'abcdef1234567890',
    updatedAt: '2026-11-01T00:00:00Z',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    rollupState: 'SUCCESS',
    failingChecks: [],
    baseIsDefault: true,
    baseAheadOfDefault: null,
    ...overrides,
  };
}

function release(overrides: Partial<ReleaseBranchFacts> = {}): ReleaseBranchFacts {
  return {
    name: 'release-0-8-0',
    aheadOfDefault: 0,
    openReleasePr: null,
    mergedPrCount: 0,
    ...overrides,
  };
}

// Known facts from rebuildup/pc-setup and rebuildup/project-init (2026-11-04 survey).
test('pc-setup #155: green and CLEAN is reported without flags (unmerged, not a problem flag)', () => {
  const row = classifyPr(pr({ number: 155 }), NOW);
  assert.equal(row.ci, 'SUCCESS');
  assert.equal(row.mergeStateStatus, 'CLEAN');
  assert.deepEqual(row.flags, []);
});

test('pc-setup #154: CONFLICTING is flagged from mergeable state', () => {
  const row = classifyPr(pr({ number: 154, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), NOW);
  assert.ok(row.flags.includes('CONFLICTING'));
});

test('pc-setup #150: draft with failing check and stale base flags CI-FAIL and STALE-BASE', () => {
  const row = classifyPr(
    pr({
      number: 150,
      isDraft: true,
      base: 'release-0-7-0',
      baseIsDefault: false,
      baseAheadOfDefault: 0,
      rollupState: 'FAILURE',
      failingChecks: ['powershell'],
      mergeStateStatus: 'UNSTABLE',
    }),
    NOW,
  );
  assert.equal(row.draft, true);
  assert.equal(row.ci, 'FAILURE');
  assert.deepEqual(row.failingChecks, ['powershell']);
  assert.deepEqual([...row.flags].sort(), ['CI-FAIL', 'STALE-BASE']);
});

test('project-init #146: DIRTY draft on a live release branch flags CONFLICTING without STALE-BASE', () => {
  const row = classifyPr(
    pr({
      number: 146,
      isDraft: true,
      base: 'release-0-8-0',
      baseIsDefault: false,
      baseAheadOfDefault: 3,
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
    }),
    NOW,
  );
  assert.deepEqual(row.flags, ['CONFLICTING']);
});

test('pc-setup release-0-7-0: branch fully contained in main flags MERGED-STALE-BASE (no merged PR needed)', () => {
  const row = classifyReleaseBranch(release({ name: 'release-0-7-0', aheadOfDefault: 0, mergedPrCount: 0 }));
  assert.deepEqual(row.flags, ['MERGED-STALE-BASE']);
  assert.equal(row.mergedPrCount, 0);
});

// Never guess green.
test('unknown rollup (no checks on head) is UNKNOWN and flagged, never SUCCESS', () => {
  const row = classifyPr(pr({ rollupState: null }), NOW);
  assert.equal(row.ci, 'UNKNOWN');
  assert.ok(row.flags.includes('NO-PR-BODY-CHECKS'));
});

test('unrecognised rollup state is UNKNOWN, not SUCCESS', () => {
  assert.equal(ciFromRollup('SOMETHING_NEW'), 'UNKNOWN');
});

test('pending and expected checks are PENDING with no failure flag', () => {
  assert.equal(ciFromRollup('PENDING'), 'PENDING');
  assert.equal(ciFromRollup('EXPECTED'), 'PENDING');
  assert.deepEqual(classifyPr(pr({ rollupState: 'PENDING' }), NOW).flags, []);
});

test('ERROR rollup counts as CI-FAIL', () => {
  assert.ok(classifyPr(pr({ rollupState: 'ERROR' }), NOW).flags.includes('CI-FAIL'));
});

test('UNKNOWN mergeable does not produce a CONFLICTING or clean verdict', () => {
  const row = classifyPr(pr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), NOW);
  assert.deepEqual(row.flags, []);
});

test('base comparison failure is BASE-UNKNOWN, not STALE-BASE and not silent', () => {
  const row = classifyPr(pr({ base: 'feature-x', baseIsDefault: false, baseAheadOfDefault: null }), NOW);
  assert.deepEqual(row.flags, ['BASE-UNKNOWN']);
});

test('base that is still ahead of default is not stale', () => {
  const row = classifyPr(pr({ base: 'release-0-8-0', baseIsDefault: false, baseAheadOfDefault: 5 }), NOW);
  assert.deepEqual(row.flags, []);
});

test('PRs targeting the default branch never get a base flag', () => {
  const row = classifyPr(pr({ baseIsDefault: true, baseAheadOfDefault: null }), NOW);
  assert.deepEqual(row.flags, []);
});

test('age is whole days since last update and never negative', () => {
  assert.equal(classifyPr(pr({ updatedAt: '2026-11-01T12:00:00Z' }), NOW).ageDays, 3);
  assert.equal(classifyPr(pr({ updatedAt: '2026-11-06T00:00:00Z' }), NOW).ageDays, 0);
  assert.throws(() => classifyPr(pr({ updatedAt: 'not-a-date' }), NOW), /invalid updatedAt/);
});

test('release branch ahead of main with no open release PR flags UNRELEASED-COMMITS', () => {
  const row = classifyReleaseBranch(release({ aheadOfDefault: 4 }));
  assert.deepEqual(row.flags, ['UNRELEASED-COMMITS']);
});

test('release branch ahead of main with an open release PR is not flagged', () => {
  const row = classifyReleaseBranch(
    release({ aheadOfDefault: 4, openReleasePr: { number: 146, isDraft: true, mergeStateStatus: 'DIRTY' } }),
  );
  assert.deepEqual(row.flags, []);
});

test('release branch with merged PRs and nothing ahead of main is flagged MERGED-STALE-BASE', () => {
  assert.deepEqual(classifyReleaseBranch(release({ aheadOfDefault: 0, mergedPrCount: 1 })).flags, ['MERGED-STALE-BASE']);
});

test('release branch whose comparison failed is BRANCH-UNKNOWN, not clean', () => {
  const row = classifyReleaseBranch(release({ aheadOfDefault: null, mergedPrCount: 1 }));
  assert.deepEqual(row.flags, ['BRANCH-UNKNOWN']);
});
