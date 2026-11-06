/**
 * T011 / #97 machines module tests.
 *
 * REAL: the "real fixture" block replays output captured from the real herdr
 *       0.9.5 CLI on macOS (script/test-fixtures/machines/*), and
 *       "local probe (real)" probes the host running the tests.
 * MOCK: everything else uses an injected Runner / declared config. No real
 *       WSL or Windows host was exercised.
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  conservativeCapacity,
  detectWsl,
  evaluate,
  getInventory,
  getLocalMachine,
  groupHosts,
  hashId,
  selectMachine,
  type Declared,
  type Machine,
  type Runner,
} from "./machines";
import { toJson } from "./contract";

const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "../test-fixtures/machines", name), "utf8"));
const NOW = () => "2026-01-01T00:00:00Z";
const GB = 1024 ** 3;

const profile = (id: string, target: string) => ({ id, label: id, target, session: "default", enabled: true, selected: false });
function runner(list: unknown, status: unknown, statusExit = 0, listExit = 0): Runner {
  return (cmd) =>
    cmd[2] === "list"
      ? { exitCode: listExit, stdout: typeof list === "string" ? list : JSON.stringify(list), stderr: "" }
      : { exitCode: statusExit, stdout: typeof status === "string" ? status : JSON.stringify(status), stderr: "" };
}
const st = (id: string, status: string, error: string | null = null) => ({ id, label: id, status, error });
const inv = (profiles: any[], statuses: any[], declared: Record<string, Declared> = {}, statusExit = 0) =>
  getInventory({ run: runner(profiles, statuses, statusExit), declared, local: null, now: NOW });
const get = (m: Machine[], id: string) => m.find((x) => x.id === id)!;

describe("real fixture: herdr 0.9.5 on macOS (REAL CLI output)", () => {
  const real = fx("herdr-real-macos.json");
  it("status exits 1 yet stdout is parsed; error surfaces as availability=error", () => {
    expect(real.statusExit).toBe(1);
    const r = getInventory({ run: runner(real.list, real.status, real.statusExit), local: null, now: NOW });
    expect(r.errors).toEqual([]);
    expect(r.machines.map((m) => m.availability).sort()).toEqual(["error", "offline", "offline", "online"]);
    expect(r.machines.every((m) => m.isLocal === false)).toBe(true);
  });
  it("saved list output: targets hashed, never raw; error text scrubbed", () => {
    const r = getInventory({ run: runner(real.list, real.status, 1), local: null, now: NOW });
    const out = toJson(r);
    for (const p of real.list) expect(out).not.toContain(p.target);
    expect(out).toContain(hashId("target-1"));
  });
  it("stored real `machines.ts list --json` run keeps its real exit code and has no local-identity leakage onto remotes", () => {
    const f = fx("machines-list-real-macos.json");
    expect(f.exitCode).toBe(0);
    const remotes = f.output.machines.filter((m: any) => !m.isLocal);
    expect(remotes.length).toBe(4);
    for (const m of remotes) {
      expect(m.os.value).toBeNull();
      expect(m.arch.value).toBeNull();
      expect(m.resources.value).toBeNull();
      expect(m.hostId.value).toBeNull();
      expect(m.resources.status).toBe("unknown");
    }
    expect(remotes.find((m: any) => m.availability === "error").error).not.toContain("device-windows");
  });
});

describe("local probe (REAL, this host)", () => {
  it("is the only local entry and carries measured evidence", () => {
    const m = getLocalMachine(undefined, NOW);
    expect(m.isLocal).toBe(true);
    expect(m.os.status).toBe("verified-live");
    expect(m.resources.value!.cpuCores).toBeGreaterThan(0);
    expect(m.resources.value!.ramBytes).toBeGreaterThan(0);
    expect(m.availability).toBe("online");
  });
  it("host identity mismatch between declared and measured makes it unsuitable", () => {
    const m = getLocalMachine({ hostId: "definitely-not-this-host" }, NOW);
    if (m.hostId.value === null) return; // platform without a host id: nothing to compare
    expect(m.identityMismatch).toBe(true);
    const e = evaluate(m, {}, groupHosts([m]));
    expect(e.suitable).toBe(false);
    expect(e.hardViolations.join()).toContain("mismatch");
    expect(groupHosts([m])[0].sharedHostUnknown).toBe(true);
  });
});

describe("remote machines (MOCK runner)", () => {
  it("all saved herdr machines are remote even when target looks like localhost", () => {
    const r = inv([profile("a", "localhost"), profile("b", "127.0.0.1"), profile("c", "device-wsl")], []);
    expect(r.machines.every((m) => !m.isLocal)).toBe(true);
  });
  it("no evidence => os/arch/resources/host unknown, not inherited from the local host", () => {
    const m = get(inv([profile("a", "t")], [st("a", "reachable")]).machines, "a");
    expect(m.os.value).toBeNull();
    expect(m.arch.value).toBeNull();
    expect(m.hostId.value).toBeNull();
    expect(m.resources).toMatchObject({ value: null, status: "unknown" });
  });
  it("declared facts are 'configured' with config provenance, not 'verified-live'", () => {
    const m = get(inv([profile("a", "t")], [st("a", "reachable")], { a: { os: "windows", arch: "x64", cpuCores: 16, ramBytes: 32 * GB, hostId: "H" } }).machines, "a");
    expect(m.os).toMatchObject({ value: "windows", status: "configured" });
    expect(m.os.evidence?.source).toBe("config");
    expect(m.resources.value!.cpuCores).toBe(16);
    expect(m.resources.value!.hasGpu).toBeNull();
  });
  it("status exit 1 with valid stdout still maps error/offline; label never decides OS", () => {
    const r = inv([profile("win", "t1"), profile("wsl", "t2")], [st("win", "error", "boom t1"), st("wsl", "disabled")], {}, 1);
    expect(get(r.machines, "win").availability).toBe("error");
    expect(get(r.machines, "win").error).toBe("boom [target]");
    expect(get(r.machines, "wsl").availability).toBe("offline");
    expect(get(r.machines, "win").os.value).toBeNull();
  });
  it("unparseable status => inventory error + availability unknown (fail-closed), not empty inventory", () => {
    const r = getInventory({ run: runner([profile("a", "t")], "not json", 1), local: null, now: NOW });
    expect(r.errors.length).toBe(1);
    expect(get(r.machines, "a").availability).toBe("unknown");
  });
  it("herdr missing is an inventory error, local entry still present", () => {
    const r = getInventory({ run: () => { throw new Error("ENOENT"); }, now: NOW });
    expect(r.errors[0]).toContain("herdr unavailable");
    expect(r.machines.length).toBe(1);
    expect(r.machines[0].isLocal).toBe(true);
  });
});

describe("host groups and capacity", () => {
  const decl = { win: { hostId: "PC1", cpuCores: 16, ramBytes: 64 * GB }, wsl: { hostId: "PC1", cpuCores: 16, ramBytes: 32 * GB } };
  const profiles = [profile("win", "t1"), profile("wsl", "t2")];
  const all = [st("win", "reachable"), st("wsl", "reachable")];

  it("Windows+WSL share one group on positive evidence; capacity is max, not sum", () => {
    const g = groupHosts(inv(profiles, all, decl).machines);
    expect(g.length).toBe(1);
    expect(g[0].sharedHostUnknown).toBe(false);
    expect(g[0].capacity).toEqual({ cpuCores: 16, ramBytes: 64 * GB });
    expect(conservativeCapacity(g)).toEqual({ cpuCores: 16, ramBytes: 64 * GB });
  });
  it("without evidence they are NOT grouped: separate groups, each sharedHostUnknown, no constant hash", () => {
    const g = groupHosts(inv(profiles, all).machines);
    expect(g.length).toBe(2);
    expect(g.every((x) => x.sharedHostUnknown)).toBe(true);
    expect(new Set(g.map((x) => x.key)).size).toBe(2);
  });
  it("unknown-host groups count conservatively: only the largest contributes (they may be one host)", () => {
    const g = groupHosts(inv(profiles, all, { win: { cpuCores: 8, ramBytes: 16 * GB }, wsl: { cpuCores: 12, ramBytes: 8 * GB } }).machines);
    expect(conservativeCapacity(g)).toEqual({ cpuCores: 12, ramBytes: 16 * GB });
  });
  it("group representative is not the first machine's resources: unattributed members add nothing", () => {
    const g = groupHosts(inv(profiles, all, { win: { hostId: "PC1" }, wsl: { hostId: "PC1", cpuCores: 4 } }).machines);
    expect(g[0].capacity).toEqual({ cpuCores: 4, ramBytes: null });
  });
  it("distinct declared hosts stay separate", () => {
    const g = groupHosts(inv(profiles, all, { win: { hostId: "A" }, wsl: { hostId: "B" } }).machines);
    expect(g.length).toBe(2);
    expect(g.every((x) => !x.sharedHostUnknown)).toBe(true);
  });
});

describe("placement", () => {
  const base = (d: Declared, status = "reachable") => get(inv([profile("m", "t")], [st("m", status)], { m: d }).machines, "m");
  it("availability is fail-closed: error/offline/unknown unsuitable by default", () => {
    for (const s of ["error", "disabled", "weird"]) expect(evaluate(base({}, s), {}).suitable).toBe(false);
    expect(evaluate(base({}), {}).suitable).toBe(true);
  });
  it("explicit opt-in allows non-online", () => {
    expect(evaluate(base({}, "error"), { allowAvailability: ["error"] }).suitable).toBe(true);
  });
  it("resource unknown fails hard minimums with a stated reason", () => {
    const e = evaluate(base({}), { minCpuCores: 4, minRamBytes: GB, guiRequired: true, os: ["linux"] });
    expect(e.suitable).toBe(false);
    expect(e.hardViolations.filter((v) => v.includes("unknown")).length).toBe(4);
  });
  it("hard constraints satisfied from declared evidence", () => {
    const e = evaluate(base({ os: "linux", arch: "arm64", cpuCores: 8, ramBytes: 16 * GB, hasGpu: true, gpuVramBytes: 8 * GB, gui: true }), {
      os: ["linux"], arch: ["arm64"], minCpuCores: 4, minRamBytes: 8 * GB, gpuRequired: true, minGpuVramBytes: 4 * GB, guiRequired: true,
    });
    expect(e.suitable).toBe(true);
    expect(e.reasoning.length).toBeGreaterThan(4);
  });
  it("soft misses lower score but do not exclude", () => {
    const e = evaluate(base({ os: "linux" }), { preferOs: ["macos"] });
    expect(e.suitable).toBe(true);
    expect(e.softMisses.length).toBe(1);
    expect(e.score).toBeLessThan(1);
  });
  it("GUI is a singleton per physical host group (Windows+WSL share it on positive evidence)", () => {
    const r = inv([profile("win", "t1"), profile("wsl", "t2")], [st("win", "reachable"), st("wsl", "reachable")], {
      win: { hostId: "PC1", gui: true },
      wsl: { hostId: "PC1", gui: true },
    });
    const groups = groupHosts(r.machines);
    const c = { guiRequired: true, busyGuiGroups: [groups[0].key] };
    expect(evaluate(get(r.machines, "wsl"), c, groups).suitable).toBe(false);
    expect(evaluate(get(r.machines, "wsl"), { guiRequired: true }, groups).suitable).toBe(true);
  });
});

describe("no silent retry on another host", () => {
  it("requested machine unreachable => null selection, other healthy machine untouched", () => {
    const r = inv([profile("a", "t1"), profile("b", "t2")], [st("a", "error"), st("b", "reachable")]);
    const s = selectMachine(r.machines, {}, "a");
    expect(s.selected).toBeNull();
    expect(s.evaluations.map((e) => e.machineId)).toEqual(["a"]);
    expect(selectMachine(r.machines, {}).selected?.id).toBe("b");
  });
});

describe("misc", () => {
  it("WSL detection precedence is correct", () => {
    expect(detectWsl("Linux version 5.15.90.1-microsoft-standard-WSL2")).toBe(true);
    expect(detectWsl("Linux version 6.1.0-debian")).toBe(false);
    expect(detectWsl("")).toBe(false);
  });
});

describe("cold review round 3: fail-closed regressions", () => {
  it("conservative capacity never adds unknown-host capacity on top of known groups", () => {
    const g = groupHosts(
      inv([profile("a", "t1"), profile("b", "t2")], [st("a", "reachable"), st("b", "reachable")], {
        a: { hostId: "H1", cpuCores: 8, ramBytes: 32 * GB },
        b: { cpuCores: 16, ramBytes: 64 * GB },
      }).machines,
    );
    // b has no declared hostId => its own sharedHostUnknown group; the bound is
    // max(known sum, largest unknown group), never their sum.
    expect(conservativeCapacity(g)).toEqual({ cpuCores: 16, ramBytes: 64 * GB });
  });
  it("a busy unknown-host gui machine blocks every other unknown-host gui candidate", () => {
    const r = inv([profile("u1", "t1"), profile("u2", "t2")], [st("u1", "reachable"), st("u2", "reachable")], {
      u1: { gui: true },
      u2: { gui: true },
    });
    const groups = groupHosts(r.machines);
    const busyKey = groups.find((g) => g.machineIds.includes("u1"))!.key;
    const e = evaluate(get(r.machines, "u2"), { guiRequired: true, busyGuiGroups: [busyKey] }, groups);
    expect(e.suitable).toBe(false);
    expect(e.hardViolations.join()).toContain("host identity unknown");
  });
  it("declared facts of the wrong type are unknown, never satisfy a constraint", () => {
    const m = get(
      inv([profile("a", "t")], [st("a", "reachable")], {
        a: { os: 42, arch: 7, hostId: "", cpuCores: "8", ramBytes: -1, hasGpu: "yes", gui: "true" } as unknown as Declared,
      }).machines,
      "a",
    );
    expect(m.os.value).toBeNull();
    expect(m.arch.value).toBeNull();
    expect(m.resources.value).toBeNull();
    expect(m.gui.value).toBeNull();
    expect(evaluate(m, { os: ["linux"], guiRequired: true }).suitable).toBe(false);
  });
});
