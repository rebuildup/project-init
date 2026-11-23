#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POLICY_REFERENCE = "docs/adr/ADR-0001.md#11-tooling-conventions";

export interface DiffEntry {
  readonly status: string;
  readonly path: string;
  readonly firstLine?: string;
}

export interface PythonException {
  readonly paths: readonly string[];
  readonly adr: string;
  readonly reason: string;
  readonly alternatives: string;
  readonly sunsetCondition: string;
}

export interface Violation {
  readonly code: "NEW_PYTHON_FILE" | "NEW_PYTHON_SHEBANG" | "INVALID_EXCEPTION";
  readonly path: string;
  readonly detail: string;
  readonly policy: string;
}

export interface CheckResult {
  readonly status: "PASS" | "FAIL";
  readonly checkedAddedFiles: number;
  readonly exemptedFiles: readonly string[];
  readonly violations: readonly Violation[];
}

const PYTHON_EXTENSION = /\.py[wi]?$/i;
const PYTHON_SHEBANG =
  /^#!\s*(?:\/usr\/bin\/env\s+(?:-\S+\s+)*python(?:\d+(?:\.\d+)?)?|\/[^\s]*\/python(?:\d+(?:\.\d+)?)?)(?:\s|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasPythonExtension(filePath: string): boolean {
  return PYTHON_EXTENSION.test(filePath);
}

export function hasPythonShebang(firstLine: string | undefined): boolean {
  if (!firstLine) return false;
  return PYTHON_SHEBANG.test(firstLine.trimEnd());
}

export function loadExceptions(
  root: string,
  exceptionsPath: string,
): { exceptions: PythonException[]; errors: Violation[] } {
  const absolute = resolve(root, exceptionsPath);
  if (!existsSync(absolute)) {
    return { exceptions: [], errors: [] };
  }
  const errors: Violation[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  } catch (error) {
    return {
      exceptions: [],
      errors: [
        {
          code: "INVALID_EXCEPTION",
          path: exceptionsPath,
          detail: `malformed exception manifest: ${error instanceof Error ? error.message : String(error)}`,
          policy: POLICY_REFERENCE,
        },
      ],
    };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.exceptions)) {
    return {
      exceptions: [],
      errors: [
        {
          code: "INVALID_EXCEPTION",
          path: exceptionsPath,
          detail: 'exception manifest must contain an "exceptions" array',
          policy: POLICY_REFERENCE,
        },
      ],
    };
  }

  const valid: PythonException[] = [];
  for (const [index, raw] of parsed.exceptions.entries()) {
    const label = `${exceptionsPath}#exceptions[${index}]`;
    if (!isRecord(raw)) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: "exception entry must be an object",
        policy: POLICY_REFERENCE,
      });
      continue;
    }
    const paths = Array.isArray(raw.paths)
      ? raw.paths.filter((p): p is string => nonEmptyString(p))
      : [];
    if (
      paths.length === 0 ||
      paths.length !== (Array.isArray(raw.paths) ? raw.paths.length : -1) ||
      !nonEmptyString(raw.adr) ||
      !nonEmptyString(raw.reason) ||
      !nonEmptyString(raw.alternatives) ||
      !nonEmptyString(raw.sunsetCondition)
    ) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail:
          "exception requires non-empty paths[], adr, reason, alternatives, and sunsetCondition",
        policy: POLICY_REFERENCE,
      });
      continue;
    }
    const adrAbs = resolve(root, raw.adr);
    if (!existsSync(adrAbs) || !statSync(adrAbs).isFile()) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: `approved ADR file not found: ${raw.adr}`,
        policy: POLICY_REFERENCE,
      });
      continue;
    }
    valid.push({
      paths,
      adr: raw.adr,
      reason: raw.reason,
      alternatives: raw.alternatives,
      sunsetCondition: raw.sunsetCondition,
    });
  }
  return { exceptions: valid, errors };
}

