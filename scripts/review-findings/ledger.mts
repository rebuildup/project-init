// Durable review-finding ledger for resilient GitHub posting, deduplication,
// exact-head resolution, and recurrence tracking (Issue #123).

export type Severity = "P0" | "P1" | "P2" | "P3";
export type PostingState = "pending" | "posted" | "not-posted";
export type FailureReason =
  | "permission"
  | "rate-limit"
  | "validation"
  | "own-pr-request-changes"
  | "network";
export type RecurrenceClass = "one-off" | "recurring" | "systemic";
export type VerificationStatus = "open" | "resolved" | "recurred";
export type ActionClass =
  | "objective-finding"
  | "scope-change-requires-owner-approval";

export interface ResolutionEvidence {
  readonly sha: string;
  readonly verificationCommand: string;
  readonly verifiedAt: string;
}

export interface ReviewFinding {
  readonly findingId: string;
  readonly repository: string;
  readonly file: string;
  readonly line: number;
  readonly sourceSha: string;
  readonly severity: Severity;
  readonly category: string;
  readonly evidence: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly issueOrReviewUrl: string | null;
  readonly postingState: PostingState;
  readonly failureReason: FailureReason | null;
  readonly recurrenceClass: RecurrenceClass;
  readonly verificationStatus: VerificationStatus;
  readonly actionClass: ActionClass;
  readonly resolvedEvidence: ResolutionEvidence | null;
  readonly observationCount: number;
}

export interface NewFindingInput {
  readonly findingId: string;
  readonly repository: string;
  readonly file: string;
  readonly line: number;
  readonly sourceSha: string;
  readonly severity: Severity;
  readonly category: string;
  readonly evidence: string;
  readonly observedAt: string;
  readonly actionClass?: ActionClass;
  readonly systemic?: boolean;
}

export interface ExistingGitHubRecord {
  readonly repository: string;
  readonly url: string;
  readonly findingId?: string;
  readonly file?: string;
  readonly category?: string;
  readonly state: "OPEN" | "CLOSED";
}

export type RetryDecision =
  | { readonly action: "post"; readonly findingId: string }
  | { readonly action: "link-existing"; readonly findingId: string; readonly url: string }
  | { readonly action: "hold-owner-approval"; readonly findingId: string }
  | { readonly action: "skip-already-posted"; readonly findingId: string };

export interface FindingLedger {
  readonly schemaVersion: 1;
  readonly findings: readonly ReviewFinding[];
}

export function createLedger(): FindingLedger {
  return { schemaVersion: 1, findings: [] };
}

export function recordFinding(
  ledger: FindingLedger,
  input: NewFindingInput,
): FindingLedger {
  const existingIndex = ledger.findings.findIndex(
    (f) => f.findingId === input.findingId && f.repository === input.repository,
  );
  if (existingIndex === -1) {
    const created: ReviewFinding = {
      findingId: input.findingId,
      repository: input.repository,
      file: input.file,
      line: input.line,
      sourceSha: input.sourceSha,
      severity: input.severity,
      category: input.category,
      evidence: input.evidence,
      firstObservedAt: input.observedAt,
      lastObservedAt: input.observedAt,
      issueOrReviewUrl: null,
      postingState: "pending",
      failureReason: null,
      recurrenceClass: input.systemic ? "systemic" : "one-off",
      verificationStatus: "open",
      actionClass: input.actionClass ?? "objective-finding",
      resolvedEvidence: null,
      observationCount: 1,
    };
    return { schemaVersion: 1, findings: [...ledger.findings, created] };
  }

  const prev = ledger.findings[existingIndex]!;
  const wasResolved = prev.verificationStatus === "resolved";
  const nextRecurrence: RecurrenceClass =
    input.systemic || prev.recurrenceClass === "systemic"
      ? "systemic"
      : wasResolved || prev.observationCount >= 1
        ? "recurring"
        : "one-off";

  const updated: ReviewFinding = {
    ...prev,
    file: input.file,
    line: input.line,
    sourceSha: input.sourceSha,
    severity: input.severity,
    evidence: input.evidence,
    lastObservedAt: input.observedAt,
    recurrenceClass: nextRecurrence,
    verificationStatus: wasResolved ? "recurred" : prev.verificationStatus,
    resolvedEvidence: wasResolved ? null : prev.resolvedEvidence,
    // Re-open posting queue if a previously resolved defect recurred on a new SHA.
    postingState: wasResolved ? "pending" : prev.postingState,
    failureReason: wasResolved ? null : prev.failureReason,
    observationCount: prev.observationCount + 1,
  };

  const next = ledger.findings.slice();
  next[existingIndex] = updated;
  return { schemaVersion: 1, findings: next };
}

