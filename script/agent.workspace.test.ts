/**
 * Tests for T012 (issue #98): workspace, runtime and mutable-resource
 * lease arbitration.
 *
 * REAL vs MOCK separation (explicit, per issue #98 and Epic #86):
 *
 *   - `describe("MOCK: …")` blocks use injected runners / in-memory inputs
 *     and exercise pure validation, capability derivation and failure
 *     paths deterministically. They prove NOTHING about real filesystem
 *     or git semantics.
 *
 *   - `describe("REAL: …")` blocks run `ResourceLeaseStore` against real
 *     temp directories with real O_EXCL semantics — including a
 *     two-process port-lease race spawned as separate `bun` processes —
 *     and run `createWorkspace` against a real `git` repository created
 *     in a temp dir.
 *
 *   - Verification host for the REAL blocks: Linux (WSL2). macOS and
 *     Windows-native workspace behavior is UNVERIFIED here; capability
 *     facts for those OSes are parameterized (mock probes only) and never
 *     asserted as observed. No test below claims macOS/Windows coverage.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { ContractError, parseJson } from "./agent/contract.ts";
import {
  MAX_GENERATION,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  type Runner,
} from "./agent/attempts.ts";
import {
  ResourceLeaseStore,
  capabilitiesFromProbe,
  createWorkspace,
  localProbe,
  parsePort,
  parseResourceId,
  parseWorkspaceRecord,
  portResourceId,
  readWorkspace,
  removeWorkspace,
  resourceStateName,
  type HostProbe,
  type WorkspaceCapabilities,
} from "./agent/workspace.ts";

const NOW = 1_799_000_000_000; // fixed epoch, well-formed for lease math
const LEASE_MS = 60_000;
const SHA1 = "a".repeat(40);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function store(): { s: ResourceLeaseStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "agent-workspace-lease-"));
  return { s: new ResourceLeaseStore(root), root };
}

function acquire(
  s: ResourceLeaseStore,
  kind: Parameters<ResourceLeaseStore["acquire"]>[0],
  id: string,
  owner: string,
  extra: Record<string, unknown> = {},
) {
  return s.acquire(kind, id, owner, { now: NOW, leaseMs: LEASE_MS, ...extra });
}

const caps = (over: Partial<WorkspaceCapabilities>): WorkspaceCapabilities => ({
  os: "linux",
  wsl: false,
  backend: "git-worktree",
  sandbox: false,
  gui: null,
  notes: [],
  ...over,
});

/** Real git Runner bound to a working directory (used by REAL blocks). */
const realRun =
  (cwd: string): Runner =>
  (cmd) => {
    const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: r.exitCode ?? 1,
      stdout: r.stdout?.toString() ?? "",
      stderr: r.stderr?.toString() ?? "",
    };
  };

/** Build a real git repo with one commit; returns { repo, sha }. */
function realRepo(): { repo: string; sha: string } {
  const repo = mkdtempSync(join(tmpdir(), "agent-workspace-git-"));
  const run = realRun(repo);
  run(["git", "init", "-q", "--initial-branch=main"]);
  run(["git", "config", "user.email", "test@example.invalid"]);
  run(["git", "config", "user.name", "test"]);
  writeFileSync(join(repo, "f.txt"), "one\n");
  run(["git", "add", "f.txt"]);
  run(["git", "commit", "-q", "-m", "one"]);
  const sha = run(["git", "rev-parse", "HEAD"]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`fixture repo setup failed: ${sha}`);
  return { repo, sha };
}

// ---------------------------------------------------------------------------
// MOCK: id and port validation (hostile input)
// ---------------------------------------------------------------------------

