#!/usr/bin/env node
// CLI entrypoint for the persistent review-finding ledger (Issue #123).
//
// Subcommands:
//   record        Record or re-observe a review finding (auto-creates ledger if missing)
//   fail          Record a GitHub posting failure reason
//   mark-posted   Mark a finding posted with its canonical GitHub URL
//   resolve       Resolve a finding with exact 40-char head SHA + verification command
//   approve-scope Record human owner approval for scope-change-requires-owner-approval
//   plan-retry    Compute retry / dedup / fallback / recurrence decisions
//   summary       Print aggregate counts by status, posting state, recurrence, and repo
//
// Exit codes: 0 success, 1 operational/state/schema error, 2 CLI argument/usage error.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approveScopeChange,
  loadLedger,
  markPosted,
  parseExistingRecordsJson,
  planRetry,
  recordFinding,
  recordPostFailure,
  redactSecrets,
  resolveFinding,
  saveLedger,
  type ActionClass,
  type ExistingGitHubRecord,
  type FailureReason,
  type FindingLedger,
  type ResolutionKind,
  type Severity,
} from "./ledger.mts";

class CliUsageError extends Error {}

const USAGE = `Usage: node scripts/review-findings/cli.mts <subcommand> --ledger <file> [options]

Subcommands:
  record        --ledger <file> --repo <owner/name> --finding-id <id> --file <path> --line <n>
                --sha <40-hex> --severity <P0|P1|P2|P3> --category <cat> --evidence <text>
                [--observed-at <iso>] [--action-class <objective-finding|scope-change-requires-owner-approval>]
                [--symbol <sym>] [--fingerprint <fp>] [--systemic]
  fail          --ledger <file> --repo <owner/name> --finding-id <id>
                --reason <permission|rate-limit|validation|own-pr-request-changes|network>
  mark-posted   --ledger <file> --repo <owner/name> --finding-id <id> --url <https://...>
  resolve       --ledger <file> --repo <owner/name> --finding-id <id> --sha <40-hex>
                --command <cmd> [--verified-at <iso>] [--resolution-kind <fix|false-positive|waived>]
  approve-scope --ledger <file> --repo <owner/name> --finding-id <id>
                --approver <handle> --evidence-url <https://...> [--approved-at <iso>]
  plan-retry    --ledger <file> [--existing <json-file>] [--write]
  summary       --ledger <file>
`;

interface ParsedFlags {
  readonly values: Map<string, string>;
  readonly booleans: Set<string>;
}

const BOOLEAN_FLAGS = new Set(["--systemic", "--write", "--help", "-h"]);

function parseFlags(argv: readonly string[]): ParsedFlags {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      throw new CliUsageError(`unexpected positional argument: ${arg}`);
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
      continue;
    }
    const next = argv[++i];
    if (next === undefined || next.startsWith("--")) {
      throw new CliUsageError(`${arg} requires a value`);
    }
    values.set(arg, next);
  }
  return { values, booleans };
}

function requireFlag(flags: ParsedFlags, name: string): string {
  const value = flags.values.get(name);
  if (value === undefined || value.trim().length === 0) {
    throw new CliUsageError(`missing required option: ${name}`);
  }
  return value;
}

function summarizeLedger(ledger: FindingLedger): Record<string, unknown> {
  const byPostingState: Record<string, number> = { pending: 0, posted: 0, "not-posted": 0 };
  const byVerificationStatus: Record<string, number> = { open: 0, resolved: 0, recurred: 0 };
  const byRecurrenceClass: Record<string, number> = { "one-off": 0, recurring: 0, systemic: 0 };
  const byActionClass: Record<string, number> = {
    "objective-finding": 0,
    "scope-change-requires-owner-approval": 0,
  };
  const byRepository: Record<string, number> = {};

  for (const f of ledger.findings) {
    byPostingState[f.postingState] = (byPostingState[f.postingState] ?? 0) + 1;
    byVerificationStatus[f.verificationStatus] =
      (byVerificationStatus[f.verificationStatus] ?? 0) + 1;
    byRecurrenceClass[f.recurrenceClass] = (byRecurrenceClass[f.recurrenceClass] ?? 0) + 1;
    byActionClass[f.actionClass] = (byActionClass[f.actionClass] ?? 0) + 1;
    byRepository[f.repository] = (byRepository[f.repository] ?? 0) + 1;
  }

  return {
    total: ledger.findings.length,
    byPostingState,
    byVerificationStatus,
    byRecurrenceClass,
    byActionClass,
    byRepository,
  };
}

function parseExistingRecords(filePath: string): readonly ExistingGitHubRecord[] {
  const raw = readFileSync(resolve(filePath), "utf8");
  try {
    return parseExistingRecordsJson(raw);
  } catch (error) {
    throw new CliUsageError(`invalid --existing file (${filePath}): ${(error as Error).message}`);
  }
}

