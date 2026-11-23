import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "./cli.mts";
import {
  approveScopeChange,
  createLedger,
  loadLedger,
  markPosted,
  matchesExisting,
  planRetry,
  recordFinding,
  recordPostFailure,
  resolveFinding,
  saveLedger,
} from "./ledger.mts";

const SHA_1 = "1111111111111111111111111111111111111111";
const SHA_2 = "2222222222222222222222222222222222222222";
const SHA_3 = "3333333333333333333333333333333333333333";

test("write denied -> next-day recovery -> posts exactly once and suppresses duplicate", () => {
  let ledger = createLedger();
  const key = { repository: "rebuildup/my-web-2026", findingId: "my-web:d1-int-precision" };
  ledger = recordFinding(ledger, {
    findingId: key.findingId,
    repository: key.repository,
    file: "src/db/metrics.ts",
    line: 42,
    sourceSha: SHA_1,
    severity: "P1",
    category: "data-integrity",
    evidence: "D1 integer exceeds JS safe integer bound",
    observedAt: "2026-10-23T00:30:00Z",
  });

  // Day 1: GitHub write denied -> persisted as not-posted with explicit failure reason
  ledger = recordPostFailure(ledger, key, "permission");
  assert.equal(ledger.findings[0]?.postingState, "not-posted");
  assert.equal(ledger.findings[0]?.failureReason, "permission");

  // Day 2: write recovers -> plans exactly 1 post with composite repository + findingId
  const retry1 = planRetry(ledger, []);
  assert.deepEqual(retry1.decisions, [
    { action: "post", repository: key.repository, findingId: key.findingId },
  ]);

  ledger = markPosted(
    retry1.ledger,
    key,
    "https://github.com/rebuildup/my-web-2026/issues/701",
  );
  assert.equal(ledger.findings[0]?.postingState, "posted");

  // Subsequent run -> does NOT post again
  const retry2 = planRetry(ledger, []);
  assert.deepEqual(retry2.decisions, [
    { action: "skip-already-posted", repository: key.repository, findingId: key.findingId },
  ]);
});

test("composite key (repository, findingId) isolates same findingId across repos and fails closed on missing target", () => {
  let ledger = createLedger();
  const repoA = { repository: "rebuildup/repo-a", findingId: "shared-id" };
  const repoB = { repository: "rebuildup/repo-b", findingId: "shared-id" };
  ledger = recordFinding(ledger, {
    ...repoA,
    file: "src/a.ts",
    line: 10,
    sourceSha: SHA_1,
    severity: "P1",
    category: "bug",
    evidence: "bug in repo A",
    observedAt: "2026-10-24T00:00:00Z",
  });
  ledger = recordFinding(ledger, {
    ...repoB,
    file: "src/b.ts",
    line: 20,
    sourceSha: SHA_1,
    severity: "P1",
    category: "bug",
    evidence: "bug in repo B",
    observedAt: "2026-10-24T00:00:00Z",
  });

  // Mutating repoA must NOT touch repoB
  ledger = markPosted(ledger, repoA, "https://github.com/rebuildup/repo-a/issues/1");
  assert.equal(ledger.findings[0]?.postingState, "posted");
  assert.equal(ledger.findings[1]?.postingState, "pending");

  // Missing target MUST throw (never silently no-op)
  const missing = { repository: "rebuildup/repo-c", findingId: "shared-id" };
  assert.throws(() => recordPostFailure(ledger, missing, "network"), /finding not found/);
  assert.throws(
    () => markPosted(ledger, missing, "https://github.com/rebuildup/repo-c/issues/1"),
    /finding not found/,
  );
  assert.throws(
    () =>
      resolveFinding(ledger, missing, {
        sha: SHA_2,
        verificationCommand: "bun test",
        verifiedAt: "2026-10-25T00:00:00Z",
      }),
    /finding not found/,
  );
  assert.throws(
    () =>
      approveScopeChange(ledger, missing, {
        approvedBy: "owner",
        approvalEvidenceUrl: "https://github.com/rebuildup/repo-c/issues/1",
        approvedAt: "2026-10-25T00:00:00Z",
      }),
    /finding not found/,
  );
});

