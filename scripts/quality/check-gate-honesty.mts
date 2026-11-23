#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface TestPartitionReport {
  readonly partition: string;
  readonly exitCode: number;
  readonly reportedSuccess: boolean;
  readonly numCollectedFiles: number;
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly numSkippedTests: number;
  readonly minPassedRequired?: number;
}

export type ExecutionVerdict = "VERIFIED" | "FAIL_CLOSED_SAFE" | "SILENT_PASS_DEFECT";

export interface GateFinding {
  readonly code:
    | "ZERO_EXECUTED_SILENT_PASS"
    | "ALL_SKIPPED_SILENT_PASS"
    | "BELOW_MIN_PASSED_FLOOR"
    | "INCONSISTENT_SUCCESS_EXIT"
    | "MERGE_TREE_VS_HEAD_REF_MISMATCH"
    | "MASKED_STEP_FAILURE"
    | "SKIPPED_REQUIRED_PARTITION"
    | "FALLBACK_CONTRADICTS_CLAIM"
    | "UNVERIFIED_PROSE_MIRROR"
    | "SHA_MISMATCH";
  readonly subject: string;
  readonly detail: string;
}

export interface ExecutionCheckResult {
  readonly verdict: ExecutionVerdict;
  readonly findings: readonly GateFinding[];
}

export function checkTestExecution(report: TestPartitionReport): ExecutionCheckResult {
  const findings: GateFinding[] = [];
  const floor = report.minPassedRequired ?? 1;

  // Distinguish fail-closed (e.g. u-sekai #78: 0 files collected, exit 1)
  // from silent pass (e.g. ty-plus #179: files collected, 0 tests executed, exit 0).
  if (report.exitCode !== 0) {
    if (report.reportedSuccess) {
      findings.push({
        code: "INCONSISTENT_SUCCESS_EXIT",
        subject: report.partition,
        detail: `partition reported success=true despite non-zero exit code ${report.exitCode}`,
      });
      return { verdict: "SILENT_PASS_DEFECT", findings };
    }
    return { verdict: "FAIL_CLOSED_SAFE", findings: [] };
  }

  if (report.numFailedTests > 0 && report.reportedSuccess) {
    findings.push({
      code: "INCONSISTENT_SUCCESS_EXIT",
      subject: report.partition,
      detail: `partition reported success with ${report.numFailedTests} failed tests`,
    });
  }

  if (report.numTotalTests > 0 && report.numPassedTests === 0 && report.numFailedTests === 0) {
    const allSkipped = report.numSkippedTests >= report.numTotalTests;
    findings.push({
      code: allSkipped ? "ALL_SKIPPED_SILENT_PASS" : "ZERO_EXECUTED_SILENT_PASS",
      subject: report.partition,
      detail: allSkipped
        ? `all ${report.numTotalTests} tests were skipped yet exited 0 (silent pass)`
        : `${report.numTotalTests} tests discovered but 0 executed/passed yet exited 0 (e.g. unmatched -t filter)`,
    });
  } else if (report.numPassedTests < floor) {
    findings.push({
      code: "BELOW_MIN_PASSED_FLOOR",
      subject: report.partition,
      detail: `passed tests (${report.numPassedTests}) below required floor (${floor}) despite exit 0`,
    });
  }

  return {
    verdict: findings.length === 0 ? "VERIFIED" : "SILENT_PASS_DEFECT",
    findings,
  };
}

interface WorkflowStep {
  readonly name?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly run?: string;
  readonly "continue-on-error"?: boolean;
}

