// Pure snapshot & consecutive delta model extending scripts/delivery-status (Issue #122).
// Never converts commit/PR counts into Work Units and never invents P50/P80/P95
// forecasts when joint estimation observations do not meet agent-delivery-estimation thresholds.

import type { Flag, PrRow, ReleaseRow } from './classify.mts';

export type EvidenceConfidence = 'high' | 'medium' | 'low';
export type ForecastStatus = 'complete' | 'conditional' | 'unavailable';

export interface EstimationInputs {
  readonly completedWu: number | 'unknown';
  readonly remainingWu: number | 'unknown';
  readonly jointObservationsCount: number;
  readonly forecastStatus: ForecastStatus;
  readonly samplePolicyNote: string;
  readonly quantiles: {
    readonly p50: string | null;
    readonly p80: string | null;
    readonly p95: string | null;
  };
}

export interface TrackedPrHead {
  readonly number: number;
  readonly headSha: string;
}

export interface ReleaseSnapshotEntry {
  readonly repo: string;
  readonly branch: string;
  readonly branchHeadSha: string | null;
  readonly defaultBranchHeadSha: string | null;
  readonly aheadOfDefault: number | null;
  readonly behindOfDefault: number | null;
  readonly mergedPrCount: number | null;
  readonly openReleasePrNumber: number | null;
  readonly openReleasePrHeadSha: string | null;
  readonly trackedOpenPrHeads: readonly TrackedPrHead[];
  readonly openPrTotal: number;
  readonly openPrDraft: number;
  readonly openPrReady: number;
  readonly openPrCiFail: number;
  readonly openPrConflicting: number;
  readonly repoOpenPrTotal: number;
  readonly tagPublished: boolean | null;
  readonly flags: readonly Flag[];
  readonly evidenceConfidence: EvidenceConfidence;
  readonly estimationInputs: EstimationInputs;
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
  readonly mergedPrCountDelta: number | 'unknown';
  readonly branchHeadShaChanged: boolean | 'unknown';
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
  readonly defaultBranchHeadSha?: string | null;
  readonly openPrs: readonly PrRow[];
  readonly releaseBranches: readonly ReleaseRow[];
}

export function buildEstimationInputs(input?: {
  readonly completedWu?: number | 'unknown';
  readonly remainingWu?: number | 'unknown';
  readonly jointObservationsCount?: number;
  readonly hasMaterialUnknowns?: boolean;
  readonly quantiles?: {
    readonly p50?: string | null;
    readonly p80?: string | null;
    readonly p95?: string | null;
  };
}): EstimationInputs {
  const completedWu = input?.completedWu ?? 'unknown';
  const remainingWu = input?.remainingWu ?? 'unknown';
  const n = Math.max(0, Math.floor(input?.jointObservationsCount ?? 0));
  const wuKnown = typeof completedWu === 'number' && typeof remainingWu === 'number';

  if (!wuKnown || n < 5) {
    return {
      completedWu,
      remainingWu,
      jointObservationsCount: n,
      forecastStatus: 'unavailable',
      samplePolicyNote:
        `n=${n} (requires calibrated WU and n>=5 empirical, n>=10 P50/P80, n>=20 P95; quantiles suppressed)`,
      quantiles: { p50: null, p80: null, p95: null },
    };
  }

  if (n < 10) {
    return {
      completedWu,
      remainingWu,
      jointObservationsCount: n,
      forecastStatus: 'conditional',
      samplePolicyNote:
        `n=${n} sparse-measured (empirical distribution only; P50/P80/P95 require n>=10/n>=20)`,
      quantiles: { p50: null, p80: null, p95: null },
    };
  }

  const hasMaterialUnknowns = input?.hasMaterialUnknowns ?? false;
  if (n < 20) {
    return {
      completedWu,
      remainingWu,
      jointObservationsCount: n,
      forecastStatus: hasMaterialUnknowns ? 'conditional' : 'complete',
      samplePolicyNote:
        `n=${n} measured (P50/P80 available; P95 provisional/suppressed until n>=20)`,
      quantiles: {
        p50: input?.quantiles?.p50 ?? null,
        p80: input?.quantiles?.p80 ?? null,
        p95: null,
      },
    };
  }

  return {
    completedWu,
    remainingWu,
    jointObservationsCount: n,
    forecastStatus: hasMaterialUnknowns ? 'conditional' : 'complete',
    samplePolicyNote: `n=${n} distribution-capable (P50/P80/P95 eligible)`,
    quantiles: {
      p50: input?.quantiles?.p50 ?? null,
      p80: input?.quantiles?.p80 ?? null,
      p95: input?.quantiles?.p95 ?? null,
    },
  };
}