describe("MOCK: resource/workspace id validation", () => {
  test("accepts plain slugs", () => {
    expect(parseResourceId("tcp-8080", "t")).toBe("tcp-8080");
    expect(parseResourceId("Worker_1.cache", "t")).toBe("Worker_1.cache");
    expect(parseResourceId("a".repeat(64), "t")).toBe("a".repeat(64));
  });

  test("rejects empty, non-string and oversized ids", () => {
    for (const bad of ["", "   ", null, undefined, 42, "x".repeat(65)]) {
      expect(() => parseResourceId(bad as never, "t")).toThrow(ContractError);
    }
  });

  test("rejects path traversal and separators in ids used as file identities", () => {
    for (const bad of ["../etc", "a/b", "a\\b", "..", ".", ".hidden", "-flag", "a..b", "x/../../x"]) {
      expect(() => parseResourceId(bad, "t")).toThrow(ContractError);
    }
  });

  test("rejects secret-shaped ids outright — never stored, never redacted-and-kept", () => {
    for (const bad of ["sk-proj-abc123", "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Bearer abcdef"]) {
      expect(() => parseResourceId(bad, "t")).toThrow(ContractError);
    }
  });

  test("resourceStateName is a flat hex name: no traversal can reach the fs layer", () => {
    for (const id of ["tcp-8080", "../x", "a/b"]) {
      try {
        const name = resourceStateName("cache", id);
        expect(name).toMatch(/^[0-9a-f]{64}$/);
      } catch (error) {
        expect(error).toBeInstanceOf(ContractError); // traversal ids refused before hashing
      }
    }
  });
});

describe("MOCK: port validation", () => {
  test("accepts real ports 1..65535", () => {
    expect(parsePort(1, "t")).toBe(1);
    expect(parsePort(65535, "t")).toBe(65535);
    expect(portResourceId(8080)).toBe("tcp-8080");
  });

  test("rejects NaN, Infinity, strings, fractions, 0, negative, 65536 and huge values", () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "8080",
      8080.5,
      0,
      -1,
      65536,
      2 ** 53,
      null,
      undefined,
    ]) {
      expect(() => parsePort(bad as never, "t")).toThrow(ContractError);
    }
  });
});

// ---------------------------------------------------------------------------
// MOCK: OS capability matrix (applied differences, sandbox ≠ workspace)
// ---------------------------------------------------------------------------

describe("MOCK: capability matrix per OS", () => {
  const base: HostProbe = {
    platform: "linux",
    procVersion: "Linux version 6.6.0",
    worktrunkVersion: "wt 0.81.0",
    gui: null,
    sandboxVerified: false,
  };

  test("Linux with Worktrunk available: worktrunk backend preferred", () => {
    const c = capabilitiesFromProbe(base);
    expect(c.os).toBe("linux");
    expect(c.wsl).toBe(false);
    expect(c.backend).toBe("worktrunk");
    expect(c.sandbox).toBe(false);
  });

  test("Linux without Worktrunk: native git worktree fallback", () => {
    const c = capabilitiesFromProbe({ ...base, worktrunkVersion: null });
    expect(c.backend).toBe("git-worktree");
  });

  test("WSL is detected from /proc/version, not guessed", () => {
    expect(capabilitiesFromProbe({ ...base, procVersion: "Linux version 6.6.0-microsoft-standard-WSL2" }).wsl).toBe(true);
    expect(capabilitiesFromProbe({ ...base, procVersion: "Linux version 6.6.0-generic" }).wsl).toBe(false);
    expect(capabilitiesFromProbe({ ...base, procVersion: null }).wsl).toBe(false);
  });

  test("macOS and Windows: only git-worktree is claimed; Worktrunk is UNVERIFIED there", () => {
    const mac = capabilitiesFromProbe({ ...base, platform: "darwin", procVersion: null });
    const win = capabilitiesFromProbe({ ...base, platform: "win32", procVersion: null });
    for (const c of [mac, win]) {
      expect(c.backend).toBe("git-worktree");
      expect(c.wsl).toBe(false);
      expect(c.notes.some((n) => n.includes("UNVERIFIED"))).toBe(true);
    }
  });

  test("unknown platform fails closed (throws), never defaults", () => {
    expect(() => capabilitiesFromProbe({ ...base, platform: "sunos" })).toThrow(ContractError);
  });

  test("workspace is never sandbox evidence: sandbox=true requires explicit verified mechanism", () => {
    expect(capabilitiesFromProbe(base).sandbox).toBe(false);
    const c = capabilitiesFromProbe({ ...base, sandboxVerified: true });
    expect(c.sandbox).toBe(true);
    expect(c.notes.some((n) => n.includes("workspace/worktree is not sandbox evidence"))).toBe(true);
  });

  test("GUI unknown stays null and is recorded as a limitation — never guessed", () => {
    const c = capabilitiesFromProbe(base);
    expect(c.gui).toBeNull();
    expect(c.notes.some((n) => n.startsWith("gui: unknown"))).toBe(true);
    expect(capabilitiesFromProbe({ ...base, gui: false }).gui).toBe(false);
  });

  test("wsl=true with a non-Linux OS is a schema error", () => {
    expect(() =>
      parseWorkspaceRecord(
        parseJson(
          JSON.stringify({
            contract_version: "1.0.0",
            id: "w",
            ref: SHA1,
            backend: "git-worktree",
            path: "/tmp/w",
            targetDir: "/tmp/w/target",
            status: "ready",
            env: { os: "macos", wsl: true, arch: "arm64" },
            createdAt: "2026-11-06T00:00:00Z",
          }),
        ),
        "t",
      ),
    ).toThrow(ContractError);
  });
});

