/**
 * Tests for script/agent/telemetry.ts (issue #93, Epic #86 T007).
 *
 * REAL tests, no mocks: every test exercises the actual module against a
 * real machine-local temp directory (mkdtemp) and real files; the
 * concurrency test spawns real `bun` child processes writing the same
 * ledger simultaneously. There are no stubs, fakes or network calls.
 * Rejection and redaction tests assert on the actual bytes on disk.
 *
 * Run: bun test script/agent.telemetry.test.ts
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, utimesSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  type AttemptIdentity,
} from "./agent/contract";
import {
  DEFAULT_RETENTION_MS,
  LEDGER_FILE,
  LEDGER_LOCK_DIR,
  LEDGER_LOCK_STALE_MS,
  ledgerStateDir,
  parseUsageRecord,
  pruneLedger,
  readLedger,
  readLedgerFor,
  recordUsage,
  summarizeLedger,
  withLedgerLock,
  type UsageRecord,
} from "./agent/telemetry";

const REPO = join(import.meta.dir);
const MODULE_PATH = join(REPO, "agent", "telemetry.ts");
const T0 = "2026-11-01T00:00:00Z";
const DAY = 24 * 60 * 60 * 1000;

const IDENTITY: AttemptIdentity = {
  route: "claude.mimo",
  model: "mimo-v2",
  machine: "test-box",
  attempt: "nonce-1",
};
const ATTEMPT_KEY = "claude.mimo#mimo-v2#test-box#nonce-1";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "agent-telemetry-test-"));
afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

function newLedgerDir(name: string): string {
  const dir = join(TMP_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Valid baseline record; tests override individual fields. */
