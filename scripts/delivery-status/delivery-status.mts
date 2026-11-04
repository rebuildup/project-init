#!/usr/bin/env node
// Read-only delivery-status report across repositories.
//
// Detects work stranded between Issue / PR / release branch and `main`:
// open PRs (CI, conflicts, stale base), release-* branches with unreleased
// commits, and merged release branches that were never deleted.
//
// Usage:
//   node scripts/delivery-status/delivery-status.mts [--repo owner/name ...] [--json]
//
// Read-only by construction: only `gh api` GraphQL queries and REST GETs are
// issued. Nothing is merged, commented on, labelled or otherwise mutated.
// Authentication is delegated to `gh`; this script never reads or prints tokens.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPr,
  classifyReleaseBranch,
  type PrFacts,
  type PrRow,
  type ReleaseRow,
  type ReleaseBranchFacts,
} from './classify.mts';

const DEFAULT_REPOS = [
  'rebuildup/pc-setup',
  'rebuildup/dotfiles',
  'rebuildup/project-init',
] as const;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RELEASE_BRANCH_PREFIX = 'release-';
const FAILING_CHECK_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILING_STATUS_STATES = new Set(['FAILURE', 'ERROR']);

interface RepoReport {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly openPrs: readonly PrRow[];
  readonly releaseBranches: readonly ReleaseRow[];
}

interface Report {
  readonly generatedAt: string;
  readonly repos: readonly RepoReport[];
  readonly errors: readonly { readonly repo: string; readonly message: string }[];
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
        number title isDraft baseRefName headRefName headRefOid updatedAt
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

function defaultBranchOf(owner: string, name: string): string {
  const data = ghJson<{ data: { repository: { defaultBranchRef: { name: string } | null } } }>([
    'api',
    'graphql',
    '-f',
    `query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } } }`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
  ]);
  const branch = data.data.repository.defaultBranchRef?.name;
  if (!branch) throw new Error(`${owner}/${name} has no default branch`);
  return branch;
}

const REFS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, after: $after, query: "${RELEASE_BRANCH_PREFIX}") {
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
  readonly pageInfo: { hasNextPage: boolean; endCursor: string | null };
  readonly nodes: readonly T[];
}

function graphqlPaged<T>(query: string, owner: string, name: string, select: (data: any) => Page<T>): T[] {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
    if (after !== null) args.push('-f', `after=${after}`);
    const page = select(ghJson<{ data: unknown }>(args).data);
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return out;
    after = page.pageInfo.endCursor;
  }
}

interface RawPr {
  number: number;
  title: string;
  isDraft: boolean;
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

// `gh api repos/o/n/compare/<default>...<branch>` -> commits `branch` has beyond default.
// Returns null only for a 404 (branch missing); any other failure is rethrown.
function aheadOfDefault(owner: string, name: string, defaultBranch: string, branch: string): number | null {
  try {
    const cmp = ghJson<{ ahead_by: number }>([
      'api',
      `repos/${owner}/${name}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}`,
    ]);
    return cmp.ahead_by;
  } catch (error) {
    if (error instanceof GhError && /HTTP 404/.test(error.stderr)) return null;
    throw error;
  }
}

function mergedPrCount(owner: string, name: string, branch: string): number {
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
}

export function collectRepo(repo: string, now: Date): RepoReport {
  if (!REPO_PATTERN.test(repo)) throw new Error(`invalid repo "${repo}", expected owner/name`);
  const [owner, name] = repo.split('/') as [string, string];

  const main = defaultBranchOf(owner, name);
  const rawPrs = graphqlPaged<RawPr>(REPO_QUERY, owner, name, (data) => data.repository.pullRequests);

  const compareCache = new Map<string, number | null>();
  const aheadCached = (branch: string): number | null => {
    if (!compareCache.has(branch)) compareCache.set(branch, aheadOfDefault(owner, name, main, branch));
    return compareCache.get(branch) ?? null;
  };

  const openPrs: PrRow[] = rawPrs.map((pr) => {
    const facts: PrFacts = {
      number: pr.number,
      title: pr.title.replace(/\s+/g, ' ').trim(),
      isDraft: pr.isDraft,
      base: pr.baseRefName,
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

  const branchNames = graphqlPaged<{ name: string }>(REFS_QUERY, owner, name, (data) => data.repository.refs).map(
    (ref) => ref.name,
  );
  const releaseBranches: ReleaseRow[] = branchNames
    .filter((branch) => branch.startsWith(RELEASE_BRANCH_PREFIX))
    .sort()
    .map((branch) => {
      const openReleasePr = rawPrs.find((pr) => pr.headRefName === branch && pr.baseRefName === main);
      const facts: ReleaseBranchFacts = {
        name: branch,
        aheadOfDefault: aheadCached(branch),
        openReleasePr: openReleasePr
          ? { number: openReleasePr.number, isDraft: openReleasePr.isDraft, mergeStateStatus: openReleasePr.mergeStateStatus }
          : null,
        mergedPrCount: mergedPrCount(owner, name, branch),
      };
      return classifyReleaseBranch(facts);
    });

  return { repo, defaultBranch: main, openPrs, releaseBranches };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
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
        ['BRANCH', 'AHEAD_OF_MAIN', 'OPEN_RELEASE_PR', 'MERGED_PRS', 'FLAGS'],
        repo.releaseBranches.map((b) => [
          b.name,
          b.aheadOfDefault === null ? 'unknown' : String(b.aheadOfDefault),
          b.openReleasePr ? `#${b.openReleasePr.number}${b.openReleasePr.isDraft ? ' (draft)' : ''} ${b.openReleasePr.mergeStateStatus}` : '-',
          String(b.mergedPrCount),
          b.flags.join(',') || '-',
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
    '       UNRELEASED-COMMITS (release-* ahead of default with no open release PR) · MERGED-STALE-BASE (release-* fully contained in default branch, not deleted)',
    '       BRANCH-UNKNOWN (release branch comparison failed)',
    'Read-only: nothing was merged, commented on, labelled or changed. Merge authority is unchanged (github-delivery Skill).',
  );
  return out.join('\n');
}

interface Args {
  repos: string[];
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { repos: [], json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--repo') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--repo requires owner/name');
      args.repos.push(value);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.repos.length === 0) args.repos = [...DEFAULT_REPOS];
  return args;
}

const USAGE = `Usage: node scripts/delivery-status/delivery-status.mts [--repo owner/name ...] [--json]

  --repo owner/name   repository to inspect (repeatable; default: ${DEFAULT_REPOS.join(', ')})
  --json              print the report as JSON instead of tables
  -h, --help          show this help
`;

function main(argv: readonly string[]): number {
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

  const report: Report = { generatedAt: now.toISOString(), repos, errors };
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderText(report)}\n`);
  return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
