// Pure snapshot & consecutive delta model extending scripts/delivery-status (Issue #122).
// Never converts commit/PR counts into Work Units and never invents P50/P80/P95
// forecasts when joint estimation observations are missing.

import type { Flag, PrRow, ReleaseRow } from './classify.mts';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

export interface EstimationInputs {
  readonly completedWu: number | 'unknown';
  readonly remainingWu: number | 'unknown';
  readonly jointObservationsCount: number;
  readonly forecastStatus: 'unavailable' | 'available';
  readonly quantiles: {
    readonly p50: string | null;
    readonly p80: string | null;
    readonly p95: string | null;
  };
}

export interface ReleaseSnapshotEntry {
  readonly repo: string;
  readonly branch: string;
  readonly aheadOfDefault: number | null;
  readonly behindOfDefault: number | null;
  readonly openReleasePrNumber: number | null;
  readonly openReleasePrHeadSha: string | null;
  readonly openPrTotal: number;
  readonly openPrDraft: number;
  readonly openPrReady: number;
  readonly openPrCiFail: number;
  readonly openPrConflicting: number;
  readonly tagPublished: boolean | null;
  readonly flags: readonly Flag[];
  readonly evidenceConfidence: EvidenceConfidence;
}

export interface DeliverySnapshot {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly releases: readonly ReleaseSnapshotEntry[];
  readonly errors: readonly { readonly repo: string; readonly message: string }[];
  readonly estimationInputs: EstimationInputs;
}

export interface ReleaseDelta {
  readonly repo: string;
  readonly branch: string;
  readonly status: 'observed' | 'new-series' | 'removed-series' | 'unknown';
  readonly aheadDelta: number | 'unknown';
  readonly behindDelta: number | 'unknown';
  readonly openPrTotalDelta: number | 'unknown';
  readonly ciFailDelta: number | 'unknown';
  readonly representativePrUnchangedWhileBranchAdvanced: boolean;
  readonly addedFlags: readonly Flag[];
  readonly clearedFlags: readonly Flag[];
}

export interface SnapshotDeltaReport {
  readonly previousCapturedAt: string | null;
  readonly currentCapturedAt: string;
  readonly deltas: readonly ReleaseDelta[];
}

export interface SnapshotRepoInput {
  readonly repo: string;
  readonly openPrs: readonly PrRow[];
  readonly releaseBranches: readonly ReleaseRow[];
}

export function buildSnapshot(
  capturedAt: string,
  repos: readonly SnapshotRepoInput[],
  errors: readonly { readonly repo: string; readonly message: string }[] = [],
): DeliverySnapshot {
  const releases: ReleaseSnapshotEntry[] = [];
  for (const repo of repos) {
    const openPrDraft = repo.openPrs.filter((pr) => pr.draft).length;
    const openPrReady = repo.openPrs.length - openPrDraft;
    const openPrCiFail = repo.openPrs.filter((pr) => pr.ci === 'FAILURE').length;
    const openPrConflicting = repo.openPrs.filter((pr) => pr.flags.includes('CONFLICTING')).length;

    for (const branch of repo.releaseBranches) {
      const releasePr = branch.openReleasePr
        ? repo.openPrs.find((pr) => pr.number === branch.openReleasePr?.number) ?? null
        : null;
      const hasUnknowns =
        branch.aheadOfDefault === null ||
        branch.behindOfDefault === null ||
        branch.mergedPrCount === null ||
        branch.tagPublished === null;
      const evidenceConfidence: EvidenceConfidence =
        branch.aheadOfDefault === null
          ? 'low'
          : hasUnknowns
            ? 'medium'
            : 'high';

      releases.push({
        repo: repo.repo,
        branch: branch.name,
        aheadOfDefault: branch.aheadOfDefault,
        behindOfDefault: branch.behindOfDefault,
        openReleasePrNumber: branch.openReleasePr?.number ?? null,
        openReleasePrHeadSha: releasePr?.headSha ?? null,
        openPrTotal: repo.openPrs.length,
        openPrDraft,
        openPrReady,
        openPrCiFail,
        openPrConflicting,
        tagPublished: branch.tagPublished,
        flags: [...branch.flags],
        evidenceConfidence,
      });
    }
  }

  // GitHub snapshot alone never supplies calibrated WU / joint wait observations.
  return {
    schemaVersion: 1,
    capturedAt,
    releases,
    errors: [...errors],
    estimationInputs: {
      completedWu: 'unknown',
      remainingWu: 'unknown',
      jointObservationsCount: 0,
      forecastStatus: 'unavailable',
      quantiles: { p50: null, p80: null, p95: null },
    },
  };
}