export function evaluateAddedFiles(
  entries: readonly DiffEntry[],
  exceptions: readonly PythonException[] = [],
  exceptionErrors: readonly Violation[] = [],
): CheckResult {
  const violations: Violation[] = [...exceptionErrors];
  const exemptedFiles: string[] = [];
  const allowedPaths = new Set<string>();
  for (const ex of exceptions) {
    for (const p of ex.paths) allowedPaths.add(p.replaceAll("\\", "/"));
  }

  let checkedAddedFiles = 0;
  for (const entry of entries) {
    const normalizedStatus = entry.status.trim().toUpperCase();
    // Only newly added files ('A' or copy 'C*') are inspected; edits ('M') to
    // pre-existing Python files are out of scope for ADR-0001 §11.
    if (!normalizedStatus.startsWith("A") && !normalizedStatus.startsWith("C")) {
      continue;
    }
    checkedAddedFiles++;
    const normalizedPath = entry.path.replaceAll("\\", "/");
    const extMatch = hasPythonExtension(normalizedPath);
    const shebangMatch = !extMatch && hasPythonShebang(entry.firstLine);
    if (!extMatch && !shebangMatch) continue;

    if (allowedPaths.has(normalizedPath)) {
      exemptedFiles.push(normalizedPath);
      continue;
    }

    violations.push({
      code: extMatch ? "NEW_PYTHON_FILE" : "NEW_PYTHON_SHEBANG",
      path: normalizedPath,
      detail: extMatch
        ? "newly added Python file violates ADR-0001 §11 (new Python scripts prohibited unless backed by an approved project-local ADR exception)"
        : "newly added file with Python shebang violates ADR-0001 §11 (new Python scripts prohibited unless backed by an approved project-local ADR exception)",
      policy: POLICY_REFERENCE,
    });
  }

  return {
    status: violations.length > 0 ? "FAIL" : "PASS",
    checkedAddedFiles,
    exemptedFiles,
    violations,
  };
}

function readFirstLineFromGit(root: string, ref: string, path: string): string | undefined {
  try {
    const content = execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const idx = content.indexOf("\n");
    return idx === -1 ? content : content.slice(0, idx);
  } catch {
    return undefined;
  }
}

export function collectGitDiffEntries(
  root: string,
  baseRef: string,
  headRef: string,
): DiffEntry[] {
  const output = execFileSync(
    "git",
    ["diff", "--name-status", "--no-renames", `${baseRef}...${headRef}`],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const entries: DiffEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split("\t");
    const status = parts[0] ?? "";
    const filePath = parts[parts.length - 1] ?? "";
    if (!filePath) continue;
    const isAdded = status.startsWith("A") || status.startsWith("C");
    const firstLine =
      isAdded && !hasPythonExtension(filePath)
        ? readFirstLineFromGit(root, headRef, filePath)
        : undefined;
    entries.push({ status, path: filePath, firstLine });
  }
  return entries;
}

interface CliArgs {
  root: string;
  base: string;
  head: string;
  exceptionsPath: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    root: ".",
    base: "HEAD~1",
    head: "HEAD",
    exceptionsPath: ".config/python-exceptions.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--root" && next) {
      args.root = next;
      i++;
    } else if (flag === "--base" && next) {
      args.base = next;
      i++;
    } else if (flag === "--head" && next) {
      args.head = next;
      i++;
    } else if (flag === "--exceptions" && next) {
      args.exceptionsPath = next;
      i++;
    } else {
      throw new Error(`unknown or incomplete argument: ${flag}`);
    }
  }
  return args;
}

function main(argv: readonly string[]): number {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const root = resolve(args.root);
  const { exceptions, errors } = loadExceptions(root, args.exceptionsPath);
  const entries = collectGitDiffEntries(root, args.base, args.head);
  const result = evaluateAddedFiles(entries, exceptions, errors);
  console.log(JSON.stringify(result, null, 2));
  return result.status === "PASS" ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
