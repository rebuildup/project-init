import assert from "node:assert/strict";
import test from "node:test";
import {
  createLedger,
  markPosted,
  planRetry,
  recordFinding,
  recordPostFailure,
  resolveFinding,
} from "./ledger.mts";

const SHA_1 = "1111111111111111111111111111111111111111";
const SHA_2 = "2222222222222222222222222222222222222222";
const SHA_3 = "3333333333333333333333333333333333333333";

test("write denied -> next-day recovery -> posts exactly once and suppresses duplicate", () => {
  let ledger = createLedger();
  ledger = recordFinding(ledger, {
    findingId: "my-web:d1-int-precision",
    repository: "rebuildup/my-web-2026",
    file: "src/db/metrics.ts",
    line: 42,
    sourceSha: SHA_1,
    severity: "P1",
    category: "data-integrity",
    evidence: "D1 integer exceeds JS safe integer bound",
    observedAt: "2026-10-23T00:30:00Z",
  });

  // Day 1: GitHub write denied -> persisted as not-posted with explicit failure reason
  ledger = recordPostFailure(ledger, "my-web:d1-int-precision", "permission");
  assert.equal(ledger.findings[0]?.postingState, "not-posted");
  assert.equal(ledger.findings[0]?.failureReason, "permission");

  // Day 2: write recovers -> plans exactly 1 post
  const retry1 = planRetry(ledger, []);
  assert.deepEqual(retry1.decisions, [
    { action: "post", findingId: "my-web:d1-int-precision" },
  ]);

  ledger = markPosted(
    retry1.ledger,
    "my-web:d1-int-precision",
    "https://github.com/rebuildup/my-web-2026/issues/701",
  );
  assert.equal(ledger.findings[0]?.postingState, "posted");

  // Subsequent run -> does NOT post again
  const retry2 = planRetry(ledger, []);
  assert.deepEqual(retry2.decisions, [
    { action: "skip-already-posted", findingId: "my-web:d1-int-precision" },
  ]);
});

test("existing GitHub Issue suppresses duplicate posting and links canonical URL", () => {
  let ledger = createLedger();
  ledger = recordFinding(ledger, {
    findingId: "my-web:admin-analytics-exclusion",
    repository: "rebuildup/my-web-2026",
    file: "src/middleware/analytics.ts",
    line: 18,
    sourceSha: SHA_1,
    severity: "P2",
    category: "analytics-scope",
    evidence: "admin route missing exclusion guard",
    observedAt: "2026-10-24T00:30:00Z",
  });
  ledger = recordPostFailure(ledger, "my-web:admin-analytics-exclusion", "rate-limit");

  const planned = planRetry(ledger, [
    {
      repository: "rebuildup/my-web-2026",
      url: "https://github.com/rebuildup/my-web-2026/issues/700",
      file: "src/middleware/analytics.ts",
      category: "analytics-scope",
      state: "OPEN",
    },
  ]);

  assert.deepEqual(planned.decisions, [
    {
      action: "link-existing",
      findingId: "my-web:admin-analytics-exclusion",
      url: "https://github.com/rebuildup/my-web-2026/issues/700",
    },
  ]);
  assert.equal(planned.ledger.findings[0]?.postingState, "posted");
  assert.equal(
    planned.ledger.findings[0]?.issueOrReviewUrl,
    "https://github.com/rebuildup/my-web-2026/issues/700",
  );
});

test("exact-head resolution followed by re-observation detects recurrence and separates scope changes", () => {
  let ledger = createLedger();
  ledger = recordFinding(ledger, {
    findingId: "my-web:logging-redaction",
    repository: "rebuildup/my-web-2026",
    file: "src/lib/logger.ts",
    line: 90,
    sourceSha: SHA_1,
    severity: "P1",
    category: "security-logging",
    evidence: "raw auth header logged on error",
    observedAt: "2026-10-24T00:30:00Z",
  });
  ledger = markPosted(
    ledger,
    "my-web:logging-redaction",
    "https://github.com/rebuildup/my-web-2026/issues/702",
  );

  // Reject short/non-exact SHA resolution
  assert.throws(
    () =>
      resolveFinding(ledger, "my-web:logging-redaction", {
        sha: "shortsha",
        verificationCommand: "pnpm test",
        verifiedAt: "2026-10-25T00:00:00Z",
      }),
    /full 40-char exact head SHA/,
  );

  // Valid exact-head resolution
  ledger = resolveFinding(ledger, "my-web:logging-redaction", {
    sha: SHA_2,
    verificationCommand: "pnpm test src/lib/logger.test.ts",
    verifiedAt: "2026-10-25T00:00:00Z",
  });
  assert.equal(ledger.findings[0]?.verificationStatus, "resolved");

  // Re-observed on later SHA -> transitions to recurred & recurring
  ledger = recordFinding(ledger, {
    findingId: "my-web:logging-redaction",
    repository: "rebuildup/my-web-2026",
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

  // Scope/target change requires owner approval and is held out of auto-post
  ledger = recordFinding(ledger, {
    findingId: "scope:move-feature-release",
    repository: "rebuildup/my-web-2026",
    file: "docs/release.md",
    line: 10,
    sourceSha: SHA_3,
    severity: "P2",
    category: "release-scope",
    evidence: "proposed release target change",
    observedAt: "2026-10-28T00:30:00Z",
    actionClass: "scope-change-requires-owner-approval",
  });
  const planned = planRetry(ledger, []);
  assert.ok(
    planned.decisions.some(
      (d) => d.action === "hold-owner-approval" && d.findingId === "scope:move-feature-release",
    ),
  );
});
