#!/usr/bin/env node
// Read-only delivery-status report across repositories.
//
// Detects work stranded between Issue / PR / release branch and `main`:
// open PRs (CI, conflicts, stale base), release-* / release/* branches with
// unreleased commits, divergence, unpublished tags, and merged release branches
// that were never deleted.
//
// Usage:
//   node scripts/delivery-status/delivery-status.mts [--repo owner/name ...] [--json]
//     [--snapshot-out path] [--prev-snapshot path]
//
// Read-only by construction: only `gh api` GraphQL queries and REST GETs are
// issued. Nothing is merged, commented on, labelled or otherwise mutated.
// Authentication is delegated to `gh`; this script never reads or prints tokens.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPr,
  classifyReleaseBranch,
  isReleaseBranch,
  isReleaseTagPublished,
  type PrFacts,
  type PrRow,
  type ReleaseRow,
  type ReleaseBranchFacts,
} from './classify.mts';
import {
  buildSnapshot,
  computeSnapshotDelta,
  parseSnapshotJson,
  type DeliverySnapshot,
  type SnapshotDeltaReport,
} from './snapshot.mts';

const DEFAULT_REPOS = [
  'rebuildup/pc-setup',
  'rebuildup/dotfiles',
  'rebuildup/project-init',
] as const;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FAILING_CHECK_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILING_STATUS_STATES = new Set(['FAILURE', 'ERROR']);

export interface RepoReport {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly defaultBranchHeadSha: string | null;
  readonly openPrs: readonly PrRow[];
  readonly releaseBranches: readonly ReleaseRow[];
}

export interface Report {
  readonly generatedAt: string;
  readonly repos: readonly RepoReport[];
  readonly errors: readonly { readonly repo: string; readonly message: string }[];
  readonly snapshot?: DeliverySnapshot;
  readonly delta?: SnapshotDeltaReport;
}

class GhError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

