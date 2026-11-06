#!/usr/bin/env bun
/**
 * Usage / task-efficiency observation ledger (issue #93, Epic #86 T007).
 *
 * Append-only JSONL ledger of per-attempt usage observations: route,
 * model, task, token usage (prompt/output/cache), cost (billed vs
 * estimated), wall time, tool calls, retries and the verified outcome.
 * It answers "what did a task actually cost in tokens and money and did
 * it succeed" — cache ratio alone is never treated as an efficiency
 * measure (it is reported, but effective non-cache tokens and cost per
 * task are computed alongside it).
 *
 * Storage contract (ADR-0015 §8: usage ledger → #93, machine-local,
 * non-secret, a cache never a second source of truth):
 *   - Location: an INJECTED ledger directory; `ledgerStateDir()` resolves
 *     the default `<agentStateDir()>/ledger`. Callers (launcher hooks,
 *     tests) always pass the directory explicitly.
 *   - One JSON object per line in `usage.jsonl`, an envelope carrying
 *     `CONTRACT_VERSION`; every record passes the same read-path
 *     validation on write (`parseUsageRecord`), so a bad record cannot
 *     be persisted.
 *   - No prompts, no raw auth headers, no personal data: the record
 *     schema is a closed whitelist (`expectFields` via `parseEnvelope`);
 *     there is no field that could carry prompt text or headers, and the
 *     serialized line goes through `redactJson` (contract redaction) so
 *     a secret-shaped value (e.g. an `sk-…` string smuggled into an
 *     opaque id) is replaced with `[redacted]` on disk.
 *   - Concurrency: writers serialize on a mkdir-based lock directory
 *     (`<dir>/lock`); a lock left behind by a forced kill is stolen once
 *     it is older than `LEDGER_LOCK_STALE_MS`. Each record is appended
 *     as a single line with a single O_APPEND write while the lock is
 *     held. Readers take no lock: a torn trailing line (kill during
 *     write) or a corrupt line is counted in `LedgerRead.corrupt` and
 *     skipped, never silently reinterpreted and never fatal.
 *   - Retention/rotation: `pruneLedger` rewrites the file atomically
 *     (temp file + rename) under the lock, dropping records older than
 *     `maxAgeMs` (default `DEFAULT_RETENTION_MS`) and, when `maxBytes`
 *     is set, oldest-first until the file fits.
 *
 * Network-free by contract: local files only, no dependencies.
 */

import { mkdirSync, openSync, closeSync, writeSync, writeFileSync, readFileSync, renameSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  agentStateDir,
  expectFields,
  isPlainObject,
  optionalStr,
  parseAttemptKey,
  parseEnvelope,
  redact,
  requireStr,
  assertSameAttempt,
  type AttemptIdentity,
} from "./contract";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Terminal outcome of one attempt. A forced kill is its own outcome. */
export type UsageOutcome = "success" | "failure" | "killed";

/** Outcome of post-run verification of the attempt's work. */
export type VerificationOutcome = "pass" | "fail" | "skipped";

/** Token counters for one attempt. All four fields are explicit; a
 * provider that does not report a counter records 0, never a guess. */
