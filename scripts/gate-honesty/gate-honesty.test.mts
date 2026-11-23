import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  checkClaimHonesty,
  checkTestExecution,
  checkWorkflowHonesty,
  checkWorkflowsDirectory,
  parseNodeTestTap,
  parseVitestJson,
  stripShellComments,
  verifyCssMirror,
  verifySchemaIndexes,
  verifyTapOutput,
  verifyVitestJsonOutput,
} from "./index.mts";

const CLI_PATH = resolve(import.meta.dirname, "cli.mts");
const REPO_ROOT = resolve(import.meta.dirname, "../..");

function runCli(
  args: readonly string[],
  input?: string,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    input,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

test("checkTestExecution: distinguishes u-sekai #78 fail-closed from ty-plus #179 silent pass", () => {
  const failClosed = checkTestExecution({
    partition: "unit",
    exitCode: 1,
    reportedSuccess: false,
    numCollectedFiles: 0,
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(failClosed.verdict, "FAIL_CLOSED_SAFE");
  assert.equal(failClosed.findings.length, 0);

  const unmatchedFilter = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 25,
    numPassedTests: 0,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(unmatchedFilter.verdict, "SILENT_PASS_DEFECT");
  assert.equal(unmatchedFilter.findings[0]?.code, "ZERO_EXECUTED_SILENT_PASS");

  const allSkipped = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 3,
    numPassedTests: 0,
    numFailedTests: 0,
    numSkippedTests: 3,
  });
  assert.equal(allSkipped.verdict, "SILENT_PASS_DEFECT");
  assert.equal(allSkipped.findings[0]?.code, "ALL_SKIPPED_SILENT_PASS");

  const zeroTotalZeroExit = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 0,
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(zeroTotalZeroExit.verdict, "SILENT_PASS_DEFECT");
  assert.equal(zeroTotalZeroExit.findings[0]?.code, "ZERO_EXECUTED_SILENT_PASS");
});

test("checkTestExecution [P0]: rejects exit 0 with failed tests or reportedSuccess=false", () => {
  // Exact regression case: exitCode=0, reportedSuccess=false, numFailedTests>0 previously returned VERIFIED!
  const failedWithFalseSuccess = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: false,
    numCollectedFiles: 2,
    numTotalTests: 10,
    numPassedTests: 8,
    numFailedTests: 2,
    numSkippedTests: 0,
  });
  assert.equal(failedWithFalseSuccess.verdict, "FAIL");
  const codes1 = new Set(failedWithFalseSuccess.findings.map((f) => f.code));
  assert.ok(codes1.has("FAILED_TESTS_WITH_ZERO_EXIT"));
  assert.ok(codes1.has("INCONSISTENT_SUCCESS_EXIT"));

  const failedWithTrueSuccess = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 5,
    numPassedTests: 4,
    numFailedTests: 1,
    numSkippedTests: 0,
  });
  assert.equal(failedWithTrueSuccess.verdict, "FAIL");
  assert.ok(failedWithTrueSuccess.findings.some((f) => f.code === "FAILED_TESTS_WITH_ZERO_EXIT"));

  const falseSuccessNoFailed = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: false,
    numCollectedFiles: 1,
    numTotalTests: 5,
    numPassedTests: 5,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(falseSuccessNoFailed.verdict, "FAIL");
  assert.ok(falseSuccessNoFailed.findings.some((f) => f.code === "INCONSISTENT_SUCCESS_EXIT"));

  const nonZeroWithTrueSuccess = checkTestExecution({
    partition: "unit",
    exitCode: 1,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 5,
    numPassedTests: 5,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(nonZeroWithTrueSuccess.verdict, "FAIL");
  assert.ok(nonZeroWithTrueSuccess.findings.some((f) => f.code === "INCONSISTENT_SUCCESS_EXIT"));
});

