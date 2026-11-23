import type { TestPartitionReport } from "./types.mts";

export interface ParseRunnerOptions {
  readonly partition?: string;
  readonly exitCode?: number;
  readonly minPassedRequired?: number;
  readonly sha?: string;
}

function parseNonNegativeInt(raw: unknown, fieldName: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(`Invalid Vitest JSON field '${fieldName}': expected non-negative integer`);
  }
  return raw;
}

/**
 * Parse `node --test --test-reporter=tap` output into a TestPartitionReport.
 * Fails closed (throws) when output is empty or missing required TAP summary metrics.
 */
export function parseNodeTestTap(
  output: string,
  options: ParseRunnerOptions = {},
): TestPartitionReport {
  if (typeof output !== "string" || output.trim().length === 0) {
    throw new Error("Empty TAP output: cannot verify test execution");
  }

  const lines = output.replace(/\r\n/g, "\n").split("\n");

  // Anchor to the final top-level TAP plan (`1..N`) when present so stdout inside tests
  // cannot spoof summary counts. If no plan is present, only accept a contiguous summary
  // block at the end of output.
  let planIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^1\.\.\d+$/.test(lines[i] ?? "")) {
      planIndex = i;
      break;
    }
  }

  const summaryLines: string[] = [];
  if (planIndex >= 0) {
    for (let i = planIndex + 1; i < lines.length; i += 1) {
      summaryLines.push(lines[i] ?? "");
    }
  } else {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "") {
        if (summaryLines.length === 0) continue;
        break;
      }
      if (/^#\s+[a-z_]+\s+[0-9.]+$/.test(line)) {
        summaryLines.unshift(line);
      } else {
        break;
      }
    }
  }

  const metrics = new Map<string, number>();
  for (const line of summaryLines) {
    const match = /^#\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)$/.exec(line);
    if (match) {
      const key = match[1];
      const value = Number.parseInt(match[2] ?? "", 10);
      if (key && Number.isSafeInteger(value) && value >= 0) {
        metrics.set(key, value);
      }
    }
  }

  const tests = metrics.get("tests");
  const pass = metrics.get("pass");
  const fail = metrics.get("fail");
  if (tests === undefined || pass === undefined || fail === undefined) {
    throw new Error(
      "Malformed TAP output: missing required summary lines (# tests, # pass, # fail)",
    );
  }

  const skipped = metrics.get("skipped") ?? 0;
  const cancelled = metrics.get("cancelled") ?? 0;
  const suites = metrics.get("suites") ?? 0;
  const reportedSuccess = fail === 0 && cancelled === 0;
  const exitCode = options.exitCode ?? (reportedSuccess ? 0 : 1);

  return {
    partition: options.partition ?? "node-test",
    exitCode,
    reportedSuccess,
    numCollectedFiles: tests > 0 ? Math.max(1, suites) : 0,
    numTotalTests: tests,
    numPassedTests: pass,
    numFailedTests: fail,
    numSkippedTests: skipped,
    numCancelledTests: cancelled,
    ...(options.minPassedRequired !== undefined
      ? { minPassedRequired: options.minPassedRequired }
      : {}),
    ...(options.sha !== undefined ? { sha: options.sha } : {}),
  };
}

/**
 * Parse Vitest JSON reporter output (`vitest run --reporter=json`) into a TestPartitionReport.
 * Fails closed (throws) when output is empty, non-JSON, or missing required fields.
 */
export function parseVitestJson(
  output: string,
  options: ParseRunnerOptions = {},
): TestPartitionReport {
  if (typeof output !== "string" || output.trim().length === 0) {
    throw new Error("Empty Vitest JSON output: cannot verify test execution");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Malformed Vitest JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Vitest JSON output: root must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.success !== "boolean") {
    throw new Error("Invalid Vitest JSON field 'success': expected boolean");
  }

  const numTotalTestSuites = parseNonNegativeInt(obj.numTotalTestSuites, "numTotalTestSuites");
  const numTotalTests = parseNonNegativeInt(obj.numTotalTests, "numTotalTests");
  const numPassedTests = parseNonNegativeInt(obj.numPassedTests, "numPassedTests");
  const numFailedTests = parseNonNegativeInt(obj.numFailedTests, "numFailedTests");
  const numPendingTests = parseNonNegativeInt(obj.numPendingTests, "numPendingTests");
  const numTodoTests =
    obj.numTodoTests === undefined
      ? 0
      : parseNonNegativeInt(obj.numTodoTests, "numTodoTests");

  const collectedFiles = Array.isArray(obj.testResults)
    ? obj.testResults.length
    : numTotalTestSuites;

  const exitCode = options.exitCode ?? (obj.success ? 0 : 1);

  return {
    partition: options.partition ?? "vitest",
    exitCode,
    reportedSuccess: obj.success,
    numCollectedFiles: collectedFiles,
    numTotalTests,
    numPassedTests,
    numFailedTests,
    numSkippedTests: numPendingTests + numTodoTests,
    ...(options.minPassedRequired !== undefined
      ? { minPassedRequired: options.minPassedRequired }
      : {}),
    ...(options.sha !== undefined ? { sha: options.sha } : {}),
  };
}