export interface TokenUsage {
  prompt: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/**
 * Cost of one attempt. `basis: "billed"` is an actually observed charge
 * (provider usage/invoice data); `basis: "estimated"` is derived from
 * catalog prices (provenance `estimated`). The two are never mixed in
 * summaries.
 */
export interface UsageCost {
  amount: number;
  /** ISO 4217 code, uppercase. */
  currency: string;
  basis: "billed" | "estimated";
}

/** One immutable observation. Written once, never updated in place. */
export interface UsageRecord {
  /** Attempt key `<route>#<model>#<machine>#<attempt>` (contract). */
  attempt: string;
  /** Opaque non-secret task id; null for attempts outside a task. */
  task: string | null;
  outcome: UsageOutcome;
  verification: VerificationOutcome;
  /** Attempt key of the attempt this record retries; null otherwise. */
  retry_of: string | null;
  usage: TokenUsage | null;
  cost: UsageCost | null;
  wall_time_ms: number | null;
  tool_calls: number | null;
  /** Retries performed WITHIN this attempt (internal retry loop). */
  retries: number | null;
  /** ISO 8601 UTC. */
  started_at: string;
  /** ISO 8601 UTC; null while the attempt is still running. */
  ended_at: string | null;
}

/** Result of a tolerant ledger read. */
export interface LedgerRead {
  records: UsageRecord[];
  /** Lines that were present but not valid records (torn or corrupt). */
  corrupt: number;
}

/** Result of a retention pass. */
export interface PruneResult {
  kept: number;
  dropped: number;
}

/** Aggregate efficiency facts over a set of records. */
export interface LedgerSummary {
  records: number;
  /** Distinct non-null task ids. */
  tasks: number;
  outcomes: Record<UsageOutcome, number>;
  verifications: Record<VerificationOutcome, number>;
  /** Records that are themselves retries of another attempt. */
  retry_observations: number;
  /** successes / decided outcomes; null when nothing decided. */
  success_rate: number | null;
  tokens: {
    prompt: number;
    output: number;
    cache_read: number;
    cache_write: number;
    /** (prompt - cache_read) + output: quota/bill-bearing tokens. */
    effective: number;
  };
  /** cache_read / (prompt + output). Transparency only — never an
   * efficiency proxy; use `tokens.effective` and cost instead. */
  cache_ratio: number | null;
  wall_time_ms: number;
  /** Per-currency totals, billed and estimated kept separate. */
  cost: Record<string, { billed: number; estimated: number }>;
  /** Per-task rollup (records with a task id only), sorted by task id. */
  per_task: Array<{
    task: string;
    attempts: number;
    successes: number;
    failures: number;
    effective_tokens: number;
    cost: Record<string, { billed: number; estimated: number }>;
  }>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Ledger file name inside the ledger directory. */
export const LEDGER_FILE = "usage.jsonl";

/** Lock directory name inside the ledger directory. */
export const LEDGER_LOCK_DIR = "lock";

/**
 * Default ledger directory: `<agentStateDir()>/ledger` (ADR-0015 §8).
 * Production callers should inject an explicit directory instead; this
 * exists for launcher hooks that have no other configuration.
 */
export function ledgerStateDir(): string {
  return join(agentStateDir(), "ledger");
}

// ---------------------------------------------------------------------------
// Validation (shared by write path and read path)
// ---------------------------------------------------------------------------

const PAYLOAD_FIELDS = [
  "attempt",
  "task",
  "outcome",
  "verification",
  "retry_of",
  "usage",
  "cost",
  "wall_time_ms",
  "tool_calls",
  "retries",
  "started_at",
  "ended_at",
] as const;

const OUTCOMES: Record<UsageOutcome, true> = { success: true, failure: true, killed: true };
const VERIFICATIONS: Record<VerificationOutcome, true> = { pass: true, fail: true, skipped: true };
const COST_BASES: Record<"billed" | "estimated", true> = { billed: true, estimated: true };

/** Same ISO-8601 UTC shape the contract enforces on Evidence timestamps. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_ID_LENGTH = 256;

function checkIso(value: string, where: string, field: string): void {
  if (!ISO_UTC.test(value)) {
    throw new ContractError("schema", `${where}: '${field}' must be an ISO 8601 UTC timestamp`);
  }
}

function nonNegInt(value: unknown, where: string, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ContractError("schema", `${where}: '${field}' must be a non-negative integer`);
  }
  return value;
}

function checkId(value: string, where: string, field: string): string {
  if (value.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ContractError("schema", `${where}: '${field}' must be a short single-line id`);
  }
  return value;
}

function parseTokenUsage(raw: unknown, where: string): TokenUsage {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: usage must be an object`);
  }
  expectFields(raw, ["prompt", "output", "cache_read", "cache_write"], where);
  return {
    prompt: nonNegInt(raw["prompt"], where, "prompt"),
    output: nonNegInt(raw["output"], where, "output"),
    cache_read: nonNegInt(raw["cache_read"], where, "cache_read"),
    cache_write: nonNegInt(raw["cache_write"], where, "cache_write"),
  };
}

function parseUsageCost(raw: unknown, where: string): UsageCost {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: cost must be an object`);
  }
  expectFields(raw, ["amount", "currency", "basis"], where);
  const amount = raw["amount"];
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new ContractError("schema", `${where}: cost.amount must be a non-negative finite number`);
  }
  const currency = requireStr(raw, "currency", where);
  if (!CURRENCY.test(currency)) {
    throw new ContractError("schema", `${where}: cost.currency must be an ISO 4217 code`);
  }
  const basis = requireStr(raw, "basis", where);
  if (!(basis in COST_BASES)) {
    throw new ContractError("schema", `${where}: cost.basis must be 'billed' or 'estimated'`);
  }
  return { amount, currency, basis: basis as "billed" | "estimated" };
}

/**
 * Validate one record from untrusted data (used on the read path AND on
 * the write path, so an invalid record can never be persisted). Enforces
 * the closed field whitelist, attempt-key identity rules and value
 * domains. Unknown fields throw — a typo must not silently drop data.
 */
export function parseUsageRecord(raw: unknown, where: string): UsageRecord {
  const env = parseEnvelope(raw, PAYLOAD_FIELDS, where);
  const p = env.payload;

  const attemptKey = requireStr(p, "attempt", where);
  parseAttemptKey(attemptKey); // identity rules: route/model/machine/nonce

  const outcome = requireStr(p, "outcome", where);
  if (!(outcome in OUTCOMES)) {
    throw new ContractError("schema", `${where}: outcome must be success|failure|killed`);
  }
  const verification = requireStr(p, "verification", where);
  if (!(verification in VERIFICATIONS)) {
    throw new ContractError("schema", `${where}: verification must be pass|fail|skipped`);
  }

  const task = optionalStr(p, "task", where);
  if (task !== null) checkId(task, where, "task");

  const retryOf = optionalStr(p, "retry_of", where);
  if (retryOf !== null) parseAttemptKey(retryOf);

  const usageRaw = p["usage"];
  const usage = usageRaw === undefined || usageRaw === null ? null : parseTokenUsage(usageRaw, `${where}.usage`);
  const costRaw = p["cost"];
  const cost = costRaw === undefined || costRaw === null ? null : parseUsageCost(costRaw, `${where}.cost`);

  const startedAt = requireStr(p, "started_at", where);
  checkIso(startedAt, where, "started_at");
  const endedAt = optionalStr(p, "ended_at", where);
  if (endedAt !== null) checkIso(endedAt, where, "ended_at");

  const wallTime = p["wall_time_ms"];
  const toolCalls = p["tool_calls"];
  const retries = p["retries"];

  return {
    attempt: attemptKey,
    task,
    outcome: outcome as UsageOutcome,
    verification: verification as VerificationOutcome,
    retry_of: retryOf,
    usage,
    cost,
    wall_time_ms: wallTime === undefined || wallTime === null ? null : nonNegInt(wallTime, where, "wall_time_ms"),
    tool_calls: toolCalls === undefined || toolCalls === null ? null : nonNegInt(toolCalls, where, "tool_calls"),
    retries: retries === undefined || retries === null ? null : nonNegInt(retries, where, "retries"),
    started_at: startedAt,
    ended_at: endedAt,
  };
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/** A lock older than this is assumed abandoned (forced kill) and stolen. */
export const LEDGER_LOCK_STALE_MS = 30_000;

/** How long a writer waits for a held lock before failing. */
export const LEDGER_LOCK_TIMEOUT_MS = 10_000;

const LOCK_POLL_MS = 20;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding the ledger's lock directory. Writers serialize
 * on `mkdir` (atomic); a lock left by a forced kill is stolen once it is
 * older than `staleMs`. Throws a `state` ContractError on timeout.
 */
export function withLedgerLock<T>(
  dir: string,
  fn: () => T,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): T {
  const timeoutMs = opts.timeoutMs ?? LEDGER_LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? LEDGER_LOCK_STALE_MS;
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, LEDGER_LOCK_DIR);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new ContractError("state", `ledger lock unavailable: ${String(err)}`);
      }
      let stolen = false;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          rmSync(lockPath, { recursive: true, force: true });
          stolen = true;
        }
      } catch {
        // Vanished between mkdir and stat: race with a releaser — retry.
      }
      if (!stolen && Date.now() >= deadline) {
        throw new ContractError("state", `ledger lock held elsewhere for over ${timeoutMs}ms`);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

function ledgerPath(dir: string): string {
  return join(dir, LEDGER_FILE);
}

/**
 * One ledger line: the contract envelope, secret-redacted (contract
 * `redact`) and compact — a record is exactly one line, so the JSON must
 * not be pretty-printed. Key order stays canonical via `redact`'s
 * contract serialization rules (`redact` preserves `toJson` ordering).
 */
function ledgerLine(rec: UsageRecord): string {
  return JSON.stringify(redact({ contract_version: CONTRACT_VERSION, ...rec }));
}

/**
 * Append one observation. The record is validated with the read-path
 * parser (fail-closed on write), redacted, serialized as a single line
 * and appended under the lock. Never stores prompts, headers or any
 * field outside the whitelist.
 */
export function recordUsage(dir: string, record: UsageRecord): void {
  parseUsageRecord({ contract_version: CONTRACT_VERSION, ...record }, "recordUsage");
  const line = ledgerLine(record) + "\n";
  withLedgerLock(dir, () => {
    mkdirSync(dir, { recursive: true });
    const fd = openSync(ledgerPath(dir), "a");
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read the whole ledger tolerantly. Blank lines are ignored; a line that
 * is not a valid record (torn trailing write from a forced kill, or a
 * corrupt middle line) is counted in `corrupt` and skipped — never
 * silently reinterpreted, never fatal for the rest of the file.
 */
export function readLedger(dir: string): LedgerRead {
  const path = ledgerPath(dir);
  if (!existsSync(path)) return { records: [], corrupt: 0 };
  const text = readFileSync(path, "utf8");
  const records: UsageRecord[] = [];
  let corrupt = 0;
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      records.push(parseUsageRecord(JSON.parse(line), `${LEDGER_FILE}:${i + 1}`));
    } catch {
      corrupt++;
    }
  }
  return { records, corrupt };
}

/**
 * Read the ledger and assert every record belongs to `expected`. A
 * record written under a different attempt identity throws (contract
 * identity guard) instead of being read as this attempt's data.
 */
export function readLedgerFor(dir: string, expected: AttemptIdentity): LedgerRead {
  const read = readLedger(dir);
  for (const record of read.records) {
    assertSameAttempt(expected, parseAttemptKey(record.attempt));
  }
  return read;
}

// ---------------------------------------------------------------------------
// Retention / rotation
// ---------------------------------------------------------------------------

/** Default retention window: 30 days. */
export const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function costOf(rec: UsageRecord): number {
  // Retention ordering key: end of observation, falling back to start.
  const ts = rec.ended_at ?? rec.started_at;
  return Date.parse(ts);
}

/**
 * Rewrite the ledger keeping only records observed within `maxAgeMs` of
 * `now` (default `DEFAULT_RETENTION_MS`); when `maxBytes` is set, drop
 * oldest-first until the file fits. Runs under the lock and replaces the
 * file atomically (temp + rename), so readers never see a half-written
 * ledger. Records without any timestamp are treated as oldest.
 */
export function pruneLedger(
  dir: string,
  opts: { now: number; maxAgeMs?: number; maxBytes?: number },
): PruneResult {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_RETENTION_MS;
  const cutoff = opts.now - maxAgeMs;
  return withLedgerLock(dir, () => {
    const path = ledgerPath(dir);
    if (!existsSync(path)) return { kept: 0, dropped: 0 };
    const { records } = readLedger(dir);
    let keep = records.filter((rec) => costOf(rec) >= cutoff);
    if (opts.maxBytes !== undefined) {
      // Oldest-first drop until the rewritten file fits the budget.
      const ordered = [...keep].sort((a, b) => costOf(a) - costOf(b));
      let bytes = 0;
      const keptRecs: UsageRecord[] = [];
      for (let i = ordered.length - 1; i >= 0; i--) {
        const lineBytes = Buffer.byteLength(ledgerLine(ordered[i]), "utf8") + 1;
        if (bytes + lineBytes > opts.maxBytes && keptRecs.length > 0) break;
        bytes += lineBytes;
        keptRecs.unshift(ordered[i]);
      }
      keep = keptRecs;
    }
    const tmp = path + ".tmp";
    const payload = keep.length === 0 ? "" : keep.map(ledgerLine).join("\n") + "\n";
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, payload);
    renameSync(tmp, path);
    return { kept: keep.length, dropped: records.length - keep.length };
  });
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function addCost(into: Record<string, { billed: number; estimated: number }>, rec: UsageRecord): void {
  if (!rec.cost) return;
  const bucket = into[rec.cost.currency] ?? { billed: 0, estimated: 0 };
  if (rec.cost.basis === "billed") bucket.billed += rec.cost.amount;
  else bucket.estimated += rec.cost.amount;
  into[rec.cost.currency] = bucket;
}

function effectiveTokens(usage: TokenUsage): number {
  return Math.max(0, usage.prompt - usage.cache_read) + usage.output;
}

/**
 * Aggregate efficiency facts. Success rate counts decided outcomes
 * (success vs failure/killed). Effective tokens are the non-cache-read
 * tokens actually spent; cache ratio is reported for transparency only —
 * efficiency judgments must use effective tokens and per-basis cost.
 */
export function summarizeLedger(records: UsageRecord[]): LedgerSummary {
  const outcomes: Record<UsageOutcome, number> = { success: 0, failure: 0, killed: 0 };
  const verifications: Record<VerificationOutcome, number> = { pass: 0, fail: 0, skipped: 0 };
  const tokens = { prompt: 0, output: 0, cache_read: 0, cache_write: 0, effective: 0 };
  const cost: Record<string, { billed: number; estimated: number }> = {};
  const tasks = new Map<string, { attempts: number; successes: number; failures: number; effective: number; cost: Record<string, { billed: number; estimated: number }> }>();
  let retryObservations = 0;
  let wallTime = 0;

  for (const rec of records) {
    outcomes[rec.outcome]++;
    verifications[rec.verification]++;
    if (rec.retry_of !== null) retryObservations++;
    if (rec.usage) {
      tokens.prompt += rec.usage.prompt;
      tokens.output += rec.usage.output;
      tokens.cache_read += rec.usage.cache_read;
      tokens.cache_write += rec.usage.cache_write;
      tokens.effective += effectiveTokens(rec.usage);
    }
    if (rec.wall_time_ms !== null) wallTime += rec.wall_time_ms;
    addCost(cost, rec);
    if (rec.task !== null) {
      const bucket = tasks.get(rec.task) ?? {
        attempts: 0,
        successes: 0,
        failures: 0,
        effective: 0,
        cost: {} as Record<string, { billed: number; estimated: number }>,
      };
      bucket.attempts++;
      if (rec.outcome === "success") bucket.successes++;
      if (rec.outcome === "failure" || rec.outcome === "killed") bucket.failures++;
      if (rec.usage) bucket.effective += effectiveTokens(rec.usage);
      addCost(bucket.cost, rec);
      tasks.set(rec.task, bucket);
    }
  }

  const decided = outcomes.success + outcomes.failure + outcomes.killed;
  const perTask = [...tasks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([task, bucket]) => ({
      task,
      attempts: bucket.attempts,
      successes: bucket.successes,
      failures: bucket.failures,
      effective_tokens: bucket.effective,
      cost: bucket.cost,
    }));

  const promptPlusOutput = tokens.prompt + tokens.output;

  return {
    records: records.length,
    tasks: tasks.size,
    outcomes,
    verifications,
    retry_observations: retryObservations,
    success_rate: decided === 0 ? null : outcomes.success / decided,
    tokens,
    cache_ratio: promptPlusOutput === 0 ? null : tokens.cache_read / promptPlusOutput,
    wall_time_ms: wallTime,
    cost,
    per_task: perTask,
  };
}
