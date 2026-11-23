// Durable review-finding ledger for resilient GitHub posting, deduplication,
// exact-head resolution, recurrence tracking, and atomic file persistence (Issue #123).

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
export type ResolutionKind = "fix" | "false-positive" | "waived";

const SEVERITIES = new Set<string>(["P0", "P1", "P2", "P3"]);
const POSTING_STATES = new Set<string>(["pending", "posted", "not-posted"]);
const FAILURE_REASONS = new Set<string>([
  "permission",
  "rate-limit",
  "validation",
  "own-pr-request-changes",
  "network",
]);
const RECURRENCE_CLASSES = new Set<string>(["one-off", "recurring", "systemic"]);
const VERIFICATION_STATUSES = new Set<string>(["open", "resolved", "recurred"]);
const ACTION_CLASSES = new Set<string>([
  "objective-finding",
  "scope-change-requires-owner-approval",
]);
const RESOLUTION_KINDS = new Set<string>(["fix", "false-positive", "waived"]);

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const LINE_MATCH_TOLERANCE = 5;

export interface FindingKey {
  readonly repository: string;
  readonly findingId: string;
}

export interface ResolutionEvidence {
  readonly sha: string;
  readonly verificationCommand: string;
  readonly verifiedAt: string;
  readonly resolutionKind?: ResolutionKind;
}

export interface OwnerApprovalEvidence {
  readonly approvedBy: string;
  readonly approvalEvidenceUrl: string;
  readonly approvedAt: string;
}

export interface ReviewFinding {
  readonly findingId: string;
  readonly repository: string;
  readonly file: string;
  readonly line: number;
  readonly symbol: string | null;
  readonly fingerprint: string | null;
  readonly sourceSha: string;
  readonly severity: Severity;
  readonly category: string;
  readonly evidence: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly issueOrReviewUrl: string | null;
  readonly priorIssueUrls: readonly string[];
  readonly postingState: PostingState;
  readonly failureReason: FailureReason | null;
  readonly recurrenceClass: RecurrenceClass;
  readonly verificationStatus: VerificationStatus;
  readonly actionClass: ActionClass;
  readonly ownerApproval: OwnerApprovalEvidence | null;
  readonly resolvedEvidence: ResolutionEvidence | null;
  readonly observationCount: number;
}

export interface NewFindingInput {
  readonly findingId: string;
  readonly repository: string;
  readonly file: string;
  readonly line: number;
  readonly symbol?: string;
  readonly fingerprint?: string;
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
  readonly line?: number;
  readonly symbol?: string;
  readonly fingerprint?: string;
  readonly state: "OPEN" | "CLOSED";
}

export type RetryDecision =
  | { readonly action: "post"; readonly repository: string; readonly findingId: string }
  | {
      readonly action: "post-comment-fallback";
      readonly repository: string;
      readonly findingId: string;
      readonly reason: "own-pr-request-changes";
    }
  | {
      readonly action: "link-existing";
      readonly repository: string;
      readonly findingId: string;
      readonly url: string;
    }
  | {
      readonly action: "comment-recurrence";
      readonly repository: string;
      readonly findingId: string;
      readonly url: string;
    }
  | {
      readonly action: "hold-owner-approval";
      readonly repository: string;
      readonly findingId: string;
    }
  | {
      readonly action: "skip-already-posted";
      readonly repository: string;
      readonly findingId: string;
    };

export interface FindingLedger {
  readonly schemaVersion: 1;
  readonly findings: readonly ReviewFinding[];
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*(?:token|Basic)\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1[REDACTED]");
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function assertRepository(value: unknown, field = "repository"): string {
  const repo = assertNonEmpty(value, field);
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`${field} must match owner/name, got: ${repo}`);
  }
  return repo;
}

function assertExactSha(value: unknown, field: string): string {
  if (typeof value !== "string" || !EXACT_SHA_PATTERN.test(value)) {
    throw new Error(`${field} requires full 40-char exact head SHA, got: ${String(value)}`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer, got: ${String(value)}`);
  }
  return value;
}

function assertIsoTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${field} must be a valid ISO-8601 timestamp, got: ${String(value)}`);
  }
  return value;
}

