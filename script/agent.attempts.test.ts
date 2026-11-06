/**
 * Tests for T013 (issue #99): durable attempts, generation leases/fencing,
 * checkpoints and the side-effect journal.
 *
 * REAL vs MOCK separation (explicit, per issue #99 and Epic #86):
 *
 *   - `describe("MOCK: …")` blocks use in-memory store doubles defined at the
 *     bottom of this file. They exercise pure validation/fencing logic
 *     deterministically and prove NOTHING about real filesystem semantics.
 *
 *   - `describe("REAL: …")` blocks run FsAttemptStore/FsJournalStore against
 *     real temp directories with real O_EXCL semantics — including a
 *     two-process lease race spawned as separate `bun` processes.
 *
 *   - GitHub-durable checkpoint restore is tested as a byte-exact fixture
 *     round-trip (the exact JSON the module emits is what recovery parses).
 *     NO test below performs a live GitHub API call; live reachability of
 *     durable references is NOT verified here and must not be claimed.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  formatAttemptKey,
  parseJson,
} from "./agent/contract.ts";
import {
  FsAttemptStore,
  acquireLease,
  assertLeaseCurrent,
  attemptStateName,
  fenceAttempt,
  initAttempt,
  MAX_EPOCH_MS,
  MAX_GENERATION,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  parseAttemptRecord,
  parseLease,
  readAttempt,
  recordChild,
  recordResult,
  releaseLease,
  updateRecord,
  type AttemptRecord,
  type AttemptStore,
  type Lease,
} from "./agent/attempts.ts";
import {
  assertNoSecrets,
  FsJournalStore,
  journalPostEffect,
  journalPreEffect,
  loadLocalCheckpoint,
  parseCheckpoint,
  parseDurableRef,
  parseSideEffectEntry,
  pendingSideEffects,
  readJournal,
  saveLocalCheckpoint,
  toCheckpointJson,
  type CheckpointRecord,
  type JournalStore,
} from "./agent/checkpoint.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const LEASE_MS = 60_000;
const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);

function attemptKey(machine = "test-machine", attempt = "attempt-1"): string {
  return formatAttemptKey({
    route: "omp.mistral",
    model: "mistral-large-2411",
    machine,
    attempt,
  });
}

function acquire(store: AttemptStore, key: string, owner = "worker-1"): Lease {
  return acquireLease(store, key, owner, { now: NOW, leaseMs: LEASE_MS });
}

function checkpointOf(key: string, overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    attemptKey: key,
    generation: 1,
    kind: "soft-local",
    inputRef: SHA1,
    resultRef: null,
    children: [],
    notes: ["worker admitted, route omp.mistral"],
    durable: null,
    createdAt: "2026-11-06T12:00:00Z",
    ...overrides,
  };
}

function expectContractError(fn: () => unknown, code?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError);
    if (code) expect((error as ContractError).code).toBe(code);
    return;
  }
  throw new Error("expected a ContractError, but the call succeeded");
}

// ---------------------------------------------------------------------------
// MOCK store doubles (in-memory only; filesystem semantics are covered by the
// REAL blocks below — these prove nothing about O_EXCL, durability or races)
// ---------------------------------------------------------------------------

/** MOCK AttemptStore: same interface, plain maps, same exclusive-create semantics. */
class MemoryAttemptStore implements AttemptStore {
  private readonly leases = new Map<string, Map<number, unknown>>();
  private readonly records = new Map<string, unknown>();

  listGenerations(attemptKey: string): number[] {
    return [...(this.leases.get(attemptKey)?.keys() ?? [])].sort((a, b) => a - b);
  }

  createLease(attemptKey: string, generation: number, lease: unknown): boolean {
    let byGen = this.leases.get(attemptKey);
    if (!byGen) {
      byGen = new Map();
      this.leases.set(attemptKey, byGen);
    }
    if (byGen.has(generation)) return false;
    byGen.set(generation, structuredClone(lease));
    return true;
  }

  readLease(attemptKey: string, generation: number): unknown {
    const value = this.leases.get(attemptKey)?.get(generation);
    return value === undefined ? null : structuredClone(value);
  }

  markLeaseReleased(attemptKey: string, generation: number): void {
    const raw = this.readLease(attemptKey, generation);
    if (raw === null) {
      throw new ContractError("state", `no lease generation ${generation} for '${attemptKey}'`);
    }
    const lease = parseLease(raw, `lease(${attemptKey}#${generation})`);
    this.leases
      .get(attemptKey)!
      .set(generation, { contract_version: CONTRACT_VERSION, ...lease, released: true });
  }

  createRecord(attemptKey: string, record: unknown): boolean {
    if (this.records.has(attemptKey)) return false;
    this.records.set(attemptKey, structuredClone(record));
    return true;
  }

  readRecord(attemptKey: string): unknown {
    const value = this.records.get(attemptKey);
    return value === undefined ? null : structuredClone(value);
  }

  writeRecord(attemptKey: string, record: unknown): void {
    if (!this.records.has(attemptKey)) {
      throw new ContractError("state", `no record for '${attemptKey}'`);
    }
    this.records.set(attemptKey, structuredClone(record));
  }
}

/** MOCK JournalStore: same interface, plain arrays, no filesystem. */
class MemoryJournalStore implements JournalStore {
  private readonly lines = new Map<string, string[]>();