test("checkTestExecution [P0]: validates floor and count invariants", () => {
  for (const badFloor of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = checkTestExecution({
      partition: "unit",
      exitCode: 0,
      reportedSuccess: true,
      numCollectedFiles: 1,
      numTotalTests: 5,
      numPassedTests: 5,
      numFailedTests: 0,
      numSkippedTests: 0,
      minPassedRequired: badFloor,
    });
    assert.equal(res.verdict, "FAIL", `floor=${String(badFloor)} must fail`);
    assert.ok(res.findings.some((f) => f.code === "INVALID_FLOOR"));
  }

  const negativeCount = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 5,
    numPassedTests: 5,
    numFailedTests: -1,
    numSkippedTests: 0,
  });
  assert.equal(negativeCount.verdict, "FAIL");
  assert.ok(negativeCount.findings.some((f) => f.code === "INVALID_REPORT_INVARIANT"));

  const zeroFilesWithPassedTests = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 0,
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    numSkippedTests: 0,
  });
  assert.equal(zeroFilesWithPassedTests.verdict, "FAIL");
  assert.ok(zeroFilesWithPassedTests.findings.some((f) => f.code === "INVALID_REPORT_INVARIANT"));

  const outcomesExceedTotal = checkTestExecution({
    partition: "unit",
    exitCode: 0,
    reportedSuccess: true,
    numCollectedFiles: 1,
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 1,
    numSkippedTests: 0,
  });
  assert.equal(outcomesExceedTotal.verdict, "FAIL");
  assert.ok(outcomesExceedTotal.findings.some((f) => f.code === "INVALID_REPORT_INVARIANT"));
});

test("parsers [P0]: parseNodeTestTap and parseVitestJson handle real outputs and fail closed on empty/zero", () => {
  const realTap = [
    "TAP version 13",
    "# Subtest: passing test",
    "ok 1 - passing test",
    "1..1",
    "# tests 4",
    "# suites 1",
    "# pass 4",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 12.34",
  ].join("\n");

  const parsedTap = parseNodeTestTap(realTap, { partition: "unit", exitCode: 0 });
  assert.equal(parsedTap.numTotalTests, 4);
  assert.equal(parsedTap.numPassedTests, 4);
  assert.equal(parsedTap.numFailedTests, 0);
  assert.equal(checkTestExecution(parsedTap).verdict, "VERIFIED");

  // Empty TAP -> FAIL
  const emptyTap = verifyTapOutput("", { partition: "unit" });
  assert.equal(emptyTap.verdict, "FAIL");
  assert.equal(emptyTap.findings[0]?.code, "UNPARSEABLE_TEST_OUTPUT");

  // Malformed TAP -> FAIL
  const garbageTap = verifyTapOutput("hello world\nno tap summary here", { partition: "unit" });
  assert.equal(garbageTap.verdict, "FAIL");
  assert.equal(garbageTap.findings[0]?.code, "UNPARSEABLE_TEST_OUTPUT");

  // Zero-test TAP with exit 0 -> SILENT_PASS_DEFECT
  const zeroTap = [
    "TAP version 13",
    "1..0",
    "# tests 0",
    "# suites 0",
    "# pass 0",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
  ].join("\n");
  const zeroTapCheck = verifyTapOutput(zeroTap, { partition: "unit", exitCode: 0 });
  assert.equal(zeroTapCheck.verdict, "SILENT_PASS_DEFECT");
  assert.equal(zeroTapCheck.findings[0]?.code, "ZERO_EXECUTED_SILENT_PASS");

  // Spoofed `# pass 99` printed inside test output before `1..0` must NOT fool parser
  const spoofedTap = [
    "TAP version 13",
    "# tests 99",
    "# pass 99",
    "# fail 0",
    "1..0",
    "# tests 0",
    "# pass 0",
    "# fail 0",
    "# skipped 0",
    "# cancelled 0",
  ].join("\n");
  const spoofedCheck = verifyTapOutput(spoofedTap, { partition: "unit", exitCode: 0 });
  assert.equal(spoofedCheck.verdict, "SILENT_PASS_DEFECT");

  // Vitest JSON positive
  const vitestPass = JSON.stringify({
    success: true,
    numTotalTestSuites: 2,
    numTotalTests: 12,
    numPassedTests: 12,
    numFailedTests: 0,
    numPendingTests: 0,
  });
  const parsedVitest = parseVitestJson(vitestPass, { partition: "unit", exitCode: 0 });
  assert.equal(checkTestExecution(parsedVitest).verdict, "VERIFIED");

  // Vitest JSON ty-plus #179 silent pass (files collected, 25 discovered, 0 passed, success=true)
  const vitestSilentPass = JSON.stringify({
    success: true,
    numTotalTestSuites: 1,
    numTotalTests: 25,
    numPassedTests: 0,
    numFailedTests: 0,
    numPendingTests: 0,
  });
  const vitestCheck = verifyVitestJsonOutput(vitestSilentPass, { partition: "unit", exitCode: 0 });
  assert.equal(vitestCheck.verdict, "SILENT_PASS_DEFECT");
  assert.equal(vitestCheck.findings[0]?.code, "ZERO_EXECUTED_SILENT_PASS");

  // Empty Vitest JSON -> FAIL
  assert.equal(verifyVitestJsonOutput("").verdict, "FAIL");
});

