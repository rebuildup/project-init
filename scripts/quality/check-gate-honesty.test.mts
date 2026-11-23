import assert from "node:assert/strict";
import test from "node:test";
import {
  checkClaimHonesty,
  checkTestExecution,
  checkWorkflowHonesty,
  verifyCssMirror,
  verifySchemaIndexes,
} from "./check-gate-honesty.mts";

test("scripts/quality/check-gate-honesty.mts facade exposes deterministic gate honesty verifiers", () => {
  const validSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const execRes = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 2,
    numTotalTests: 10,
    numPassedTests: 10,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(execRes.verdict, "VERIFIED");

  const claimFindings = checkClaimHonesty({
    subject: "release-gate",
    claimedSha: validSha,
    executedSha: validSha,
    requiredPartitions: ["unit"],
    partitionReports: [
      {
        partition: "unit",
        sha: validSha,
        exitCode: 0,
        reportedSuccess: true,
        numCollectedFiles: 2,
        numTotalTests: 10,
        numPassedTests: 10,
        numFailedTests: 0,
        numSkippedTests: 0,
      },
    ],
    claimedGuarantee: "unit suite executed with real verified schema and CSS mirrors",
    cssMirrorChecks: [
      {
        subject: "reader-view",
        cssText: ".rm-reader-scroll { padding-inline: 48px; }",
        expectations: [
          {
            constantName: "FIT_WIDTH_PADDING_PX",
            selectors: [".rm-reader-scroll"],
            expectedProperty: "padding",
            expectedValue: "48px",
          },
        ],
      },
    ],
    schemaIndexChecks: [
      {
        subject: "bookmarks",
        dexieSchema: { bookmarks: "++id, [documentId+sourceFingerprint]" },
        claims: [
          {
            queryName: "listBookmarks",
            table: "bookmarks",
            columns: ["documentId", "sourceFingerprint"],
          },
        ],
      },
    ],
  });
  assert.deepEqual(claimFindings, []);

  assert.ok(checkWorkflowHonesty("", "empty.yml").length > 0);
  assert.ok(
    verifyCssMirror({
      subject: "negative",
      cssText: ".other { padding: 0; }",
      expectations: [{ constantName: "X", selectors: [".missing"] }],
    }).length > 0,
  );
  assert.ok(
    verifySchemaIndexes({
      subject: "negative",
      sqlDdl: "CREATE TABLE t (id INT PRIMARY KEY, a INT, b INT);",
      claims: [{ queryName: "q", table: "t", columns: ["a", "b"] }],
    }).length > 0,
  );
});