function diffNumber(prev: number | null, curr: number | null): number | 'unknown' {
  if (prev === null || curr === null) return 'unknown';
  return curr - prev;
}

export function computeSnapshotDelta(
  previous: DeliverySnapshot | null,
  current: DeliverySnapshot,
): SnapshotDeltaReport {
  const prevByKey = new Map<string, ReleaseSnapshotEntry>();
  if (previous) {
    for (const entry of previous.releases) {
      prevByKey.set(`${entry.repo}#${entry.branch}`, entry);
    }
  }

  const seenKeys = new Set<string>();
  const deltas: ReleaseDelta[] = [];

  for (const curr of current.releases) {
    const key = `${curr.repo}#${curr.branch}`;
    seenKeys.add(key);
    const prev = prevByKey.get(key);

    if (!previous || !prev) {
      deltas.push({
        repo: curr.repo,
        branch: curr.branch,
        status: previous ? 'new-series' : 'unknown',
        aheadDelta: 'unknown',
        behindDelta: 'unknown',
        openPrTotalDelta: 'unknown',
        ciFailDelta: 'unknown',
        representativePrUnchangedWhileBranchAdvanced: false,
        addedFlags: [...curr.flags],
        clearedFlags: [],
      });
      continue;
    }

    const aheadDelta = diffNumber(prev.aheadOfDefault, curr.aheadOfDefault);
    const behindDelta = diffNumber(prev.behindOfDefault, curr.behindOfDefault);
    const prevFlags = new Set(prev.flags);
    const currFlags = new Set(curr.flags);
    const addedFlags = curr.flags.filter((f) => !prevFlags.has(f));
    const clearedFlags = prev.flags.filter((f) => !currFlags.has(f));

    const representativePrSame =
      prev.openReleasePrNumber !== null &&
      prev.openReleasePrNumber === curr.openReleasePrNumber &&
      prev.openReleasePrHeadSha !== null &&
      prev.openReleasePrHeadSha === curr.openReleasePrHeadSha;
    const branchAdvanced = typeof aheadDelta === 'number' && aheadDelta > 0;

    deltas.push({
      repo: curr.repo,
      branch: curr.branch,
      status: 'observed',
      aheadDelta,
      behindDelta,
      openPrTotalDelta: curr.openPrTotal - prev.openPrTotal,
      ciFailDelta: curr.openPrCiFail - prev.openPrCiFail,
      representativePrUnchangedWhileBranchAdvanced: representativePrSame && branchAdvanced,
      addedFlags,
      clearedFlags,
    });
  }

  if (previous) {
    for (const prev of previous.releases) {
      const key = `${prev.repo}#${prev.branch}`;
      if (seenKeys.has(key)) continue;
      deltas.push({
        repo: prev.repo,
        branch: prev.branch,
        status: 'removed-series',
        aheadDelta: 'unknown',
        behindDelta: 'unknown',
        openPrTotalDelta: 'unknown',
        ciFailDelta: 'unknown',
        representativePrUnchangedWhileBranchAdvanced: false,
        addedFlags: [],
        clearedFlags: [...prev.flags],
      });
    }
  }

  return {
    previousCapturedAt: previous?.capturedAt ?? null,
    currentCapturedAt: current.capturedAt,
    deltas,
  };
}