test("checkClaimHonesty [P0]: rejects empty requiredPartitions, invalid SHAs, and duplicate partition overwrite", () => {
  const validSha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  // Empty requiredPartitions must fail closed
  const emptyRequired = checkClaimHonesty({
    subject: "release-gate",
    claimedSha: validSha,
    executedSha: validSha,
    requiredPartitions: [],
    partitionReports: [],
    claimedGuarantee: "all partitions passed",
  });
  assert.ok(emptyRequired.some((f) => f.code === "EMPTY_REQUIRED_PARTITIONS"));

  // Empty / invalid SHAs must fail closed
  const invalidSha = checkClaimHonesty({
    subject: "release-gate",
    claimedSha: "",
    executedSha: "not-a-hex-sha",
    requiredPartitions: ["unit"],
    partitionReports: [
      {
        partition: "unit",
        sha: "xyz",
        exitCode: 0,
        reportedSuccess: true,
        numCollectedFiles: 1,
        numTotalTests: 5,
        numPassedTests: 5,
        numFailedTests: 0,
        numSkippedTests: 0,
      },
    ],
    claimedGuarantee: "unit passed",
  });
  assert.equal(invalidSha.filter((f) => f.code === "INVALID_SHA").length, 3);

  // Duplicate partition report: earlier failure MUST NOT be masked by a later passing report!
  const duplicatePartition = checkClaimHonesty({
    subject: "release-gate",
    claimedSha: validSha,
    executedSha: validSha,
    requiredPartitions: ["unit"],
    partitionReports: [
      {
        partition: "unit",
        sha: validSha,
        exitCode: 0,
        reportedSuccess: false,
        numCollectedFiles: 1,
        numTotalTests: 5,
        numPassedTests: 3,
        numFailedTests: 2,
        numSkippedTests: 0,
      },
      {
        partition: "unit",
        sha: validSha,
        exitCode: 0,
        reportedSuccess: true,
        numCollectedFiles: 1,
        numTotalTests: 5,
        numPassedTests: 5,
        numFailedTests: 0,
        numSkippedTests: 0,
      },
    ],
    claimedGuarantee: "unit passed",
  });
  const dupCodes = new Set(duplicatePartition.map((f) => f.code));
  assert.ok(dupCodes.has("DUPLICATE_PARTITION_REPORT"));
  assert.ok(dupCodes.has("FAILED_TESTS_WITH_ZERO_EXIT"));
});

test("checkWorkflowHonesty [P1]: fails closed on empty/malformed YAML, catches env head-ref, ref: github.ref, job continue-on-error, || :, || exit 0, set +e, and ignores shell comments", () => {
  // Empty YAML -> FAIL
  assert.equal(checkWorkflowHonesty("", "empty.yml")[0]?.code, "INVALID_WORKFLOW_YAML");

  // Malformed YAML -> FAIL
  assert.equal(
    checkWorkflowHonesty("name: ci\non: [\n  unclosed", "broken.yml")[0]?.code,
    "INVALID_WORKFLOW_YAML",
  );

  // Comment containing `|| true`, `|| :`, `set +e` MUST PASS (no false positives)
  const commentsOnlyWorkflow = `
name: honest-with-comments
on:
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run checks
        run: |
          # Never use || true, || :, || exit 0, or set +e here
          echo "running tests" # inline comment mentioning || true
          node --test scripts/gate-honesty/gate-honesty.test.mts
`;
  assert.deepEqual(checkWorkflowHonesty(commentsOnlyWorkflow, "comments.yml"), []);
  assert.equal(stripShellComments("echo ok # || true\n# set +e\nrun_cmd"), "echo ok \n\nrun_cmd");

  // env:-level GITHUB_HEAD_REF / github.event.pull_request.head.* with default checkout -> FAIL
  const envHeadRefWorkflow = `
name: env-head-ref
on:
  pull_request:
jobs:
  version:
    runs-on: ubuntu-latest
    env:
      PR_HEAD: \${{ github.event.pull_request.head.ref }}
    steps:
      - uses: actions/checkout@v4
      - run: echo "$PR_HEAD"
`;
  assert.ok(
    checkWorkflowHonesty(envHeadRefWorkflow, "env.yml").some(
      (f) => f.code === "MERGE_TREE_VS_HEAD_REF_MISMATCH",
    ),
  );

  // actions/checkout with ref: ${{ github.ref }} on pull_request -> FAIL
  const githubRefCheckoutWorkflow = `
name: bad-ref-checkout
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.ref }}
      - run: npm test
`;
  assert.ok(
    checkWorkflowHonesty(githubRefCheckoutWorkflow, "bad-ref.yml").some(
      (f) => f.code === "MERGE_TREE_VS_HEAD_REF_MISMATCH",
    ),
  );

  // job-level continue-on-error: true + || : + || exit 0 + set +e -> ALL flagged
  const maskedWorkflow = `
name: masked
on:
  pull_request:
jobs:
  masked_job:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - name: colon
        run: "npm test || :"
      - name: exit-zero
        run: npm test || exit 0
      - name: set-plus-e
        run: |
          set +e
          npm test
`;
  const maskedFindings = checkWorkflowHonesty(maskedWorkflow, "masked.yml");
  assert.equal(
    maskedFindings.filter((f) => f.code === "MASKED_STEP_FAILURE").length,
    4,
    JSON.stringify(maskedFindings),
  );

  // Real repository `.github/workflows` directory scan must check all workflow files and pass
  const repoWorkflows = checkWorkflowsDirectory(join(REPO_ROOT, ".github/workflows"));
  assert.ok(repoWorkflows.filesChecked.length >= 3, "expected at least 3 repository workflows");
  assert.deepEqual(repoWorkflows.findings, []);
});