test("re-observing a still-open finding keeps verificationStatus=open and recurrenceClass=one-off", () => {
  let ledger = createLedger();
  const base = {
    findingId: "still-open-bug",
    repository: "rebuildup/project-init",
    file: "src/app.ts",
    line: 30,
    sourceSha: SHA_1,
    severity: "P2" as const,
    category: "validation",
    evidence: "first observation",
    observedAt: "2026-10-24T00:00:00Z",
  };
  ledger = recordFinding(ledger, base);
  assert.equal(ledger.findings[0]?.verificationStatus, "open");
  assert.equal(ledger.findings[0]?.recurrenceClass, "one-off");

  // Re-observed while STILL open -> must NOT prematurely flip to recurring or recurred
  ledger = recordFinding(ledger, {
    ...base,
    sourceSha: SHA_2,
    evidence: "still present on next run",
    observedAt: "2026-10-25T00:00:00Z",
  });
  assert.equal(ledger.findings[0]?.observationCount, 2);
  assert.equal(ledger.findings[0]?.verificationStatus, "open");
  assert.equal(ledger.findings[0]?.recurrenceClass, "one-off");
});

test("matchesExisting deduplication: authoritative findingId mismatch and distinct bugs in same file+category are NOT suppressed", () => {
  let ledger = createLedger();
  ledger = recordFinding(ledger, {
    findingId: "bug-line-18",
    repository: "rebuildup/my-web-2026",
    file: "src/middleware/analytics.ts",
    line: 18,
    symbol: "excludeAdminRoute",
    fingerprint: "fp-admin-18",
    sourceSha: SHA_1,
    severity: "P2",
    category: "analytics-scope",
    evidence: "admin route missing exclusion guard",
    observedAt: "2026-10-24T00:30:00Z",
  });
  const finding = ledger.findings[0]!;

  // 1. Authoritative findingId mismatch MUST return false even if file + category + line match
  assert.equal(
    matchesExisting(finding, {
      repository: "rebuildup/my-web-2026",
      url: "https://github.com/rebuildup/my-web-2026/issues/700",
      findingId: "different-finding-id",
      file: "src/middleware/analytics.ts",
      category: "analytics-scope",
      line: 18,
      state: "OPEN",
    }),
    false,
  );

  // 2. Without findingId, file + category ALONE (no line/symbol/fingerprint) MUST return false
  assert.equal(
    matchesExisting(finding, {
      repository: "rebuildup/my-web-2026",
      url: "https://github.com/rebuildup/my-web-2026/issues/701",
      file: "src/middleware/analytics.ts",
      category: "analytics-scope",
      state: "OPEN",
    }),
    false,
  );

  // 3. Different line far away in same file + category MUST return false (two distinct bugs)
  assert.equal(
    matchesExisting(finding, {
      repository: "rebuildup/my-web-2026",
      url: "https://github.com/rebuildup/my-web-2026/issues/702",
      file: "src/middleware/analytics.ts",
      category: "analytics-scope",
      line: 120,
      state: "OPEN",
    }),
    false,
  );

  // 4. Matching file + category + line within tight tolerance (<= 5) matches and links
  const planned = planRetry(ledger, [
    {
      repository: "rebuildup/my-web-2026",
      url: "https://github.com/rebuildup/my-web-2026/issues/700",
      file: "src/middleware/analytics.ts",
      category: "analytics-scope",
      line: 20,
      state: "OPEN",
    },
  ]);
  assert.deepEqual(planned.decisions, [
    {
      action: "link-existing",
      repository: "rebuildup/my-web-2026",
      findingId: "bug-line-18",
      url: "https://github.com/rebuildup/my-web-2026/issues/700",
    },
  ]);
  assert.equal(planned.ledger.findings[0]?.postingState, "posted");
});

test("own-pr-request-changes emits post-comment-fallback instead of retrying REQUEST_CHANGES", () => {
  let ledger = createLedger();
  const key = { repository: "rebuildup/project-init", findingId: "self-review-bug" };
  ledger = recordFinding(ledger, {
    ...key,
    file: "scripts/foo.mts",
    line: 12,
    sourceSha: SHA_1,
    severity: "P1",
    category: "correctness",
    evidence: "null check missing",
    observedAt: "2026-10-24T00:00:00Z",
  });
  ledger = recordPostFailure(ledger, key, "own-pr-request-changes");

  const planned = planRetry(ledger, []);
  assert.deepEqual(planned.decisions, [
    {
      action: "post-comment-fallback",
      repository: key.repository,
      findingId: key.findingId,
      reason: "own-pr-request-changes",
    },
  ]);
});

