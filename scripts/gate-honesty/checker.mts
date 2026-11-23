import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import type {
  ClaimVerificationRecord,
  CssMirrorExpectation,
  CssMirrorInput,
  ExecutionCheckResult,
  GateFinding,
  QueryIndexClaim,
  SchemaIndexInput,
  TestPartitionReport,
} from "./types.mts";
import {
  parseNodeTestTap,
  parseVitestJson,
  type ParseRunnerOptions,
} from "./parsers.mts";
import { verifyCssMirror, verifySchemaIndexes } from "./verifiers.mts";

const VALID_SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;

function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function checkTestExecution(report: TestPartitionReport): ExecutionCheckResult {
  const findings: GateFinding[] = [];
  const subject =
    typeof report.partition === "string" && report.partition.trim().length > 0
      ? report.partition
      : "<unnamed-partition>";

  if (typeof report.partition !== "string" || report.partition.trim().length === 0) {
    findings.push({
      code: "INVALID_REPORT_INVARIANT",
      subject,
      detail: "partition name must be a non-empty string",
    });
  }

  const floor = report.minPassedRequired ?? 1;
  if (typeof floor !== "number" || !Number.isSafeInteger(floor) || floor < 1) {
    findings.push({
      code: "INVALID_FLOOR",
      subject,
      detail: `minPassedRequired floor (${String(floor)}) must be a safe integer >= 1`,
    });
  }

  if (typeof report.exitCode !== "number" || !Number.isSafeInteger(report.exitCode)) {
    findings.push({
      code: "INVALID_REPORT_INVARIANT",
      subject,
      detail: `exitCode (${String(report.exitCode)}) must be a safe integer`,
    });
  }

  if (typeof report.reportedSuccess !== "boolean") {
    findings.push({
      code: "INVALID_REPORT_INVARIANT",
      subject,
      detail: "reportedSuccess must be a boolean",
    });
  }

  const cancelled = report.numCancelledTests ?? 0;
  const countFields: ReadonlyArray<readonly [string, unknown]> = [
    ["numCollectedFiles", report.numCollectedFiles],
    ["numTotalTests", report.numTotalTests],
    ["numPassedTests", report.numPassedTests],
    ["numFailedTests", report.numFailedTests],
    ["numSkippedTests", report.numSkippedTests],
    ["numCancelledTests", cancelled],
  ];

  let countsValid = true;
  for (const [name, value] of countFields) {
    if (!isNonNegativeSafeInt(value)) {
      countsValid = false;
      findings.push({
        code: "INVALID_REPORT_INVARIANT",
        subject,
        detail: `${name} (${String(value)}) must be a non-negative integer`,
      });
    }
  }

  if (countsValid) {
    if (
      report.numCollectedFiles === 0 &&
      (report.numPassedTests > 0 || report.numFailedTests > 0 || report.numTotalTests > 0)
    ) {
      findings.push({
        code: "INVALID_REPORT_INVARIANT",
        subject,
        detail: `impossible count invariant: numCollectedFiles is 0 while tests were reported (total=${report.numTotalTests}, passed=${report.numPassedTests}, failed=${report.numFailedTests})`,
      });
    }

    const sumOutcomes =
      report.numPassedTests + report.numFailedTests + report.numSkippedTests + cancelled;
    if (sumOutcomes > report.numTotalTests) {
      findings.push({
        code: "INVALID_REPORT_INVARIANT",
        subject,
        detail: `impossible count invariant: passed(${report.numPassedTests}) + failed(${report.numFailedTests}) + skipped(${report.numSkippedTests}) + cancelled(${cancelled}) = ${sumOutcomes} exceeds numTotalTests(${report.numTotalTests})`,
      });
    }
  }

  // Invalid floor or impossible report counts always fail closed immediately.
  if (findings.length > 0) {
    return { verdict: "FAIL", findings };
  }

  // Distinguish fail-closed (e.g. u-sekai #78: 0 files collected, exit 1)
  // from silent pass (e.g. ty-plus #179: files collected, 0 tests executed, exit 0).
  if (report.exitCode !== 0) {
    if (report.reportedSuccess) {
      findings.push({
        code: "INCONSISTENT_SUCCESS_EXIT",
        subject,
        detail: `partition reported success=true despite non-zero exit code ${report.exitCode}`,
      });
      return { verdict: "FAIL", findings };
    }
    return { verdict: "FAIL_CLOSED_SAFE", findings: [] };
  }

  // exitCode === 0 from here onward:
  let hardFailure = false;

  if (report.numFailedTests > 0) {
    hardFailure = true;
    findings.push({
      code: "FAILED_TESTS_WITH_ZERO_EXIT",
      subject,
      detail: `partition exited 0 despite ${report.numFailedTests} failed test(s)`,
    });
  }

  if (report.reportedSuccess !== true) {
    hardFailure = true;
    findings.push({
      code: "INCONSISTENT_SUCCESS_EXIT",
      subject,
      detail: "partition exited 0 while reportedSuccess is false",
    });
  }

  const accounted =
    report.numPassedTests + report.numFailedTests + report.numSkippedTests + cancelled;

  if (accounted === 0 && report.numTotalTests === 0) {
    findings.push({
      code: "ZERO_EXECUTED_SILENT_PASS",
      subject,
      detail: "0 tests executed (passed + failed + skipped + cancelled = 0) despite exit 0",
    });
  } else if (
    report.numTotalTests > 0 &&
    report.numPassedTests === 0 &&
    report.numFailedTests === 0
  ) {
    const allSkipped = report.numSkippedTests >= report.numTotalTests;
    findings.push({
      code: allSkipped ? "ALL_SKIPPED_SILENT_PASS" : "ZERO_EXECUTED_SILENT_PASS",
      subject,
      detail: allSkipped
        ? `all ${report.numTotalTests} tests were skipped yet exited 0 (silent pass)`
        : `${report.numTotalTests} tests discovered but 0 executed/passed yet exited 0 (e.g. unmatched -t filter)`,
    });
  } else if (report.numPassedTests < floor) {
    findings.push({
      code: "BELOW_MIN_PASSED_FLOOR",
      subject,
      detail: `passed tests (${report.numPassedTests}) below required floor (${floor}) despite exit 0`,
    });
  }

  if (findings.length === 0) {
    return { verdict: "VERIFIED", findings: [] };
  }
  return {
    verdict: hardFailure ? "FAIL" : "SILENT_PASS_DEFECT",
    findings,
  };
}