export function buildSnapshot(
  capturedAt: string,
  repos: readonly SnapshotRepoInput[],
  errors: readonly { readonly repo: string; readonly message: string }[] = [],
): DeliverySnapshot {
  const releases: ReleaseSnapshotEntry[] = [];
  for (const repo of repos) {
    for (const branch of repo.releaseBranches) {
      const releasePr = branch.openReleasePr
        ? repo.openPrs.find((pr) => pr.number === branch.openReleasePr?.number) ?? null
        : null;

      // Scope per-release PR metrics strictly to PRs targeting this release branch
      // (base === branch.name) or representing this release branch (headRefName === branch.name
      // or matching openReleasePr.number), so multi-release repos never cross-contaminate.
      const scopedPrs = repo.openPrs.filter(
        (pr) =>
          pr.base === branch.name ||
          pr.headRefName === branch.name ||
          (branch.openReleasePr !== null && pr.number === branch.openReleasePr.number),
      );
      const openPrDraft = scopedPrs.filter((pr) => pr.draft).length;
      const openPrReady = scopedPrs.length - openPrDraft;
      const openPrCiFail = scopedPrs.filter((pr) => pr.ci === 'FAILURE').length;
      const openPrConflicting = scopedPrs.filter((pr) => pr.flags.includes('CONFLICTING')).length;

      // Non-release open PRs targeting this release branch, tracked for head-SHA comparison.
      const trackedOpenPrHeads: TrackedPrHead[] = repo.openPrs
        .filter((pr) => pr.base === branch.name)
        .map((pr) => ({ number: pr.number, headSha: pr.headSha }))
        .sort((a, b) => a.number - b.number);

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
        branchHeadSha: branch.branchHeadSha,
        defaultBranchHeadSha: repo.defaultBranchHeadSha ?? null,
        aheadOfDefault: branch.aheadOfDefault,
        behindOfDefault: branch.behindOfDefault,
        mergedPrCount: branch.mergedPrCount,
        openReleasePrNumber: branch.openReleasePr?.number ?? null,
        openReleasePrHeadSha: releasePr?.headSha ?? null,
        trackedOpenPrHeads,
        openPrTotal: scopedPrs.length,
        openPrDraft,
        openPrReady,
        openPrCiFail,
        openPrConflicting,
        repoOpenPrTotal: repo.openPrs.length,
        tagPublished: branch.tagPublished,
        flags: [...branch.flags],
        evidenceConfidence,
        estimationInputs: buildEstimationInputs(),
      });
    }
  }

  // GitHub snapshot alone never supplies calibrated WU / joint wait observations.
  return {
    schemaVersion: 1,
    capturedAt,
    releases,
    errors: [...errors],
    estimationInputs: buildEstimationInputs(),
  };
}

