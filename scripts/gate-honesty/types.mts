export interface TestPartitionReport {
  readonly partition: string;
  readonly exitCode: number;
  readonly reportedSuccess: boolean;
  readonly numCollectedFiles: number;
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly numSkippedTests: number;
  readonly numCancelledTests?: number;
  readonly minPassedRequired?: number;
  readonly sha?: string;
}

export type ExecutionVerdict =
  | "VERIFIED"
  | "FAIL_CLOSED_SAFE"
  | "SILENT_PASS_DEFECT"
  | "FAIL";

export type GateFindingCode =
  | "ZERO_EXECUTED_SILENT_PASS"
  | "ALL_SKIPPED_SILENT_PASS"
  | "BELOW_MIN_PASSED_FLOOR"
  | "INCONSISTENT_SUCCESS_EXIT"
  | "FAILED_TESTS_WITH_ZERO_EXIT"
  | "INVALID_FLOOR"
  | "INVALID_REPORT_INVARIANT"
  | "UNPARSEABLE_TEST_OUTPUT"
  | "INVALID_WORKFLOW_YAML"
  | "MERGE_TREE_VS_HEAD_REF_MISMATCH"
  | "MASKED_STEP_FAILURE"
  | "EMPTY_REQUIRED_PARTITIONS"
  | "DUPLICATE_PARTITION_REPORT"
  | "SKIPPED_REQUIRED_PARTITION"
  | "FALLBACK_CONTRADICTS_CLAIM"
  | "UNVERIFIED_PROSE_MIRROR"
  | "INVALID_VERIFIER_SPEC"
  | "INVALID_SHA"
  | "SHA_MISMATCH";

export interface GateFinding {
  readonly code: GateFindingCode;
  readonly subject: string;
  readonly detail: string;
}

export interface ExecutionCheckResult {
  readonly verdict: ExecutionVerdict;
  readonly findings: readonly GateFinding[];
}

export interface CssMirrorExpectation {
  readonly constantName: string;
  readonly selectors: readonly string[];
  readonly expectedProperty?: string;
  readonly expectedValue?: string;
}

export interface CssMirrorInput {
  readonly subject: string;
  readonly sourceCode?: string;
  readonly cssText: string;
  readonly expectations: readonly CssMirrorExpectation[];
}

export interface QueryIndexClaim {
  readonly queryName: string;
  readonly table: string;
  readonly columns: readonly string[];
}

export interface SchemaIndexInput {
  readonly subject: string;
  readonly sqlDdl?: string;
  readonly dexieSchema?: Readonly<Record<string, string>>;
  readonly claims: readonly QueryIndexClaim[];
}

export interface ClaimVerificationRecord {
  readonly subject: string;
  readonly claimedSha: string;
  readonly executedSha: string;
  readonly requiredPartitions: readonly string[];
  readonly partitionReports: readonly TestPartitionReport[];
  readonly skippedRequiredPartitions?: readonly string[];
  readonly claimedGuarantee: string;
  readonly cssMirrorChecks?: readonly CssMirrorInput[];
  readonly schemaIndexChecks?: readonly SchemaIndexInput[];
}