test("recurrence emits comment-recurrence on OPEN issue and preserves priorIssueUrls on new issue after CLOSED", () => {
  let ledger = createLedger();
  const key = { repository: "rebuildup/my-web-2026", findingId: "my-web:logging-redaction" };
  ledger = recordFinding(ledger, {
    ...key,
    file: "src/lib/logger.ts",
    line: 90,
    sourceSha: SHA_1,
    severity: "P1",
    category: "security-logging",
    evidence: "raw auth header logged on error",
    observedAt: "2026-10-24T00:30:00Z",
  });
  ledger = markPosted(ledger, key, "https://github.com/rebuildup/my-web-2026/issues/702");

  // Reject resolving on the exact same sourceSha unless false-positive or waived
  assert.throws(
    () =>
      resolveFinding(ledger, key, {
        sha: SHA_1,
        verificationCommand: "pnpm test",
        verifiedAt: "2026-10-25T00:00:00Z",
      }),
    /same sourceSha/,
  );

  // Explicit false-positive/waived on same sourceSha IS allowed
  const waived = resolveFinding(ledger, key, {
    sha: SHA_1,
    verificationCommand: "manual audit confirmed false positive",
    verifiedAt: "2026-10-25T00:00:00Z",
    resolutionKind: "false-positive",
  });
  assert.equal(waived.findings[0]?.verificationStatus, "resolved");

  // Normal fix on later SHA
  ledger = resolveFinding(ledger, key, {
    sha: SHA_2,
    verificationCommand: "pnpm test src/lib/logger.test.ts",
    verifiedAt: "2026-10-25T00:00:00Z",
  });

  // Re-observed on SHA_3 -> transitions to recurred & recurring
  ledger = recordFinding(ledger, {
    ...key,
    file: "src/lib/logger.ts",
    line: 94,
    sourceSha: SHA_3,
    severity: "P1",
    category: "security-logging",
    evidence: "auth header logged again in fallback catch",
    observedAt: "2026-10-28T00:30:00Z",
  });
  assert.equal(ledger.findings[0]?.verificationStatus, "recurred");
  assert.equal(ledger.findings[0]?.recurrenceClass, "recurring");
  assert.equal(ledger.findings[0]?.postingState, "pending");

  // Case A: Prior issue #702 is still OPEN -> MUST emit comment-recurrence (not silent link-existing)
  const openMatch = planRetry(ledger, [
    {
      repository: key.repository,
      url: "https://github.com/rebuildup/my-web-2026/issues/702",
      findingId: key.findingId,
      state: "OPEN",
    },
  ]);
  assert.deepEqual(openMatch.decisions, [
    {
      action: "comment-recurrence",
      repository: key.repository,
      findingId: key.findingId,
      url: "https://github.com/rebuildup/my-web-2026/issues/702",
    },
  ]);
  assert.equal(openMatch.ledger.findings[0]?.postingState, "pending");

  // Case B: Prior issue #702 is CLOSED -> plans new post, and markPosted preserves #702 in priorIssueUrls
  const closedMatch = planRetry(ledger, [
    {
      repository: key.repository,
      url: "https://github.com/rebuildup/my-web-2026/issues/702",
      findingId: key.findingId,
      state: "CLOSED",
    },
  ]);
  assert.deepEqual(closedMatch.decisions, [
    { action: "post", repository: key.repository, findingId: key.findingId },
  ]);
  ledger = markPosted(
    closedMatch.ledger,
    key,
    "https://github.com/rebuildup/my-web-2026/issues/805",
  );
  assert.equal(
    ledger.findings[0]?.issueOrReviewUrl,
    "https://github.com/rebuildup/my-web-2026/issues/805",
  );
  assert.deepEqual(ledger.findings[0]?.priorIssueUrls, [
    "https://github.com/rebuildup/my-web-2026/issues/702",
  ]);
});