export function parseSnapshotJson(raw: string): DeliverySnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('snapshot must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion: ${String(obj.schemaVersion)} (expected 1)`);
  }
  if (typeof obj.capturedAt !== 'string' || obj.capturedAt.length === 0) {
    throw new Error('snapshot capturedAt must be a non-empty string');
  }
  if (!Array.isArray(obj.releases)) {
    throw new Error('snapshot releases must be an array');
  }
  for (let i = 0; i < obj.releases.length; i++) {
    const entry = obj.releases[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`snapshot releases[${i}] must be an object`);
    }
    const r = entry as Record<string, unknown>;
    if (typeof r.repo !== 'string' || typeof r.branch !== 'string' || !Array.isArray(r.flags)) {
      throw new Error(`snapshot releases[${i}] missing required repo/branch/flags fields`);
    }
  }
  if (!Array.isArray(obj.errors)) {
    throw new Error('snapshot errors must be an array');
  }
  for (let i = 0; i < obj.errors.length; i++) {
    const entry = obj.errors[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`snapshot errors[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.repo !== 'string' || typeof e.message !== 'string') {
      throw new Error(`snapshot errors[${i}] missing required repo/message fields`);
    }
  }
  return parsed as DeliverySnapshot;
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
  const prevErrorRepos = new Set<string>();
  if (previous) {
    for (const entry of previous.releases) {
      prevByKey.set(`${entry.repo}#${entry.branch}`, entry);
    }
    for (const err of previous.errors) {
      prevErrorRepos.add(err.repo);
    }
  }
  const currentErrorRepos = new Set<string>(current.errors.map((e) => e.repo));

  const seenKeys = new Set<string>();
  const deltas: ReleaseDelta[] = [];

  for (const curr of current.releases) {
    const key = `${curr.repo}#${curr.branch}`;
    seenKeys.add(key);
    const prev = prevByKey.get(key);

    if (!previous || !prev) {
      const priorUnavailable = !previous || prevErrorRepos.has(curr.repo);
      deltas.push({
        repo: curr.repo,
        branch: curr.branch,
        status: priorUnavailable ? 'unknown' : 'new-series',
        aheadDelta: 'unknown',
        behindDelta: 'unknown',
        openPrTotalDelta: 'unknown',
        ciFailDelta: 'unknown',
        mergedPrCountDelta: 'unknown',
        branchHeadShaChanged: 'unknown',
        representativePrUnchangedWhileBranchAdvanced: false,
        // Never treat baseline flags on first snapshot (or after a prior repo error) as newly added.
        addedFlags: priorUnavailable ? [] : [...curr.flags],
        clearedFlags: [],
      });
      continue;
    }

    const aheadDelta = diffNumber(prev.aheadOfDefault, curr.aheadOfDefault);
    const behindDelta = diffNumber(prev.behindOfDefault, curr.behindOfDefault);
    const mergedPrCountDelta = diffNumber(prev.mergedPrCount ?? null, curr.mergedPrCount ?? null);
    const branchHeadShaChanged: boolean | 'unknown' =
      prev.branchHeadSha !== null &&
      prev.branchHeadSha !== undefined &&
      curr.branchHeadSha !== null &&
      curr.branchHeadSha !== undefined
        ? prev.branchHeadSha !== curr.branchHeadSha
        : 'unknown';

    const prevFlags = new Set(prev.flags);
    const currFlags = new Set(curr.flags);
    const addedFlags = curr.flags.filter((f) => !prevFlags.has(f));
    const clearedFlags = prev.flags.filter((f) => !currFlags.has(f));

    const branchAdvanced =
      (typeof aheadDelta === 'number' && aheadDelta > 0) ||
      (branchHeadShaChanged === true && aheadDelta === 'unknown');

    // Realistic GitHub branch advancement beyond a single representative PR:
    // On GitHub, an open release PR's headRefOid automatically tracks the release branch,
    // so relying on unchanged openReleasePrHeadSha while aheadDelta > 0 cannot happen.
    // Instead, detect progress hidden from single-PR tracking when the branch advanced AND:
    //   1. No open release PR exists for this release branch; OR
    //   2. A tracked non-release PR targeting this release branch kept an unchanged head SHA
    //      while other commits/PRs landed on the release branch; OR
    //   3. Multiple commits or merged PRs landed (aheadDelta > 1 or mergedPrCountDelta > 0).
    const prevTracked = new Map((prev.trackedOpenPrHeads ?? []).map((p) => [p.number, p.headSha]));
    const hasUnchangedTrackedPr = (curr.trackedOpenPrHeads ?? []).some((p) => {
      const priorSha = prevTracked.get(p.number);
      return priorSha !== undefined && priorSha === p.headSha;
    });
    const noOpenReleasePr = curr.openReleasePrNumber === null;
    const multipleChangesLanded =
      (typeof mergedPrCountDelta === 'number' && mergedPrCountDelta > 0) ||
      (typeof aheadDelta === 'number' && aheadDelta > 1);

    deltas.push({
      repo: curr.repo,
      branch: curr.branch,
      status: 'observed',
      aheadDelta,
      behindDelta,
      openPrTotalDelta: curr.openPrTotal - prev.openPrTotal,
      ciFailDelta: curr.openPrCiFail - prev.openPrCiFail,
      mergedPrCountDelta,
      branchHeadShaChanged,
      representativePrUnchangedWhileBranchAdvanced:
        branchAdvanced && (noOpenReleasePr || hasUnchangedTrackedPr || multipleChangesLanded),
      addedFlags,
      clearedFlags,
    });
  }

  if (previous) {
    for (const prev of previous.releases) {
      const key = `${prev.repo}#${prev.branch}`;
      if (seenKeys.has(key)) continue;
      // Fail closed: if current run failed to inspect this repo (network/404/auth error),
      // emit status 'unknown' with no cleared flags — NEVER misclassify as 'removed-series'.
      if (currentErrorRepos.has(prev.repo)) {
        deltas.push({
          repo: prev.repo,
          branch: prev.branch,
          status: 'unknown',
          aheadDelta: 'unknown',
          behindDelta: 'unknown',
          openPrTotalDelta: 'unknown',
          ciFailDelta: 'unknown',
          mergedPrCountDelta: 'unknown',
          branchHeadShaChanged: 'unknown',
          representativePrUnchangedWhileBranchAdvanced: false,
          addedFlags: [],
          clearedFlags: [],
        });
        continue;
      }
      deltas.push({
        repo: prev.repo,
        branch: prev.branch,
        status: 'removed-series',
        aheadDelta: 'unknown',
        behindDelta: 'unknown',
        openPrTotalDelta: 'unknown',
        ciFailDelta: 'unknown',
        mergedPrCountDelta: 'unknown',
        branchHeadShaChanged: 'unknown',
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