// Defence in depth: gh should never echo credentials, but scrub token-shaped
// strings from anything we print.
export function redact(text: string): string {
  return text.replace(/(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g, '[REDACTED]');
}

function gh(args: readonly string[]): string {
  try {
    return execFileSync('gh', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr?.toString() ?? '';
    throw new GhError(redact(stderr.trim() || 'gh command failed'), redact(stderr));
  }
}

function ghJson<T>(args: readonly string[]): T {
  return JSON.parse(gh(args)) as T;
}

const REPO_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title isDraft isCrossRepository baseRefName headRefName headRefOid updatedAt
        mergeable mergeStateStatus
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name conclusion completedAt }
              ... on StatusContext { context state createdAt }
            }
          }
        }
      }
    }
  }
}`;

function defaultBranchInfo(owner: string, name: string): { name: string; headSha: string | null } {
  const data = ghJson<{
    data: {
      repository: {
        defaultBranchRef: { name: string; target?: { oid?: string } | null } | null;
      };
    };
  }>([
    'api',
    'graphql',
    '-f',
    `query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name target { oid } } } }`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
  ]);
  const ref = data.data.repository.defaultBranchRef;
  if (!ref?.name) throw new Error(`${owner}/${name} has no default branch`);
  return { name: ref.name, headSha: ref.target?.oid ?? null };
}

// Query both `release-*` and `release/*` via prefix "release", then filter strictly with isReleaseBranch.
const REFS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, after: $after, query: "release") {
      pageInfo { hasNextPage endCursor }
      nodes { name target { oid } }
    }
  }
}`;

const TAGS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/tags/", first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { name }
    }
  }
}`;

const MERGED_COUNT_QUERY = `
query($owner: String!, $name: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $head, states: MERGED, first: 1) { totalCount }
  }
}`;

interface Page<T> {
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  readonly nodes: readonly T[];
}

// A partial result is never a completed inventory. Keep pagination progress
// independent of the GitHub client so both acceptance and failure can be tested.
export function paginate<T>(load: (after: string | null) => Page<T>): T[] {
  const out: T[] = [];
  const visitedCursors = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const page = load(after);
    if (!page || !Array.isArray(page.nodes) || !page.pageInfo ||
        typeof page.pageInfo.hasNextPage !== 'boolean') {
      throw new Error('invalid GraphQL pagination response');
    }
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return out;

    const cursor = page.pageInfo.endCursor;
    if (typeof cursor !== 'string' || cursor.length === 0 || visitedCursors.has(cursor)) {
      throw new Error('incomplete GraphQL pagination: missing or repeated endCursor');
    }
    visitedCursors.add(cursor);
    after = cursor;
  }
}

function graphqlPaged<T>(query: string, owner: string, name: string, select: (data: any) => Page<T>): T[] {
  return paginate((after) => {
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
    if (after !== null) args.push('-f', `after=${after}`);
    return select(ghJson<{ data: unknown }>(args).data);
  });
}

interface RawPr {
  number: number;
  title: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  updatedAt: string;
  mergeable: string;
  mergeStateStatus: string;
  statusCheckRollup: {
    state: string;
    contexts: { nodes: readonly RawContext[] };
  } | null;
}

interface RawRef {
  name: string;
  target?: { oid?: string } | null;
}

type RawContext =
  | { __typename: 'CheckRun'; name: string; conclusion: string | null; completedAt: string | null }
  | { __typename: 'StatusContext'; context: string; state: string; createdAt: string | null };

// Failing check names, one per name, using the most recent run of each name.
// Display only: the rollup state is the authoritative CI verdict.
export function failingCheckNames(contexts: readonly RawContext[]): string[] {
  const latest = new Map<string, { failing: boolean; at: string }>();
  for (const ctx of contexts) {
    if (ctx.__typename === 'CheckRun') {
      if (ctx.conclusion === null) continue;
      const at = ctx.completedAt ?? '';
      const prev = latest.get(ctx.name);
      if (!prev || at >= prev.at) latest.set(ctx.name, { failing: FAILING_CHECK_CONCLUSIONS.has(ctx.conclusion), at });
    } else {
      const at = ctx.createdAt ?? '';
      const prev = latest.get(ctx.context);
      if (!prev || at >= prev.at) latest.set(ctx.context, { failing: FAILING_STATUS_STATES.has(ctx.state), at });
    }
  }
  return [...latest].filter(([, v]) => v.failing).map(([k]) => k).sort();
}

// `gh api repos/o/n/compare/<default>...<branch>` -> ahead/behind commits relative to default.
// Any API comparison failure is unknown, never a green/stale conclusion.
function compareToDefault(
  owner: string,
  name: string,
  defaultBranch: string,
  branch: string,
): { ahead: number; behind: number } | null {
  try {
    const cmp = ghJson<{ ahead_by: number; behind_by: number }>([
      'api',
      `repos/${owner}/${name}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}`,
    ]);
    return { ahead: cmp.ahead_by, behind: cmp.behind_by };
  } catch (error) {
    if (error instanceof GhError) return null;
    throw error;
  }
}

function fetchTags(owner: string, name: string): string[] | null {
  try {
    return graphqlPaged<{ name: string }>(TAGS_QUERY, owner, name, (data) => data.repository.refs).map(
      (ref) => ref.name,
    );
  } catch (error) {
    if (error instanceof GhError) return null;
    throw error;
  }
}

function mergedPrCount(owner: string, name: string, branch: string): number | null {
  try {
    const data = ghJson<{ data: { repository: { pullRequests: { totalCount: number } } } }>([
      'api',
      'graphql',
      '-f',
      `query=${MERGED_COUNT_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-f',
      `head=${branch}`,
    ]);
    return data.data.repository.pullRequests.totalCount;
  } catch (error) {
    if (error instanceof GhError) return null;
    throw error;
  }
}

export function matchesReleasePr(pr: Pick<RawPr, 'headRefName' | 'baseRefName' | 'isCrossRepository'>, branch: string, defaultBranch: string): boolean {
  return !pr.isCrossRepository && pr.headRefName === branch && pr.baseRefName === defaultBranch;
}

export function collectRepo(repo: string, now: Date): RepoReport {
  if (!REPO_PATTERN.test(repo)) throw new Error(`invalid repo "${repo}", expected owner/name`);
  const [owner, name] = repo.split('/') as [string, string];

  const defaultBranch = defaultBranchInfo(owner, name);
  const main = defaultBranch.name;
  const rawPrs = graphqlPaged<RawPr>(REPO_QUERY, owner, name, (data) => data.repository.pullRequests);

  const compareCache = new Map<string, { ahead: number; behind: number } | null>();
  const compareCached = (branch: string): { ahead: number; behind: number } | null => {
    if (!compareCache.has(branch)) compareCache.set(branch, compareToDefault(owner, name, main, branch));
    return compareCache.get(branch) ?? null;
  };
  const aheadCached = (branch: string): number | null => compareCached(branch)?.ahead ?? null;

  const openPrs: PrRow[] = rawPrs.map((pr) => {
    const facts: PrFacts = {
      number: pr.number,
      title: pr.title.replace(/\s+/g, ' ').trim(),
      isDraft: pr.isDraft,
      base: pr.baseRefName,
      headRefName: pr.headRefName,
      headSha: pr.headRefOid,
      updatedAt: pr.updatedAt,
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      rollupState: pr.statusCheckRollup?.state ?? null,
      failingChecks: failingCheckNames(pr.statusCheckRollup?.contexts.nodes ?? []),
      baseIsDefault: pr.baseRefName === main,
      baseAheadOfDefault: pr.baseRefName === main ? 0 : aheadCached(pr.baseRefName),
    };
    return classifyPr(facts, now);
  });

  const releaseRefs = graphqlPaged<RawRef>(REFS_QUERY, owner, name, (data) => data.repository.refs)
    .filter((ref) => isReleaseBranch(ref.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tags = releaseRefs.length > 0 ? fetchTags(owner, name) : [];

  const releaseBranches: ReleaseRow[] = releaseRefs.map((ref) => {
    const branch = ref.name;
    const openReleasePr = rawPrs.find((pr) => matchesReleasePr(pr, branch, main));
    const cmp = compareCached(branch);
    const facts: ReleaseBranchFacts = {
      name: branch,
      branchHeadSha: ref.target?.oid ?? null,
      aheadOfDefault: cmp?.ahead ?? null,
      behindOfDefault: cmp?.behind ?? null,
      openReleasePr: openReleasePr
        ? { number: openReleasePr.number, isDraft: openReleasePr.isDraft, mergeStateStatus: openReleasePr.mergeStateStatus }
        : null,
      mergedPrCount: mergedPrCount(owner, name, branch),
      tagPublished: isReleaseTagPublished(branch, tags),
    };
    return classifyReleaseBranch(facts);
  });

  return {
    repo,
    defaultBranch: main,
    defaultBranchHeadSha: defaultBranch.headSha,
    openPrs,
    releaseBranches,
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

function formatDeltaNumber(value: number | 'unknown'): string {
  if (value === 'unknown') return 'unknown';
  return value > 0 ? `+${value}` : String(value);
}

export function renderText(report: Report): string {
  const out: string[] = [`Delivery status (read-only) generated ${report.generatedAt}`, ''];
  for (const repo of report.repos) {
    out.push(`## ${repo.repo}  (default branch: ${repo.defaultBranch})`, '');
    out.push(`Open PRs (${repo.openPrs.length})`);
    out.push(
      renderTable(
        ['#', 'DRAFT', 'BASE', 'HEAD', 'CI', 'MERGEABLE', 'STATE', 'AGE(d)', 'FLAGS', 'TITLE'],
        repo.openPrs.map((pr) => [
          String(pr.number),
          pr.draft ? 'yes' : 'no',
          pr.base,
          pr.headSha.slice(0, 7),
          pr.failingChecks.length > 0 ? `${pr.ci}(${truncate(pr.failingChecks.join(','), 30)})` : pr.ci,
          pr.mergeable,
          pr.mergeStateStatus,
          String(pr.ageDays),
          pr.flags.join(',') || '-',
          truncate(pr.title, 60),
        ]),
      ),
    );
    out.push('', `Release branches (${repo.releaseBranches.length})`);
    out.push(
      renderTable(
        ['BRANCH', 'AHEAD_OF_DEFAULT', 'BEHIND', 'OPEN_RELEASE_PR', 'MERGED_PRS', 'TAG', 'FLAGS'],
        repo.releaseBranches.map((b) => [
          b.name,
          b.aheadOfDefault === null ? 'unknown' : String(b.aheadOfDefault),
          b.behindOfDefault === null ? 'unknown' : String(b.behindOfDefault),
          b.openReleasePr ? `#${b.openReleasePr.number}${b.openReleasePr.isDraft ? ' (draft)' : ''} ${b.openReleasePr.mergeStateStatus}` : '-',
          b.mergedPrCount === null ? 'unknown' : String(b.mergedPrCount),
          b.tagPublished === null ? 'unknown' : b.tagPublished ? 'published' : 'unpublished',
          b.flags.join(',') || '-',
        ]),
      ),
    );
    out.push('');
  }
  if (report.delta) {
    out.push(
      `## Delta (previous: ${report.delta.previousCapturedAt ?? 'none'} -> current: ${report.delta.currentCapturedAt})`,
      '',
    );
    out.push(
      renderTable(
        ['REPO', 'BRANCH', 'STATUS', 'AHEAD_DELTA', 'BEHIND_DELTA', 'OPEN_PR_DELTA', 'CI_FAIL_DELTA', 'ADV_BEYOND_PR', 'ADDED_FLAGS', 'CLEARED_FLAGS'],
        report.delta.deltas.map((d) => [
          d.repo,
          d.branch,
          d.status,
          formatDeltaNumber(d.aheadDelta),
          formatDeltaNumber(d.behindDelta),
          formatDeltaNumber(d.openPrTotalDelta),
          formatDeltaNumber(d.ciFailDelta),
          d.representativePrUnchangedWhileBranchAdvanced ? 'yes' : 'no',
          d.addedFlags.join(',') || '-',
          d.clearedFlags.join(',') || '-',
        ]),
      ),
    );
    out.push('');
  }
  if (report.errors.length > 0) {
    out.push('Errors (these repositories were NOT evaluated):');
    for (const e of report.errors) out.push(`- ${e.repo}: ${e.message}`);
    out.push('');
  }
  out.push(
    'Flags: CI-FAIL (head checks failed) · CONFLICTING (merge conflict) · STALE-BASE (base fully contained in default branch)',
    '       BASE-UNKNOWN (base comparison failed) · NO-PR-BODY-CHECKS (no check rollup: CI state undetermined, not green)',
    '       UNRELEASED-COMMITS (release-*/release/* ahead of default with no open release PR) · MERGED-STALE-BASE (release branch fully contained in default branch, not deleted)',
    '       BRANCH-DIVERGED (release branch both ahead of and behind default branch) · TAG-UNPUBLISHED (matching release tag not found)',
    '       BRANCH-UNKNOWN (release branch comparison failed)',
    'Read-only: nothing was merged, commented on, labelled or changed. Merge authority is unchanged (github-delivery Skill).',
  );
  return out.join('\n');
}

interface Args {
  repos: string[];
  json: boolean;
  help: boolean;
  snapshotOut: string | null;
  prevSnapshot: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { repos: [], json: false, help: false, snapshotOut: null, prevSnapshot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--repo') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) throw new Error('--repo requires owner/name');
      args.repos.push(value);
    } else if (arg === '--snapshot-out') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) throw new Error('--snapshot-out requires a file path');
      args.snapshotOut = value;
    } else if (arg === '--prev-snapshot') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) throw new Error('--prev-snapshot requires a file path');
      args.prevSnapshot = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.repos.length === 0) args.repos = [...DEFAULT_REPOS];
  return args;
}

const USAGE = `Usage: node scripts/delivery-status/delivery-status.mts [--repo owner/name ...] [--json] [--snapshot-out path] [--prev-snapshot path]

  --repo owner/name      repository to inspect (repeatable; default: ${DEFAULT_REPOS.join(', ')})
  --json                 print the report as JSON instead of tables
  --snapshot-out path    write the evidence snapshot JSON to a local file
  --prev-snapshot path   compare current snapshot against a prior snapshot JSON
  -h, --help             show this help
`;

export function writeSnapshotFile(filePath: string, snapshot: DeliverySnapshot): void {
  const outPath = resolve(filePath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, redact(`${JSON.stringify(snapshot, null, 2)}\n`), 'utf8');
}

export function loadPreviousSnapshot(filePath: string): DeliverySnapshot {
  const raw = readFileSync(resolve(filePath), 'utf8');
  return parseSnapshotJson(raw);
}

export function main(argv: readonly string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let previousSnapshot: DeliverySnapshot | null = null;
  if (args.prevSnapshot) {
    try {
      previousSnapshot = loadPreviousSnapshot(args.prevSnapshot);
    } catch (error) {
      process.stderr.write(`invalid --prev-snapshot (${args.prevSnapshot}): ${redact((error as Error).message)}\n`);
      return 2;
    }
  }

  const now = new Date();
  const repos: RepoReport[] = [];
  const errors: { repo: string; message: string }[] = [];
  for (const repo of args.repos) {
    try {
      repos.push(collectRepo(repo, now));
    } catch (error) {
      errors.push({ repo, message: redact((error as Error).message) });
    }
  }

  const generatedAt = now.toISOString();
  const snapshot = buildSnapshot(generatedAt, repos, errors);
  const delta = previousSnapshot ? computeSnapshotDelta(previousSnapshot, snapshot) : undefined;
  if (args.snapshotOut) {
    writeSnapshotFile(args.snapshotOut, snapshot);
  }

  const report: Report = {
    generatedAt,
    repos,
    errors,
    ...(args.snapshotOut || args.prevSnapshot ? { snapshot } : {}),
    ...(delta ? { delta } : {}),
  };
  process.stdout.write(redact(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderText(report)}\n`));
  return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