// ---------------------------------------------------------------------------
// MOCK: lease logic against a real tmp store (logic-level, single process)
// ---------------------------------------------------------------------------

describe("MOCK: resource lease collision, takeover and release semantics", () => {
  test("a second worker is rejected while the resource is held (same-resource collision)", () => {
    const { s } = store();
    acquire(s, "port", "tcp-8080", "worker-1");
    expect(() => acquire(s, "port", "tcp-8080", "worker-2")).toThrow(/held by 'worker-1'/);
    // A different resource is unaffected.
    expect(acquire(s, "port", "tcp-8081", "worker-2")?.generation).toBe(1);
  });

  test("tryAcquire returns null (queue/block signal) instead of throwing on collision", () => {
    const { s } = store();
    acquire(s, "db", "pg-main", "worker-1");
    expect(s.tryAcquire("db", "pg-main", "worker-2", { now: NOW, leaseMs: LEASE_MS })).toBeNull();
  });

  test("an expired lease is taken over by the NEXT generation; old holder's lease is stale", () => {
    const { s } = store();
    const first = acquire(s, "queue", "q1", "worker-1");
    const later = s.tryAcquire("queue", "q1", "worker-2", { now: NOW + LEASE_MS + 1, leaseMs: LEASE_MS });
    expect(later).not.toBeNull();
    expect(later!.generation).toBe(first.generation + 1);
    // The old holder cannot release a superseded generation.
    expect(() => s.release(first, NOW + LEASE_MS + 1)).toThrow(/superseded/);
  });

  test("only the holder may release; double release is idempotent for the same holder", () => {
    const { s } = store();
    const lease = acquire(s, "cache", "c1", "worker-1");
    expect(() => s.release({ ...lease, owner: "worker-2" }, NOW + 1)).toThrow(/held by 'worker-1'/);
    s.release(lease, NOW + 1);
    s.release(lease, NOW + 1); // idempotent
    // Released lease is immediately acquirable as the next generation.
    expect(acquire(s, "cache", "c1", "worker-3").generation).toBe(lease.generation + 1);
  });

  test("a lease whose stored identity disagrees with its resource is refused, never reinterpreted", () => {
    const { s, root } = store();
    acquire(s, "db", "pg-a", "worker-1");
    // Tamper: a lease claiming a different resource, stored in pg-a's dir.
    const lease = s.current("db", "pg-a")!;
    const dir = join(root, resourceStateName("db", "pg-a"));
    writeFileSync(
      join(dir, "lease-1.json"),
      JSON.stringify({ contract_version: "1.0.0", ...lease, resourceId: "pg-other" }),
    );
    expect(() => s.current("db", "pg-a")).toThrow(/not 'db:pg-a'/);
    rmSync(root, { recursive: true, force: true });
  });

  test("generation overflow fails closed", () => {
    const { s, root } = store();
    const dir = join(root, resourceStateName("cache", "huge"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `lease-${MAX_GENERATION}.json`),
      JSON.stringify({
        contract_version: "1.0.0",
        kind: "cache",
        resourceId: "huge",
        generation: MAX_GENERATION,
        owner: "worker-1",
        workspace: null,
        acquiredAt: "2026-11-06T00:00:00Z",
        expiresAt: "2026-11-07T00:00:00Z",
        released: true,
      }),
    );
    expect(() => acquire(s, "cache", "huge", "worker-2")).toThrow(/generation overflow/);
    rmSync(root, { recursive: true, force: true });
  });

  test("gui-singleton lease requires VERIFIED gui capability; unknown/false fail closed", () => {
    const { s } = store();
    expect(() => acquire(s, "gui-singleton", "compositor", "worker-1")).toThrow(/requires capabilities/);
    expect(() => acquire(s, "gui-singleton", "compositor", "worker-1", { capabilities: caps({ gui: null }) })).toThrow(
      /requires capabilities/,
    );
    expect(() => acquire(s, "gui-singleton", "compositor", "worker-1", { capabilities: caps({ gui: false }) })).toThrow(
      /requires capabilities/,
    );
    const ok = acquire(s, "gui-singleton", "compositor", "worker-1", { capabilities: caps({ gui: true }) });
    expect(ok.kind).toBe("gui-singleton");
  });

  test("hostile lease options throw: NaN now, sub-second and over-max leaseMs", () => {
    const { s } = store();
    for (const opts of [
      { now: Number.NaN, leaseMs: LEASE_MS },
      { now: Number.POSITIVE_INFINITY, leaseMs: LEASE_MS },
      { now: -1, leaseMs: LEASE_MS },
      { now: NOW, leaseMs: MIN_LEASE_MS - 1 },
      { now: NOW, leaseMs: MAX_LEASE_MS + 1 },
      { now: NOW, leaseMs: 1.5 },
    ]) {
      expect(() => s.acquire("port", "tcp-1", "worker-1", opts as never)).toThrow(ContractError);
    }
  });

  test("secret-shaped owners are refused, never stored", () => {
    const { s } = store();
    expect(() => acquire(s, "credential", "slot-1", "sk-proj-abc123")).toThrow(ContractError);
  });
});

