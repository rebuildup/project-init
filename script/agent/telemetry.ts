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
 * task are computed alongside it), and success is counted strictly:
 * only an attempt that succeeded AND passed verification.
 *
 * Storage contract (ADR-0015 §8: usage ledger → #93, machine-local,
 * non-secret, a cache never a second source of truth):
 *   - Location: an INJECTED ledger directory; `ledgerStateDir()` resolves
 *     the default `<agentStateDir()>/ledger`. Callers (launcher hooks,
 *     tests) always pass the directory explicitly.
 *   - One JSON object per line in `usage.jsonl`, an envelope carrying
 *     `CONTRACT_VERSION`; every record passes the same read-path
 *     validation on write (`parseUsageRecord`), so a bad record cannot
 *     be persisted. Ids (`task`) are restricted to a fixed charset —
 *     no free text, so prompts cannot hide in them.
 *   - No secrets, ever: a record whose redaction (`redact`) differs from
 *     the record itself is REJECTED, not silently rewritten — a
 *     secret-shaped value in `task`, model, nonce or `retry_of` throws
 *     before anything is persisted. There is also no field that could
 *     carry prompt text or raw auth headers (closed whitelist via
 *     `parseEnvelope`).
 *   - Concurrency: writers serialize on a mkdir-based lock directory
 *     (`<dir>/lock`) holding an owner token; release verifies the token
 *     (a stolen lock is never unlinked by its former owner) and a lock
 *     left behind by a forced kill is stolen rename-then-delete once it
 *     is older than `LEDGER_LOCK_STALE_MS`. Each record is appended as a
 *     single line with a single O_APPEND write while the lock is held;
 *     a torn tail (kill during a previous write) is repaired by
 *     prepending the missing newline so the next record is never
 *     swallowed. A duplicate attempt key is rejected, so a retried
 *     append can never double count.
 *   - Reads: lock-free and tolerant — a torn trailing line or corrupt
 *     line is counted in `LedgerRead.corrupt` and skipped, never
 *     silently reinterpreted and never fatal.
 *   - Retention/rotation: `pruneLedger` rewrites the file atomically
 *     (temp file + rename) under the lock, dropping records older than
 *     `maxAgeMs` (default `DEFAULT_RETENTION_MS`) and, when `maxBytes`
 *     is set, oldest-first until the file fits; corrupt lines dropped
 *     by the rewrite are reported (`corrupt_dropped`).
 *   - Summaries never fold missing data into zero: records without
 *     usage/cost are counted (`usage_unknown_records` /
 *     `cost_unknown_records`), never summed as 0.
 *
 * Network-free by contract: local files only, no dependencies.
 */

import { mkdirSync, openSync, closeSync, writeSync, readSync, fstatSync, writeFileSync, readFileSync, renameSync, rmSync, statSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  /** Opaque non-secret task id (fixed charset, no free text). */
  task: string | null;
  outcome: UsageOutcome;
  verification: VerificationOutcome;
  /** Attempt key of the attempt this record retries; null otherwise.
   * Never equal to this record's own attempt key. */
  retry_of: string | null;
  usage: TokenUsage | null;
  cost: UsageCost | null;
  wall_time_ms: number | null;
  tool_calls: number | null;
  /** Retries performed WITHIN this attempt (internal retry loop). */
  retries: number | null;
  /** ISO 8601 UTC, real calendar date. */
  started_at: string;
  /** ISO 8601 UTC; null while the attempt is still running. When set,
   * always >= `started_at`. */
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
  /** Corrupt lines removed by the rewrite (they are never kept). */
  corrupt_dropped: number;
}

/** Cost totals per currency, billed and estimated kept separate. Sums
 * cover only records that CARRY cost; records without cost are counted
 * in `cost_unknown_records`, never folded into these as 0. */
export type CostTotals = Record<string, { billed: number; estimated: number }>;