interface WorkflowJob {
  readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDoc {
  readonly on?: unknown;
  readonly jobs?: Record<string, WorkflowJob>;
}

function triggersPullRequest(onField: unknown): boolean {
  if (typeof onField === "string") return onField === "pull_request" || onField === "pull_request_target";
  if (Array.isArray(onField)) return onField.includes("pull_request") || onField.includes("pull_request_target");
  if (onField !== null && typeof onField === "object") {
    return Object.hasOwn(onField, "pull_request") || Object.hasOwn(onField, "pull_request_target");
  }
  return false;
}

export function checkWorkflowHonesty(yamlText: string, fileLabel = "workflow.yml"): GateFinding[] {
  const doc = parseYaml(yamlText) as WorkflowDoc | null;
  if (!doc || typeof doc !== "object") return [];
  const findings: GateFinding[] = [];
  const hasPrTrigger = triggersPullRequest(doc.on);
  const jobs = doc.jobs ?? {};

  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    let defaultMergeTreeCheckout = false;
    let usesHeadRefEnv = false;

    for (const [idx, step] of steps.entries()) {
      const subject = `${fileLabel}:${jobName}[${step.name ?? String(idx)}]`;
      if (typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")) {
        const ref = step.with?.ref;
        if (ref === undefined || ref === null || String(ref).trim() === "") {
          defaultMergeTreeCheckout = true;
        }
      }
      if (typeof step.run === "string") {
        if (/\bGITHUB_HEAD_REF\b|\bgithub\.head_ref\b/.test(step.run)) {
          usesHeadRefEnv = true;
        }
        if (/\|\|\s*true\b/.test(step.run)) {
          findings.push({
            code: "MASKED_STEP_FAILURE",
            subject,
            detail: "step masks non-zero exit code with '|| true'",
          });
        }
      }
      if (step["continue-on-error"] === true) {
        findings.push({
          code: "MASKED_STEP_FAILURE",
          subject,
          detail: "step sets continue-on-error: true, turning failure into green job status",
        });
      }
    }

    if (hasPrTrigger && defaultMergeTreeCheckout && usesHeadRefEnv) {
      findings.push({
        code: "MERGE_TREE_VS_HEAD_REF_MISMATCH",
        subject: `${fileLabel}:${jobName}`,
        detail:
          "pull_request job checks out default merge tree (no explicit ref:) while reading GITHUB_HEAD_REF/github.head_ref (subject tree and ref name come from different trees)",
      });
    }
  }
  return findings;
}

export interface ClaimVerificationRecord {
  readonly subject: string;
  readonly claimedSha: string;
  readonly executedSha: string;
  readonly requiredPartitions: readonly string[];
  readonly partitionReports: readonly TestPartitionReport[];
  readonly skippedRequiredPartitions?: readonly string[];
  readonly claimedGuarantee: string;
  readonly fallbackUsed?: boolean;
  readonly proseMirrorClaim?: {
    readonly declaredRelation: string;
    readonly verifiedAgainstTarget: boolean;
  };
}

export function checkClaimHonesty(record: ClaimVerificationRecord): GateFinding[] {
  const findings: GateFinding[] = [];
  if (record.claimedSha !== record.executedSha) {
    findings.push({
      code: "SHA_MISMATCH",
      subject: record.subject,
      detail: `claimed SHA (${record.claimedSha}) does not match executed SHA (${record.executedSha})`,
    });
  }

  for (const skipped of record.skippedRequiredPartitions ?? []) {
    findings.push({
      code: "SKIPPED_REQUIRED_PARTITION",
      subject: `${record.subject}:${skipped}`,
      detail: `required partition '${skipped}' was skipped; cannot count as discharged`,
    });
  }

  const reportByName = new Map(record.partitionReports.map((r) => [r.partition, r] as const));
  for (const required of record.requiredPartitions) {
    const report = reportByName.get(required);
    if (!report) {
      findings.push({
        code: "SKIPPED_REQUIRED_PARTITION",
        subject: `${record.subject}:${required}`,
        detail: `required partition '${required}' produced no execution report`,
      });
      continue;
    }
    const execCheck = checkTestExecution(report);
    if (execCheck.verdict === "FAIL_CLOSED_SAFE") {
      findings.push({
        code: "SKIPPED_REQUIRED_PARTITION",
        subject: `${record.subject}:${required}`,
        detail: `required partition '${required}' failed closed (exit ${report.exitCode}); not verified`,
      });
    } else {
      findings.push(...execCheck.findings);
    }
  }

  if (record.fallbackUsed === true) {
    findings.push({
      code: "FALLBACK_CONTRADICTS_CLAIM",
      subject: record.subject,
      detail: `execution fell back away from claimed guarantee (${record.claimedGuarantee})`,
    });
  }

  if (record.proseMirrorClaim && !record.proseMirrorClaim.verifiedAgainstTarget) {
    findings.push({
      code: "UNVERIFIED_PROSE_MIRROR",
      subject: record.subject,
      detail: `prose/comment invariant '${record.proseMirrorClaim.declaredRelation}' does not match verified target`,
    });
  }

  return findings;
}

function main(argv: readonly string[]): number {
  const mode = argv[0];
  const filePath = argv[1];
  if (!mode || !filePath) {
    console.error("usage: check-gate-honesty.mts <workflow|claim> <file>");
    return 2;
  }
  const content = readFileSync(resolve(filePath), "utf8");
  const findings =
    mode === "workflow"
      ? checkWorkflowHonesty(content, filePath)
      : mode === "claim"
        ? checkClaimHonesty(JSON.parse(content) as ClaimVerificationRecord)
        : null;
  if (findings === null) {
    console.error(`unknown mode: ${mode}`);
    return 2;
  }
  console.log(JSON.stringify({ status: findings.length === 0 ? "PASS" : "FAIL", findings }, null, 2));
  return findings.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
