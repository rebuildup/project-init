import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPr, classifyReleaseBranch } from './classify.mts';
import { buildSnapshot, computeSnapshotDelta } from './snapshot.mts';

const NOW = new Date('2026-11-23T00:00:00Z');

test('first snapshot without prior history reports unknown deltas and unavailable forecast (never invents P50/P80/P95)', () => {
  const snap = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/project-init',
      openPrs: [],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          aheadOfDefault: 4,
          behindOfDefault: 0,
          openReleasePr: null,
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  assert.equal(snap.estimationInputs.forecastStatus, 'unavailable');
  assert.equal(snap.estimationInputs.completedWu, 'unknown');
  assert.equal(snap.estimationInputs.quantiles.p50, null);
  assert.equal(snap.releases[0]?.flags.includes('UNRELEASED-COMMITS'), true);
  assert.equal(snap.releases[0]?.flags.includes('TAG-UNPUBLISHED'), true);

  const delta = computeSnapshotDelta(null, snap);
  assert.equal(delta.previousCapturedAt, null);
  assert.equal(delta.deltas[0]?.status, 'unknown');
  assert.equal(delta.deltas[0]?.aheadDelta, 'unknown');
});

test('consecutive snapshots detect branch advancement while representative PR head is unchanged, divergence, and CI failures', () => {
  const prDay1 = classifyPr(
    {
      number: 191,
      title: 'release: v0.4.0',
      isDraft: false,
      base: 'main',
      headSha: '1111111111111111111111111111111111111111',
      updatedAt: '2026-11-21T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );
  const prDay2CiFail = classifyPr(
    {
      number: 205,
      title: 'feat: broken runner',
      isDraft: false,
      base: 'release-0-4-0',
      headSha: '2222222222222222222222222222222222222222',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
      rollupState: 'FAILURE',
      failingChecks: ['ci'],
      baseIsDefault: false,
      baseAheadOfDefault: 12,
    },
    NOW,
  );

  const day1 = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/xyt-media',
      openPrs: [prDay1],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-4-0',
          aheadOfDefault: 570,
          behindOfDefault: 0,
          openReleasePr: { number: 191, isDraft: false, mergeStateStatus: 'CLEAN' },
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  const day2 = buildSnapshot('2026-11-23T00:00:00Z', [
    {
      repo: 'rebuildup/xyt-media',
      openPrs: [prDay1, prDay2CiFail],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-4-0',
          aheadOfDefault: 633,
          behindOfDefault: 3,
          openReleasePr: { number: 191, isDraft: false, mergeStateStatus: 'CLEAN' },
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  const delta = computeSnapshotDelta(day1, day2);
  const row = delta.deltas[0];
  assert.ok(row);
  assert.equal(row.status, 'observed');
  assert.equal(row.aheadDelta, 63);
  assert.equal(row.behindDelta, 3);
  assert.equal(row.ciFailDelta, 1);
  assert.equal(row.representativePrUnchangedWhileBranchAdvanced, true);
  assert.ok(row.addedFlags.includes('BRANCH-DIVERGED'));
});