/** Aggregate efficiency facts over a set of records. */
export interface LedgerSummary {
  records: number;
  /** Distinct non-null task ids. */
  tasks: number;
  outcomes: Record<UsageOutcome, number>;
  verifications: Record<VerificationOutcome, number>;
  /** outcome success AND verification pass. */
  verified_successes: number;
  /** outcome success but verification fail/skipped: unproven success. */
  unverified_successes: number;
  /** Records that are themselves retries of another attempt. */
  retry_observations: number;
  /** successes-with-passing-verification / decided outcomes; null when
   * nothing decided. Unverified successes do NOT count as success. */
  success_rate: number | null;
  /** Sums over records that CARRY usage; records without usage are
   * counted in `usage_unknown_records`, never summed as 0. */
  tokens: {
    prompt: number;
    output: number;
    cache_read: number;
    cache_write: number;
    /** (prompt - cache_read) + output: quota/bill-bearing tokens. */
    effective: number;
  };
  /** Records with `usage: null` (excluded from `tokens`). */
  usage_unknown_records: number;
  /** Records with `cost: null` (excluded from `cost`). */
  cost_unknown_records: number;
  /** cache_read / (prompt + output). Transparency only — never an
   * efficiency proxy; use `tokens.effective` and cost instead. */
  cache_ratio: number | null;
  wall_time_ms: number;
  cost: CostTotals;
  /** Per-task rollup (records with a task id only), sorted by task id. */
  per_task: Array<{
    task: string;
    attempts: number;
    successes: number;
    failures: number;
    effective_tokens: number;
    usage_unknown_records: number;
    cost_unknown_records: number;
    cost: CostTotals;
  }>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Ledger file name inside the ledger directory. */
export const LEDGER_FILE = "usage.jsonl";

/** Lock directory name inside the ledger directory. */
export const LEDGER_LOCK_DIR = "lock";

/** Owner-token file name inside the lock directory. */
export const LEDGER_LOCK_TOKEN = "owner";

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
/** Id charset for `task`: no free text, no whitespace, no separators
 * beyond `. _ : -`, so a prompt cannot hide in an id. Model ids and
 * attempt nonces are already constrained by the contract's own parsers. */
const ID_CHARSET = /^[A-Za-z0-9._:-]{1,128}$/;

function checkIso(value: string, where: string, field: string): number {
  if (!ISO_UTC.test(value)) {
    throw new ContractError("schema", `${where}: '${field}' must be a real ISO 8601 UTC timestamp`);
  }
  const ms = Date.parse(value);
  // Reject rolled-over values (e.g. 2026-02-31, 25:00): the parsed
  // instant must re-decompose to exactly the written Y-M-D h:m:s.
  const d = new Date(ms);
  const parts = [
    [value.slice(0, 4), d.getUTCFullYear()],
    [value.slice(5, 7), d.getUTCMonth() + 1],
    [value.slice(8, 10), d.getUTCDate()],
    [value.slice(11, 13), d.getUTCHours()],
    [value.slice(14, 16), d.getUTCMinutes()],
    [value.slice(17, 19), d.getUTCSeconds()],
  ] as const;
  if (!Number.isFinite(ms) || parts.some(([written, actual]) => Number(written) !== actual)) {
    throw new ContractError("schema", `${where}: '${field}' must be a real ISO 8601 UTC timestamp`);
  }
  return ms;
}

function nonNegInt(value: unknown, where: string, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractError("schema", `${where}: '${field}' must be a non-negative safe integer`);
  }
  return value;
}