  append(attemptKey: string, line: string): void {
    const existing = this.lines.get(attemptKey) ?? [];
    existing.push(line);
    this.lines.set(attemptKey, existing);
  }

  readAll(attemptKey: string): string[] {
    return [...(this.lines.get(attemptKey) ?? [])];
  }
}

// ---------------------------------------------------------------------------
// MOCK: attempt records, leases and fencing
// ---------------------------------------------------------------------------

describe("MOCK: attempt records, leases and fencing", () => {
  test("initAttempt creates an admitted record; first lease is generation 1", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    const record = initAttempt(store, key, { now: NOW });
    expect(record.status).toBe("admitted");
    expect(record.generation).toBe(0);
    const lease = acquire(store, key);
    expect(lease.generation).toBe(1);
    expect(lease.owner).toBe("worker-1");
    expect(lease.released).toBe(false);
    const after = readAttempt(store, key);
    expect(after?.status).toBe("running");
    expect(after?.generation).toBe(1);
    expect(after?.owner).toBe("worker-1");
  });

  test("double lease on the same generation is refused while a lease is active", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    acquire(store, key, "worker-1");
    expectContractError(
      () => acquireLease(store, key, "worker-2", { now: NOW + 1, leaseMs: LEASE_MS }),
      "state",
    );
    // The refusal is not just an error: no second lease file may exist.
    expect(store.listGenerations(key)).toEqual([1]);
  });

  test("concurrent exclusive creates of one generation: exactly one wins (CAS)", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    const lease = {
      attemptKey: key,
      generation: 1,
      owner: "worker-1",
      acquiredAt: "2026-11-06T12:00:00Z",
      expiresAt: "2026-11-06T12:01:00Z",
      released: false,
    };
    expect(store.createLease(key, 1, lease)).toBe(true);
    expect(store.createLease(key, 1, { ...lease, owner: "worker-2" })).toBe(false);
  });

  test("an expired lease can be superseded by the next generation", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    acquire(store, key, "worker-1");
    const lease2 = acquireLease(store, key, "worker-2", {
      now: NOW + LEASE_MS + 1, // first lease has expired
      leaseMs: LEASE_MS,
    });
    expect(lease2.generation).toBe(2);
    expect(store.listGenerations(key)).toEqual([1, 2]);
  });

  test("stale generation results are rejected and the record is unchanged", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    const stale = acquire(store, key, "worker-1");
    releaseLease(store, stale, NOW); // worker-1 finished its lease cleanly
    acquire(store, key, "worker-2"); // generation 2 now owns the attempt
    expectContractError(() => recordResult(store, stale, SHA1, NOW + 1), "evidence");
    const record = readAttempt(store, key);
    expect(record?.resultRef).toBeNull();
    expect(record?.status).toBe("running");
    expect(record?.owner).toBe("worker-2");
  });

  test("recordResult commits under a current lease; same ref is idempotent, a different ref is refused", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    const lease = acquire(store, key);
    const done = recordResult(store, lease, SHA1, NOW + 10);
    expect(done.status).toBe("completed");
    expect(done.resultRef).toBe(SHA1);
    const again = recordResult(store, lease, SHA1, NOW + 11);
    expect(again.resultRef).toBe(SHA1);
    expectContractError(() => recordResult(store, lease, SHA2, NOW + 12), "state");
  });

  test("fenceAttempt marks the attempt fenced; the fenced holder cannot write", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    const lease = acquire(store, key, "worker-1");
    const fenced = fenceAttempt(store, key, NOW + 1);
    expect(fenced.status).toBe("fenced");
    expectContractError(() => recordResult(store, lease, SHA1, NOW + 2), "evidence");
    expectContractError(() => assertLeaseCurrent(store, lease, NOW + 2), "evidence");
    // A new generation resumes the attempt after the fence.
    const lease2 = acquireLease(store, key, "worker-2", { now: NOW + 3, leaseMs: LEASE_MS });
    expect(lease2.generation).toBe(2);
    expect(readAttempt(store, key)?.status).toBe("running");
  });

  test("fencing is idempotent and refuses completed or unknown attempts", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    expectContractError(() => fenceAttempt(store, key, NOW), "state");
    const lease = acquire(store, key);
    fenceAttempt(store, key, NOW + 1);
    expect(fenceAttempt(store, key, NOW + 2).status).toBe("fenced");
    releaseLease(store, lease, NOW + 3);
    const lease2 = acquireLease(store, key, "worker-2", { now: NOW + 4, leaseMs: LEASE_MS });
    recordResult(store, lease2, SHA1, NOW + 5);
    expectContractError(() => fenceAttempt(store, key, NOW + 6), "state");
  });

  test("parent death does not kill child state", () => {
    const store = new MemoryAttemptStore();
    const parentKey = attemptKey("test-machine", "parent");
    const childKey = attemptKey("test-machine", "child");
    initAttempt(store, parentKey, { now: NOW });
    const parentLease = acquire(store, parentKey, "worker-1");
    recordChild(store, parentLease, childKey, NOW + 1);
    initAttempt(store, childKey, { now: NOW, parent: parentKey });
    const childLease = acquire(store, childKey, "worker-1");

    // The parent's holder dies; the supervisor fences the parent record.
    fenceAttempt(store, parentKey, NOW + 2);

    // The child's lease is untouched and the child can still commit.
    assertLeaseCurrent(store, childLease, NOW + 3);
    const done = recordResult(store, childLease, SHA1, NOW + 4);
    expect(done.status).toBe("completed");
    // The parent record is fenced, but the child link survives on both sides.
    expect(readAttempt(store, parentKey)?.children).toEqual([childKey]);
    expect(readAttempt(store, childKey)?.parent).toBe(parentKey);
  });

  test("updateRecord is a generation CAS: a moved generation refuses stale writes", () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey();
    initAttempt(store, key, { now: NOW });
    const lease = acquire(store, key);
    const record = readAttempt(store, key) as AttemptRecord;
    expectContractError(
      () => updateRecord(store, key, record.generation + 1, NOW + 1, (r) => r),
      "evidence",
    );
    // The generation must never move backwards.
    expectContractError(
      () => updateRecord(store, key, record.generation, NOW + 1, (r) => ({ ...r, generation: 0 })),
      "state",
    );
    expect(readAttempt(store, key)?.generation).toBe(lease.generation);
  });

  test("readAttempt returns null for an unknown attempt; released leases fail closed", () => {
    const store = new MemoryAttemptStore();
    expect(readAttempt(store, attemptKey())).toBeNull();
    const key = attemptKey();
    const lease = acquire(store, key);
    releaseLease(store, lease, NOW + 1);
    expectContractError(() => assertLeaseCurrent(store, lease, NOW + 2), "evidence");
  });
});