test("scope-change-requires-owner-approval holds until approveScopeChange records owner evidence", () => {
  let ledger = createLedger();
  const key = { repository: "rebuildup/my-web-2026", findingId: "scope:move-feature-release" };
  ledger = recordFinding(ledger, {
    ...key,
    file: "docs/release.md",
    line: 10,
    sourceSha: SHA_3,
    severity: "P2",
    category: "release-scope",
    evidence: "proposed release target change",
    observedAt: "2026-10-28T00:30:00Z",
    actionClass: "scope-change-requires-owner-approval",
  });

  const before = planRetry(ledger, []);
  assert.deepEqual(before.decisions, [
    { action: "hold-owner-approval", repository: key.repository, findingId: key.findingId },
  ]);

  ledger = approveScopeChange(ledger, key, {
    approvedBy: "rebuildup",
    approvalEvidenceUrl: "https://github.com/rebuildup/my-web-2026/issues/141#issuecomment-1",
    approvedAt: "2026-10-29T00:00:00Z",
  });
  const after = planRetry(ledger, []);
  assert.deepEqual(after.decisions, [
    { action: "post", repository: key.repository, findingId: key.findingId },
  ]);
});

test("strict input validation rejects malformed SHA, line, timestamp, and empty required fields", () => {
  const ledger = createLedger();
  const valid = {
    findingId: "id-1",
    repository: "rebuildup/project-init",
    file: "src/index.ts",
    line: 10,
    sourceSha: SHA_1,
    severity: "P1" as const,
    category: "bug",
    evidence: "details",
    observedAt: "2026-10-28T00:30:00Z",
  };

  assert.throws(() => recordFinding(ledger, { ...valid, findingId: "  " }), /findingId/);
  assert.throws(() => recordFinding(ledger, { ...valid, repository: "bad-repo" }), /owner\/name/);
  assert.throws(() => recordFinding(ledger, { ...valid, file: "" }), /file/);
  assert.throws(() => recordFinding(ledger, { ...valid, line: 0 }), /positive integer/);
  assert.throws(() => recordFinding(ledger, { ...valid, line: 1.5 }), /positive integer/);
  assert.throws(() => recordFinding(ledger, { ...valid, sourceSha: "shortsha" }), /40-char exact head SHA/);
  assert.throws(() => recordFinding(ledger, { ...valid, evidence: "" }), /evidence/);
  assert.throws(() => recordFinding(ledger, { ...valid, observedAt: "not-a-date" }), /ISO-8601/);
});