export function recordPostFailure(
  ledger: FindingLedger,
  findingId: string,
  reason: FailureReason,
): FindingLedger {
  return {
    schemaVersion: 1,
    findings: ledger.findings.map((f) =>
      f.findingId === findingId
        ? { ...f, postingState: "not-posted", failureReason: reason }
        : f,
    ),
  };
}

export function markPosted(
  ledger: FindingLedger,
  findingId: string,
  url: string,
): FindingLedger {
  if (!url.trim()) throw new Error("posted finding requires non-empty issueOrReviewUrl");
  return {
    schemaVersion: 1,
    findings: ledger.findings.map((f) =>
      f.findingId === findingId
        ? { ...f, postingState: "posted", failureReason: null, issueOrReviewUrl: url }
        : f,
    ),
  };
}

export function resolveFinding(
  ledger: FindingLedger,
  findingId: string,
  evidence: ResolutionEvidence,
): FindingLedger {
  if (!/^[0-9a-f]{40}$/i.test(evidence.sha)) {
    throw new Error(`resolution requires full 40-char exact head SHA, got: ${evidence.sha}`);
  }
  if (!evidence.verificationCommand.trim()) {
    throw new Error("resolution requires verificationCommand evidence");
  }
  return {
    schemaVersion: 1,
    findings: ledger.findings.map((f) =>
      f.findingId === findingId
        ? { ...f, verificationStatus: "resolved", resolvedEvidence: evidence }
        : f,
    ),
  };
}

function matchesExisting(
  finding: ReviewFinding,
  record: ExistingGitHubRecord,
): boolean {
  if (record.state !== "OPEN" || record.repository !== finding.repository) return false;
  if (record.findingId && record.findingId === finding.findingId) return true;
  if (record.file && record.category) {
    return record.file === finding.file && record.category === finding.category;
  }
  return false;
}

export function planRetry(
  ledger: FindingLedger,
  existingGitHub: readonly ExistingGitHubRecord[],
): { ledger: FindingLedger; decisions: readonly RetryDecision[] } {
  const decisions: RetryDecision[] = [];
  const nextFindings: ReviewFinding[] = [];

  for (const finding of ledger.findings) {
    if (finding.verificationStatus === "resolved") {
      nextFindings.push(finding);
      continue;
    }
    if (finding.actionClass === "scope-change-requires-owner-approval") {
      decisions.push({ action: "hold-owner-approval", findingId: finding.findingId });
      nextFindings.push(finding);
      continue;
    }
    if (finding.postingState === "posted" && finding.issueOrReviewUrl) {
      decisions.push({ action: "skip-already-posted", findingId: finding.findingId });
      nextFindings.push(finding);
      continue;
    }

    const match = existingGitHub.find((r) => matchesExisting(finding, r));
    if (match) {
      decisions.push({
        action: "link-existing",
        findingId: finding.findingId,
        url: match.url,
      });
      nextFindings.push({
        ...finding,
        postingState: "posted",
        failureReason: null,
        issueOrReviewUrl: match.url,
      });
      continue;
    }

    decisions.push({ action: "post", findingId: finding.findingId });
    nextFindings.push(finding);
  }

  return { ledger: { schemaVersion: 1, findings: nextFindings }, decisions };
}