export function verifyTapOutput(
  output: string,
  options: ParseRunnerOptions = {},
): ExecutionCheckResult {
  try {
    const report = parseNodeTestTap(output, options);
    return checkTestExecution(report);
  } catch (error) {
    return {
      verdict: "FAIL",
      findings: [
        {
          code: "UNPARSEABLE_TEST_OUTPUT",
          subject: options.partition ?? "node-test",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function verifyVitestJsonOutput(
  output: string,
  options: ParseRunnerOptions = {},
): ExecutionCheckResult {
  try {
    const report = parseVitestJson(output, options);
    return checkTestExecution(report);
  } catch (error) {
    return {
      verdict: "FAIL",
      findings: [
        {
          code: "UNPARSEABLE_TEST_OUTPUT",
          subject: options.partition ?? "vitest",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

interface WorkflowStep {
  readonly name?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly run?: string;
  readonly "continue-on-error"?: unknown;
}

interface WorkflowJob {
  readonly env?: Record<string, unknown>;
  readonly "continue-on-error"?: unknown;
  readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDoc {
  readonly on?: unknown;
  readonly env?: Record<string, unknown>;
  readonly jobs?: Record<string, WorkflowJob>;
}

function triggersPullRequest(onField: unknown): boolean {
  if (typeof onField === "string") {
    return onField === "pull_request" || onField === "pull_request_target";
  }
  if (Array.isArray(onField)) {
    return onField.includes("pull_request") || onField.includes("pull_request_target");
  }
  if (isPlainObject(onField)) {
    return Object.hasOwn(onField, "pull_request") || Object.hasOwn(onField, "pull_request_target");
  }
  return false;
}

function isContinueOnErrorEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string" && /^\$\{\{\s*true\s*\}\}$/i.test(value.trim())) return true;
  return false;
}

/**
 * Strip `# ...` shell comments from a script while respecting single quotes,
 * double quotes, and backslash escapes, so comments mentioning `|| true` or `set +e`
 * never trigger false positives.
 */
export function stripShellComments(script: string): string {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const strippedLines: string[] = [];

  for (const line of lines) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    let out = "";

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i] ?? "";
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\" && !inSingle) {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        out += ch;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        out += ch;
        continue;
      }
      if (ch === "#" && !inSingle && !inDouble) {
        const prev = i === 0 ? "" : (line[i - 1] ?? "");
        if (i === 0 || /[\s;&|(]/.test(prev)) {
          break;
        }
      }
      out += ch;
    }

    strippedLines.push(out);
  }

  return strippedLines.join("\n");
}

const HEAD_REF_EXPR_PATTERN =
  /\bGITHUB_HEAD_REF\b|\bgithub\.head_ref\b|\bgithub\.event\.pull_request\.head\.[A-Za-z0-9_]+\b/;

function envReferencesHeadRef(envField: unknown): boolean {
  if (!isPlainObject(envField)) return false;
  for (const [key, val] of Object.entries(envField)) {
    if (HEAD_REF_EXPR_PATTERN.test(key)) return true;
    if (typeof val === "string" && HEAD_REF_EXPR_PATTERN.test(val)) return true;
  }
  return false;
}

function detectMaskedShellPatterns(cleanRun: string): string[] {
  const reasons: string[] = [];
  if (/\|\|\s*true(?:\s|$|[;&|)])/.test(cleanRun)) {
    reasons.push("masks non-zero exit code with '|| true'");
  }
  if (/\|\|\s*:(?:\s|$|[;&|)])/.test(cleanRun)) {
    reasons.push("masks non-zero exit code with '|| :'");
  }
  if (/\|\|\s*exit\s+0(?:\s|$|[;&|)])/.test(cleanRun)) {
    reasons.push("masks non-zero exit code with '|| exit 0'");
  }
  if (
    /(?:^|[;&|\s])set\s+(?:-[A-Za-z]+\s+)*\+[A-Za-z]*e[A-Za-z]*(?:\s|$|[;&|])/.test(cleanRun) ||
    /(?:^|[;&|\s])set\s+\+o\s+errexit(?:\s|$|[;&|])/.test(cleanRun)
  ) {
    reasons.push("disables errexit via 'set +e' / 'set +o errexit'");
  }
  return reasons;
}

export function checkWorkflowHonesty(yamlText: string, fileLabel = "workflow.yml"): GateFinding[] {
  if (typeof yamlText !== "string" || yamlText.trim().length === 0) {
    return [
      {
        code: "INVALID_WORKFLOW_YAML",
        subject: fileLabel,
        detail: "workflow YAML is empty (fail closed)",
      },
    ];
  }

  const parsedDoc = parseDocument(yamlText);
  if (parsedDoc.errors.length > 0) {
    return [
      {
        code: "INVALID_WORKFLOW_YAML",
        subject: fileLabel,
        detail: `malformed workflow YAML: ${parsedDoc.errors.map((e) => e.message).join("; ")}`,
      },
    ];
  }

  const rawDoc: unknown = parsedDoc.toJSON();
  if (!isPlainObject(rawDoc)) {
    return [
      {
        code: "INVALID_WORKFLOW_YAML",
        subject: fileLabel,
        detail: "workflow YAML root must be a mapping object",
      },
    ];
  }

  const doc = rawDoc as WorkflowDoc;
  if (doc.on === undefined) {
    return [
      {
        code: "INVALID_WORKFLOW_YAML",
        subject: fileLabel,
        detail: "workflow YAML is missing required 'on:' trigger definition",
      },
    ];
  }

  if (!isPlainObject(doc.jobs) || Object.keys(doc.jobs).length === 0) {
    return [
      {
        code: "INVALID_WORKFLOW_YAML",
        subject: fileLabel,
        detail: "workflow YAML defines no jobs",
      },
    ];
  }

  const findings: GateFinding[] = [];
  const hasPrTrigger = triggersPullRequest(doc.on);
  const workflowEnvUsesHeadRef = envReferencesHeadRef(doc.env);

  for (const [jobName, rawJob] of Object.entries(doc.jobs)) {
    if (!isPlainObject(rawJob)) {
      findings.push({
        code: "INVALID_WORKFLOW_YAML",
        subject: `${fileLabel}:${jobName}`,
        detail: "job definition must be a mapping object",
      });
      continue;
    }

    const job = rawJob as WorkflowJob;
    if (isContinueOnErrorEnabled(job["continue-on-error"])) {
      findings.push({
        code: "MASKED_STEP_FAILURE",
        subject: `${fileLabel}:${jobName}`,
        detail: "job sets continue-on-error: true, turning job failure into green workflow status",
      });
    }

    const steps = Array.isArray(job.steps) ? job.steps : [];
    let defaultMergeTreeCheckout = false;
    let baseTreeCheckout = false;
    let usesHeadRef = workflowEnvUsesHeadRef || envReferencesHeadRef(job.env);

    for (const [idx, step] of steps.entries()) {
      if (!isPlainObject(step)) continue;
      const subject = `${fileLabel}:${jobName}[${step.name ?? String(idx)}]`;

      if (envReferencesHeadRef(step.env)) {
        usesHeadRef = true;
      }

      if (typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")) {
        const stepWith = isPlainObject(step.with) ? step.with : undefined;
        const refVal = stepWith?.ref;
        const refStr = refVal === undefined || refVal === null ? "" : String(refVal).trim();
        if (refStr === "") {
          defaultMergeTreeCheckout = true;
        } else if (hasPrTrigger) {
          if (/\$\{\{\s*github\.ref\s*\}\}/.test(refStr)) {
            defaultMergeTreeCheckout = true;
            findings.push({
              code: "MERGE_TREE_VS_HEAD_REF_MISMATCH",
              subject,
              detail:
                "pull_request checkout explicitly uses ref: ${{ github.ref }} (synthetic merge ref) instead of an explicit head SHA",
            });
          } else if (
            /\$\{\{\s*(?:github\.head_ref|github\.event\.pull_request\.head\.ref)\s*\}\}/.test(
              refStr,
            )
          ) {
            findings.push({
              code: "MERGE_TREE_VS_HEAD_REF_MISMATCH",
              subject,
              detail:
                "pull_request checkout uses mutable head.ref instead of immutable github.event.pull_request.head.sha",
            });
          } else if (
            /\$\{\{\s*(?:github\.base_ref|github\.event\.pull_request\.base\.(?:ref|sha))\s*\}\}/.test(
              refStr,
            )
          ) {
            baseTreeCheckout = true;
          }
        }
      }

      if (typeof step.run === "string") {
        const cleanRun = stripShellComments(step.run);
        if (HEAD_REF_EXPR_PATTERN.test(cleanRun)) {
          usesHeadRef = true;
        }
        for (const reason of detectMaskedShellPatterns(cleanRun)) {
          findings.push({
            code: "MASKED_STEP_FAILURE",
            subject,
            detail: `step ${reason}`,
          });
        }
      }

      if (isContinueOnErrorEnabled(step["continue-on-error"])) {
        findings.push({
          code: "MASKED_STEP_FAILURE",
          subject,
          detail: "step sets continue-on-error: true, turning failure into green job status",
        });
      }
    }

    if (hasPrTrigger && (defaultMergeTreeCheckout || baseTreeCheckout) && usesHeadRef) {
      findings.push({
        code: "MERGE_TREE_VS_HEAD_REF_MISMATCH",
        subject: `${fileLabel}:${jobName}`,
        detail:
          "pull_request job checks out default merge/base tree while reading GITHUB_HEAD_REF or github.event.pull_request.head.* (subject tree and head reference come from different trees)",
      });
    }
  }

  return findings;
}

export interface WorkflowsDirCheckResult {
  readonly filesChecked: readonly string[];
  readonly findings: readonly GateFinding[];
}

export function checkWorkflowsDirectory(dirPath: string): WorkflowsDirCheckResult {
  const resolvedDir = resolve(dirPath);
  if (!existsSync(resolvedDir) || !statSync(resolvedDir).isDirectory()) {
    return {
      filesChecked: [],
      findings: [
        {
          code: "INVALID_WORKFLOW_YAML",
          subject: dirPath,
          detail: `workflows directory does not exist or is not a directory: ${dirPath}`,
        },
      ],
    };
  }

  const entries = readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (entries.length === 0) {
    return {
      filesChecked: [],
      findings: [
        {
          code: "INVALID_WORKFLOW_YAML",
          subject: dirPath,
          detail: `workflows directory contains no .yml/.yaml files: ${dirPath}`,
        },
      ],
    };
  }

  const filesChecked: string[] = [];
  const findings: GateFinding[] = [];
  for (const name of entries) {
    const label = join(dirPath, name);
    filesChecked.push(label);
    const content = readFileSync(join(resolvedDir, name), "utf8");
    findings.push(...checkWorkflowHonesty(content, label));
  }

  return { filesChecked, findings };
}

export function checkClaimHonesty(record: ClaimVerificationRecord): GateFinding[] {
  const findings: GateFinding[] = [];

  const claimedShaValid =
    typeof record.claimedSha === "string" && VALID_SHA_PATTERN.test(record.claimedSha);
  const executedShaValid =
    typeof record.executedSha === "string" && VALID_SHA_PATTERN.test(record.executedSha);

  if (!claimedShaValid) {
    findings.push({
      code: "INVALID_SHA",
      subject: record.subject,
      detail: `claimedSha (${String(record.claimedSha)}) must be a 7-40 character hex SHA`,
    });
  }
  if (!executedShaValid) {
    findings.push({
      code: "INVALID_SHA",
      subject: record.subject,
      detail: `executedSha (${String(record.executedSha)}) must be a 7-40 character hex SHA`,
    });
  }
  if (
    claimedShaValid &&
    executedShaValid &&
    record.claimedSha.toLowerCase() !== record.executedSha.toLowerCase()
  ) {
    findings.push({
      code: "SHA_MISMATCH",
      subject: record.subject,
      detail: `claimed SHA (${record.claimedSha}) does not match executed SHA (${record.executedSha})`,
    });
  }

  if (record.requiredPartitions.length === 0) {
    findings.push({
      code: "EMPTY_REQUIRED_PARTITIONS",
      subject: record.subject,
      detail: "requiredPartitions is empty (fail closed: at least one required partition must be verified)",
    });
  }

  for (const skipped of record.skippedRequiredPartitions ?? []) {
    findings.push({
      code: "SKIPPED_REQUIRED_PARTITION",
      subject: `${record.subject}:${skipped}`,
      detail: `required partition '${skipped}' was skipped; cannot count as discharged`,
    });
  }

  // Group all reports by partition name so later duplicates can never silently overwrite earlier failures.
  const reportsByName = new Map<string, TestPartitionReport[]>();
  for (const report of record.partitionReports) {
    const list = reportsByName.get(report.partition);
    if (list) list.push(report);
    else reportsByName.set(report.partition, [report]);

    if (report.sha !== undefined) {
      if (!VALID_SHA_PATTERN.test(report.sha)) {
        findings.push({
          code: "INVALID_SHA",
          subject: `${record.subject}:${report.partition}`,
          detail: `partition sha (${String(report.sha)}) must be a 7-40 character hex SHA`,
        });
      } else if (
        claimedShaValid &&
        report.sha.toLowerCase() !== record.claimedSha.toLowerCase()
      ) {
        findings.push({
          code: "SHA_MISMATCH",
          subject: `${record.subject}:${report.partition}`,
          detail: `partition SHA (${report.sha}) does not match claimed SHA (${record.claimedSha})`,
        });
      }
    }
  }

  for (const [partitionName, reports] of reportsByName.entries()) {
    if (reports.length > 1) {
      findings.push({
        code: "DUPLICATE_PARTITION_REPORT",
        subject: `${record.subject}:${partitionName}`,
        detail: `partition '${partitionName}' reported ${reports.length} times (duplicate reports are rejected to prevent hiding earlier failures)`,
      });
    }
  }

  const seenRequired = new Set<string>();
  for (const required of record.requiredPartitions) {
    if (seenRequired.has(required)) {
      findings.push({
        code: "DUPLICATE_PARTITION_REPORT",
        subject: `${record.subject}:${required}`,
        detail: `requiredPartitions lists '${required}' more than once`,
      });
      continue;
    }
    seenRequired.add(required);

    const reports = reportsByName.get(required);
    if (!reports || reports.length === 0) {
      findings.push({
        code: "SKIPPED_REQUIRED_PARTITION",
        subject: `${record.subject}:${required}`,
        detail: `required partition '${required}' produced no execution report`,
      });
      continue;
    }

    for (const report of reports) {
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
  }

  for (const cssCheck of record.cssMirrorChecks ?? []) {
    findings.push(...verifyCssMirror(cssCheck));
  }

  for (const schemaCheck of record.schemaIndexChecks ?? []) {
    findings.push(...verifySchemaIndexes(schemaCheck));
  }

  return findings;
}

function assertString(val: unknown, path: string, allowEmpty = false): string {
  if (typeof val !== "string" || (!allowEmpty && val.trim().length === 0)) {
    throw new Error(`Invalid field '${path}': expected ${allowEmpty ? "string" : "non-empty string"}`);
  }
  return val;
}

function assertNumber(val: unknown, path: string): number {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new Error(`Invalid field '${path}': expected finite number`);
  }
  return val;
}

function assertBoolean(val: unknown, path: string): boolean {
  if (typeof val !== "boolean") {
    throw new Error(`Invalid field '${path}': expected boolean`);
  }
  return val;
}

function assertStringArray(val: unknown, path: string): string[] {
  if (!Array.isArray(val)) {
    throw new Error(`Invalid field '${path}': expected string[]`);
  }
  return val.map((item, idx) => assertString(item, `${path}[${idx}]`));
}

export function parseCssMirrorInput(raw: unknown, path = "cssMirror"): CssMirrorInput {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid '${path}': expected object`);
  }
  const subject = assertString(raw.subject, `${path}.subject`);
  const cssText = assertString(raw.cssText, `${path}.cssText`, true);
  const sourceCode =
    raw.sourceCode === undefined
      ? undefined
      : assertString(raw.sourceCode, `${path}.sourceCode`, true);

  if (!Array.isArray(raw.expectations)) {
    throw new Error(`Invalid '${path}.expectations': expected array`);
  }

  const expectations: CssMirrorExpectation[] = raw.expectations.map((item, idx) => {
    const itemPath = `${path}.expectations[${idx}]`;
    if (!isPlainObject(item)) throw new Error(`Invalid '${itemPath}': expected object`);
    const constantName = assertString(item.constantName, `${itemPath}.constantName`);
    const selectors = assertStringArray(item.selectors, `${itemPath}.selectors`);
    const expectedProperty =
      item.expectedProperty === undefined
        ? undefined
        : assertString(item.expectedProperty, `${itemPath}.expectedProperty`);
    const expectedValue =
      item.expectedValue === undefined
        ? undefined
        : assertString(item.expectedValue, `${itemPath}.expectedValue`);
    return {
      constantName,
      selectors,
      ...(expectedProperty !== undefined ? { expectedProperty } : {}),
      ...(expectedValue !== undefined ? { expectedValue } : {}),
    };
  });

  return {
    subject,
    cssText,
    expectations,
    ...(sourceCode !== undefined ? { sourceCode } : {}),
  };
}

export function parseSchemaIndexInput(raw: unknown, path = "schemaIndex"): SchemaIndexInput {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid '${path}': expected object`);
  }
  const subject = assertString(raw.subject, `${path}.subject`);
  const sqlDdl =
    raw.sqlDdl === undefined ? undefined : assertString(raw.sqlDdl, `${path}.sqlDdl`, true);

  let dexieSchema: Record<string, string> | undefined;
  if (raw.dexieSchema !== undefined) {
    if (!isPlainObject(raw.dexieSchema)) {
      throw new Error(`Invalid '${path}.dexieSchema': expected Record<string, string>`);
    }
    dexieSchema = {};
    for (const [k, v] of Object.entries(raw.dexieSchema)) {
      dexieSchema[k] = assertString(v, `${path}.dexieSchema.${k}`, true);
    }
  }

  if (!Array.isArray(raw.claims)) {
    throw new Error(`Invalid '${path}.claims': expected array`);
  }

  const claims: QueryIndexClaim[] = raw.claims.map((item, idx) => {
    const itemPath = `${path}.claims[${idx}]`;
    if (!isPlainObject(item)) throw new Error(`Invalid '${itemPath}': expected object`);
    return {
      queryName: assertString(item.queryName, `${itemPath}.queryName`),
      table: assertString(item.table, `${itemPath}.table`),
      columns: assertStringArray(item.columns, `${itemPath}.columns`),
    };
  });

  return {
    subject,
    claims,
    ...(sqlDdl !== undefined ? { sqlDdl } : {}),
    ...(dexieSchema !== undefined ? { dexieSchema } : {}),
  };
}

function parsePartitionReport(raw: unknown, path: string): TestPartitionReport {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid '${path}': expected object`);
  }
  return {
    partition: assertString(raw.partition, `${path}.partition`),
    exitCode: assertNumber(raw.exitCode, `${path}.exitCode`),
    reportedSuccess: assertBoolean(raw.reportedSuccess, `${path}.reportedSuccess`),
    numCollectedFiles: assertNumber(raw.numCollectedFiles, `${path}.numCollectedFiles`),
    numTotalTests: assertNumber(raw.numTotalTests, `${path}.numTotalTests`),
    numPassedTests: assertNumber(raw.numPassedTests, `${path}.numPassedTests`),
    numFailedTests: assertNumber(raw.numFailedTests, `${path}.numFailedTests`),
    numSkippedTests: assertNumber(raw.numSkippedTests, `${path}.numSkippedTests`),
    ...(raw.numCancelledTests !== undefined
      ? { numCancelledTests: assertNumber(raw.numCancelledTests, `${path}.numCancelledTests`) }
      : {}),
    ...(raw.minPassedRequired !== undefined
      ? { minPassedRequired: assertNumber(raw.minPassedRequired, `${path}.minPassedRequired`) }
      : {}),
    ...(raw.sha !== undefined ? { sha: assertString(raw.sha, `${path}.sha`, true) } : {}),
  };
}

export function parseClaimVerificationRecord(raw: unknown): ClaimVerificationRecord {
  if (!isPlainObject(raw)) {
    throw new Error("Invalid claim record: root must be a JSON object");
  }
  const subject = assertString(raw.subject, "subject");
  const claimedSha = assertString(raw.claimedSha, "claimedSha", true);
  const executedSha = assertString(raw.executedSha, "executedSha", true);
  const requiredPartitions = assertStringArray(raw.requiredPartitions, "requiredPartitions");
  const claimedGuarantee = assertString(raw.claimedGuarantee, "claimedGuarantee");

  if (!Array.isArray(raw.partitionReports)) {
    throw new Error("Invalid field 'partitionReports': expected array");
  }
  const partitionReports = raw.partitionReports.map((item, idx) =>
    parsePartitionReport(item, `partitionReports[${idx}]`),
  );

  const skippedRequiredPartitions =
    raw.skippedRequiredPartitions === undefined
      ? undefined
      : assertStringArray(raw.skippedRequiredPartitions, "skippedRequiredPartitions");

  let cssMirrorChecks: CssMirrorInput[] | undefined;
  if (raw.cssMirrorChecks !== undefined) {
    if (!Array.isArray(raw.cssMirrorChecks)) {
      throw new Error("Invalid field 'cssMirrorChecks': expected array");
    }
    cssMirrorChecks = raw.cssMirrorChecks.map((item, idx) =>
      parseCssMirrorInput(item, `cssMirrorChecks[${idx}]`),
    );
  }

  let schemaIndexChecks: SchemaIndexInput[] | undefined;
  if (raw.schemaIndexChecks !== undefined) {
    if (!Array.isArray(raw.schemaIndexChecks)) {
      throw new Error("Invalid field 'schemaIndexChecks': expected array");
    }
    schemaIndexChecks = raw.schemaIndexChecks.map((item, idx) =>
      parseSchemaIndexInput(item, `schemaIndexChecks[${idx}]`),
    );
  }

  return {
    subject,
    claimedSha,
    executedSha,
    requiredPartitions,
    partitionReports,
    claimedGuarantee,
    ...(skippedRequiredPartitions !== undefined ? { skippedRequiredPartitions } : {}),
    ...(cssMirrorChecks !== undefined ? { cssMirrorChecks } : {}),
    ...(schemaIndexChecks !== undefined ? { schemaIndexChecks } : {}),
  };
}