function assertUrl(value: unknown, field: string): string {
  const url = assertNonEmpty(value, field);
  if (!URL_PATTERN.test(url)) {
    throw new Error(`${field} must be an http(s) URL, got: ${url}`);
  }
  return url;
}

function findIndexOrThrow(ledger: FindingLedger, key: FindingKey): number {
  const repository = assertRepository(key.repository);
  const findingId = assertNonEmpty(key.findingId, "findingId");
  const idx = ledger.findings.findIndex(
    (f) => f.repository === repository && f.findingId === findingId,
  );
  if (idx === -1) {
    throw new Error(`finding not found in ledger: ${repository}#${findingId}`);
  }
  return idx;
}

export function createLedger(): FindingLedger {
  return { schemaVersion: 1, findings: [] };
}

export function recordFinding(
  ledger: FindingLedger,
  input: NewFindingInput,
): FindingLedger {
  const findingId = assertNonEmpty(input.findingId, "findingId");
  const repository = assertRepository(input.repository);
  const file = assertNonEmpty(input.file, "file");
  const line = assertPositiveInteger(input.line, "line");
  const sourceSha = assertExactSha(input.sourceSha, "sourceSha");
  if (!SEVERITIES.has(input.severity)) {
    throw new Error(`invalid severity: ${String(input.severity)}`);
  }
  const category = assertNonEmpty(input.category, "category");
  const evidence = redactSecrets(assertNonEmpty(input.evidence, "evidence"));
  const observedAt = assertIsoTimestamp(input.observedAt, "observedAt");
  const actionClass = input.actionClass ?? "objective-finding";
  if (!ACTION_CLASSES.has(actionClass)) {
    throw new Error(`invalid actionClass: ${String(actionClass)}`);
  }
  const symbol = input.symbol?.trim() ? input.symbol.trim() : null;
  const fingerprint = input.fingerprint?.trim() ? input.fingerprint.trim() : null;

  const existingIndex = ledger.findings.findIndex(
    (f) => f.findingId === findingId && f.repository === repository,
  );
  if (existingIndex === -1) {
    const created: ReviewFinding = {
      findingId,
      repository,
      file,
      line,
      symbol,
      fingerprint,
      sourceSha,
      severity: input.severity,
      category,
      evidence,
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
      issueOrReviewUrl: null,
      priorIssueUrls: [],
      postingState: "pending",
      failureReason: null,
      recurrenceClass: input.systemic ? "systemic" : "one-off",
      verificationStatus: "open",
      actionClass,
      ownerApproval: null,
      resolvedEvidence: null,
      observationCount: 1,
    };
    return { schemaVersion: 1, findings: [...ledger.findings, created] };
  }

  const prev = ledger.findings[existingIndex]!;
  const wasResolved = prev.verificationStatus === "resolved";
  // Re-observing a still-open finding MUST keep verificationStatus "open" and
  // recurrenceClass "one-off" (unless systemic or already recurring/systemic).
  // Only re-observing a previously resolved finding transitions to recurred/recurring.
  const nextRecurrence: RecurrenceClass =
    input.systemic || prev.recurrenceClass === "systemic"
      ? "systemic"
      : wasResolved
        ? "recurring"
        : prev.recurrenceClass;

  const updated: ReviewFinding = {
    ...prev,
    file,
    line,
    symbol: symbol ?? prev.symbol,
    fingerprint: fingerprint ?? prev.fingerprint,
    sourceSha,
    severity: input.severity,
    category,
    evidence,
    lastObservedAt: observedAt,
    recurrenceClass: nextRecurrence,
    verificationStatus: wasResolved ? "recurred" : prev.verificationStatus,
    resolvedEvidence: wasResolved ? null : prev.resolvedEvidence,
    // Re-open posting queue if a previously resolved defect recurred.
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
  key: FindingKey,
  reason: FailureReason,
): FindingLedger {
  if (!FAILURE_REASONS.has(reason)) {
    throw new Error(`invalid failureReason: ${String(reason)}`);
  }
  const idx = findIndexOrThrow(ledger, key);
  const next = ledger.findings.slice();
  next[idx] = {
    ...next[idx]!,
    postingState: "not-posted",
    failureReason: reason,
  };
  return { schemaVersion: 1, findings: next };
}

export function markPosted(
  ledger: FindingLedger,
  key: FindingKey,
  url: string,
): FindingLedger {
  const canonicalUrl = assertUrl(url, "issueOrReviewUrl");
  const idx = findIndexOrThrow(ledger, key);
  const prev = ledger.findings[idx]!;
  const priorIssueUrls =
    prev.issueOrReviewUrl &&
    prev.issueOrReviewUrl !== canonicalUrl &&
    !prev.priorIssueUrls.includes(prev.issueOrReviewUrl)
      ? [...prev.priorIssueUrls, prev.issueOrReviewUrl]
      : [...prev.priorIssueUrls];

  const next = ledger.findings.slice();
  next[idx] = {
    ...prev,
    postingState: "posted",
    failureReason: null,
    issueOrReviewUrl: canonicalUrl,
    priorIssueUrls,
  };
  return { schemaVersion: 1, findings: next };
}

export function resolveFinding(
  ledger: FindingLedger,
  key: FindingKey,
  evidence: ResolutionEvidence,
): FindingLedger {
  const sha = assertExactSha(evidence.sha, "resolution.sha");
  const verificationCommand = redactSecrets(
    assertNonEmpty(evidence.verificationCommand, "resolution.verificationCommand"),
  );
  const verifiedAt = assertIsoTimestamp(evidence.verifiedAt, "resolution.verifiedAt");
  const resolutionKind: ResolutionKind = evidence.resolutionKind ?? "fix";
  if (!RESOLUTION_KINDS.has(resolutionKind)) {
    throw new Error(`invalid resolutionKind: ${String(resolutionKind)}`);
  }

  const idx = findIndexOrThrow(ledger, key);
  const prev = ledger.findings[idx]!;
  if (
    sha.toLowerCase() === prev.sourceSha.toLowerCase() &&
    resolutionKind !== "false-positive" &&
    resolutionKind !== "waived"
  ) {
    throw new Error(
      `cannot resolve finding on the same sourceSha (${sha}) without resolutionKind "false-positive" or "waived"`,
    );
  }

  const next = ledger.findings.slice();
  next[idx] = {
    ...prev,
    verificationStatus: "resolved",
    resolvedEvidence: {
      sha,
      verificationCommand,
      verifiedAt,
      resolutionKind,
    },
  };
  return { schemaVersion: 1, findings: next };
}

export function approveScopeChange(
  ledger: FindingLedger,
  key: FindingKey,
  approval: OwnerApprovalEvidence,
): FindingLedger {
  const approvedBy = assertNonEmpty(approval.approvedBy, "approval.approvedBy");
  const approvalEvidenceUrl = assertUrl(
    approval.approvalEvidenceUrl,
    "approval.approvalEvidenceUrl",
  );
  const approvedAt = assertIsoTimestamp(approval.approvedAt, "approval.approvedAt");

  const idx = findIndexOrThrow(ledger, key);
  const prev = ledger.findings[idx]!;
  if (prev.actionClass !== "scope-change-requires-owner-approval") {
    throw new Error(
      `finding ${prev.repository}#${prev.findingId} does not require scope-change owner approval`,
    );
  }

  const next = ledger.findings.slice();
  next[idx] = {
    ...prev,
    ownerApproval: { approvedBy, approvalEvidenceUrl, approvedAt },
  };
  return { schemaVersion: 1, findings: next };
}

export function matchesExisting(
  finding: ReviewFinding,
  record: ExistingGitHubRecord,
): boolean {
  if (record.state !== "OPEN" || record.repository !== finding.repository) return false;
  // If record carries a findingId, it is authoritative: NEVER fall through on mismatch.
  if (record.findingId !== undefined && record.findingId.trim().length > 0) {
    return record.findingId === finding.findingId;
  }
  // Without findingId, file + category alone is NOT sufficient (would suppress distinct bugs).
  // Require matching file + category AND a fine-grained locator (fingerprint, symbol, or line within tolerance).
  if (!record.file || !record.category) return false;
  if (record.file !== finding.file || record.category !== finding.category) return false;

  if (record.fingerprint && finding.fingerprint) {
    return record.fingerprint === finding.fingerprint;
  }
  if (record.symbol && finding.symbol) {
    return record.symbol === finding.symbol;
  }
  if (typeof record.line === "number" && Number.isInteger(record.line) && record.line > 0) {
    return Math.abs(record.line - finding.line) <= LINE_MATCH_TOLERANCE;
  }
  return false;
}

export function parseExistingRecordsJson(raw: string): readonly ExistingGitHubRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid existing records JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("existing records must be a JSON array");
  }
  const records: ExistingGitHubRecord[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`existing[${i}] must be an object`);
    }
    const r = entry as Record<string, unknown>;
    const repository = assertRepository(r.repository, `existing[${i}].repository`);
    const url = assertUrl(r.url, `existing[${i}].url`);
    if (r.state !== "OPEN" && r.state !== "CLOSED") {
      throw new Error(`existing[${i}].state must be OPEN or CLOSED`);
    }
    if (r.findingId !== undefined && typeof r.findingId !== "string") {
      throw new Error(`existing[${i}].findingId must be a string`);
    }
    if (r.file !== undefined && typeof r.file !== "string") {
      throw new Error(`existing[${i}].file must be a string`);
    }
    if (r.category !== undefined && typeof r.category !== "string") {
      throw new Error(`existing[${i}].category must be a string`);
    }
    if (r.symbol !== undefined && typeof r.symbol !== "string") {
      throw new Error(`existing[${i}].symbol must be a string`);
    }
    if (r.fingerprint !== undefined && typeof r.fingerprint !== "string") {
      throw new Error(`existing[${i}].fingerprint must be a string`);
    }
    let line: number | undefined;
    if (r.line !== undefined) {
      line = assertPositiveInteger(r.line, `existing[${i}].line`);
    }
    records.push({
      repository,
      url,
      state: r.state,
      ...(r.findingId !== undefined ? { findingId: r.findingId } : {}),
      ...(r.file !== undefined ? { file: r.file } : {}),
      ...(r.category !== undefined ? { category: r.category } : {}),
      ...(r.symbol !== undefined ? { symbol: r.symbol } : {}),
      ...(r.fingerprint !== undefined ? { fingerprint: r.fingerprint } : {}),
      ...(line !== undefined ? { line } : {}),
    });
  }
  return records;
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
    if (
      finding.actionClass === "scope-change-requires-owner-approval" &&
      finding.ownerApproval === null
    ) {
      decisions.push({
        action: "hold-owner-approval",
        repository: finding.repository,
        findingId: finding.findingId,
      });
      nextFindings.push(finding);
      continue;
    }
    if (finding.postingState === "posted" && finding.issueOrReviewUrl) {
      decisions.push({
        action: "skip-already-posted",
        repository: finding.repository,
        findingId: finding.findingId,
      });
      nextFindings.push(finding);
      continue;
    }

    const match = existingGitHub.find((r) => matchesExisting(finding, r));
    if (match) {
      const matchedUrl = assertUrl(match.url, "existingGitHub.url");
      if (finding.verificationStatus === "recurred") {
        // Do NOT silently swallow a recurred defect as already posted: emit explicit recurrence comment action.
        decisions.push({
          action: "comment-recurrence",
          repository: finding.repository,
          findingId: finding.findingId,
          url: matchedUrl,
        });
        nextFindings.push(finding);
        continue;
      }
      decisions.push({
        action: "link-existing",
        repository: finding.repository,
        findingId: finding.findingId,
        url: matchedUrl,
      });
      const priorIssueUrls =
        finding.issueOrReviewUrl &&
        finding.issueOrReviewUrl !== matchedUrl &&
        !finding.priorIssueUrls.includes(finding.issueOrReviewUrl)
          ? [...finding.priorIssueUrls, finding.issueOrReviewUrl]
          : [...finding.priorIssueUrls];
      nextFindings.push({
        ...finding,
        postingState: "posted",
        failureReason: null,
        issueOrReviewUrl: matchedUrl,
        priorIssueUrls,
      });
      continue;
    }

    if (finding.failureReason === "own-pr-request-changes") {
      decisions.push({
        action: "post-comment-fallback",
        repository: finding.repository,
        findingId: finding.findingId,
        reason: "own-pr-request-changes",
      });
      nextFindings.push(finding);
      continue;
    }

    decisions.push({
      action: "post",
      repository: finding.repository,
      findingId: finding.findingId,
    });
    nextFindings.push(finding);
  }

  return { ledger: { schemaVersion: 1, findings: nextFindings }, decisions };
}