// ---------------------------------------------------------------------------
// MOCK: hostile input validation (fail closed, never guessed)
// ---------------------------------------------------------------------------

describe("MOCK: hostile input validation", () => {
  const store = new MemoryAttemptStore();

  test("generations must be small positive integers: NaN, 0, negative, fractional and huge all throw", () => {
    const base = {
      contract_version: CONTRACT_VERSION,
      attemptKey: attemptKey(),
      status: "running",
      owner: "worker-1",
      parent: null,
      children: [],
      inputRef: null,
      resultRef: null,
      createdAt: "2026-11-06T12:00:00Z",
      updatedAt: "2026-11-06T12:00:01Z",
    };
    for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, MAX_GENERATION + 1]) {
      expectContractError(() => parseAttemptRecord({ ...base, generation: bad }, "record"));
    }
    // Generation 0 is valid for a record (admitted, not yet leased) but a
    // lease generation must be >= 1.
    expect(parseAttemptRecord({ ...base, generation: 0 }, "record").generation).toBe(0);
    expectContractError(() =>
      parseLease(
        {
          contract_version: CONTRACT_VERSION,
          attemptKey: attemptKey(),
          generation: 0,
          owner: "worker-1",
          acquiredAt: "2026-11-06T12:00:00Z",
          expiresAt: "2026-11-06T12:01:00Z",
          released: false,
        },
        "lease",
      ),
    );
  });

  test("now must be a finite non-negative integer epoch; NaN and Infinity throw", () => {
    const key = attemptKey();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "now", null]) {
      expectContractError(() => acquireLease(store, key, "worker-1", { now: bad as number, leaseMs: LEASE_MS }));
    }
  });

  test("leaseMs is bounded: 0, sub-second and over-max leases throw", () => {
    const key = attemptKey();
    for (const bad of [0, MIN_LEASE_MS - 1, MAX_LEASE_MS + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectContractError(() => acquireLease(store, key, "worker-1", { now: NOW, leaseMs: bad }));
    }
  });

  test("now + leaseMs must not overflow the representable date range", () => {
    const key = attemptKey();
    expectContractError(() =>
      acquireLease(store, key, "worker-1", { now: MAX_EPOCH_MS, leaseMs: LEASE_MS }),
    );
  });

  test("epoch numbers are rejected where ISO 8601 UTC timestamps are required", () => {
    const base = {
      contract_version: CONTRACT_VERSION,
      attemptKey: attemptKey(),
      generation: 1,
      status: "running",
      owner: "worker-1",
      parent: null,
      children: [],
      inputRef: null,
      resultRef: null,
      createdAt: "2026-11-06T12:00:00Z",
    };
    expectContractError(() =>
      parseAttemptRecord({ ...base, updatedAt: NOW + 1 }, "record"), // epoch number, not ISO
    );
    expectContractError(() =>
      parseAttemptRecord({ ...base, updatedAt: "2026-11-06T12:00:00+00:00" }, "record"), // not Zulu
    );
    expectContractError(() =>
      parseLease(
        {
          contract_version: CONTRACT_VERSION,
          attemptKey: attemptKey(),
          generation: 1,
          owner: "worker-1",
          acquiredAt: "2026-11-06T12:00:00Z",
          expiresAt: 1762426800000,
          released: false,
        },
        "lease",
      ),
    );
  });

  test("secret-shaped owner labels are refused, never stored", () => {
    const key = attemptKey();
    for (const bad of ["Bearer abcdefgh123456", "sk-abcdefghijklmnop", "", "worker 1", "w".repeat(129)]) {
      expectContractError(() => acquireLease(store, key, bad, { now: NOW, leaseMs: LEASE_MS }));
    }
    expect(store.listGenerations(key)).toEqual([]); // nothing was written
  });

  test("unknown and missing fields in persisted JSON throw (records and leases)", () => {
    const base = {
      contract_version: CONTRACT_VERSION,
      attemptKey: attemptKey(),
      generation: 1,
      status: "running",
      owner: "worker-1",
      parent: null,
      children: [],
      inputRef: null,
      resultRef: null,
      createdAt: "2026-11-06T12:00:00Z",
      updatedAt: "2026-11-06T12:00:01Z",
    };
    expectContractError(() => parseAttemptRecord({ ...base, reasoning: "chain of thought" }, "record"));
    const { updatedAt: _dropped, ...missing } = base;
    expectContractError(() => parseAttemptRecord(missing, "record"));
    expectContractError(() =>
      parseLease(
        {
          contract_version: CONTRACT_VERSION,
          attemptKey: attemptKey(),
          generation: 1,
          owner: "worker-1",
          acquiredAt: "2026-11-06T12:00:00Z",
          expiresAt: "2026-11-06T12:01:00Z",
          released: false,
          apiKey: "value",
        },
        "lease",
      ),
    );
  });

  test("record invariants: duplicate children, self-parenting and time travel throw", () => {
    const key = attemptKey();
    const child = attemptKey("test-machine", "child");
    const base = {
      contract_version: CONTRACT_VERSION,
      attemptKey: key,
      generation: 1,
      status: "running",
      owner: "worker-1",
      parent: null,
      children: [child],
      inputRef: null,
      resultRef: null,
      createdAt: "2026-11-06T12:00:00Z",
      updatedAt: "2026-11-06T12:00:01Z",
    };
    expectContractError(() => parseAttemptRecord({ ...base, children: [child, child] }, "record"));
    expectContractError(() => parseAttemptRecord({ ...base, parent: key }, "record"));
    expectContractError(
      () =>
        parseAttemptRecord(
          { ...base, createdAt: "2026-11-06T12:00:02Z", updatedAt: "2026-11-06T12:00:01Z" },
          "record",
        ),
    );
  });

  test("malformed attempt keys fail closed through the shared contract parser", () => {
    expectContractError(() => initAttempt(store, "omp.mistral#model#machine", { now: NOW }));
    expectContractError(() => initAttempt(store, "omp mistral#model#machine#a1", { now: NOW }));
  });

  test("immutable refs must be git SHAs; URLs and guesses are rejected", () => {
    const key = attemptKey();
    for (const bad of ["latest", "main", "https://github.com/o/r/commit/abc", "ABCDEF", "a".repeat(41)]) {
      expectContractError(() => initAttempt(store, key, { now: NOW, inputRef: bad }));
    }
  });
});

