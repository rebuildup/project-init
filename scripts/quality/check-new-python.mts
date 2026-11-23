#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POLICY_REFERENCE = "docs/adr/ADR-0001.md#11-tooling-conventions";

const MAX_SHEBANG_BYTES = 4096;
const MAX_DIFF_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BUFFER_BYTES = 10 * 1024 * 1024;
const HEADER_SCAN_LINES = 40;

export interface DiffEntry {
  readonly status: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly firstLine?: string;
  readonly previousFirstLine?: string;
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

export interface LoadExceptionsOptions {
  readonly ref?: string;
  readonly policy?: string;
}

const PYTHON_EXTENSION = /\.py[wi]?$/i;
const PYTHON_EXECUTABLE = /^(?:pythonw?|pypy)(?:\d+(?:\.\d+)*)?t?$/i;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ENV_FLAGS_WITH_ARG = new Set(["-u", "--unset", "-C", "--chdir", "-P", "-a"]);
const ADR_PATH_PATTERN = /(?:^|\/)(?:docs\/)?adrs?\/.+\.md$/i;
const STATUS_KEY_PATTERN =
  /^(?:[-*+]\s+)?(?:\*\*)?(?:Status|ステータス|状態)(?:\*\*)?\s*[:：]\s*(.+)$/i;
const STATUS_HEADING_PATTERN = /^#{1,3}\s*(?:Status|ステータス|状態)\s*$/i;
const ACCEPTED_STATUS_VALUE =
  /^(?:accepted|approved)\b|^(?:承認(?:済み|済)?|採用(?:済み|済)?)(?:\s|$|[;；。、(\（,:：])/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeRepoRelativePath(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("\0")) return undefined;
  const slashNormalized = trimmed.replaceAll("\\", "/");
  if (slashNormalized.startsWith("/") || /^[a-zA-Z]:/.test(slashNormalized)) {
    return undefined;
  }
  const rawSegments = slashNormalized.split("/");
  if (rawSegments.some((segment) => segment === "..")) {
    return undefined;
  }
  const normalized = posix.normalize(slashNormalized);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    return undefined;
  }
  return normalized;
}

export function isAdrPath(repoRelativePath: string): boolean {
  return ADR_PATH_PATTERN.test(repoRelativePath);
}

function stripMarkdownWrapper(raw: string): string {
  return raw.trim().replace(/^[*_`]+/, "").replace(/[*_`]+$/, "").trim();
}

export function isAcceptedAdrContent(content: string): boolean {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/).slice(0, HEADER_SCAN_LINES);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const inlineMatch = STATUS_KEY_PATTERN.exec(line);
    if (inlineMatch?.[1] !== undefined) {
      return ACCEPTED_STATUS_VALUE.test(stripMarkdownWrapper(inlineMatch[1]));
    }
    if (STATUS_HEADING_PATTERN.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]?.trim() ?? "";
        if (!nextLine) continue;
        if (nextLine.startsWith("#")) return false;
        const cleaned = stripMarkdownWrapper(nextLine.replace(/^[-*+]\s+/, ""));
        return ACCEPTED_STATUS_VALUE.test(cleaned);
      }
      return false;
    }
  }
  return false;
}

export function hasPythonExtension(filePath: string): boolean {
  return PYTHON_EXTENSION.test(filePath);
}

function tokenizeShebangCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += "\\";
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function baseCommandName(token: string): string {
  const normalized = token.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function isPythonExecutableToken(token: string | undefined): boolean {
  if (!token) return false;
  return PYTHON_EXECUTABLE.test(baseCommandName(token));
}

export function hasPythonShebang(firstLine: string | undefined): boolean {
  if (!firstLine) return false;
  const cleaned = firstLine.replace(/^\uFEFF/, "").trimEnd();
  if (!cleaned.startsWith("#!")) return false;
  const command = cleaned.slice(2).trimStart();
  if (!command) return false;

  const tokens = tokenizeShebangCommand(command);
  const interpreter = tokens[0];
  if (!interpreter) return false;
  if (isPythonExecutableToken(interpreter)) return true;

  if (baseCommandName(interpreter).toLowerCase() !== "env") {
    return false;
  }

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--") {
      return isPythonExecutableToken(tokens[i + 1]);
    }
    if (token.startsWith("--split-string=")) {
      const splitTokens = tokenizeShebangCommand(token.slice("--split-string=".length));
      tokens.splice(i + 1, 0, ...splitTokens);
      continue;
    }
    if (token.startsWith("-S") && token.length > 2) {
      const splitTokens = tokenizeShebangCommand(token.slice(2));
      tokens.splice(i + 1, 0, ...splitTokens);
      continue;
    }
    if (token.startsWith("-")) {
      if (ENV_FLAGS_WITH_ARG.has(token)) {
        i++;
      }
      continue;
    }
    if (ENV_ASSIGNMENT.test(token)) {
      continue;
    }
    return isPythonExecutableToken(token);
  }
  return false;
}