function rec(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    attempt: ATTEMPT_KEY,
    task: "task-1",
    outcome: "success",
    verification: "pass",
    retry_of: null,
    usage: { prompt: 100, output: 50, cache_read: 20, cache_write: 10 },
    cost: { amount: 0.5, currency: "USD", basis: "billed" },
    wall_time_ms: 1000,
    tool_calls: 2,
    retries: 0,
    started_at: T0,
    ended_at: "2026-11-01T00:00:05Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Record + read roundtrip: distinct observations preserved
// ---------------------------------------------------------------------------

describe("record/read roundtrip", () => {
  test("keeps success, failure, retry and verification observations distinct", () => {
    const dir = newLedgerDir("roundtrip");
    recordUsage(dir, rec());
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "nonce-2"), outcome: "failure", verification: "fail" }));
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "nonce-3"), outcome: "failure", verification: "skipped", retry_of: ATTEMPT_KEY }));
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "nonce-4"), task: null, outcome: "killed", ended_at: null }));

    const read = readLedger(dir);
    expect(read.corrupt).toBe(0);
    expect(read.records).toHaveLength(4);
    expect(read.records.map((r) => r.outcome)).toEqual(["success", "failure", "failure", "killed"]);
    expect(read.records.map((r) => r.verification)).toEqual(["pass", "fail", "skipped", "pass"]);
    expect(read.records[2].retry_of).toBe(ATTEMPT_KEY);
    expect(read.records[0].usage).toEqual({ prompt: 100, output: 50, cache_read: 20, cache_write: 10 });
    expect(read.records[3].task).toBeNull();
    expect(read.records[3].ended_at).toBeNull();
  });

  test("readLedger on a missing directory is empty", () => {
    expect(readLedger(join(TMP_ROOT, "does-not-exist"))).toEqual({ records: [], corrupt: 0 });
  });

  test("readLedgerFor rejects records from a foreign attempt identity", () => {
    const dir = newLedgerDir("identity");
    recordUsage(dir, rec());
    expect(() =>
      readLedgerFor(dir, { ...IDENTITY, attempt: "nonce-OTHER" }),
    ).toThrow(ContractError);
    const read = readLedgerFor(dir, IDENTITY);
    expect(read.records).toHaveLength(1);
  });

  test("ledgerStateDir follows the injected AGENT_STATE_DIR", () => {
    const prev = process.env.AGENT_STATE_DIR;
    try {
      process.env.AGENT_STATE_DIR = "/tmp/agent-state-telemetry-test";
      expect(ledgerStateDir()).toBe("/tmp/agent-state-telemetry-test/ledger");
    } finally {
      if (prev === undefined) delete process.env.AGENT_STATE_DIR;
      else process.env.AGENT_STATE_DIR = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Write-path validation (fail-closed)
// ---------------------------------------------------------------------------

describe("write-path validation", () => {
  test("rejects unknown fields, bad enums, negative counters and bad identities", () => {
    const dir = newLedgerDir("validation");
    const bad: Array<Record<string, unknown>> = [
      { ...rec(), prompt_text: "never stored" },
      { ...rec(), outcome: "maybe" },
      { ...rec(), verification: "unknown" },
      { ...rec(), cost: { ...rec().cost!, basis: "guessed" } },
      { ...rec(), cost: { ...rec().cost!, currency: "usd" } },
      { ...rec(), usage: { ...rec().usage!, prompt: -1 } },
      { ...rec(), usage: { ...rec().usage!, prompt: 2 ** 53 } },
      { ...rec(), wall_time_ms: 1.5 },
      { ...rec(), attempt: "claude.mimo#mimo-v2#test-box#has # inside" },
      { ...rec(), retry_of: "not-an-attempt-key" },
      { ...rec(), started_at: "2026-11-01 00:00:00" },
    ];
    for (const record of bad) {
      expect(() => recordUsage(dir, record as UsageRecord)).toThrow(ContractError);
    }
    expect(existsSync(join(dir, LEDGER_FILE))).toBeFalse();
  });

  test("rejects non-real calendar dates and ended_at before started_at", () => {
    const dir = newLedgerDir("dates");
    expect(() => recordUsage(dir, rec({ started_at: "2026-02-31T00:00:00Z" }))).toThrow(ContractError);
    expect(() =>
      recordUsage(dir, rec({ started_at: "2026-11-02T00:00:00Z", ended_at: "2026-11-01T00:00:00Z" })),
    ).toThrow(ContractError);
    expect(existsSync(join(dir, LEDGER_FILE))).toBeFalse();
  });

  test("rejects retry_of equal to the record's own attempt", () => {
    const dir = newLedgerDir("self-retry");
    expect(() => recordUsage(dir, rec({ retry_of: ATTEMPT_KEY }))).toThrow(ContractError);
    expect(existsSync(join(dir, LEDGER_FILE))).toBeFalse();
  });

  test("rejects ids outside the fixed charset (no free text, no prompts)", () => {
    const dir = newLedgerDir("id-charset");
    for (const task of ["has space", "slash/ed", "日本語", "semi;colon", "x".repeat(129), ""]) {
      expect(() => recordUsage(dir, rec({ task }))).toThrow(ContractError);
    }
    expect(existsSync(join(dir, LEDGER_FILE))).toBeFalse();
  });

  test("rejects records that redaction would rewrite (secret-shaped values), never persists", () => {
    const dir = newLedgerDir("redaction-refusal");
    // Secret-shaped task id (sk-… value shape).
    expect(() => recordUsage(dir, rec({ task: "sk-abc123def456ghi" }))).toThrow(ContractError);
    // Secret-shaped attempt nonce: passes the contract's nonce rules but
    // is value-shaped like a credential — must be refused, not rewritten.
    expect(() =>
      recordUsage(dir, rec({ attempt: "claude.mimo#mimo-v2#test-box#sk-abc123def456" })),
    ).toThrow(ContractError);
    expect(existsSync(join(dir, LEDGER_FILE))).toBeFalse();
    expect(readLedger(dir).records).toHaveLength(0);
  });

  test("parseUsageRecord rejects unknown fields on the read path", () => {
    const forged = { contract_version: CONTRACT_VERSION, ...rec(), extra: 1 };
    expect(() => parseUsageRecord(forged, "test")).toThrow(ContractError);
  });
});

// ---------------------------------------------------------------------------
// Duplicate attempt keys: a retried append must not double count
// ---------------------------------------------------------------------------

describe("duplicate attempt keys", () => {
  test("a second append with the same attempt key is rejected", () => {
    const dir = newLedgerDir("duplicate");
    recordUsage(dir, rec());
    expect(() => recordUsage(dir, rec())).toThrow(ContractError);
    const read = readLedger(dir);
    expect(read.records).toHaveLength(1);
    expect(read.corrupt).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrent writers: real child processes, one shared ledger
// ---------------------------------------------------------------------------

describe("concurrent writers (real processes)", () => {
  test("8 simultaneous writers x 20 records all land intact", async () => {
    const dir = newLedgerDir("concurrent");
    const writerSrc = `
      // The module path is passed per-process (argv) so every spawned
      // writer imports the same telemetry module from its absolute
      // location; a static specifier cannot express that here.
      const mod = await import(process.argv[2]);
      const dir = process.argv[3];
      const count = Number(process.argv[4]);
      const writer = process.argv[5];
      for (let i = 0; i < count; i++) {
        mod.recordUsage(dir, {
          attempt: "claude.mimo#mimo-v2#box#w" + writer + "n" + i,
          task: "t-" + (i % 3),
          outcome: i % 2 === 0 ? "success" : "failure",
          verification: "pass",
          retry_of: null,
          usage: { prompt: 10, output: 5, cache_read: 0, cache_write: 0 },
          cost: null,
          wall_time_ms: 1,
          tool_calls: 0,
          retries: 0,
          started_at: "2026-11-01T00:00:00Z",
          ended_at: "2026-11-01T00:00:01Z",
        });
      }
    `;
    const writerPath = join(TMP_ROOT, "writer.ts");
    writeFileSync(writerPath, writerSrc);

    const writers = 8;
    const perWriter = 20;
    const procs = Array.from({ length: writers }, (_, w) =>
      Bun.spawn(["bun", writerPath, MODULE_PATH, dir, String(perWriter), String(w)], {
        stdout: "ignore",
        stderr: "pipe",
      }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual(Array(writers).fill(0));

    const read = readLedger(dir);
    expect(read.corrupt).toBe(0);
    expect(read.records).toHaveLength(writers * perWriter);
    const attempts = new Set(read.records.map((r) => r.attempt));
    expect(attempts.size).toBe(writers * perWriter);
  }, 60_000);

  test("a held lock blocks writers and times out with a state error", () => {
    const dir = newLedgerDir("lock-contention");
    mkdirSync(join(dir, LEDGER_LOCK_DIR));
    let ran = false;
    expect(() =>
      withLedgerLock(dir, () => {
        ran = true;
      }, { timeoutMs: 100 }),
    ).toThrow(ContractError);
    expect(ran).toBeFalse();
  });

  test("a stale lock left by a forced kill is stolen (rename-then-delete, no residue)", () => {
    const dir = newLedgerDir("stale-lock");
    const lockPath = join(dir, LEDGER_LOCK_DIR);
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, "owner"), "dead-owner-token\n");
    const old = new Date(Date.now() - LEDGER_LOCK_STALE_MS * 10);
    utimesSync(lockPath, old, old);
    recordUsage(dir, rec());
    expect(existsSync(lockPath)).toBeFalse();
    // No stale-copy residue left behind by the steal.
    expect(readdirSync(dir).filter((n) => n.startsWith(LEDGER_LOCK_DIR))).toEqual([]);
    expect(readLedger(dir).records).toHaveLength(1);
  });

  test("a former owner never unlinks a lock it no longer owns", () => {
    const dir = newLedgerDir("lock-ownership");
    let innerResult: string | null = null;
    // Outer holder's release must not remove the successor's lock: the
    // successor steals the (stale) outer lock while fn is running, then
    // the outer finally runs — the lock now carries the successor's token.
    const stale = new Date(Date.now() - LEDGER_LOCK_STALE_MS * 10);
    mkdirSync(join(dir, LEDGER_LOCK_DIR));
    utimesSync(join(dir, LEDGER_LOCK_DIR), stale, stale);

    // Simulate: outer acquires, then a successor steals and holds it.
    // We approximate the ownership invariant by checking that withLedgerLock
    // refuses to remove a replaced lock: acquire, replace the owner token
    // with a foreign one mid-run, release, and assert the lock survives.
    withLedgerLock(dir, () => {
      writeFileSync(join(dir, LEDGER_LOCK_DIR, "owner"), "successor-token\n");
    }, { staleMs: LEDGER_LOCK_STALE_MS * 10 });
    innerResult = existsSync(join(dir, LEDGER_LOCK_DIR)) ? "survived" : "removed";
    expect(innerResult).toBe("survived");
    // Cleanup for the assertion above: the successor token is foreign to
    // everyone now, so drop the directory manually for the next test.
    rmSync(join(dir, LEDGER_LOCK_DIR), { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Forced kill / torn and corrupt lines
// ---------------------------------------------------------------------------

describe("torn and corrupt records", () => {
  test("a torn trailing line (kill during write) is skipped and counted", () => {
    const dir = newLedgerDir("torn");
    recordUsage(dir, rec());
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "nonce-2") }));
    // Simulate a forced kill mid-write: a partial line without newline.
    appendFileSync(join(dir, LEDGER_FILE), '{"contract_version":"1.0.0","attempt":"claude.mimo#mimo-v');
    const read = readLedger(dir);
    expect(read.records).toHaveLength(2);
    expect(read.corrupt).toBe(1);
  });

  test("an append after a torn tail is not swallowed (newline repaired under the lock)", () => {
    const dir = newLedgerDir("torn-append");
    recordUsage(dir, rec());
    // Kill mid-write: torn tail without newline.
    appendFileSync(join(dir, LEDGER_FILE), '{"contract_version":"1.0.0","att');
    // The next record must land on its own line, not concatenated.
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "nonce-9") }));
    const read = readLedger(dir);
    expect(read.records).toHaveLength(2);
    expect(read.records[1].attempt).toBe(ATTEMPT_KEY.replace("nonce-1", "nonce-9"));
    expect(read.corrupt).toBe(1); // the torn tail is still counted
    const raw = readFileSync(join(dir, LEDGER_FILE), "utf8");
    expect(raw).toContain('{"contract_version":"1.0.0","att\n');
  });

  test("a complete-but-unnewlined final record (kill after write, before newline flush) still parses", () => {
    const dir = newLedgerDir("unnewlined");
    recordUsage(dir, rec());
    appendFileSync(join(dir, LEDGER_FILE), '{"contract_version":"1.0.0","attempt":"claude.mimo#mimo-v2#test-box#n9","task":"t","outcome":"success","verification":"pass","retry_of":null,"usage":null,"cost":null,"wall_time_ms":null,"tool_calls":null,"retries":null,"started_at":"2026-11-01T00:00:00Z","ended_at":null}');
    const read = readLedger(dir);
    expect(read.corrupt).toBe(0);
    expect(read.records).toHaveLength(2);
    expect(read.records[1].attempt).toContain("n9");
  });

  test("corrupt middle lines are counted and never fatal for the rest", () => {
    const dir = newLedgerDir("corrupt");
    const line = (nonce: string) =>
      JSON.stringify({ contract_version: CONTRACT_VERSION, ...rec({ attempt: ATTEMPT_KEY.replace("nonce-1", nonce) }) });
    writeFileSync(
      join(dir, LEDGER_FILE),
      [line("ok-1"), "not json at all {{{", JSON.stringify({ contract_version: CONTRACT_VERSION }), line("ok-2"), ""].join("\n"),
    );
    const read = readLedger(dir);
    expect(read.records.map((r) => r.attempt)).toEqual([
      ATTEMPT_KEY.replace("nonce-1", "ok-1"),
      ATTEMPT_KEY.replace("nonce-1", "ok-2"),
    ]);
    expect(read.corrupt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Retention / rotation
// ---------------------------------------------------------------------------

describe("retention and rotation", () => {
  test("drops records older than the retention window and rewrites atomically", () => {
    const dir = newLedgerDir("retention");
    const at = (days: number) => new Date(Date.parse(T0) + days * DAY).toISOString().replace(".000Z", "Z");
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "d0"), started_at: at(0), ended_at: at(0) }));
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "d20"), started_at: at(20), ended_at: at(20) }));
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "d40"), started_at: at(40), ended_at: at(40) }));

    const result = pruneLedger(dir, { now: Date.parse(at(45)), maxAgeMs: 30 * DAY });
    expect(result).toEqual({ kept: 2, dropped: 1, corrupt_dropped: 0 });
    const read = readLedger(dir);
    expect(read.records.map((r) => r.attempt)).toEqual([
      ATTEMPT_KEY.replace("nonce-1", "d20"),
      ATTEMPT_KEY.replace("nonce-1", "d40"),
    ]);
    // Default window is 30 days.
    expect(DEFAULT_RETENTION_MS).toBe(30 * DAY);
  });

  test("maxBytes rotation drops oldest-first and always keeps at least one record", () => {
    const dir = newLedgerDir("rotation");
    for (let i = 0; i < 5; i++) {
      recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", `r${i}`), started_at: T0, ended_at: T0 }));
    }
    const oneLine = Buffer.byteLength(readFileSync(join(dir, LEDGER_FILE), "utf8").split("\n")[0], "utf8") + 1;
    const result = pruneLedger(dir, { now: Date.parse(T0) + DAY, maxBytes: oneLine * 2 + 10 });
    expect(result.kept).toBe(2);
    expect(result.dropped).toBe(3);
    const read = readLedger(dir);
    expect(read.records.map((r) => r.attempt)).toEqual([
      ATTEMPT_KEY.replace("nonce-1", "r3"),
      ATTEMPT_KEY.replace("nonce-1", "r4"),
    ]);
  });

  test("pruning also removes corrupt lines, reporting them as corrupt_dropped", () => {
    const dir = newLedgerDir("prune-corrupt");
    recordUsage(dir, rec());
    appendFileSync(join(dir, LEDGER_FILE), "GARBAGE\n");
    const result = pruneLedger(dir, { now: Date.parse(T0) + DAY });
    expect(result).toEqual({ kept: 1, dropped: 0, corrupt_dropped: 1 });
    expect(readLedger(dir).corrupt).toBe(0);

    expect(pruneLedger(join(TMP_ROOT, "prune-missing"), { now: Date.parse(T0) })).toEqual({
      kept: 0,
      dropped: 0,
      corrupt_dropped: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Summaries: strict success rate, unknown counts, per-task cost
// ---------------------------------------------------------------------------

describe("summarizeLedger", () => {
  test("computes strict success rate, effective tokens and per-basis cost per task", () => {
    const records = [
      // Task A, verified success: 1000 prompt / 500 output / 800 cache-read → effective 700.
      rec({
        attempt: ATTEMPT_KEY.replace("nonce-1", "s1"),
        task: "task-a",
        outcome: "success",
        verification: "pass",
        usage: { prompt: 1000, output: 500, cache_read: 800, cache_write: 0 },
        cost: { amount: 0.02, currency: "USD", basis: "billed" },
        wall_time_ms: 4000,
      }),
      // Task A, failed retry observation.
      rec({
        attempt: ATTEMPT_KEY.replace("nonce-1", "s2"),
        task: "task-a",
        outcome: "failure",
        verification: "fail",
        retry_of: ATTEMPT_KEY.replace("nonce-1", "s1"),
        usage: { prompt: 300, output: 100, cache_read: 0, cache_write: 0 },
        cost: { amount: 0.01, currency: "USD", basis: "estimated" },
        wall_time_ms: 1000,
      }),
      // Task B, killed, estimated cost in EUR.
      rec({
        attempt: ATTEMPT_KEY.replace("nonce-1", "s3"),
        task: "task-b",
        outcome: "killed",
        verification: "skipped",
        usage: { prompt: 200, output: 50, cache_read: 150, cache_write: 0 },
        cost: { amount: 0.03, currency: "EUR", basis: "estimated" },
        wall_time_ms: 500,
      }),
      // Success WITHOUT passing verification: counted, but never as a
      // verified success; no usage, no cost → unknown counts, not zeros.
      rec({
        attempt: ATTEMPT_KEY.replace("nonce-1", "s4"),
        task: null,
        outcome: "success",
        verification: "skipped",
        usage: null,
        cost: null,
        wall_time_ms: null,
      }),
    ];

    const s = summarizeLedger(records);
    expect(s.records).toBe(4);
    expect(s.tasks).toBe(2);
    expect(s.outcomes).toEqual({ success: 2, failure: 1, killed: 1 });
    expect(s.verifications).toEqual({ pass: 1, fail: 1, skipped: 2 });
    expect(s.verified_successes).toBe(1);
    expect(s.unverified_successes).toBe(1);
    expect(s.retry_observations).toBe(1);
    // Strict: only success + verification pass counts.
    expect(s.success_rate).toBeCloseTo(0.25);
    expect(s.tokens).toEqual({ prompt: 1500, output: 650, cache_read: 950, cache_write: 0, effective: 1200 });
    expect(s.usage_unknown_records).toBe(1);
    expect(s.cost_unknown_records).toBe(1);
    // Cache ratio is reported for transparency only.
    expect(s.cache_ratio).toBeCloseTo(950 / 2150);
    expect(s.wall_time_ms).toBe(5500);
    expect(s.cost).toEqual({
      USD: { billed: 0.02, estimated: 0.01 },
      EUR: { billed: 0, estimated: 0.03 },
    });
    expect(s.per_task).toEqual([
      {
        task: "task-a",
        attempts: 2,
        successes: 1,
        failures: 1,
        effective_tokens: 700 + 400,
        usage_unknown_records: 0,
        cost_unknown_records: 0,
        cost: { USD: { billed: 0.02, estimated: 0.01 } },
      },
      {
        task: "task-b",
        attempts: 1,
        successes: 0,
        failures: 1,
        effective_tokens: 100,
        usage_unknown_records: 0,
        cost_unknown_records: 0,
        cost: { EUR: { billed: 0, estimated: 0.03 } },
      },
    ]);
  });

  test("records without usage/cost are counted as unknown, never summed as 0", () => {
    const dir = newLedgerDir("unknown-counts");
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "u1"), task: "t-a", usage: null, cost: null }));
    recordUsage(dir, rec({ attempt: ATTEMPT_KEY.replace("nonce-1", "u2"), task: "t-a", usage: { prompt: 10, output: 5, cache_read: 0, cache_write: 0 }, cost: { amount: 1, currency: "USD", basis: "billed" } }));
    const read = readLedger(dir);
    const s = summarizeLedger(read.records);
    expect(s.usage_unknown_records).toBe(1);
    expect(s.cost_unknown_records).toBe(1);
    // The known record's numbers are not diluted by zeros from the unknown one.
    expect(s.tokens.effective).toBe(15);
    expect(s.cost.USD).toEqual({ billed: 1, estimated: 0 });
    const taskA = s.per_task.find((t) => t.task === "t-a")!;
    expect(taskA.usage_unknown_records).toBe(1);
    expect(taskA.cost_unknown_records).toBe(1);
    expect(taskA.effective_tokens).toBe(15);
    expect(taskA.cost.USD).toEqual({ billed: 1, estimated: 0 });
  });

  test("an empty ledger summarizes to nulls and zeros", () => {
    const s = summarizeLedger([]);
    expect(s.success_rate).toBeNull();
    expect(s.cache_ratio).toBeNull();
    expect(s.per_task).toEqual([]);
    expect(s.tokens.effective).toBe(0);
    expect(s.usage_unknown_records).toBe(0);
    expect(s.cost_unknown_records).toBe(0);
  });

  test("cache-heavy records do NOT look efficient: effective tokens stay low while cache ratio is high", () => {
    const cached = rec({
      usage: { prompt: 100_000, output: 100, cache_read: 99_900, cache_write: 0 },
      cost: { amount: 0.9, currency: "USD", basis: "billed" },
    });
    const uncached = rec({
      attempt: ATTEMPT_KEY.replace("nonce-1", "n2"),
      usage: { prompt: 100_000, output: 100, cache_read: 0, cache_write: 0 },
      cost: { amount: 0.9, currency: "USD", basis: "billed" },
    });
    const s = summarizeLedger([cached, uncached]);
    // Same billed cost, wildly different effective token spend.
    expect(s.tokens.effective).toBe(200 + 100_100);
    expect(s.cache_ratio).toBeCloseTo(99_900 / 200_200);
    expect(s.cost.USD!.billed).toBeCloseTo(1.8);
  });
});