test("file persistence: saveLedger atomically creates dirs, redacts tokens, and loadLedger rejects corrupt/wrong-schema files", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-findings-ledger-"));
  try {
    const ledgerPath = join(dir, "nested", "dir", "ledger.json");
    // Missing file fails cleanly when createIfMissing is not set
    assert.throws(() => loadLedger(ledgerPath), /failed to read ledger/);
    // Missing file returns empty ledger only when explicitly initialized
    assert.deepEqual(loadLedger(ledgerPath, { createIfMissing: true }), createLedger());

    const ghpToken = "ghp_" + "A".repeat(32);
    const patToken = "github_pat_" + "B".repeat(28);
    const bearer = "Bearer " + "C".repeat(24);
    let ledger = createLedger();
    ledger = recordFinding(ledger, {
      findingId: "secret-check",
      repository: "rebuildup/project-init",
      file: "src/auth.ts",
      line: 5,
      sourceSha: SHA_1,
      severity: "P0",
      category: "secrets",
      evidence: `leaked ${ghpToken} and ${patToken} and ${bearer}`,
      observedAt: "2026-11-23T00:00:00Z",
    });

    saveLedger(ledgerPath, ledger);
    const rawDisk = readFileSync(ledgerPath, "utf8");
    assert.equal(rawDisk.includes(ghpToken), false);
    assert.equal(rawDisk.includes(patToken), false);
    assert.equal(rawDisk.includes("C".repeat(24)), false);
    assert.equal(rawDisk.includes("[REDACTED]"), true);

    const reloaded = loadLedger(ledgerPath);
    assert.equal(reloaded.findings.length, 1);
    assert.equal(reloaded.findings[0]?.findingId, "secret-check");

    // Corrupt JSON -> throws
    const corruptPath = join(dir, "corrupt.json");
    writeFileSync(corruptPath, "{broken", "utf8");
    assert.throws(() => loadLedger(corruptPath), /invalid ledger JSON/);

    // Wrong schemaVersion -> throws
    const badSchemaPath = join(dir, "bad-schema.json");
    writeFileSync(badSchemaPath, JSON.stringify({ schemaVersion: 2, findings: [] }), "utf8");
    assert.throws(() => loadLedger(badSchemaPath), /unsupported ledger schemaVersion/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI end-to-end subcommands and negative-control exit codes (0, 1, 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-findings-cli-"));
  try {
    const ledgerPath = join(dir, "store", "ledger.json");

    // Exit 2 on unknown subcommand or missing required flags
    assert.equal(runCli(["unknown-cmd", "--ledger", ledgerPath]).exitCode, 2);
    assert.equal(runCli(["record", "--ledger", ledgerPath]).exitCode, 2);

    // Exit 1 when mutating a non-existent ledger or missing finding
    assert.equal(runCli(["summary", "--ledger", ledgerPath]).exitCode, 1);

    // Record finding
    const rec = runCli([
      "record",
      "--ledger",
      ledgerPath,
      "--repo",
      "rebuildup/project-init",
      "--finding-id",
      "cli-bug-1",
      "--file",
      "scripts/cli.mts",
      "--line",
      "15",
      "--sha",
      SHA_1,
      "--severity",
      "P1",
      "--category",
      "cli",
      "--evidence",
      "missing check",
      "--observed-at",
      "2026-11-23T00:00:00Z",
    ]);
    assert.equal(rec.exitCode, 0);

    // Fail with own-pr-request-changes
    const failRes = runCli([
      "fail",
      "--ledger",
      ledgerPath,
      "--repo",
      "rebuildup/project-init",
      "--finding-id",
      "cli-bug-1",
      "--reason",
      "own-pr-request-changes",
    ]);
    assert.equal(failRes.exitCode, 0);

    // Plan retry -> emits post-comment-fallback
    const planRes = runCli(["plan-retry", "--ledger", ledgerPath]);
    assert.equal(planRes.exitCode, 0);
    const planJson = JSON.parse(planRes.stdout) as { decisions: { action: string }[] };
    assert.equal(planJson.decisions[0]?.action, "post-comment-fallback");

    // Mark posted
    const postedRes = runCli([
      "mark-posted",
      "--ledger",
      ledgerPath,
      "--repo",
      "rebuildup/project-init",
      "--finding-id",
      "cli-bug-1",
      "--url",
      "https://github.com/rebuildup/project-init/issues/999",
    ]);
    assert.equal(postedRes.exitCode, 0);

    // Resolve on same SHA fails with exit 1
    const badResolve = runCli([
      "resolve",
      "--ledger",
      ledgerPath,
      "--repo",
      "rebuildup/project-init",
      "--finding-id",
      "cli-bug-1",
      "--sha",
      SHA_1,
      "--command",
      "bun test",
      "--verified-at",
      "2026-11-23T01:00:00Z",
    ]);
    assert.equal(badResolve.exitCode, 1);

    // Resolve on new SHA succeeds
    const goodResolve = runCli([
      "resolve",
      "--ledger",
      ledgerPath,
      "--repo",
      "rebuildup/project-init",
      "--finding-id",
      "cli-bug-1",
      "--sha",
      SHA_2,
      "--command",
      "bun test",
      "--verified-at",
      "2026-11-23T01:00:00Z",
    ]);
    assert.equal(goodResolve.exitCode, 0);

    // Scope-change + approve-scope
    assert.equal(
      runCli([
        "record",
        "--ledger",
        ledgerPath,
        "--repo",
        "rebuildup/project-init",
        "--finding-id",
        "scope-1",
        "--file",
        "README.md",
        "--line",
        "1",
        "--sha",
        SHA_2,
        "--severity",
        "P2",
        "--category",
        "scope",
        "--evidence",
        "scope shift",
        "--observed-at",
        "2026-11-23T01:00:00Z",
        "--action-class",
        "scope-change-requires-owner-approval",
      ]).exitCode,
      0,
    );
    assert.equal(
      runCli([
        "approve-scope",
        "--ledger",
        ledgerPath,
        "--repo",
        "rebuildup/project-init",
        "--finding-id",
        "scope-1",
        "--approver",
        "rebuildup",
        "--evidence-url",
        "https://github.com/rebuildup/project-init/issues/141#issuecomment-2",
        "--approved-at",
        "2026-11-23T02:00:00Z",
      ]).exitCode,
      0,
    );

    // Summary reports totals accurately
    const summaryRes = runCli(["summary", "--ledger", ledgerPath]);
    assert.equal(summaryRes.exitCode, 0);
    const summary = JSON.parse(summaryRes.stdout) as { total: number; byVerificationStatus: Record<string, number> };
    assert.equal(summary.total, 2);
    assert.equal(summary.byVerificationStatus.resolved, 1);
    assert.equal(summary.byVerificationStatus.open, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