type TreeFileLookup =
  | { readonly status: "missing" }
  | { readonly status: "non-regular"; readonly detail: string }
  | { readonly status: "found"; readonly content: string };

function verifyGitTreeRef(root: string, ref: string): void {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readRegularFileFromGitTree(
  root: string,
  ref: string,
  repoRelativePath: string,
): TreeFileLookup {
  const lsOut = execFileSync(
    "git",
    ["-c", "core.quotePath=false", "ls-tree", "-z", ref, "--", repoRelativePath],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_MANIFEST_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (!lsOut) {
    return { status: "missing" };
  }
  const firstEntry = lsOut.split("\0")[0] ?? "";
  const tabIndex = firstEntry.indexOf("\t");
  if (tabIndex === -1) {
    throw new Error(`unexpected git ls-tree output for ${ref}:${repoRelativePath}`);
  }
  const meta = firstEntry.slice(0, tabIndex).split(" ");
  const mode = meta[0] ?? "";
  const objectType = meta[1] ?? "";
  const sha = meta[2] ?? "";
  if (objectType !== "blob" || (mode !== "100644" && mode !== "100755")) {
    return {
      status: "non-regular",
      detail: `expected regular file blob, found mode=${mode} type=${objectType}`,
    };
  }
  const content = execFileSync("git", ["cat-file", "blob", sha], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_MANIFEST_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: "found", content };
}

function readRegularFileFromWorkdir(
  root: string,
  repoRelativePath: string,
): TreeFileLookup {
  const rootAbs = resolve(root);
  const targetAbs = resolve(rootAbs, repoRelativePath);
  const rel = relative(rootAbs, targetAbs);
  if (!rel || rel.startsWith("..") || rel.includes("\0") || rel.startsWith("/")) {
    return { status: "non-regular", detail: "path escapes repository root" };
  }
  if (!existsSync(targetAbs)) {
    return { status: "missing" };
  }
  const stat = lstatSync(targetAbs);
  if (!stat.isFile()) {
    return {
      status: "non-regular",
      detail: stat.isSymbolicLink()
        ? "symlinks are not permitted"
        : "target is not a regular file",
    };
  }
  return { status: "found", content: readFileSync(targetAbs, "utf8") };
}

export function loadExceptions(
  root: string,
  exceptionsPath: string,
  options: LoadExceptionsOptions = {},
): { exceptions: PythonException[]; errors: Violation[] } {
  const policy = options.policy ?? POLICY_REFERENCE;
  const normalizedManifestPath = normalizeRepoRelativePath(exceptionsPath);
  if (!normalizedManifestPath) {
    return {
      exceptions: [],
      errors: [
        {
          code: "INVALID_EXCEPTION",
          path: exceptionsPath,
          detail: "exception manifest path must be a repo-relative path without '..'",
          policy,
        },
      ],
    };
  }

  if (options.ref !== undefined) {
    verifyGitTreeRef(root, options.ref);
  }

  const readFile = (repoRelativePath: string): TreeFileLookup =>
    options.ref !== undefined
      ? readRegularFileFromGitTree(root, options.ref, repoRelativePath)
      : readRegularFileFromWorkdir(root, repoRelativePath);

  const manifestLookup = readFile(normalizedManifestPath);
  if (manifestLookup.status === "missing") {
    return { exceptions: [], errors: [] };
  }
  if (manifestLookup.status === "non-regular") {
    return {
      exceptions: [],
      errors: [
        {
          code: "INVALID_EXCEPTION",
          path: normalizedManifestPath,
          detail: `invalid exception manifest file: ${manifestLookup.detail}`,
          policy,
        },
      ],
    };
  }

  const errors: Violation[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestLookup.content) as unknown;
  } catch (error) {
    return {
      exceptions: [],
      errors: [
        {
          code: "INVALID_EXCEPTION",
          path: normalizedManifestPath,
          detail: `malformed exception manifest: ${error instanceof Error ? error.message : String(error)}`,
          policy,
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
          path: normalizedManifestPath,
          detail: 'exception manifest must contain an "exceptions" array',
          policy,
        },
      ],
    };
  }

  const valid: PythonException[] = [];
  const sourceLabel = options.ref !== undefined ? ` at ${options.ref}` : "";
  for (const [index, raw] of parsed.exceptions.entries()) {
    const label = `${normalizedManifestPath}#exceptions[${index}]`;
    if (!isRecord(raw)) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: "exception entry must be an object",
        policy,
      });
      continue;
    }
    const rawPaths = Array.isArray(raw.paths) ? raw.paths : [];
    const normalizedPaths: string[] = [];
    let invalidPathFound = false;
    for (const p of rawPaths) {
      if (!nonEmptyString(p)) {
        invalidPathFound = true;
        break;
      }
      const norm = normalizeRepoRelativePath(p);
      if (!norm) {
        invalidPathFound = true;
        break;
      }
      normalizedPaths.push(norm);
    }
    if (
      normalizedPaths.length === 0 ||
      invalidPathFound ||
      !nonEmptyString(raw.adr) ||
      !nonEmptyString(raw.reason) ||
      !nonEmptyString(raw.alternatives) ||
      !nonEmptyString(raw.sunsetCondition)
    ) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail:
          "exception requires valid repo-relative paths[], adr, reason, alternatives, and sunsetCondition",
        policy,
      });
      continue;
    }

    const normalizedAdr = normalizeRepoRelativePath(raw.adr);
    if (!normalizedAdr || !isAdrPath(normalizedAdr)) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: `adr must be a repo-relative Markdown file under an ADR directory (e.g. docs/adr/*.md): ${raw.adr}`,
        policy,
      });
      continue;
    }

    const adrLookup = readFile(normalizedAdr);
    if (adrLookup.status === "missing") {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: `approved ADR file not found${sourceLabel}: ${normalizedAdr}`,
        policy,
      });
      continue;
    }
    if (adrLookup.status === "non-regular") {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: `approved ADR file is not a regular file${sourceLabel}: ${normalizedAdr} (${adrLookup.detail})`,
        policy,
      });
      continue;
    }
    if (!isAcceptedAdrContent(adrLookup.content)) {
      errors.push({
        code: "INVALID_EXCEPTION",
        path: label,
        detail: `ADR must declare an Accepted/Approved status (e.g. "Status: Accepted")${sourceLabel}: ${normalizedAdr}`,
        policy,
      });
      continue;
    }

    valid.push({
      paths: normalizedPaths,
      adr: normalizedAdr,
      reason: raw.reason,
      alternatives: raw.alternatives,
      sunsetCondition: raw.sunsetCondition,
    });
  }
  return { exceptions: valid, errors };
}

