import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classifyReleaseBranch } from './classify.mts';
import {
  main,
  matchesReleasePr,
  paginate,
  parseArgs,
  redact,
  renderText,
  writeSnapshotFile,
  type Report,
} from './delivery-status.mts';
import { buildSnapshot, computeSnapshotDelta } from './snapshot.mts';

test('missing or option-looking --repo / --snapshot-out / --prev-snapshot values are argument errors', () => {
  assert.throws(() => parseArgs(['--repo']), /requires owner\/name/);
  assert.throws(() => parseArgs(['--repo', '--json']), /requires owner\/name/);
  assert.throws(() => parseArgs(['--snapshot-out']), /requires a file path/);
  assert.throws(() => parseArgs(['--snapshot-out', '--json']), /requires a file path/);
  assert.throws(() => parseArgs(['--prev-snapshot']), /requires a file path/);
  assert.throws(() => parseArgs(['--prev-snapshot', '--json']), /requires a file path/);
  assert.deepEqual(parseArgs(['--repo', 'owner/repo', '--json']).repos, ['owner/repo']);
});

test('both report formats mask token-shaped PR titles/check names', () => {
  const token = 'ghp_' + 'A'.repeat(30);
  assert.equal(redact('PR title: ' + token), 'PR title: [REDACTED]');
  assert.equal(redact(JSON.stringify({ check: token })), JSON.stringify({ check: '[REDACTED]' }));
});

test('fork PR with same branch name is not local release PR', () => {
  const pr = { headRefName: 'release-0-9-0', baseRefName: 'main', isCrossRepository: true };
  assert.equal(matchesReleasePr(pr, 'release-0-9-0', 'main'), false);
  assert.equal(matchesReleasePr({ ...pr, isCrossRepository: false }, 'release-0-9-0', 'main'), true);
});

test('writeSnapshotFile creates nested parent directories and redacts tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-status-test-'));
  try {
    const outPath = join(dir, 'nested', 'deep', 'snapshot.json');
    const token = 'github_pat_' + 'B'.repeat(24);
    const snap = buildSnapshot('2026-11-23T00:00:00Z', [], [{ repo: 'o/r', message: `leak ${token}` }]);
    writeSnapshotFile(outPath, snap);
    const written = readFileSync(outPath, 'utf8');
    assert.equal(written.includes(token), false);
    assert.equal(written.includes('[REDACTED]'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main returns exit code 2 on missing, corrupt, or wrong-schema --prev-snapshot without uncaught throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-status-prev-'));
  try {
    const missing = join(dir, 'does-not-exist.json');
    assert.equal(main(['--prev-snapshot', missing, '--repo', 'rebuildup/project-init']), 2);

    const corrupt = join(dir, 'corrupt.json');
    writeFileSync(corrupt, '{bad json', 'utf8');
    assert.equal(main(['--prev-snapshot', corrupt, '--repo', 'rebuildup/project-init']), 2);

    const wrongSchema = join(dir, 'wrong-schema.json');
    writeFileSync(
      wrongSchema,
      JSON.stringify({ schemaVersion: 99, capturedAt: '2026-11-22T00:00:00Z', releases: [], errors: [] }),
      'utf8',
    );
    assert.equal(main(['--prev-snapshot', wrongSchema, '--repo', 'rebuildup/project-init']), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderText includes BEHIND, TAG, Delta summary, and BRANCH-DIVERGED / TAG-UNPUBLISHED legend', () => {
  const relDay1 = classifyReleaseBranch({
    name: 'release/0.1.0-alpha.1',
    branchHeadSha: '1111111111111111111111111111111111111111',
    aheadOfDefault: 2,
    behindOfDefault: 0,
    openReleasePr: null,
    mergedPrCount: 0,
    tagPublished: false,
  });
  const relDay2 = classifyReleaseBranch({
    name: 'release/0.1.0-alpha.1',
    branchHeadSha: '2222222222222222222222222222222222222222',
    aheadOfDefault: 5,
    behindOfDefault: 2,
    openReleasePr: null,
    mergedPrCount: 0,
    tagPublished: false,
  });
  const snap1 = buildSnapshot('2026-11-22T00:00:00Z', [{ repo: 'o/r', openPrs: [], releaseBranches: [relDay1] }]);
  const snap2 = buildSnapshot('2026-11-23T00:00:00Z', [{ repo: 'o/r', openPrs: [], releaseBranches: [relDay2] }]);
  const delta = computeSnapshotDelta(snap1, snap2);
  const report: Report = {
    generatedAt: '2026-11-23T00:00:00Z',
    repos: [
      {
        repo: 'o/r',
        defaultBranch: 'main',
        defaultBranchHeadSha: '3333333333333333333333333333333333333333',
        openPrs: [],
        releaseBranches: [relDay2],
      },
    ],
    errors: [],
    snapshot: snap2,
    delta,
  };

  const rendered = renderText(report);
  assert.match(rendered, /BEHIND/);
  assert.match(rendered, /TAG/);
  assert.match(rendered, /unpublished/);
  assert.match(rendered, /## Delta/);
  assert.match(rendered, /\+3/);
  assert.match(rendered, /\+2/);
  assert.match(rendered, /BRANCH-DIVERGED/);
  assert.match(rendered, /TAG-UNPUBLISHED/);
});

test('pagination returns a complete, ordered multi-page inventory', () => {
  const seen: (string | null)[] = [];
  const pages = new Map<string, { nodes: number[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }>([
    ['start', { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: 'p1' } }],
    ['p1', { nodes: [3], pageInfo: { hasNextPage: true, endCursor: 'p2' } }],
    ['p2', { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }],
  ]);
  const values = paginate<number>((after) => {
    seen.push(after);
    const page = pages.get(after ?? 'start');
    if (!page) throw Error('unexpected cursor');
    return page;
  });
  assert.deepEqual(values, [1, 2, 3]);
  assert.deepEqual(seen, [null, 'p1', 'p2']);
});

test('pagination rejects missing and repeated next-page cursors', () => {
  for (const bad of [null, '']) {
    assert.throws(
      () => paginate(() => ({ nodes: [1], pageInfo: { hasNextPage: true, endCursor: bad } })),
      /incomplete GraphQL pagination/,
    );
  }
  let n = 0;
  assert.throws(
    () =>
      paginate(() => {
        n++;
        return { nodes: [n], pageInfo: { hasNextPage: true, endCursor: 'same' } };
      }),
    /incomplete GraphQL pagination/,
  );
  assert.equal(n, 2);
});

test('pagination rejects malformed pages, not just explicit failures', () => {
  assert.throws(
    () =>
      paginate<number>(() => ({
        nodes: [],
        pageInfo: null as unknown as { hasNextPage: boolean; endCursor: string | null },
      })),
    /invalid GraphQL pagination response/,
  );
  assert.throws(
    () =>
      paginate<number>(() => ({
        nodes: null as unknown as number[],
        pageInfo: { hasNextPage: false, endCursor: null },
      })),
    /invalid GraphQL pagination response/,
  );
});

test('pagination accepts a legitimately empty final page', () => {
  assert.deepEqual(
    paginate<number>(() => ({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    })),
    [],
  );
});
