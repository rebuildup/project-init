import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPr, classifyReleaseBranch } from './classify.mts';
import {
  buildEstimationInputs,
  buildSnapshot,
  computeSnapshotDelta,
  parseSnapshotJson,
} from './snapshot.mts';

const NOW = new Date('2026-11-23T00:00:00Z');

test('first snapshot without prior history reports unknown deltas, empty addedFlags, and unavailable forecast', () => {
  const snap = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/project-init',
      defaultBranchHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      openPrs: [],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          branchHeadSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
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
  assert.equal(snap.releases[0]?.estimationInputs.forecastStatus, 'unavailable');
  assert.equal(snap.releases[0]?.branchHeadSha, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(snap.releases[0]?.defaultBranchHeadSha, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(snap.releases[0]?.flags.includes('UNRELEASED-COMMITS'), true);
  assert.equal(snap.releases[0]?.flags.includes('TAG-UNPUBLISHED'), true);

  const delta = computeSnapshotDelta(null, snap);
  assert.equal(delta.previousCapturedAt, null);
  assert.equal(delta.deltas[0]?.status, 'unknown');
  assert.equal(delta.deltas[0]?.aheadDelta, 'unknown');
  // First snapshot has no prior baseline, so existing flags must NOT be reported as newly added.
  assert.deepEqual(delta.deltas[0]?.addedFlags, []);
  assert.deepEqual(delta.deltas[0]?.clearedFlags, []);
});

test('buildEstimationInputs enforces agent-delivery-estimation sample-size thresholds', () => {
  const empty = buildEstimationInputs();
  assert.equal(empty.forecastStatus, 'unavailable');
  assert.deepEqual(empty.quantiles, { p50: null, p80: null, p95: null });

  const tooSmall = buildEstimationInputs({
    completedWu: 3,
    remainingWu: 5,
    jointObservationsCount: 4,
    quantiles: { p50: '2d', p80: '4d', p95: '7d' },
  });
  assert.equal(tooSmall.forecastStatus, 'unavailable');
  assert.deepEqual(tooSmall.quantiles, { p50: null, p80: null, p95: null });

  const sparse = buildEstimationInputs({
    completedWu: 6,
    remainingWu: 5,
    jointObservationsCount: 7,
    quantiles: { p50: '2d', p80: '4d', p95: '7d' },
  });
  assert.equal(sparse.forecastStatus, 'conditional');
  assert.deepEqual(sparse.quantiles, { p50: null, p80: null, p95: null });

  const measured = buildEstimationInputs({
    completedWu: 12,
    remainingWu: 5,
    jointObservationsCount: 12,
    quantiles: { p50: '2d', p80: '4d', p95: '7d' },
  });
  assert.equal(measured.forecastStatus, 'complete');
  assert.deepEqual(measured.quantiles, { p50: '2d', p80: '4d', p95: null });

  const fullConditional = buildEstimationInputs({
    completedWu: 20,
    remainingWu: 5,
    jointObservationsCount: 20,
    hasMaterialUnknowns: true,
    quantiles: { p50: '2d', p80: '4d', p95: '7d' },
  });
  assert.equal(fullConditional.forecastStatus, 'conditional');
  assert.deepEqual(fullConditional.quantiles, { p50: '2d', p80: '4d', p95: '7d' });
});

test('multi-release repo scopes open PR metrics strictly per release branch', () => {
  const prRelA = classifyPr(
    {
      number: 101,
      title: 'feat: ticket on release A',
      isDraft: false,
      base: 'release-0-12-0',
      headRefName: '122',
      headSha: '1111111111111111111111111111111111111111',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
      rollupState: 'FAILURE',
      failingChecks: ['test'],
      baseIsDefault: false,
      baseAheadOfDefault: 4,
    },
    NOW,
  );
  const prRelARelease = classifyPr(
    {
      number: 187,
      title: 'release: v0.12.0',
      isDraft: false,
      base: 'main',
      headRefName: 'release-0-12-0',
      headSha: '2222222222222222222222222222222222222222',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );
  const prRelB = classifyPr(
    {
      number: 202,
      title: 'wip: alpha ticket on release B',
      isDraft: true,
      base: 'release/0.1.0-alpha.1',
      headRefName: '200',
      headSha: '3333333333333333333333333333333333333333',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: false,
      baseAheadOfDefault: 2,
    },
    NOW,
  );
  const prUnrelatedMain = classifyPr(
    {
      number: 303,
      title: 'hotfix directly against main',
      isDraft: false,
      base: 'main',
      headRefName: 'hotfix-1',
      headSha: '4444444444444444444444444444444444444444',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'FAILURE',
      failingChecks: ['lint'],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );

  const snap = buildSnapshot('2026-11-23T00:00:00Z', [
    {
      repo: 'rebuildup/multi',
      openPrs: [prRelA, prRelARelease, prRelB, prUnrelatedMain],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          branchHeadSha: '2222222222222222222222222222222222222222',
          aheadOfDefault: 4,
          behindOfDefault: 0,
          openReleasePr: { number: 187, isDraft: false, mergeStateStatus: 'CLEAN' },
          mergedPrCount: 1,
          tagPublished: false,
        }),
        classifyReleaseBranch({
          name: 'release/0.1.0-alpha.1',
          branchHeadSha: '5555555555555555555555555555555555555555',
          aheadOfDefault: 2,
          behindOfDefault: 0,
          openReleasePr: null,
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  const relA = snap.releases.find((r) => r.branch === 'release-0-12-0');
  const relB = snap.releases.find((r) => r.branch === 'release/0.1.0-alpha.1');
  assert.ok(relA && relB);

  // release-0-12-0 has #101 (base=release-0-12-0, CI fail) and #187 (head=release-0-12-0, green).
  assert.equal(relA.openPrTotal, 2);
  assert.equal(relA.openPrDraft, 0);
  assert.equal(relA.openPrReady, 2);
  assert.equal(relA.openPrCiFail, 1);
  assert.equal(relA.openPrConflicting, 0);
  assert.equal(relA.repoOpenPrTotal, 4);

  // release/0.1.0-alpha.1 has ONLY #202 (draft, conflicting, green).
  assert.equal(relB.openPrTotal, 1);
  assert.equal(relB.openPrDraft, 1);
  assert.equal(relB.openPrReady, 0);
  assert.equal(relB.openPrCiFail, 0);
  assert.equal(relB.openPrConflicting, 1);
  assert.equal(relB.repoOpenPrTotal, 4);
});

test('realistic xyt-media scenario: tracked ticket PR stays unchanged while release branch advances via other PRs', () => {
  // Ticket PR #191 targets release-0-4-0 and keeps the same head SHA across both days,
  // while 63 commits from other ticket PRs land on release-0-4-0 (advancing branchHeadSha).
  const trackedTicketPr = classifyPr(
    {
      number: 191,
      title: 'feat: long-running ticket PR',
      isDraft: true,
      base: 'release-0-4-0',
      headRefName: '191',
      headSha: '1111111111111111111111111111111111111111',
      updatedAt: '2026-11-21T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'DRAFT',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: false,
      baseAheadOfDefault: 570,
    },
    NOW,
  );
  const prDay2CiFail = classifyPr(
    {
      number: 205,
      title: 'feat: broken runner',
      isDraft: false,
      base: 'release-0-4-0',
      headRefName: '205',
      headSha: '2222222222222222222222222222222222222222',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
      rollupState: 'FAILURE',
      failingChecks: ['ci'],
      baseIsDefault: false,
      baseAheadOfDefault: 633,
    },
    NOW,
  );
  // Open release PR #180 moves its head SHA with the release branch (as GitHub always does).
  const releasePrDay1 = classifyPr(
    {
      number: 180,
      title: 'release: v0.4.0',
      isDraft: false,
      base: 'main',
      headRefName: 'release-0-4-0',
      headSha: 'aaaa111111111111111111111111111111111111',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );
  const releasePrDay2 = classifyPr(
    {
      number: 180,
      title: 'release: v0.4.0',
      isDraft: false,
      base: 'main',
      headRefName: 'release-0-4-0',
      headSha: 'bbbb222222222222222222222222222222222222',
      updatedAt: '2026-11-23T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );

  const day1 = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/xyt-media',
      openPrs: [releasePrDay1, trackedTicketPr],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-4-0',
          branchHeadSha: 'aaaa111111111111111111111111111111111111',
          aheadOfDefault: 570,
          behindOfDefault: 0,
          openReleasePr: { number: 180, isDraft: false, mergeStateStatus: 'CLEAN' },
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  const day2 = buildSnapshot('2026-11-23T00:00:00Z', [
    {
      repo: 'rebuildup/xyt-media',
      openPrs: [releasePrDay2, trackedTicketPr, prDay2CiFail],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-4-0',
          branchHeadSha: 'bbbb222222222222222222222222222222222222',
          aheadOfDefault: 633,
          behindOfDefault: 3,
          openReleasePr: { number: 180, isDraft: false, mergeStateStatus: 'CLEAN' },
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
  assert.equal(row.openPrTotalDelta, 1);
  assert.equal(row.ciFailDelta, 1);
  assert.equal(row.branchHeadShaChanged, true);
  assert.equal(row.representativePrUnchangedWhileBranchAdvanced, true);
  assert.ok(row.addedFlags.includes('BRANCH-DIVERGED'));
});

test('single normal 1-commit update on open release PR does NOT trigger representativePrUnchangedWhileBranchAdvanced', () => {
  const relPrDay1 = classifyPr(
    {
      number: 187,
      title: 'release: v0.12.0',
      isDraft: false,
      base: 'main',
      headRefName: 'release-0-12-0',
      headSha: 'aaaa000000000000000000000000000000000000',
      updatedAt: '2026-11-22T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );
  const relPrDay2 = classifyPr(
    {
      number: 187,
      title: 'release: v0.12.0',
      isDraft: false,
      base: 'main',
      headRefName: 'release-0-12-0',
      headSha: 'bbbb000000000000000000000000000000000000',
      updatedAt: '2026-11-23T00:00:00Z',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      rollupState: 'SUCCESS',
      failingChecks: [],
      baseIsDefault: true,
      baseAheadOfDefault: 0,
    },
    NOW,
  );

  const day1 = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/project-init',
      openPrs: [relPrDay1],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          branchHeadSha: 'aaaa000000000000000000000000000000000000',
          aheadOfDefault: 10,
          behindOfDefault: 0,
          openReleasePr: { number: 187, isDraft: false, mergeStateStatus: 'CLEAN' },
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);
  const day2 = buildSnapshot('2026-11-23T00:00:00Z', [
    {
      repo: 'rebuildup/project-init',
      openPrs: [relPrDay2],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          branchHeadSha: 'bbbb000000000000000000000000000000000000',
          aheadOfDefault: 11,
          behindOfDefault: 0,
          openReleasePr: { number: 187, isDraft: false, mergeStateStatus: 'CLEAN' },
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  const delta = computeSnapshotDelta(day1, day2);
  assert.equal(delta.deltas[0]?.aheadDelta, 1);
  assert.equal(delta.deltas[0]?.representativePrUnchangedWhileBranchAdvanced, false);
});

test('branch advancing with no open release PR flags representativePrUnchangedWhileBranchAdvanced', () => {
  const day1 = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/project-init',
      openPrs: [],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          branchHeadSha: 'aaaa000000000000000000000000000000000000',
          aheadOfDefault: 2,
          behindOfDefault: 0,
          openReleasePr: null,
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);
  const day2 = buildSnapshot('2026-11-23T00:00:00Z', [
    {
      repo: 'rebuildup/project-init',
      openPrs: [],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          branchHeadSha: 'bbbb000000000000000000000000000000000000',
          aheadOfDefault: 3,
          behindOfDefault: 0,
          openReleasePr: null,
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
  ]);

  const delta = computeSnapshotDelta(day1, day2);
  assert.equal(delta.deltas[0]?.representativePrUnchangedWhileBranchAdvanced, true);
});

test('current.errors repo is classified as unknown with no clearedFlags, NEVER removed-series', () => {
  const day1 = buildSnapshot('2026-11-22T00:00:00Z', [
    {
      repo: 'rebuildup/private-repo',
      openPrs: [],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-12-0',
          aheadOfDefault: 4,
          behindOfDefault: 1,
          openReleasePr: null,
          mergedPrCount: 0,
          tagPublished: false,
        }),
      ],
    },
    {
      repo: 'rebuildup/clean-repo',
      openPrs: [],
      releaseBranches: [
        classifyReleaseBranch({
          name: 'release-0-11-0',
          aheadOfDefault: 0,
          behindOfDefault: 0,
          openReleasePr: null,
          mergedPrCount: 1,
          tagPublished: true,
        }),
      ],
    },
  ]);

  // Day 2: private-repo fails with HTTP 404/network error; clean-repo succeeds with release branch deleted.
  const day2 = buildSnapshot(
    '2026-11-23T00:00:00Z',
    [
      {
        repo: 'rebuildup/clean-repo',
        openPrs: [],
        releaseBranches: [],
      },
    ],
    [{ repo: 'rebuildup/private-repo', message: 'HTTP 404: Not Found' }],
  );

  const delta = computeSnapshotDelta(day1, day2);
  const errored = delta.deltas.find((d) => d.repo === 'rebuildup/private-repo');
  const removed = delta.deltas.find((d) => d.repo === 'rebuildup/clean-repo');

  assert.ok(errored);
  assert.equal(errored.status, 'unknown');
  assert.equal(errored.aheadDelta, 'unknown');
  assert.equal(errored.behindDelta, 'unknown');
  assert.equal(errored.openPrTotalDelta, 'unknown');
  assert.equal(errored.ciFailDelta, 'unknown');
  assert.deepEqual(errored.clearedFlags, []);
  assert.deepEqual(errored.addedFlags, []);

  assert.ok(removed);
  assert.equal(removed.status, 'removed-series');
  assert.deepEqual(removed.clearedFlags, ['MERGED-STALE-BASE']);
});

test('parseSnapshotJson validates schema strictly and rejects malformed/wrong-schema inputs', () => {
  const valid = buildSnapshot('2026-11-23T00:00:00Z', []);
  assert.equal(parseSnapshotJson(JSON.stringify(valid)).schemaVersion, 1);

  assert.throws(() => parseSnapshotJson('not-json'), /invalid JSON/);
  assert.throws(() => parseSnapshotJson('[]'), /must be a JSON object/);
  assert.throws(() => parseSnapshotJson(JSON.stringify({ schemaVersion: 2, capturedAt: '2026-11-23T00:00:00Z', releases: [], errors: [] })), /unsupported schemaVersion/);
  assert.throws(() => parseSnapshotJson(JSON.stringify({ schemaVersion: 1, capturedAt: '2026-11-23T00:00:00Z', releases: 'bad', errors: [] })), /releases must be an array/);
  assert.throws(() => parseSnapshotJson(JSON.stringify({ schemaVersion: 1, capturedAt: '2026-11-23T00:00:00Z', releases: [], errors: null })), /errors must be an array/);
});