function isExistingPythonRename(entry: DiffEntry, normalizedStatus: string): boolean {
  if (!normalizedStatus.startsWith("R")) return false;
  if (!entry.previousPath) return false;
  return (
    hasPythonExtension(entry.previousPath.replaceAll("\\", "/")) ||
    hasPythonShebang(entry.previousFirstLine)
  );
}

export function evaluateAddedFiles(
  entries: readonly DiffEntry[],
  exceptions: readonly PythonException[] = [],
  exceptionErrors: readonly Violation[] = [],
  policy: string = POLICY_REFERENCE,
): CheckResult {
  const violations: Violation[] = [...exceptionErrors];
  const exemptedFiles: string[] = [];
  const allowedPaths = new Set<string>();
  for (const ex of exceptions) {
    for (const p of ex.paths) {
      const normalized = normalizeRepoRelativePath(p) ?? p.replaceAll("\\", "/");
      allowedPaths.add(normalized);
    }
  }

  let checkedAddedFiles = 0;
  for (const entry of entries) {
    const normalizedStatus = entry.status.trim().toUpperCase();
    const isAddedOrCopied =
      normalizedStatus.startsWith("A") || normalizedStatus.startsWith("C");
    const isRename = normalizedStatus.startsWith("R");

    // Only newly added ('A'), copied ('C*'), or renamed-into-Python ('R*' from
    // non-Python) files are inspected; edits ('M') and Python->Python renames
    // of pre-existing Python files are out of scope for ADR-0001 §11.
    if (!isAddedOrCopied && !isRename) {
      continue;
    }
    if (isRename && isExistingPythonRename(entry, normalizedStatus)) {
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
      policy,
    });
  }

  return {
    status: violations.length > 0 ? "FAIL" : "PASS",
    checkedAddedFiles,
    exemptedFiles,
    violations,
  };
}