test("verifyCssMirror [P1]: deterministic readmark #76 CSS mirror verifier (negative and positive controls)", () => {
  // Negative control 1: exact readmark #76 mismatch (padding is 20px 0 60vh, not 48px)
  const readmark76Negative = verifyCssMirror({
    subject: "src/ui/reader-view.tsx",
    sourceCode: "export const FIT_WIDTH_PADDING_PX = 48;",
    cssText: `
      .rm-reader-scroll { padding: 20px 0 60vh; }
      .rm-reader-pages { display: flex; flex-direction: column; }
    `,
    expectations: [
      {
        constantName: "FIT_WIDTH_PADDING_PX",
        selectors: [".rm-reader-scroll", ".rm-reader-pages"],
        expectedProperty: "padding",
        expectedValue: "48px",
      },
    ],
  });
  assert.ok(readmark76Negative.some((f) => f.code === "UNVERIFIED_PROSE_MIRROR"));

  // Negative control 2: selector does not exist at all
  const missingSelector = verifyCssMirror({
    subject: "src/ui/reader-view.tsx",
    cssText: ".rm-reader-scroll { padding: 48px; }",
    expectations: [
      {
        constantName: "SIDEBAR_WIDTH_PX",
        selectors: [".rm-nonexistent-sidebar"],
      },
    ],
  });
  assert.ok(missingSelector.some((f) => f.code === "UNVERIFIED_PROSE_MIRROR"));

  // Positive control: selector, property, and value match
  const positive = verifyCssMirror({
    subject: "src/ui/reader-view.tsx",
    sourceCode: "export const FIT_WIDTH_PADDING_PX = 48;",
    cssText: `
      /* reader viewport */
      .rm-reader-scroll { padding-inline: 48px; }
      .rm-reader-pages { display: flex; }
    `,
    expectations: [
      {
        constantName: "FIT_WIDTH_PADDING_PX",
        selectors: [".rm-reader-scroll", ".rm-reader-pages"],
        expectedProperty: "padding",
        expectedValue: "48px",
      },
    ],
  });
  assert.deepEqual(positive, []);
});

