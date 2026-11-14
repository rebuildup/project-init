// Pure classification for the delivery-status report (no I/O).
// The CLI in delivery-status.mts gathers raw GitHub facts and passes them here.
// Unknown inputs never become green: they map to UNKNOWN / *-UNKNOWN flags.

export const FLAGS = [
  'CI-FAIL',
  'CONFLICTING',
  'STALE-BASE',
  'BASE-UNKNOWN',
  'NO-PR-BODY-CHECKS',
  'UNRELEASED-COMMITS',
  'MERGED-STALE-BASE',
  'BRANCH-UNKNOWN',
] as const;

export type Flag = (typeof FLAGS)[number];
export type CiState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'UNKNOWN';

export interface PrFacts {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly base: string;
  readonly headSha: string;
  readonly updatedAt: string;
  /** GraphQL PullRequest.mergeable: MERGEABLE | CONFLICTING | UNKNOWN */
  readonly mergeable: string;
  /** GraphQL PullRequest.mergeStateStatus: CLEAN | DIRTY | BEHIND | BLOCKED | UNSTABLE | DRAFT | UNKNOWN | ... */
  readonly mergeStateStatus: string;
  /** GraphQL StatusCheckRollup.state for the head commit, or null when the commit has no checks. */
  readonly rollupState: string | null;
  /** Names of failing checks on the head commit (best effort, for display only). */
  readonly failingChecks: readonly string[];
  readonly baseIsDefault: boolean;
  /** Commits the base branch has that the default branch lacks; null when the comparison failed. */
  readonly baseAheadOfDefault: number | null;
}

export interface PrRow {
  readonly number: number;
  readonly title: string;
  readonly draft: boolean;
  readonly base: string;
  readonly headSha: string;
  readonly mergeable: string;
  readonly mergeStateStatus: string;
  readonly ci: CiState;
  readonly failingChecks: readonly string[];
  readonly ageDays: number;
  readonly flags: readonly Flag[];
}

export interface ReleasePrRef {
  readonly number: number;
  readonly isDraft: boolean;
  readonly mergeStateStatus: string;
}

export interface ReleaseBranchFacts {
  readonly name: string;
  /** Commits on the release branch that the default branch lacks; null when the comparison failed. */
  readonly aheadOfDefault: number | null;
  readonly openReleasePr: ReleasePrRef | null;
  /** Number of merged PRs whose head is this branch. */
  readonly mergedPrCount: number;
}

export interface ReleaseRow {
  readonly name: string;
  readonly aheadOfDefault: number | null;
  readonly openReleasePr: ReleasePrRef | null;
  readonly mergedPrCount: number;
  readonly flags: readonly Flag[];
}

export function ciFromRollup(state: string | null): CiState {
  switch (state) {
    case null:
      return 'UNKNOWN';
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'ERROR':
      return 'FAILURE';
    case 'PENDING':
    case 'EXPECTED':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

export function isConflicting(mergeable: string, mergeStateStatus: string): boolean {
  return mergeable === 'CONFLICTING' || mergeStateStatus === 'DIRTY';
}

export function ageDays(updatedAt: string, now: Date): number {
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(updated)) {
    throw new Error(`invalid updatedAt: ${updatedAt}`);
  }
  return Math.max(0, Math.floor((now.getTime() - updated) / 86_400_000));
}

export function classifyPr(facts: PrFacts, now: Date): PrRow {
  const ci = ciFromRollup(facts.rollupState);
  const flags: Flag[] = [];

  if (ci === 'FAILURE') flags.push('CI-FAIL');
  if (ci === 'UNKNOWN') flags.push('NO-PR-BODY-CHECKS');
  if (isConflicting(facts.mergeable, facts.mergeStateStatus)) flags.push('CONFLICTING');

  if (!facts.baseIsDefault) {
    if (facts.baseAheadOfDefault === null) {
      flags.push('BASE-UNKNOWN');
    } else if (facts.baseAheadOfDefault === 0) {
      // The base has nothing the default branch lacks: the PR is aimed at history
      // that is already integrated, so its base is stale.
      flags.push('STALE-BASE');
    }
  }

  return {
    number: facts.number,
    title: facts.title,
    draft: facts.isDraft,
    base: facts.base,
    headSha: facts.headSha,
    mergeable: facts.mergeable,
    mergeStateStatus: facts.mergeStateStatus,
    ci,
    failingChecks: facts.failingChecks,
    ageDays: ageDays(facts.updatedAt, now),
    flags,
  };
}

export function classifyReleaseBranch(facts: ReleaseBranchFacts): ReleaseRow {
  const flags: Flag[] = [];

  if (facts.aheadOfDefault === null) {
    flags.push('BRANCH-UNKNOWN');
  } else if (facts.aheadOfDefault === 0) {
    // Fully contained in the default branch: the release branch was not deleted
    // after its content reached main. Note that a freshly cut zero-diff branch
    // also satisfies this; mergedPrCount tells the two apart for the reader.
    flags.push('MERGED-STALE-BASE');
  } else if (facts.openReleasePr === null) {
    flags.push('UNRELEASED-COMMITS');
  }

  return {
    name: facts.name,
    aheadOfDefault: facts.aheadOfDefault,
    openReleasePr: facts.openReleasePr,
    mergedPrCount: facts.mergedPrCount,
    flags,
  };
}