// ---------------------------------------------------------------------------
// MOCK: workspace records and failed-setup cleanup (injected git runner)
// ---------------------------------------------------------------------------

describe("MOCK: workspace record validation", () => {
  const record = (over: Record<string, unknown> = {}) =>
    parseJson(
      JSON.stringify({
        contract_version: "1.0.0",
        id: "w1",
        ref: SHA1,
        backend: "git-worktree",
        path: "/tmp/ws/w1",
        targetDir: "/tmp/ws/w1/target",
        status: "ready",
        env: { os: "linux", wsl: false, arch: "x86_64" },
        createdAt: "2026-11-06T00:00:00Z",
        ...over,
      }),
    );

  test("a valid record parses; env identity is preserved", () => {
    const r = parseWorkspaceRecord(record(), "t");
    expect(r.id).toBe("w1");
    expect(r.env.os).toBe("linux");
    expect(r.ref).toBe(SHA1);
  });

  test("targetDir outside the workspace path is refused (mutable artifacts are never shared)", () => {
    expect(() => parseWorkspaceRecord(record({ targetDir: "/shared/target" }), "t")).toThrow(ContractError);
  });

  test("hostile fields fail closed: unknown fields, missing fields, non-SHA ref, epoch createdAt", () => {
    expect(() => parseWorkspaceRecord({ ...record(), extra: 1 }, "t")).toThrow(ContractError);
    expect(() => parseWorkspaceRecord(record({ ref: "main" }), "t")).toThrow(ContractError);
    expect(() => parseWorkspaceRecord(record({ createdAt: NOW }), "t")).toThrow(ContractError);
    expect(() => parseWorkspaceRecord(record({ status: "ready?" }), "t")).toThrow(ContractError);
    const noRef = record();
    delete (noRef as Record<string, unknown>)["ref"];
    expect(() => parseWorkspaceRecord(noRef, "t")).toThrow(ContractError);
  });

  test("ids with traversal are refused at the record layer too", () => {
    expect(() => parseWorkspaceRecord(record({ id: "../escape" }), "t")).toThrow(ContractError);
  });
});