test("verifySchemaIndexes [P1]: deterministic readmark #72 SQL and Dexie schema-index verifier", () => {
  // Negative control 1 (readmark #72 Dexie): queries [documentId+sourceFingerprint], schema only has [documentId+pageIndex]
  const dexieNegative = verifySchemaIndexes({
    subject: "bookmarks-repo",
    dexieSchema: {
      bookmarks: "++id, [documentId+pageIndex], createdAt",
      highlights: "++id, [documentId+pageIndex]",
    },
    claims: [
      {
        queryName: "listBookmarks",
        table: "bookmarks",
        columns: ["documentId", "sourceFingerprint"],
      },
      {
        queryName: "listHighlights",
        table: "highlights",
        columns: ["documentId", "sourceFingerprint"],
      },
    ],
  });
  assert.equal(dexieNegative.filter((f) => f.code === "FALLBACK_CONTRADICTS_CLAIM").length, 2);

  // Negative control 2 (SQL DDL): missing index on (document_id, source_fingerprint)
  const sqlNegative = verifySchemaIndexes({
    subject: "migrations/001_init.sql",
    sqlDdl: `
      CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY,
        document_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        source_fingerprint TEXT NOT NULL
      );
      CREATE INDEX idx_bookmarks_doc_page ON bookmarks (document_id, page_index);
    `,
    claims: [
      {
        queryName: "listBookmarksByFingerprint",
        table: "bookmarks",
        columns: ["document_id", "source_fingerprint"],
      },
    ],
  });
  assert.equal(sqlNegative.length, 1);
  assert.equal(sqlNegative[0]?.code, "FALLBACK_CONTRADICTS_CLAIM");

  // Positive control (SQL + Dexie): leftmost prefix and exact compound index match
  const positive = verifySchemaIndexes({
    subject: "migrations/002_add_fingerprint_idx.sql",
    sqlDdl: `
      CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY,
        document_id TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        page_index INTEGER NOT NULL
      );
      CREATE INDEX idx_bookmarks_doc_fp ON bookmarks (document_id, source_fingerprint, page_index);
    `,
    dexieSchema: {
      highlights: "++id, [documentId+sourceFingerprint+pageIndex]",
    },
    claims: [
      {
        queryName: "listBookmarksByFingerprint",
        table: "bookmarks",
        columns: ["document_id", "source_fingerprint"],
      },
      {
        queryName: "listBookmarksByDoc",
        table: "bookmarks",
        columns: ["document_id"],
      },
      {
        queryName: "listHighlightsByFingerprint",
        table: "highlights",
        columns: ["documentId", "sourceFingerprint"],
      },
    ],
  });
  assert.deepEqual(positive, []);
});

test("CLI [P0/P1]: enforces strict JSON schema validation (exit 2), workflows-dir scan, and TAP stdin/run-and-verify", () => {
  const scratch = mkdtempSync(join(tmpdir(), "gate-honesty-cli-"));
  try {
    // 1. Malformed / missing-fields claim JSON must exit 2
    const badClaimPath = join(scratch, "bad-claim.json");
    writeFileSync(badClaimPath, JSON.stringify({ subject: "release-gate" }), "utf8");
    const badClaimRes = runCli(["claim", badClaimPath]);
    assert.equal(badClaimRes.status, 2);

    // 2. --workflows-dir on real .github/workflows must exit 0 and check all workflow files
    const wfRes = runCli(["workflow", "--workflows-dir", ".github/workflows"]);
    assert.equal(wfRes.status, 0, wfRes.stderr || wfRes.stdout);
    const wfPayload = JSON.parse(wfRes.stdout) as {
      status: string;
      filesChecked: string[];
      findings: unknown[];
    };
    assert.equal(wfPayload.status, "PASS");
    assert.ok(wfPayload.filesChecked.length >= 3);

    // 3. --verify-tap stdin with real passing TAP -> exit 0
    const passTapRes = runCli(
      ["--verify-tap", "stdin", "--floor", "2"],
      "TAP version 13\n1..2\n# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0\n",
    );
    assert.equal(passTapRes.status, 0);

    // 4. --verify-tap stdin with empty input -> exit 1 (FAIL)
    const emptyTapRes = runCli(["--verify-tap", "-", "--floor", "1"], "");
    assert.equal(emptyTapRes.status, 1);

    // 5. --verify-tap stdin with 0 executed tests -> exit 1 (FAIL)
    const zeroTapRes = runCli(
      ["--verify-tap", "-", "--floor", "1"],
      "TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n",
    );
    assert.equal(zeroTapRes.status, 1);

    // 6. --run-and-verify with a real zero-test command (exit 0, 0 tests) -> exit 1 (FAIL)
    const zeroCmdRes = runCli([
      "--run-and-verify",
      "--floor",
      "1",
      "--partition",
      "zero-probe",
      "--",
      process.execPath,
      "-e",
      "console.log('TAP version 13\\n1..0\\n# tests 0\\n# pass 0\\n# fail 0\\n# skipped 0\\n# cancelled 0')",
    ]);
    assert.equal(zeroCmdRes.status, 1);

    // 7. --run-and-verify with a real passing command -> exit 0 (PASS)
    const passCmdRes = runCli([
      "--run-and-verify",
      "--floor",
      "1",
      "--partition",
      "pass-probe",
      "--",
      process.execPath,
      "-e",
      "console.log('TAP version 13\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n# skipped 0\\n# cancelled 0')",
    ]);
    assert.equal(passCmdRes.status, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