function checkId(value: string, where: string, field: string): string {
  if (!ID_CHARSET.test(value)) {
    throw new ContractError("schema", `${where}: '${field}' must match /^[A-Za-z0-9._:-]{1,128}$/`);
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
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > Number.MAX_SAFE_INTEGER
  ) {
    throw new ContractError("schema", `${where}: cost.amount must be a non-negative finite safe number`);
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
 * the closed field whitelist, attempt-key identity rules, id charset and
 * value domains (real ISO dates, `ended_at >= started_at`,
 * `retry_of != own attempt`, safe integers). Unknown fields throw — a
 * typo must not silently drop data.
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
  if (retryOf !== null) {
    parseAttemptKey(retryOf);
    if (retryOf === attemptKey) {
      throw new ContractError("identity", `${where}: retry_of must not equal the record's own attempt`);
    }
  }

  const usageRaw = p["usage"];
  const usage = usageRaw === undefined || usageRaw === null ? null : parseTokenUsage(usageRaw, `${where}.usage`);
  const costRaw = p["cost"];
  const cost = costRaw === undefined || costRaw === null ? null : parseUsageCost(costRaw, `${where}.cost`);

  const startedAt = requireStr(p, "started_at", where);
  const startedMs = checkIso(startedAt, where, "started_at");
  const endedAt = optionalStr(p, "ended_at", where);
  if (endedAt !== null && checkIso(endedAt, where, "ended_at") < startedMs) {
    throw new ContractError("schema", `${where}: ended_at must not precede started_at`);
  }

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

/** True when the lock directory at `lockPath` carries our owner token. */
function lockIsOurs(lockPath: string, token: string): boolean {
  try {
    return readFileSync(join(lockPath, LEDGER_LOCK_TOKEN), "utf8") === token;
  } catch {
    return false; // vanished or unreadable: not provably ours, never touch
  }
}

/**
 * Run `fn` while holding the ledger's lock directory. Writers serialize
 * on `mkdir` (atomic); the owner token proves ownership on release — a
 * former owner never unlinks a lock it does not own — and a lock left by
 * a forced kill is stolen rename-then-delete after `staleMs`, so a
 * concurrent acquirer can never observe a half-removed lock. Throws a
 * `state` ContractError on timeout.
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
  const token = randomUUID() + "\n";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, LEDGER_LOCK_TOKEN), token);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new ContractError("state", `ledger lock unavailable: ${String(err)}`);
      }
      let stolen = false;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          // Rename-then-delete: the steal is atomic for concurrent
          // acquirers, and cleanup of the stale copy cannot race with a
          // fresh owner's token write inside the live lock directory.
          const stalePath = `${lockPath}.stale-${randomUUID()}`;
          renameSync(lockPath, stalePath);
          rmSync(stalePath, { recursive: true, force: true });
          stolen = true;
        }
      } catch {
        // Vanished between mkdir and stat/rename: race with a releaser — retry.
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
    // Verified release only: if the lock was stolen or already removed,
    // its content is not ours and we must not unlink the new owner's lock.
    if (lockIsOurs(lockPath, token)) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

function ledgerPath(dir: string): string {
  return join(dir, LEDGER_FILE);
}

/**
 * One ledger line: the contract envelope, compact — a record is exactly
 * one line, so the JSON must not be pretty-printed. Key order follows
 * the record's own field order (`redact` preserves it).
 */
function ledgerLine(rec: UsageRecord): string {
  return JSON.stringify(redact({ contract_version: CONTRACT_VERSION, ...rec }));
}

/**
 * Append one observation. The record is validated with the read-path
 * parser (fail-closed on write); if redaction would change anything
 * (a secret-shaped value in `task`, model, nonce or `retry_of`) the
 * write THROWS before persisting — the ledger never rewrites data into
 * redacted form. A duplicate attempt key is rejected so a retried
 * append cannot double count. The line is appended under the lock; a
 * torn tail from an earlier killed write is repaired first (missing
 * newline prepended) so the new record is never swallowed.
 */
export function recordUsage(dir: string, record: UsageRecord): void {
  const envelope: Record<string, unknown> = { contract_version: CONTRACT_VERSION, ...record };
  parseUsageRecord(envelope, "recordUsage");
  const redacted = redact(envelope);
  if (JSON.stringify(redacted) !== JSON.stringify(envelope)) {
    throw new ContractError(
      "schema",
      "recordUsage: record contains secret-shaped values; refusing to persist a rewritten record",
    );
  }
  const line = JSON.stringify(redacted) + "\n";
  withLedgerLock(dir, () => {
    const existing = readLedger(dir);
    if (existing.records.some((rec) => rec.attempt === record.attempt)) {
      throw new ContractError("identity", `recordUsage: duplicate attempt key '${record.attempt}'`);
    }
    mkdirSync(dir, { recursive: true });
    const fd = openSync(ledgerPath(dir), "a+");
    try {
      const size = fstatSync(fd).size;
      let prefix = "";
      if (size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) prefix = "\n"; // torn tail: repair before appending
      }
      writeSync(fd, prefix + line);
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
  return Date.parse(rec.ended_at ?? rec.started_at);
}

/**
 * Rewrite the ledger keeping only records observed within `maxAgeMs` of
 * `now` (default `DEFAULT_RETENTION_MS`); when `maxBytes` is set, drop
 * oldest-first until the file fits. Runs under the lock and replaces the
 * file atomically (temp + rename), so readers never see a half-written
 * ledger. Corrupt lines never survive a rewrite; the number dropped is
 * reported as `corrupt_dropped`. Records without any timestamp are
 * treated as oldest.
 */
export function pruneLedger(
  dir: string,
  opts: { now: number; maxAgeMs?: number; maxBytes?: number },
): PruneResult {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_RETENTION_MS;
  const cutoff = opts.now - maxAgeMs;
  return withLedgerLock(dir, () => {
    const path = ledgerPath(dir);
    if (!existsSync(path)) return { kept: 0, dropped: 0, corrupt_dropped: 0 };
    const { records, corrupt } = readLedger(dir);
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
    return { kept: keep.length, dropped: records.length - keep.length, corrupt_dropped: corrupt };
  });
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function addCost(into: CostTotals, rec: UsageRecord): void {
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
 * Aggregate efficiency facts. Success is strict: only an attempt with
 * `outcome: "success"` AND `verification: "pass"` counts; verified vs
 * unverified successes are reported separately. Effective tokens are the
 * non-cache-read tokens actually spent; cache ratio is reported for
 * transparency only — efficiency judgments must use effective tokens and
 * per-basis cost. Records without usage/cost are never summed as 0; they
 * are counted in the respective `*_unknown_records` fields.
 */
export function summarizeLedger(records: UsageRecord[]): LedgerSummary {
  const outcomes: Record<UsageOutcome, number> = { success: 0, failure: 0, killed: 0 };
  const verifications: Record<VerificationOutcome, number> = { pass: 0, fail: 0, skipped: 0 };
  const tokens = { prompt: 0, output: 0, cache_read: 0, cache_write: 0, effective: 0 };
  const cost: CostTotals = {};
  const tasks = new Map<string, {
    attempts: number;
    successes: number;
    failures: number;
    effective: number;
    usageUnknown: number;
    costUnknown: number;
    cost: CostTotals;
  }>();
  let retryObservations = 0;
  let usageUnknown = 0;
  let costUnknown = 0;
  let verifiedSuccesses = 0;
  let unverifiedSuccesses = 0;
  let wallTime = 0;

  for (const rec of records) {
    outcomes[rec.outcome]++;
    verifications[rec.verification]++;
    if (rec.outcome === "success") {
      if (rec.verification === "pass") verifiedSuccesses++;
      else unverifiedSuccesses++;
    }
    if (rec.retry_of !== null) retryObservations++;
    if (rec.usage) {
      tokens.prompt += rec.usage.prompt;
      tokens.output += rec.usage.output;
      tokens.cache_read += rec.usage.cache_read;
      tokens.cache_write += rec.usage.cache_write;
      tokens.effective += effectiveTokens(rec.usage);
    } else {
      usageUnknown++;
    }
    if (!rec.cost) costUnknown++;
    if (rec.wall_time_ms !== null) wallTime += rec.wall_time_ms;
    addCost(cost, rec);
    if (rec.task !== null) {
      const bucket = tasks.get(rec.task) ?? {
        attempts: 0,
        successes: 0,
        failures: 0,
        effective: 0,
        usageUnknown: 0,
        costUnknown: 0,
        cost: {} as CostTotals,
      };
      bucket.attempts++;
      if (rec.outcome === "success") bucket.successes++;
      if (rec.outcome === "failure" || rec.outcome === "killed") bucket.failures++;
      if (rec.usage) bucket.effective += effectiveTokens(rec.usage);
      else bucket.usageUnknown++;
      if (!rec.cost) bucket.costUnknown++;
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
      usage_unknown_records: bucket.usageUnknown,
      cost_unknown_records: bucket.costUnknown,
      cost: bucket.cost,
    }));

  const promptPlusOutput = tokens.prompt + tokens.output;

  return {
    records: records.length,
    tasks: tasks.size,
    outcomes,
    verifications,
    verified_successes: verifiedSuccesses,
    unverified_successes: unverifiedSuccesses,
    retry_observations: retryObservations,
    success_rate: decided === 0 ? null : verifiedSuccesses / decided,
    tokens,
    usage_unknown_records: usageUnknown,
    cost_unknown_records: costUnknown,
    cache_ratio: promptPlusOutput === 0 ? null : tokens.cache_read / promptPlusOutput,
    wall_time_ms: wallTime,
    cost,
    per_task: perTask,
  };
}