export function runCli(argv: readonly string[]): {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { exitCode: 0, stdout: USAGE, stderr: "" };
  }

  const subcommand = argv[0]!;
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv.slice(1));
    if (flags.booleans.has("--help") || flags.booleans.has("-h")) {
      return { exitCode: 0, stdout: USAGE, stderr: "" };
    }
  } catch (error) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `${(error as Error).message}\n${USAGE}`,
    };
  }

  try {
    const ledgerPath = requireFlag(flags, "--ledger");

    if (subcommand === "record") {
      const lineStr = requireFlag(flags, "--line");
      const line = Number(lineStr);
      if (!Number.isInteger(line) || line <= 0) {
        throw new CliUsageError(`--line must be a positive integer, got: ${lineStr}`);
      }
      const repository = requireFlag(flags, "--repo");
      const findingId = requireFlag(flags, "--finding-id");
      const file = requireFlag(flags, "--file");
      const sourceSha = requireFlag(flags, "--sha");
      const severity = requireFlag(flags, "--severity") as Severity;
      const category = requireFlag(flags, "--category");
      const evidence = requireFlag(flags, "--evidence");
      const observedAt = flags.values.get("--observed-at") ?? new Date().toISOString();
      const actionClass = flags.values.get("--action-class") as ActionClass | undefined;
      const symbol = flags.values.get("--symbol");
      const fingerprint = flags.values.get("--fingerprint");
      const systemic = flags.booleans.has("--systemic");

      const current = loadLedger(ledgerPath, { createIfMissing: true });
      const updated = recordFinding(current, {
        findingId,
        repository,
        file,
        line,
        sourceSha,
        severity,
        category,
        evidence,
        observedAt,
        ...(actionClass ? { actionClass } : {}),
        ...(symbol ? { symbol } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(systemic ? { systemic } : {}),
      });
      saveLedger(ledgerPath, updated);
      const entry = updated.findings.find(
        (f) => f.repository === repository && f.findingId === findingId,
      );
      return {
        exitCode: 0,
        stdout: redactSecrets(`${JSON.stringify({ ok: true, finding: entry }, null, 2)}\n`),
        stderr: "",
      };
    }

    if (subcommand === "fail") {
      const repository = requireFlag(flags, "--repo");
      const findingId = requireFlag(flags, "--finding-id");
      const reason = requireFlag(flags, "--reason") as FailureReason;
      const current = loadLedger(ledgerPath);
      const updated = recordPostFailure(current, { repository, findingId }, reason);
      saveLedger(ledgerPath, updated);
      const entry = updated.findings.find(
        (f) => f.repository === repository && f.findingId === findingId,
      );
      return {
        exitCode: 0,
        stdout: redactSecrets(`${JSON.stringify({ ok: true, finding: entry }, null, 2)}\n`),
        stderr: "",
      };
    }

    if (subcommand === "mark-posted") {
      const repository = requireFlag(flags, "--repo");
      const findingId = requireFlag(flags, "--finding-id");
      const url = requireFlag(flags, "--url");
      const current = loadLedger(ledgerPath);
      const updated = markPosted(current, { repository, findingId }, url);
      saveLedger(ledgerPath, updated);
      const entry = updated.findings.find(
        (f) => f.repository === repository && f.findingId === findingId,
      );
      return {
        exitCode: 0,
        stdout: redactSecrets(`${JSON.stringify({ ok: true, finding: entry }, null, 2)}\n`),
        stderr: "",
      };
    }

    if (subcommand === "resolve") {
      const repository = requireFlag(flags, "--repo");
      const findingId = requireFlag(flags, "--finding-id");
      const sha = requireFlag(flags, "--sha");
      const verificationCommand = requireFlag(flags, "--command");
      const verifiedAt = flags.values.get("--verified-at") ?? new Date().toISOString();
      const resolutionKind = flags.values.get("--resolution-kind") as ResolutionKind | undefined;
      const current = loadLedger(ledgerPath);
      const updated = resolveFinding(
        current,
        { repository, findingId },
        {
          sha,
          verificationCommand,
          verifiedAt,
          ...(resolutionKind ? { resolutionKind } : {}),
        },
      );
      saveLedger(ledgerPath, updated);
      const entry = updated.findings.find(
        (f) => f.repository === repository && f.findingId === findingId,
      );
      return {
        exitCode: 0,
        stdout: redactSecrets(`${JSON.stringify({ ok: true, finding: entry }, null, 2)}\n`),
        stderr: "",
      };
    }

    if (subcommand === "approve-scope") {
      const repository = requireFlag(flags, "--repo");
      const findingId = requireFlag(flags, "--finding-id");
      const approvedBy = requireFlag(flags, "--approver");
      const approvalEvidenceUrl = requireFlag(flags, "--evidence-url");
      const approvedAt = flags.values.get("--approved-at") ?? new Date().toISOString();
      const current = loadLedger(ledgerPath);
      const updated = approveScopeChange(
        current,
        { repository, findingId },
        { approvedBy, approvalEvidenceUrl, approvedAt },
      );
      saveLedger(ledgerPath, updated);
      const entry = updated.findings.find(
        (f) => f.repository === repository && f.findingId === findingId,
      );
      return {
        exitCode: 0,
        stdout: redactSecrets(`${JSON.stringify({ ok: true, finding: entry }, null, 2)}\n`),
        stderr: "",
      };
    }

    if (subcommand === "plan-retry") {
      const current = loadLedger(ledgerPath);
      const existingPath = flags.values.get("--existing");
      const existingRecords = existingPath ? parseExistingRecords(existingPath) : [];
      const planned = planRetry(current, existingRecords);
      if (flags.booleans.has("--write")) {
        saveLedger(ledgerPath, planned.ledger);
      }
      return {
        exitCode: 0,
        stdout: redactSecrets(
          `${JSON.stringify({ ok: true, decisions: planned.decisions }, null, 2)}\n`,
        ),
        stderr: "",
      };
    }

    if (subcommand === "summary") {
      const current = loadLedger(ledgerPath);
      return {
        exitCode: 0,
        stdout: redactSecrets(`${JSON.stringify(summarizeLedger(current), null, 2)}\n`),
        stderr: "",
      };
    }

    throw new CliUsageError(`unknown subcommand: ${subcommand}`);
  } catch (error) {
    if (error instanceof CliUsageError) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: `${redactSecrets(error.message)}\n${USAGE}`,
      };
    }
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${redactSecrets((error as Error).message)}\n`,
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