// ---------------------------------------------------------------------------
// REAL: filesystem store (temp dirs, real O_EXCL semantics)
// ---------------------------------------------------------------------------

describe("REAL: filesystem attempt store", () => {
  let root: string;

  function freshRoot(): string {
    root = mkdtempSync(join(tmpdir(), "agent-attempts-"));
    return root;
  }

  test("acquire and recordResult persist to disk and parse back", () => {
    const store = new FsAttemptStore(freshRoot());
    const key = attemptKey("fs-machine", "fs-1");
    initAttempt(store, key, { now: NOW, inputRef: SHA1 });
    const lease = acquire(store, key, "worker-fs");
    const done = recordResult(store, lease, SHA2, NOW + 10);
    expect(done.status).toBe("completed");
    // The durable state is real files.
    const dir = join(root, attemptStateName(key));
    expect(existsSync(join(dir, "record.json"))).toBe(true);
    expect(existsSync(join(dir, "lease-1.json"))).toBe(true);
    const raw = JSON.parse(readFileSync(join(dir, "record.json"), "utf8"));
    expect(raw.contract_version).toBe(CONTRACT_VERSION);
    expect(raw.resultRef).toBe(SHA2);
    const reread = readAttempt(store, key);
    expect(reread?.resultRef).toBe(SHA2);
    rmSync(root, { recursive: true, force: true });
  });

  test("double lease on the real filesystem is impossible", () => {
    const store = new FsAttemptStore(freshRoot());
    const key = attemptKey("fs-machine", "fs-2");
    acquire(store, key, "worker-a");
    expectContractError(
      () => acquireLease(store, key, "worker-b", { now: NOW + 1, leaseMs: LEASE_MS }),
      "state",
    );
    // Direct O_EXCL race on one generation file: exactly one create wins.
    const lease = {
      contract_version: CONTRACT_VERSION,
      attemptKey: key,
      generation: 2,
      owner: "worker-a",
      acquiredAt: "2026-11-06T12:00:00Z",
      expiresAt: "2026-11-06T12:01:00Z",
      released: false,
    };
    expect(store.createLease(key, 2, lease)).toBe(true);
    expect(store.createLease(key, 2, { ...lease, owner: "worker-b" })).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("a stale generation cannot commit results on the real store", () => {
    const store = new FsAttemptStore(freshRoot());
    const key = attemptKey("fs-machine", "fs-3");
    initAttempt(store, key, { now: NOW });
    const stale = acquire(store, key, "worker-old");
    acquireLease(store, key, "worker-new", { now: NOW + LEASE_MS + 1, leaseMs: LEASE_MS });
    expectContractError(() => recordResult(store, stale, SHA1, NOW + LEASE_MS + 2), "evidence");
    expect(readAttempt(store, key)?.resultRef).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("corrupt state files fail closed; missing attempts read as null", () => {
    const store = new FsAttemptStore(freshRoot());
    const key = attemptKey("fs-machine", "fs-4");
    expect(readAttempt(store, key)).toBeNull();
    expect(store.listGenerations(key)).toEqual([]);
    initAttempt(store, key, { now: NOW });
    const recordPath = join(root, attemptStateName(key), "record.json");
    writeFileSync(recordPath, "{not json", "utf8");
    expectContractError(() => readAttempt(store, key));
    writeFileSync(
      recordPath,
      JSON.stringify({
        contract_version: CONTRACT_VERSION,
        attemptKey: key,
        generation: 1,
        status: "running",
        owner: "worker-1",
        parent: null,
        children: [],
        inputRef: null,
        resultRef: null,
        createdAt: "2026-11-06T12:00:00Z",
        updatedAt: "2026-11-06T12:00:01Z",
        bogus: 1,
      }),
      "utf8",
    );
    expectContractError(() => readAttempt(store, key));
    rmSync(root, { recursive: true, force: true });
  });

  test("persisted attempt state contains no secret-shaped values", () => {
    const store = new FsAttemptStore(freshRoot());
    const key = attemptKey("fs-machine", "fs-5");
    initAttempt(store, key, { now: NOW, inputRef: SHA1 });
    const lease = acquire(store, key, "herdr:w5F");
    recordResult(store, lease, SHA2, NOW + 1);
    const dir = join(root, attemptStateName(key));
    for (const name of ["record.json", "lease-1.json"]) {
      const raw = readFileSync(join(dir, name), "utf8");
      expect(raw).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
      expect(raw).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
      expect(raw).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      expect(raw).not.toContain("reasoning");
    }
    rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// REAL: two-process lease race (the CAS under真 concurrency)
// ---------------------------------------------------------------------------

describe("REAL: two-process lease race", () => {
  test("exactly one of two concurrent processes acquires the first generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-attempts-race-"));
    const key = attemptKey("race-machine", "race-1");
    const workerSource = `
import { FsAttemptStore, acquireLease } from ${JSON.stringify(join(import.meta.dir, "agent", "attempts.ts"))};
const [root, key] = process.argv.slice(2);
try {
  acquireLease(new FsAttemptStore(root), key, "worker-" + process.pid, {
    now: Date.now(),
    leaseMs: 60000,
  });
  process.exit(0);
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
`;
    const workerPath = join(root, "worker.ts");
    writeFileSync(workerPath, workerSource, "utf8");
    const procs = await Promise.all(
      [0, 1].map(() => {
        const proc = Bun.spawn(["bun", workerPath, root, key], {
          stdout: "pipe",
          stderr: "pipe",
        });
        return proc.exited.then((code) => ({ code, proc }));
      }),
    );
    const exitCodes = procs.map((p) => p.code).sort();
    expect(exitCodes).toEqual([0, 1]); // exactly one winner
    const store = new FsAttemptStore(root);
    expect(store.listGenerations(key)).toEqual([1]); // one lease file, generation 1
    expect(readAttempt(store, key)?.owner).toMatch(/^worker-\d+$/);
    rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// MOCK: checkpoints (soft vs hard, GitHub-durable restore)
// ---------------------------------------------------------------------------

describe("MOCK: checkpoints — soft vs hard, GitHub-durable restore", () => {
  test("a soft-local checkpoint has no durable reference", () => {
    const record = checkpointOf(attemptKey());
    const parsed = parseCheckpoint(
      parseJson(toCheckpointJson(record)),
      "soft",
    );
    expect(parsed).toEqual(record);
    expect(parsed.kind).toBe("soft-local");
    expect(parsed.durable).toBeNull();
  });

  test("a hard-remote checkpoint carries a durable GitHub reference", () => {
    const key = attemptKey();
    const record = checkpointOf(key, {
      kind: "hard-remote",
      durable: {
        kind: "issue-comment",
        repo: "rebuildup/dotfiles",
        n: 99,
        sha: null,
        url: "https://github.com/rebuildup/dotfiles/issues/99#issuecomment-1",
      },
    });
    const parsed = parseCheckpoint(parseJson(toCheckpointJson(record)), "hard");
    expect(parsed).toEqual(record);
    expect(parsed.kind).toBe("hard-remote");
    expect(parsed.durable?.n).toBe(99);
  });

  test("checkpoint restores byte-exactly from GitHub-durable state (fixture round-trip, no live API call)", () => {
    const key = attemptKey("github-machine", "restore-1");
    const record = checkpointOf(key, {
      kind: "hard-remote",
      resultRef: SHA2,
      children: [attemptKey("github-machine", "child")],
      durable: {
        kind: "git-ref",
        repo: "rebuildup/dotfiles",
        n: null,
        sha: SHA1,
        url: "https://github.com/rebuildup/dotfiles/commit/" + SHA1,
      },
      notes: ["checkpoint posted to issue #99 by the supervisor"],
    });
    // What the supervisor posts to GitHub (e.g. an issue comment body):
    const posted = toCheckpointJson(record);
    // What recovery later reads back from GitHub-durable state:
    const restored = parseCheckpoint(parseJson(posted), "github-durable");
    expect(restored).toEqual(record);
  });

  test("kind must agree with the durable reference; mismatches throw", () => {
    const key = attemptKey();
    expectContractError(() =>
      parseCheckpoint(
        parseJson(
          toCheckpointJson(
            checkpointOf(key, {
              kind: "soft-local",
              durable: {
                kind: "issue",
                repo: "rebuildup/dotfiles",
                n: 99,
                sha: null,
                url: "https://github.com/rebuildup/dotfiles/issues/99",
              },
            }),
          ),
        ),
        "mismatch-hard",
      ),
    );
    expectContractError(() =>
      parseCheckpoint(
        parseJson(toCheckpointJson(checkpointOf(key, { kind: "hard-remote" }))),
        "mismatch-soft",
      ),
    );
  });

  test("durable refs are strictly validated", () => {
    expectContractError(() =>
      parseDurableRef(
        { kind: "issue", repo: "rebuildup/dotfiles", n: 0, sha: null, url: "https://github.com/rebuildup/dotfiles/issues/99" },
        "durable",
      ),
    );
    expectContractError(() =>
      parseDurableRef(
        { kind: "git-ref", repo: "rebuildup/dotfiles", n: null, sha: null, url: "https://github.com/rebuildup/dotfiles" },
        "durable",
      ),
    );
    expectContractError(() =>
      parseDurableRef(
        {
          kind: "issue",
          repo: "rebuildup/dotfiles",
          n: 99,
          sha: null,
          url: "https://user:token@github.com/rebuildup/dotfiles/issues/99",
        },
        "durable",
      ),
    );
    expectContractError(() =>
      parseDurableRef(
        { kind: "newsletter", repo: "rebuildup/dotfiles", n: 1, sha: null, url: "https://github.com/rebuildup/dotfiles/issues/1" },
        "durable",
      ),
    );
  });

  test("hostile checkpoint fields throw: unknown fields, missing fields, epoch timestamps", () => {
    const record = checkpointOf(attemptKey(), { kind: "hard-remote" });
    record.durable = {
      kind: "issue",
      repo: "rebuildup/dotfiles",
      n: 99,
      sha: null,
      url: "https://github.com/rebuildup/dotfiles/issues/99",
    };
    const raw = JSON.parse(toCheckpointJson(record));
    expectContractError(() => parseCheckpoint({ ...raw, reasoning: "internal" }, "hostile"));
    const { notes: _notes, ...missing } = raw;
    expectContractError(() => parseCheckpoint(missing, "hostile"));
    expectContractError(() => parseCheckpoint({ ...raw, createdAt: NOW }, "hostile"));
  });

  test("secret-shaped checkpoint data is refused, never silently redacted", () => {
    const key = attemptKey();
    expectContractError(() =>
      toCheckpointJson(checkpointOf(key, { notes: ["token ghp_" + "x".repeat(30)] })),
    );
    expectContractError(() =>
      assertNoSecrets({ attemptKey: key, apiKey: "value" }, "checkpoint"),
    );
    expectContractError(() =>
      assertNoSecrets({ attemptKey: key, notes: ["Bearer abcdefgh123456"] }, "checkpoint"),
    );
    expectContractError(() =>
      parseCheckpoint(
        parseJson(
          toCheckpointJson(
            checkpointOf(key, {
              kind: "hard-remote",
              durable: {
                kind: "issue",
                repo: "rebuildup/dotfiles",
                n: 99,
                sha: null,
                url: "https://github.com/rebuildup/dotfiles/issues/99?access_token=abc123",
              },
            }),
          ),
        ),
        "hostile-url",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// REAL: local checkpoint persistence (soft restore path)
// ---------------------------------------------------------------------------

describe("REAL: local checkpoint persistence", () => {
  test("save + load round-trips; missing reads as null; corrupt and regressed state fail closed", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-checkpoints-"));
    const key = attemptKey("fs-machine", "ckpt-1");
    expect(loadLocalCheckpoint(root, key)).toBeNull();
    saveLocalCheckpoint(root, checkpointOf(key, { generation: 1 }));
    expect(loadLocalCheckpoint(root, key)?.notes).toEqual(["worker admitted, route omp.mistral"]);
    // Same generation may be re-saved; an OLDER generation must not win.
    saveLocalCheckpoint(root, checkpointOf(key, { generation: 1, notes: ["updated"] }));
    expect(loadLocalCheckpoint(root, key)?.notes).toEqual(["updated"]);
    saveLocalCheckpoint(root, checkpointOf(key, { generation: 2, notes: ["gen2"] }));
    expectContractError(() => saveLocalCheckpoint(root, checkpointOf(key, { generation: 1 })));
    expect(loadLocalCheckpoint(root, key)?.generation).toBe(2);
    // Corrupt file fails closed.
    const path = join(root, `${attemptStateName(key)}.json`);
    writeFileSync(path, "not json at all", "utf8");
    expectContractError(() => loadLocalCheckpoint(root, key));
    // Persisted bytes are secret-free.
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(raw).not.toContain("reasoning");
    rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// MOCK: side-effect journal (pre/post, fencing, fail-closed recovery)
// ---------------------------------------------------------------------------

describe("MOCK: side-effect journal", () => {
  function setup() {
    const attempts = new MemoryAttemptStore();
    const journal = new MemoryJournalStore();
    const key = attemptKey("journal-machine", "journal-1");
    initAttempt(attempts, key, { now: NOW });
    const lease = acquire(attempts, key, "worker-1");
    return { attempts, journal, key, lease };
  }

  test("pre then post records intent and outcome in order", () => {
    const { attempts, journal, key, lease } = setup();
    journalPreEffect(attempts, journal, lease, {
      effectId: "push-1",
      kind: "git-push",
      target: "rebuildup/dotfiles:99",
    }, NOW + 1);
    const post = journalPostEffect(attempts, journal, lease, {
      effectId: "push-1",
      outcome: "succeeded",
      ref: SHA1,
    }, NOW + 2);
    expect(post.phase).toBe("post");
    expect(post.outcome).toBe("succeeded");
    expect(post.ref).toBe(SHA1);
    const entries = readJournal(journal, key);
    expect(entries.map((e) => e.phase)).toEqual(["pre", "post"]);
    expect(pendingSideEffects(journal, key)).toEqual([]);
  });

  test("post without pre, double post and duplicate pre all fail closed", () => {
    const { attempts, journal, lease } = setup();
    expectContractError(
      () =>
        journalPostEffect(attempts, journal, lease, {
          effectId: "ghost",
          outcome: "succeeded",
          ref: null,
        }, NOW + 1),
      "state",
    );
    journalPreEffect(attempts, journal, lease, {
      effectId: "push-1",
      kind: "git-push",
      target: "rebuildup/dotfiles:99",
    }, NOW + 1);
    journalPostEffect(attempts, journal, lease, {
      effectId: "push-1",
      outcome: "failed",
      ref: null,
    }, NOW + 2);
    expectContractError(
      () =>
        journalPostEffect(attempts, journal, lease, {
          effectId: "push-1",
          outcome: "succeeded",
          ref: SHA1,
        }, NOW + 3),
      "state",
    );
    expectContractError(
      () =>
        journalPreEffect(attempts, journal, lease, {
          effectId: "push-1",
          kind: "git-push",
          target: "rebuildup/dotfiles:99",
        }, NOW + 4),
      "state",
    );
  });

  test("a fenced/stale generation cannot declare or complete side effects", () => {
    const { attempts, journal, key, lease } = setup();
    journalPreEffect(attempts, journal, lease, {
      effectId: "push-1",
      kind: "git-push",
      target: "rebuildup/dotfiles:99",
    }, NOW + 1);
    // Generation 2 takes over (worker-1's lease was released).
    releaseLease(attempts, lease, NOW + 2);
    const lease2 = acquireLease(attempts, key, "worker-2", { now: NOW + 3, leaseMs: LEASE_MS });
    // The stale generation-1 worker can neither declare nor complete effects.
    expectContractError(
      () =>
        journalPreEffect(attempts, journal, lease, {
          effectId: "push-2",
          kind: "git-push",
          target: "rebuildup/dotfiles:99",
        }, NOW + 4),
      "evidence",
    );
    expectContractError(
      () =>
        journalPostEffect(attempts, journal, lease, {
          effectId: "push-1",
          outcome: "succeeded",
          ref: SHA1,
        }, NOW + 5),
      "evidence",
    );
    // The current generation completes the orphaned effect (recovery path).
    const post = journalPostEffect(attempts, journal, lease2, {
      effectId: "push-1",
      outcome: "succeeded",
      ref: SHA1,
    }, NOW + 6);
    expect(post.generation).toBe(2);
    expect(pendingSideEffects(journal, key)).toEqual([]);
  });

  test("a pre declared under a NEWER generation cannot be completed by an older one", () => {
    const { attempts, journal, key, lease: lease1 } = setup();
    releaseLease(attempts, lease1, NOW + 1);
    const lease2 = acquireLease(attempts, key, "worker-2", { now: NOW + 2, leaseMs: LEASE_MS });
    journalPreEffect(attempts, journal, lease2, {
      effectId: "push-new",
      kind: "git-push",
      target: "rebuildup/dotfiles:99",
    }, NOW + 3);
    expectContractError(
      () =>
        journalPostEffect(attempts, journal, lease1, {
          effectId: "push-new",
          outcome: "succeeded",
          ref: null,
        }, NOW + 4),
      "evidence",
    );
  });

  test("uncompleted effects surface as UNKNOWN for recovery — never guessed", () => {
    const { attempts, journal, key, lease } = setup();
    journalPreEffect(attempts, journal, lease, {
      effectId: "push-1",
      kind: "git-push",
      target: "rebuildup/dotfiles:99",
    }, NOW + 1);
    journalPreEffect(attempts, journal, lease, {
      effectId: "comment-1",
      kind: "issue-comment",
      target: "rebuildup/dotfiles#99",
    }, NOW + 2);
    journalPostEffect(attempts, journal, lease, {
      effectId: "comment-1",
      outcome: "failed",
      ref: null,
    }, NOW + 3);
    const pending = pendingSideEffects(journal, key);
    expect(pending).toEqual([
      {
        effectId: "push-1",
        generation: 1,
        kind: "git-push",
        target: "rebuildup/dotfiles:99",
        declaredAt: "2026-11-06T12:00:00.001Z",
      },
    ]);
  });

  test("hostile journal entries fail closed: secret targets, bad phases, pre with outcome", () => {
    const { attempts, journal, lease } = setup();
    expectContractError(
      () =>
        journalPreEffect(attempts, journal, lease, {
          effectId: "push-1",
          kind: "git-push",
          target: "https://example.com/?token=abcdef123456",
        }, NOW + 1),
    );
    expectContractError(() =>
      parseSideEffectEntry(
        {
          contract_version: CONTRACT_VERSION,
          effectId: "push-1",
          attemptKey: attemptKey(),
          generation: 1,
          phase: "pre",
          kind: "git-push",
          target: "rebuildup/dotfiles:99",
          outcome: "succeeded",
          ref: null,
          at: "2026-11-06T12:00:00Z",
        },
        "hostile",
      ),
    );
    expectContractError(() =>
      parseSideEffectEntry(
        {
          contract_version: CONTRACT_VERSION,
          effectId: "push-1",
          attemptKey: attemptKey(),
          generation: 1,
          phase: "post",
          kind: "git-push",
          target: "rebuildup/dotfiles:99",
          outcome: null,
          ref: null,
          at: "2026-11-06T12:00:00Z",
        },
        "hostile",
      ),
    );
    expect(journal.readAll(attemptKey("journal-machine", "journal-1")).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REAL: end-to-end recovery scenario on real stores
// ---------------------------------------------------------------------------

describe("REAL: end-to-end recovery (crash, fence, checkpoint restore, journal)", () => {
  test("a crashed worker's attempt is recovered from durable state without double execution", () => {
    const attemptRoot = mkdtempSync(join(tmpdir(), "agent-e2e-attempts-"));
    const journalRoot = mkdtempSync(join(tmpdir(), "agent-e2e-journal-"));
    const checkpointRoot = mkdtempSync(join(tmpdir(), "agent-e2e-checkpoints-"));
    const attempts = new FsAttemptStore(attemptRoot);
    const journal = new FsJournalStore(journalRoot);
    const key = attemptKey("e2e-machine", "e2e-1");

    // Generation 1: worker admits, checkpoints (soft), declares a push — then
    // crashes before the post. Its lease is short and expires.
    initAttempt(attempts, key, { now: NOW, inputRef: SHA1 });
    const lease1 = acquireLease(attempts, key, "worker-1", { now: NOW, leaseMs: 1_000 });
    saveLocalCheckpoint(
      checkpointRoot,
      checkpointOf(key, { generation: 1, inputRef: SHA1, notes: ["gen1 checkpoint"] }),
    );
    journalPreEffect(attempts, journal, lease1, {
      effectId: "push-1",
      kind: "git-push",
      target: "rebuildup/dotfiles:99",
    }, NOW + 1);
    // ... crash. No post, no result.

    // Recovery (later than the 1s lease): a new generation acquires the
    // attempt — the crashed worker is fenced by generation, not by guessing.
    const later = NOW + 5_000;
    const lease2 = acquireLease(attempts, key, "recoverer", { now: later, leaseMs: LEASE_MS });
    expect(lease2.generation).toBe(2);

    // The stale generation-1 worker cannot commit anything anymore.
    expectContractError(() => recordResult(attempts, lease1, SHA2, later + 1), "evidence");
    expectContractError(
      () =>
        journalPostEffect(attempts, journal, lease1, {
          effectId: "push-1",
          outcome: "succeeded",
          ref: SHA2,
        }, later + 2),
      "evidence",
    );

    // Recovery restores the checkpoint from local durable state and sees the
    // pending effect with an UNKNOWN outcome — verified externally, never
    // assumed to have not happened.
    const restored = loadLocalCheckpoint(checkpointRoot, key);
    expect(restored?.inputRef).toBe(SHA1);
    expect(restored?.generation).toBe(1);
    const pending = pendingSideEffects(journal, key);
    expect(pending.map((p) => p.effectId)).toEqual(["push-1"]);

    // After external verification the recovery generation completes the
    // effect and commits the result.
    const post = journalPostEffect(attempts, journal, lease2, {
      effectId: "push-1",
      outcome: "succeeded",
      ref: SHA2,
    }, later + 3);
    expect(post.generation).toBe(2);
    const done = recordResult(attempts, lease2, SHA2, later + 4);
    expect(done.status).toBe("completed");
    expect(pendingSideEffects(journal, key)).toEqual([]);

    // Durable bytes stay secret-free.
    const journalFile = readFileSync(join(journalRoot, `${attemptStateName(key)}.jsonl`), "utf8");
    expect(journalFile).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(journalFile).not.toContain("reasoning");

    rmSync(attemptRoot, { recursive: true, force: true });
    rmSync(journalRoot, { recursive: true, force: true });
    rmSync(checkpointRoot, { recursive: true, force: true });
  });

  test("journal lines on disk are strictly parsed; a corrupt line fails closed", () => {
    const journalRoot = mkdtempSync(join(tmpdir(), "agent-e2e-journal-2-"));
    const journal = new FsJournalStore(journalRoot);
    const key = attemptKey("e2e-machine", "e2e-2");
    expect(readJournal(journal, key)).toEqual([]);
    journal.append(
      key,
      JSON.stringify({
        contract_version: CONTRACT_VERSION,
        effectId: "push-1",
        attemptKey: key,
        generation: 1,
        phase: "pre",
        kind: "git-push",
        target: "rebuildup/dotfiles:99",
        outcome: null,
        ref: null,
        at: "2026-11-06T12:00:00Z",
      }),
    );
    expect(readJournal(journal, key)).toHaveLength(1);
    // Corrupt the journal: recovery fails closed instead of skipping the line.
    const path = join(journalRoot, `${attemptStateName(key)}.jsonl`);
    writeFileSync(path, `${readFileSync(path, "utf8").trimEnd()}\n{broken\n`, "utf8");
    expectContractError(() => readJournal(journal, key));
    expectContractError(() => pendingSideEffects(journal, key));
    rmSync(journalRoot, { recursive: true, force: true });
  });
});