export function readFirstLineFromGitObject(
  root: string,
  objectSpec: string,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["cat-file", "blob", objectSpec], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let collected = 0;
    let stoppedEarly = false;
    let settled = false;
    let stderr = "";

    const finish = (err: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      if (err) rejectPromise(err);
      else resolvePromise(value ?? "");
    };

    const stopChild = () => {
      if (stoppedEarly) return;
      stoppedEarly = true;
      child.stdout.destroy();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    };

    child.stdout.on("error", (err) => {
      if (!stoppedEarly) {
        finish(new Error(`failed reading git blob ${objectSpec}: ${err.message}`));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) {
        stderr += chunk.toString("utf8");
      }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stoppedEarly) return;
      const remaining = MAX_SHEBANG_BYTES - collected;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      const newlineIndex = slice.indexOf(0x0a);
      if (newlineIndex !== -1) {
        chunks.push(slice.subarray(0, newlineIndex));
        collected += newlineIndex;
        stopChild();
        return;
      }
      chunks.push(slice);
      collected += slice.length;
      if (collected >= MAX_SHEBANG_BYTES) {
        stopChild();
      }
    });

    child.on("error", (err) => {
      finish(new Error(`failed to spawn git cat-file for ${objectSpec}: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      if (stoppedEarly) {
        const line = Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
        finish(null, line);
        return;
      }
      if (code !== 0 || signal !== null) {
        const detail =
          stderr.trim() || `exit code ${String(code)} signal ${String(signal)}`;
        finish(new Error(`git cat-file blob ${objectSpec} failed: ${detail}`));
        return;
      }
      const line = Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
      finish(null, line);
    });
  });
}

function isRegularFileMode(mode: string): boolean {
  return mode === "100644" || mode === "100755";
}

interface RawDiffRecord {
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldSha: string;
  readonly newSha: string;
  readonly status: string;
  readonly path: string;
  readonly previousPath?: string;
}

export function parseRawDiffOutput(rawOutput: string): RawDiffRecord[] {
  const tokens = rawOutput.split("\0");
  const records: RawDiffRecord[] = [];
  let i = 0;
  while (i < tokens.length) {
    const header = tokens[i];
    if (!header) {
      i++;
      continue;
    }
    if (!header.startsWith(":")) {
      throw new Error(`unexpected git diff --raw record header: ${header}`);
    }
    const fields = header.slice(1).split(" ");
    if (fields.length < 5) {
      throw new Error(`malformed git diff --raw header: ${header}`);
    }
    const [oldMode, newMode, oldSha, newSha, status] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    const upperStatus = status.toUpperCase();
    if (upperStatus.startsWith("R") || upperStatus.startsWith("C")) {
      const previousPath = tokens[i + 1];
      const nextPath = tokens[i + 2];
      if (previousPath === undefined || nextPath === undefined) {
        throw new Error(`incomplete rename/copy record in git diff --raw for ${status}`);
      }
      records.push({
        oldMode,
        newMode,
        oldSha,
        newSha,
        status,
        path: nextPath,
        previousPath,
      });
      i += 3;
    } else {
      const filePath = tokens[i + 1];
      if (filePath === undefined) {
        throw new Error(`incomplete record in git diff --raw for ${status}`);
      }
      records.push({
        oldMode,
        newMode,
        oldSha,
        newSha,
        status,
        path: filePath,
      });
      i += 2;
    }
  }
  return records;
}

export async function collectGitDiffEntries(
  root: string,
  baseRef: string,
  headRef: string,
): Promise<DiffEntry[]> {
  const output = execFileSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "-z",
      "-M",
      "--raw",
      "--no-abbrev",
      `${baseRef}...${headRef}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_DIFF_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const rawRecords = parseRawDiffOutput(output);
  const entries: DiffEntry[] = [];

  for (const record of rawRecords) {
    const upperStatus = record.status.toUpperCase();
    const isAddedOrCopied = upperStatus.startsWith("A") || upperStatus.startsWith("C");
    const isRename = upperStatus.startsWith("R");

    let firstLine: string | undefined;
    if (
      (isAddedOrCopied || isRename) &&
      !hasPythonExtension(record.path) &&
      isRegularFileMode(record.newMode)
    ) {
      firstLine = await readFirstLineFromGitObject(root, record.newSha);
    }

    let previousFirstLine: string | undefined;
    if (
      isRename &&
      record.previousPath !== undefined &&
      !hasPythonExtension(record.previousPath) &&
      (hasPythonExtension(record.path) || hasPythonShebang(firstLine)) &&
      isRegularFileMode(record.oldMode)
    ) {
      previousFirstLine = await readFirstLineFromGitObject(root, record.oldSha);
    }

    entries.push({
      status: record.status,
      path: record.path,
      previousPath: record.previousPath,
      firstLine,
      previousFirstLine,
    });
  }
  return entries;
}

interface CliArgs {
  root: string;
  base: string;
  head: string;
  exceptionsPath: string;
  policy: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    root: ".",
    base: "HEAD~1",
    head: "HEAD",
    exceptionsPath: ".config/python-exceptions.json",
    policy: POLICY_REFERENCE,
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
    } else if (flag === "--policy" && next) {
      args.policy = next;
      i++;
    } else {
      throw new Error(`unknown or incomplete argument: ${flag}`);
    }
  }
  return args;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const root = resolve(args.root);
  try {
    const { exceptions, errors } = loadExceptions(root, args.exceptionsPath, {
      ref: args.head,
      policy: args.policy,
    });
    const entries = await collectGitDiffEntries(root, args.base, args.head);
    const result = evaluateAddedFiles(entries, exceptions, errors, args.policy);
    console.log(JSON.stringify(result, null, 2));
    return result.status === "PASS" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