export function parseLedgerJson(raw: string): FindingLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ledger JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ledger must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error(`unsupported ledger schemaVersion: ${String(obj.schemaVersion)} (expected 1)`);
  }
  if (!Array.isArray(obj.findings)) {
    throw new Error("ledger findings must be an array");
  }

  const findings: ReviewFinding[] = [];
  for (let i = 0; i < obj.findings.length; i++) {
    const entry = obj.findings[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`ledger findings[${i}] must be an object`);
    }
    const f = entry as Record<string, unknown>;
    const findingId = assertNonEmpty(f.findingId, `findings[${i}].findingId`);
    const repository = assertRepository(f.repository, `findings[${i}].repository`);
    const file = assertNonEmpty(f.file, `findings[${i}].file`);
    const line = assertPositiveInteger(f.line, `findings[${i}].line`);
    const sourceSha = assertExactSha(f.sourceSha, `findings[${i}].sourceSha`);
    if (typeof f.severity !== "string" || !SEVERITIES.has(f.severity)) {
      throw new Error(`findings[${i}].severity invalid: ${String(f.severity)}`);
    }
    const category = assertNonEmpty(f.category, `findings[${i}].category`);
    const evidence = assertNonEmpty(f.evidence, `findings[${i}].evidence`);
    const firstObservedAt = assertIsoTimestamp(f.firstObservedAt, `findings[${i}].firstObservedAt`);
    const lastObservedAt = assertIsoTimestamp(f.lastObservedAt, `findings[${i}].lastObservedAt`);
    if (typeof f.postingState !== "string" || !POSTING_STATES.has(f.postingState)) {
      throw new Error(`findings[${i}].postingState invalid: ${String(f.postingState)}`);
    }
    if (f.failureReason !== null && (typeof f.failureReason !== "string" || !FAILURE_REASONS.has(f.failureReason))) {
      throw new Error(`findings[${i}].failureReason invalid: ${String(f.failureReason)}`);
    }
    if (typeof f.recurrenceClass !== "string" || !RECURRENCE_CLASSES.has(f.recurrenceClass)) {
      throw new Error(`findings[${i}].recurrenceClass invalid: ${String(f.recurrenceClass)}`);
    }
    if (typeof f.verificationStatus !== "string" || !VERIFICATION_STATUSES.has(f.verificationStatus)) {
      throw new Error(`findings[${i}].verificationStatus invalid: ${String(f.verificationStatus)}`);
    }
    if (typeof f.actionClass !== "string" || !ACTION_CLASSES.has(f.actionClass)) {
      throw new Error(`findings[${i}].actionClass invalid: ${String(f.actionClass)}`);
    }
    const observationCount = assertPositiveInteger(f.observationCount, `findings[${i}].observationCount`);
    if (f.issueOrReviewUrl !== null && typeof f.issueOrReviewUrl !== "string") {
      throw new Error(`findings[${i}].issueOrReviewUrl must be string or null`);
    }
    const priorIssueUrls = f.priorIssueUrls === undefined ? [] : f.priorIssueUrls;
    if (!Array.isArray(priorIssueUrls) || !priorIssueUrls.every((u) => typeof u === "string")) {
      throw new Error(`findings[${i}].priorIssueUrls must be an array of strings`);
    }
    if (f.symbol !== undefined && f.symbol !== null && typeof f.symbol !== "string") {
      throw new Error(`findings[${i}].symbol must be string or null`);
    }
    if (f.fingerprint !== undefined && f.fingerprint !== null && typeof f.fingerprint !== "string") {
      throw new Error(`findings[${i}].fingerprint must be string or null`);
    }

    let ownerApproval: OwnerApprovalEvidence | null = null;
    if (f.ownerApproval !== undefined && f.ownerApproval !== null) {
      if (typeof f.ownerApproval !== "object" || Array.isArray(f.ownerApproval)) {
        throw new Error(`findings[${i}].ownerApproval must be an object or null`);
      }
      const a = f.ownerApproval as Record<string, unknown>;
      ownerApproval = {
        approvedBy: assertNonEmpty(a.approvedBy, `findings[${i}].ownerApproval.approvedBy`),
        approvalEvidenceUrl: assertUrl(
          a.approvalEvidenceUrl,
          `findings[${i}].ownerApproval.approvalEvidenceUrl`,
        ),
        approvedAt: assertIsoTimestamp(a.approvedAt, `findings[${i}].ownerApproval.approvedAt`),
      };
    }

    let resolvedEvidence: ResolutionEvidence | null = null;
    if (f.resolvedEvidence !== undefined && f.resolvedEvidence !== null) {
      if (typeof f.resolvedEvidence !== "object" || Array.isArray(f.resolvedEvidence)) {
        throw new Error(`findings[${i}].resolvedEvidence must be an object or null`);
      }
      const r = f.resolvedEvidence as Record<string, unknown>;
      const kind = r.resolutionKind === undefined ? "fix" : r.resolutionKind;
      if (typeof kind !== "string" || !RESOLUTION_KINDS.has(kind)) {
        throw new Error(`findings[${i}].resolvedEvidence.resolutionKind invalid: ${String(kind)}`);
      }
      resolvedEvidence = {
        sha: assertExactSha(r.sha, `findings[${i}].resolvedEvidence.sha`),
        verificationCommand: assertNonEmpty(
          r.verificationCommand,
          `findings[${i}].resolvedEvidence.verificationCommand`,
        ),
        verifiedAt: assertIsoTimestamp(r.verifiedAt, `findings[${i}].resolvedEvidence.verifiedAt`),
        resolutionKind: kind as ResolutionKind,
      };
    }

    findings.push({
      findingId,
      repository,
      file,
      line,
      symbol: (f.symbol as string | null | undefined) ?? null,
      fingerprint: (f.fingerprint as string | null | undefined) ?? null,
      sourceSha,
      severity: f.severity as Severity,
      category,
      evidence,
      firstObservedAt,
      lastObservedAt,
      issueOrReviewUrl: f.issueOrReviewUrl as string | null,
      priorIssueUrls: priorIssueUrls as string[],
      postingState: f.postingState as PostingState,
      failureReason: f.failureReason as FailureReason | null,
      recurrenceClass: f.recurrenceClass as RecurrenceClass,
      verificationStatus: f.verificationStatus as VerificationStatus,
      actionClass: f.actionClass as ActionClass,
      ownerApproval,
      resolvedEvidence,
      observationCount,
    });
  }

  return { schemaVersion: 1, findings };
}

export function loadLedger(
  filePath: string,
  options?: { readonly createIfMissing?: boolean },
): FindingLedger {
  const resolved = resolve(filePath);
  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && options?.createIfMissing) {
      return createLedger();
    }
    throw new Error(`failed to read ledger (${filePath}): ${(error as Error).message}`);
  }
  return parseLedgerJson(raw);
}

export function saveLedger(filePath: string, ledger: FindingLedger): void {
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  const payload = redactSecrets(`${JSON.stringify(ledger, null, 2)}\n`);
  const tmpPath = `${resolved}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, resolved);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
