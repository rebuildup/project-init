#!/usr/bin/env -S bun
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  checkTestExecution,
  checkWorkflowsDirectory,
  verifyCssMirror,
  verifySchemaIndexes,
  verifyTapOutput,
} from "../../scripts/gate-honesty/index.mts";

const root = resolve(import.meta.dirname, "../..");

// 1. All repository GitHub Actions workflows pass workflow honesty checks
const workflows = checkWorkflowsDirectory(join(root, ".github/workflows"));
assert.ok(workflows.filesChecked.length >= 3, "expected >= 3 workflow files");
assert.deepEqual(
  workflows.findings,
  [],
  `workflow honesty findings: ${JSON.stringify(workflows.findings)}`,
);

// 2. Real node --test TAP execution count >= 1 verification
const tapRun = spawnSync(
  "node",
  ["--test", "--test-reporter=tap", join(root, "scripts/gate-honesty/gate-honesty.test.mts")],
  { encoding: "utf8", cwd: root },
);
assert.equal(tapRun.status, 0, tapRun.stderr || tapRun.stdout);
const tapCheck = verifyTapOutput(tapRun.stdout ?? "", {
  partition: "gate-honesty",
  exitCode: tapRun.status ?? 1,
  minPassedRequired: 1,
});
assert.equal(tapCheck.verdict, "VERIFIED", JSON.stringify(tapCheck.findings));

// 3. Negative controls must fail closed
assert.equal(
  checkTestExecution({
    partition: "silent-pass",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 10,
    numPassedTests: 0,
    numFailedTests: 0,
    numSkippedTests: 0,
  }).verdict,
  "SILENT_PASS_DEFECT",
);
assert.equal(
  checkTestExecution({
    partition: "failed-zero-exit",
    exitCode: 0,
    reportedSuccess: false,
    numCollectedFiles: 1,
    numTotalTests: 5,
    numPassedTests: 4,
    numFailedTests: 1,
    numSkippedTests: 0,
  }).verdict,
  "FAIL",
);
assert.ok(
  verifyCssMirror({
    subject: "readmark-76-negative",
    cssText: ".rm-reader-scroll { padding: 20px 0 60vh; }",
    expectations: [
      {
        constantName: "FIT_WIDTH_PADDING_PX",
        selectors: [".rm-reader-scroll"],
        expectedProperty: "padding",
        expectedValue: "48px",
      },
    ],
  }).some((f) => f.code === "UNVERIFIED_PROSE_MIRROR"),
);
assert.ok(
  verifySchemaIndexes({
    subject: "readmark-72-negative",
    dexieSchema: { bookmarks: "++id, [documentId+pageIndex]" },
    claims: [
      {
        queryName: "listBookmarks",
        table: "bookmarks",
        columns: ["documentId", "sourceFingerprint"],
      },
    ],
  }).some((f) => f.code === "FALLBACK_CONTRADICTS_CLAIM"),
);

console.log(
  `gate-honesty controls OK (${workflows.filesChecked.length} workflows verified, real TAP execution verified)`,
);
