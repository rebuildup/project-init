import assert from "node:assert/strict";
import test from "node:test";
import {
  checkClaimHonesty,
  checkTestExecution,
  checkWorkflowHonesty,
} from "./check-gate-honesty.mts";

test("distinguishes u-sekai #78 fail-closed from ty-plus #179 silent pass", () => {
  // u-sekai #78 (corrected observation): 0 files collected -> exit 1 -> fail-closed (safe)
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

  // ty-plus #179 (unmatched -t filter): files collected, 25 discovered, 0 passed, exit 0 -> silent pass defect
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

  // ty-plus #179 (describe.skip): all tests skipped, exit 0 -> silent pass defect
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
});

test("negative workflow controls: u-sekai #75 merge-tree vs head-ref and masked failure", () => {
  const brokenWorkflow = `
name: ci
on:
  pull_request:
jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check version against head ref
        run: node scripts/version-check.mjs "$GITHUB_HEAD_REF" || true
`;
  const findings = checkWorkflowHonesty(brokenWorkflow, ".github/workflows/ci.yml");
  assert.ok(findings.some((f) => f.code === "MERGE_TREE_VS_HEAD_REF_MISMATCH"));
  assert.ok(findings.some((f) => f.code === "MASKED_STEP_FAILURE"));

  const honestWorkflow = `
name: ci
on:
  pull_request:
jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - name: Check version against head ref
        run: node scripts/version-check.mjs "$GITHUB_HEAD_REF"
`;
  assert.deepEqual(checkWorkflowHonesty(honestWorkflow, ".github/workflows/ci.yml"), []);
});

test("negative claim controls: ty-plus #175 skipped partition, readmark #72 fallback, readmark #76 false prose mirror", () => {
  const findings = checkClaimHonesty({
    subject: "release-gate",
    claimedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    executedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    requiredPartitions: ["unit", "windows-release-gate"],
    skippedRequiredPartitions: ["windows-release-gate"],
    partitionReports: [
      {
        partition: "unit",
        exitCode: 0,
        reportedSuccess: true,
        numCollectedFiles: 5,
        numTotalTests: 21,
        numPassedTests: 21,
        numFailedTests: 0,
        numSkippedTests: 0,
      },
    ],
    claimedGuarantee: "indexed read via [documentId+sourceFingerprint]",
    fallbackUsed: true,
    proseMirrorClaim: {
      declaredRelation: "FIT_WIDTH_PADDING_PX=48 mirrors .rm-reader-scroll padding",
      verifiedAgainstTarget: false,
    },
  });
  const codes = new Set(findings.map((f) => f.code));
  assert.ok(codes.has("SKIPPED_REQUIRED_PARTITION"));
  assert.ok(codes.has("FALLBACK_CONTRADICTS_CLAIM"));
  assert.ok(codes.has("UNVERIFIED_PROSE_MIRROR"));
});

test("positive control: executed tests > 0, exact SHA, no fallback, verified prose passes", () => {
  const findings = checkClaimHonesty({
    subject: "release-gate",
    claimedSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    executedSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    requiredPartitions: ["unit"],
    partitionReports: [
      {
        partition: "unit",
        exitCode: 0,
        reportedSuccess: true,
        numCollectedFiles: 4,
        numTotalTests: 18,
        numPassedTests: 18,
        numFailedTests: 0,
        numSkippedTests: 0,
      },
    ],
    claimedGuarantee: "unit suite executed on candidate SHA",
    fallbackUsed: false,
    proseMirrorClaim: {
      declaredRelation: "intentional margin token (no stylesheet mirror claimed)",
      verifiedAgainstTarget: true,
    },
  });
  assert.deepEqual(findings, []);
});