describe("MOCK: failed workspace setup cleans up partial state (injected runner)", () => {
  test("git failure removes the worktree dir and record; the id is immediately reusable", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-workspace-fail-"));
    let calls: string[][] = [];
    const failing: Runner = (cmd) => {
      calls.push(cmd);
      if (cmd[1] === "worktree" && cmd[2] === "add") {
        return { exitCode: 128, stdout: "", stderr: "fatal: something failed\n" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    expect(() =>
      createWorkspace({
        id: "w1",
        ref: SHA1,
        rootDir: root,
        run: failing,
        env: { os: "linux", wsl: false, arch: "x86_64" },
        now: NOW,
      }),
    ).toThrow(/git worktree add 'w1' failed/);
    // Partial cleanup: no directory, no record — the claim was rolled back.
    expect(existsSync(join(root, "w1"))).toBe(false);
    expect(existsSync(join(root, "w1.json"))).toBe(false);
    expect(calls.some((c) => c[2] === "prune")).toBe(true);
    // Reuse: the same id now succeeds with a working runner.
    const ok: Runner = (cmd) => ({ exitCode: 0, stdout: "", stderr: "" });
    const rec = createWorkspace({
      id: "w1",
      ref: SHA1,
      rootDir: root,
      run: ok,
      env: { os: "linux", wsl: false, arch: "x86_64" },
      now: NOW,
    });
    expect(rec.status).toBe("ready");
    expect(rec.targetDir).toBe(join(root, "w1", "target"));
    rmSync(root, { recursive: true, force: true });
  });

  test("double claim of one workspace id fails closed for the loser", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-workspace-claim-"));
    const run: Runner = (cmd) => ({ exitCode: 0, stdout: "", stderr: "" });
    createWorkspace({ id: "w1", ref: SHA1, rootDir: root, run, env: { os: "linux", wsl: false, arch: "x86_64" }, now: NOW });
    expect(() =>
      createWorkspace({ id: "w1", ref: SHA1, rootDir: root, run, env: { os: "linux", wsl: false, arch: "x86_64" }, now: NOW }),
    ).toThrow(/already exists/);
    expect(readWorkspace(root, "w1")?.status).toBe("ready");
    rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// REAL: filesystem lease store (real O_EXCL, real temp dirs)
// ---------------------------------------------------------------------------

describe("REAL: resource lease store on the filesystem", () => {
  test("acquire persists a strictly-parseable lease; corrupt state fails closed", () => {
    const { s, root } = store();
    const lease = acquire(s, "port", "tcp-9000", "worker-1", { workspace: "w1" });
    expect(lease.generation).toBe(1);
    const raw = parseJson(
      readFileSync(join(root, resourceStateName("port", "tcp-9000"), "lease-1.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw["contract_version"]).toBe("1.0.0");
    expect(raw["kind"]).toBe("port");
    expect(raw["released"]).toBe(false);
    // Corrupt the lease: the store must refuse, never guess.
    writeFileSync(join(root, resourceStateName("port", "tcp-9000"), "lease-2.json"), "{not json");
    expect(() => s.current("port", "tcp-9000")).toThrow(ContractError);
    rmSync(root, { recursive: true, force: true });
  });

  test("persisted leases carry no secret-shaped values", () => {
    const { s, root } = store();
    acquire(s, "credential", "slot-1", "worker-1");
    const file = readFileSync(join(root, resourceStateName("credential", "slot-1"), "lease-1.json"), "utf8");
    expect(/sk-|ghp_|Bearer /.test(file)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("unknown resource reads as null; release writes through atomically", () => {
    const { s } = store();
    expect(s.current("db", "nope")).toBeNull();
    const lease = acquire(s, "db", "pg-x", "worker-1");
    s.release(lease, NOW + 1);
    expect(s.current("db", "pg-x")?.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REAL: two-process resource race (real concurrent processes, O_EXCL CAS)
// ---------------------------------------------------------------------------

describe("REAL: two-process port-lease race", () => {
  test("exactly one of two concurrent processes acquires the same port", async () => {
    const { root } = store();
    const workerSource = `
import { ResourceLeaseStore } from ${JSON.stringify(join(import.meta.dir, "agent", "workspace.ts"))};
const [root] = process.argv.slice(2);
try {
  new ResourceLeaseStore(root).acquire("port", "tcp-7000", "worker-" + process.pid, {
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
        const proc = Bun.spawn(["bun", workerPath, root], { stdout: "pipe", stderr: "pipe" });
        return proc.exited.then((code) => code);
      }),
    );
    expect(procs.sort()).toEqual([0, 1]); // exactly one winner
    const s = new ResourceLeaseStore(root);
    const current = s.current("port", "tcp-7000");
    expect(current?.generation).toBe(1);
    expect(current?.owner).toMatch(/^worker-\d+$/);
    rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// REAL: git worktree creation, pinning, cleanup and reuse (real git)
// ---------------------------------------------------------------------------

describe("REAL: workspace creation against a real git repository", () => {
  test("creates a detached worktree pinned to the immutable SHA with its own target dir", () => {
    const { repo, sha } = realRepo();
    const wsRoot = mkdtempSync(join(tmpdir(), "agent-workspace-real-"));
    const rec = createWorkspace({
      id: "ticket-98",
      ref: sha,
      rootDir: wsRoot,
      run: realRun(repo),
      env: { os: "linux", wsl: false, arch: "x86_64" },
      now: NOW,
    });
    expect(rec.status).toBe("ready");
    expect(rec.ref).toBe(sha);
    expect(rec.env.wsl).toBe(false);
    // The worktree really exists and is pinned to the SHA.
    expect(realRun(rec.path)(["git", "rev-parse", "HEAD"]).stdout.trim()).toBe(sha);
    // Per-workspace mutable artifacts live inside the workspace, never shared.
    expect(rec.targetDir.startsWith(rec.path)).toBe(true);
    const rec2 = createWorkspace({
      id: "ticket-99",
      ref: sha,
      rootDir: wsRoot,
      run: realRun(repo),
      env: { os: "linux", wsl: false, arch: "x86_64" },
      now: NOW,
    });
    expect(rec2.targetDir).not.toBe(rec.targetDir);
    // Record round-trips through the strict read path.
    expect(readWorkspace(wsRoot, "ticket-98")?.ref).toBe(sha);
    // Teardown removes the worktree and the record.
    removeWorkspace(wsRoot, "ticket-98", realRun(repo));
    expect(readWorkspace(wsRoot, "ticket-98")).toBeNull();
    expect(existsSync(rec.path)).toBe(false);
    rmSync(wsRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  test("a well-formed but unknown SHA fails, cleans partial state, and the id is reusable", () => {
    const { repo, sha } = realRepo();
    const wsRoot = mkdtempSync(join(tmpdir(), "agent-workspace-real2-"));
    const badSha = "b".repeat(40);
    expect(() =>
      createWorkspace({
        id: "w1",
        ref: badSha,
        rootDir: wsRoot,
        run: realRun(repo),
        env: { os: "linux", wsl: false, arch: "x86_64" },
        now: NOW,
      }),
    ).toThrow(ContractError);
    expect(existsSync(join(wsRoot, "w1"))).toBe(false);
    expect(existsSync(join(wsRoot, "w1.json"))).toBe(false);
    // Reuse after failed setup with the real SHA.
    const rec = createWorkspace({
      id: "w1",
      ref: sha,
      rootDir: wsRoot,
      run: realRun(repo),
      env: { os: "linux", wsl: false, arch: "x86_64" },
      now: NOW,
    });
    expect(rec.status).toBe("ready");
    rmSync(wsRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// REAL: this host (Linux/WSL2) — capability probe against the real machine
// ---------------------------------------------------------------------------

describe("REAL: local host capability probe (Linux/WSL2 verification host)", () => {
  test("probe reports this host's real OS; sandbox is never claimed; no guessing", () => {
    const probe = localProbe((cmd) => {
      const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
      return { exitCode: r.exitCode ?? 1, stdout: r.stdout?.toString() ?? "", stderr: r.stderr?.toString() ?? "" };
    });
    expect(probe.platform).toBe(platform());
    const c = capabilitiesFromProbe(probe);
    if (process.platform === "linux") {
      expect(c.os).toBe("linux");
      // WSL2 verification host: /proc/version is real, detection is real.
      expect(typeof c.wsl).toBe("boolean");
    }
    // Cross-OS invariants that hold on every host: no sandbox claim, and
    // the backend is one of the two known values.
    expect(c.sandbox).toBe(false);
    expect(["worktrunk", "git-worktree"]).toContain(c.backend);
    expect(c.notes.length).toBeGreaterThan(0);
  });
});
