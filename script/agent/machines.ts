#!/usr/bin/env bun
/**
 * Machine inventory and placement suitability (Epic #86, T011 / issue #97).
 *
 * Read-only: uses `herdr machine list/status --json` (official Herdr CLI) and
 * on-demand probes of the LOCAL host only. No custom transport, no server
 * restart, no pane takeover, no retry on another host.
 *
 * Invariants:
 *   - Every SAVED herdr machine is REMOTE (isLocal=false). Only the synthetic
 *     entry for the host running this process is local.
 *   - Remote os/arch/host-identity/resources come ONLY from evidence about that
 *     machine: a declared-config file (status "configured") — Herdr 0.9.5 has
 *     no read-only exec, so there is no remote probe. Otherwise they are
 *     `unknown` attestations (value null).
 *   - `herdr machine status --json` exits 1 when any machine is in error but
 *     still writes valid JSON: stdout is parsed regardless of exit code.
 *   - Unknown host identity is never grouped: each such machine is its own
 *     group flagged sharedHostUnknown=true and counted conservatively.
 *     Windows+WSL share a group only on positive evidence (same declared or
 *     measured host id).
 *   - Availability is fail-closed: anything but "online" is unsuitable unless
 *     the caller opts in via constraints.allowAvailability.
 *   - Raw Herdr target aliases are never emitted (hash only, scrubbed from
 *     error text).
 */

import { platform, arch, totalmem, cpus } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { attest, agentStateDir, toJson, type Attested, type Evidence } from "./contract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MachineOS = "linux" | "macos" | "windows";
export type MachineAvailability = "online" | "offline" | "error" | "unknown";

/** null = unknown (never a guessed default). */
export interface MachineResources {
  cpuCores: number | null;
  ramBytes: number | null;
  hasGpu: boolean | null;
  gpuVramBytes: number | null;
  diskAvailableBytes: number | null;
}

export interface HerdrMachineProfile {
  id: string;
  label: string;
  target: string;
  session: string;
  enabled: boolean;
  selected: boolean;
}

export interface HerdrMachineStatus {
  id: string;
  label: string;
  status: string;
  error: string | null;
}

export interface Machine {
  id: string;
  label: string;
  isLocal: boolean;
  /** sha256 prefix of the Herdr target alias; the raw alias is never emitted. */
  targetHash: string | null;
  session: string | null;
  enabled: boolean;
  availability: MachineAvailability;
  error: string | null;
  os: Attested<MachineOS>;
  arch: Attested<string>;
  /** Hashed host identity; the grouping key. Unknown => no grouping. */
  hostId: Attested<string>;
  resources: Attested<MachineResources>;
  gui: Attested<boolean>;
  /** True when declared host identity contradicts the measured one. */
  identityMismatch: boolean;
}

export interface HostGroup {
  key: string;
  machineIds: string[];
  /** True when the group is a lone machine whose host identity is unknown. */
  sharedHostUnknown: boolean;
  /** Shared hardware: max over attributed members, never a sum. */
  capacity: { cpuCores: number | null; ramBytes: number | null };
}

export interface PlacementConstraints {
  os?: MachineOS[];
  arch?: string[];
  minCpuCores?: number;
  minRamBytes?: number;
  minGpuVramBytes?: number;
  gpuRequired?: boolean;
  guiRequired?: boolean;
  /** Opt-in: availabilities accepted besides "online". Default fail-closed. */
  allowAvailability?: MachineAvailability[];
  /** Host-group keys already running the GUI singleton. */
  busyGuiGroups?: string[];
  /** Soft preferences (affect score only). */
  preferOs?: MachineOS[];
  preferArch?: string[];
}

export interface Suitability {
  machineId: string;
  suitable: boolean;
  hardViolations: string[];
  softMisses: string[];
  reasoning: string[];
  score: number;
}

export interface Declared {
  os?: MachineOS;
  arch?: string;
  /** Opaque host identity; machines declaring the same value share a host. */
  hostId?: string;
  cpuCores?: number;
  ramBytes?: number;
  hasGpu?: boolean;
  gpuVramBytes?: number;
  gui?: boolean;
}

export type Runner = (cmd: string[]) => { exitCode: number; stdout: string; stderr: string };

export interface Inventory {
  machines: Machine[];
  /** Non-fatal inventory problems; an empty inventory is distinct from an errored one. */
  errors: string[];
}

export interface InventoryOptions {
  run?: Runner;
  declared?: Record<string, Declared>;
  local?: Machine | null;
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const BYTES_PER_GB = 1024 ** 3;

export function hashId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

const unknownFact = <T>(): Attested<T> => attest<T>({ value: null, status: "unknown", provenance: "estimated" });

function declaredFact<T>(value: T | undefined, evidence: Evidence): Attested<T> {
  if (value === undefined) return unknownFact<T>();
  return attest({ value, status: "configured", provenance: "estimated", evidence });
}

function measuredFact<T>(value: T | null, evidence: Evidence): Attested<T> {
  if (value === null) return unknownFact<T>();
  return attest({ value, status: "verified-live", provenance: "measured", evidence });
}

const defaultRunner: Runner = (cmd) => {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  return { exitCode: r.exitCode ?? 1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
};

export function formatBytes(bytes: number): string {
  return bytes >= BYTES_PER_GB ? `${(bytes / BYTES_PER_GB).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(2)} MB`;
}

/** Correct WSL detection from /proc/version text. */
export function detectWsl(procVersion: string): boolean {
  return /microsoft|wsl/i.test(procVersion);
}

// ---------------------------------------------------------------------------
// Herdr (official CLI, read-only)
// ---------------------------------------------------------------------------

/** Parse JSON array stdout regardless of exit code. */
function parseHerdrArray<T>(what: string, res: { exitCode: number; stdout: string; stderr: string }): T[] | string {
  try {
    const parsed = JSON.parse(res.stdout);
    if (Array.isArray(parsed)) return parsed as T[];
    return `${what}: expected a JSON array (exit ${res.exitCode})`;
  } catch {
    return `${what}: no valid JSON on stdout (exit ${res.exitCode})`;
  }
}

function herdrAvailability(status: string | undefined): MachineAvailability {
  switch ((status ?? "").toLowerCase()) {
    case "reachable":
      return "online";
    case "disabled":
      return "offline";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

function scrub(text: string | null, target: string): string | null {
  if (text === null) return null;
  return text.split(target).join("[target]").slice(0, 300);
}

export function loadDeclared(path?: string): Record<string, Declared> {
  const file = path ?? process.env.AGENT_MACHINES_DECLARED ?? join(agentStateDir(), "machines-declared.json");
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${basename(file)}: object expected`);
  return raw as Record<string, Declared>;
}

function remoteMachine(
  profile: HerdrMachineProfile,
  status: HerdrMachineStatus | undefined,
  statusKnown: boolean,
  declared: Declared | undefined,
  at: string,
): Machine {
  const ev: Evidence = { at, source: "config", note: "declared machine facts" };
  const d = declared ?? {};
  const hasRes = [d.cpuCores, d.ramBytes, d.hasGpu, d.gpuVramBytes].some((v) => v !== undefined);
  return {
    id: profile.id,
    label: profile.label,
    isLocal: false, // every saved Herdr machine is remote
    targetHash: hashId(profile.target),
    session: profile.session,
    enabled: profile.enabled,
    availability: statusKnown ? herdrAvailability(status?.status) : "unknown",
    error: scrub(status?.error ?? null, profile.target),
    os: declaredFact(d.os, ev),
    arch: declaredFact(d.arch, ev),
    hostId: declaredFact(d.hostId === undefined ? undefined : hashId(d.hostId), ev),
    resources: hasRes
      ? declaredFact<MachineResources>(
          {
            cpuCores: d.cpuCores ?? null,
            ramBytes: d.ramBytes ?? null,
            hasGpu: d.hasGpu ?? null,
            gpuVramBytes: d.gpuVramBytes ?? null,
            diskAvailableBytes: null,
          },
          ev,
        )
      : unknownFact(),
    gui: declaredFact(d.gui, ev),
    identityMismatch: false,
  };
}

// ---------------------------------------------------------------------------
// Local probe (this host only)
// ---------------------------------------------------------------------------

function sh(cmd: string[]): string | null {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  } catch {
    return null;
  }
}

function localHostId(): string | null {
  switch (platform()) {
    case "darwin":
      return sh(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"])?.match(/"IOPlatformUUID" = "([^"]+)"/)?.[1] ?? null;
    case "win32":
      return (
        sh(["powershell", "-NoProfile", "-Command", "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid"])?.trim() ||
        null
      );
    case "linux":
      try {
        return readFileSync("/etc/machine-id", "utf8").trim() || null;
      } catch {
        return null;
      }
    default:
      return null;
  }
}

function localDiskAvailable(): number | null {
  if (platform() === "win32") return null;
  const line = sh(["df", "-kP", "/"])?.split("\n")[1]?.trim().split(/\s+/);
  const kb = line ? parseInt(line[3], 10) : NaN;
  return Number.isFinite(kb) ? kb * 1024 : null;
}

function localGpu(): { hasGpu: boolean | null; vram: number | null } {
  if (platform() === "darwin") {
    const out = sh(["system_profiler", "SPDisplaysDataType"]);
    if (out === null) return { hasGpu: null, vram: null };
    const has = /Chipset Model:/.test(out);
    // Apple Silicon reports unified memory, not dedicated VRAM: leave unknown.
    return { hasGpu: has, vram: null };
  }
  if (platform() === "linux") {
    const out = sh(["lspci"]);
    if (out === null) return { hasGpu: null, vram: null };
    return { hasGpu: /VGA compatible|3D controller/i.test(out), vram: null };
  }
  return { hasGpu: null, vram: null };
}

function localGui(): boolean | null {
  if (platform() === "darwin" || platform() === "win32") return true;
  if (platform() === "linux") return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  return null;
}

export function getLocalMachine(declared?: Declared, now: () => string = () => new Date().toISOString()): Machine {
  const ev: Evidence = { at: now(), source: "probe", note: "local host probe" };
  const osName: Record<string, MachineOS> = { darwin: "macos", win32: "windows", linux: "linux" };
  const raw = localHostId();
  const hostIdHash = raw ? hashId(raw) : null;
  const gpu = localGpu();
  const resources: MachineResources = {
    cpuCores: cpus().length || null,
    ramBytes: totalmem(),
    hasGpu: gpu.hasGpu,
    gpuVramBytes: gpu.vram,
    diskAvailableBytes: localDiskAvailable(),
  };
  return {
    id: `local-${platform()}`,
    label: `Local (${platform()})`,
    isLocal: true,
    targetHash: null,
    session: null,
    enabled: true,
    availability: "online",
    error: null,
    os: measuredFact(osName[platform()] ?? null, ev),
    arch: measuredFact(arch(), ev),
    hostId: measuredFact(hostIdHash, ev),
    resources: measuredFact(resources, ev),
    gui: measuredFact(localGui(), ev),
    identityMismatch: declared?.hostId !== undefined && hostIdHash !== null && hashId(declared.hostId) !== hostIdHash,
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function getInventory(opts: InventoryOptions = {}): Inventory {
  const run = opts.run ?? defaultRunner;
  const now = opts.now ?? (() => new Date().toISOString());
  const declared = opts.declared ?? {};
  const errors: string[] = [];
  const machines: Machine[] = [];

  let profiles: HerdrMachineProfile[] = [];
  let statuses: HerdrMachineStatus[] = [];
  let statusKnown = false;
  try {
    const l = parseHerdrArray<HerdrMachineProfile>("herdr machine list", run(["herdr", "machine", "list", "--json"]));
    if (typeof l === "string") errors.push(l);
    else profiles = l;
    // exits 1 when any machine is in error but still writes JSON: parse regardless
    const s = parseHerdrArray<HerdrMachineStatus>("herdr machine status", run(["herdr", "machine", "status", "--json"]));
    if (typeof s === "string") errors.push(s);
    else {
      statuses = s;
      statusKnown = true;
    }
  } catch (e) {
    errors.push(`herdr unavailable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
  }

  const at = now();
  const byId = new Map(statuses.map((s) => [s.id, s]));
  for (const p of profiles) {
    machines.push(remoteMachine(p, byId.get(p.id), statusKnown, declared[p.id], at));
  }
  const local = opts.local === undefined ? getLocalMachine(declared.local, now) : opts.local;
  if (local) machines.push(local);
  return { machines, errors };
}

// ---------------------------------------------------------------------------
// Host groups / capacity
// ---------------------------------------------------------------------------

export function groupHosts(machines: Machine[]): HostGroup[] {
  const groups = new Map<string, HostGroup>();
  for (const m of machines) {
    const known = m.hostId.value !== null && !m.identityMismatch;
    const key = known ? `host:${m.hostId.value}` : `unknown:${hashId(m.id)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, machineIds: [], sharedHostUnknown: !known, capacity: { cpuCores: null, ramBytes: null } };
      groups.set(key, g);
    }
    g.machineIds.push(m.id);
    const r = m.resources.value;
    if (r) {
      // Same physical hardware: take the max over attributed members, never a sum.
      if (r.cpuCores !== null) g.capacity.cpuCores = Math.max(g.capacity.cpuCores ?? 0, r.cpuCores);
      if (r.ramBytes !== null) g.capacity.ramBytes = Math.max(g.capacity.ramBytes ?? 0, r.ramBytes);
    }
  }
  return [...groups.values()];
}

/**
 * Conservative capacity: known groups add up; groups of unknown host identity
 * may all be the same physical host, so together they contribute only the
 * largest single one.
 */
export function conservativeCapacity(groups: HostGroup[]): { cpuCores: number; ramBytes: number } {
  let cpu = 0;
  let ram = 0;
  let uCpu = 0;
  let uRam = 0;
  for (const g of groups) {
    if (g.sharedHostUnknown) {
      uCpu = Math.max(uCpu, g.capacity.cpuCores ?? 0);
      uRam = Math.max(uRam, g.capacity.ramBytes ?? 0);
    } else {
      cpu += g.capacity.cpuCores ?? 0;
      ram += g.capacity.ramBytes ?? 0;
    }
  }
  return { cpuCores: cpu + uCpu, ramBytes: ram + uRam };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export function evaluate(machine: Machine, c: PlacementConstraints, groups: HostGroup[] = []): Suitability {
  const hard: string[] = [];
  const soft: string[] = [];
  const why: string[] = [];
  const r = machine.resources.value;

  if (!(machine.availability === "online" || c.allowAvailability?.includes(machine.availability))) {
    hard.push(`availability ${machine.availability} is not suitable (fail-closed)`);
  }
  if (machine.identityMismatch) hard.push("host identity mismatch: declared host id contradicts measured host id");

  const need = <T>(label: string, f: Attested<T>, ok: (v: T) => boolean, detail: (v: T) => string) => {
    if (f.value === null) hard.push(`${label} unknown, cannot verify`);
    else if (!ok(f.value)) hard.push(`${label} ${detail(f.value)}`);
    else why.push(`${label} ok`);
  };
  if (c.os?.length) need("os", machine.os, (v) => c.os!.includes(v), (v) => `${v} not in ${c.os!.join(",")}`);
  if (c.arch?.length) need("arch", machine.arch, (v) => c.arch!.includes(v), (v) => `${v} not in ${c.arch!.join(",")}`);

  const res = (label: string, min: number | undefined, pick: (r: MachineResources) => number | null) => {
    if (min === undefined) return;
    const v = r ? pick(r) : null;
    if (v === null) hard.push(`${label} unknown, cannot verify minimum ${min}`);
    else if (v < min) hard.push(`${label} ${v} < minimum ${min}`);
    else why.push(`${label} ${v} >= ${min}`);
  };
  res("cpuCores", c.minCpuCores, (x) => x.cpuCores);
  res("ramBytes", c.minRamBytes, (x) => x.ramBytes);
  res("gpuVramBytes", c.minGpuVramBytes, (x) => x.gpuVramBytes);

  if (c.gpuRequired) {
    if (r?.hasGpu == null) hard.push("gpu unknown, cannot verify gpuRequired");
    else if (!r.hasGpu) hard.push("gpu required but none present");
  }
  if (c.guiRequired) {
    if (machine.gui.value === null) hard.push("gui unknown, cannot verify guiRequired");
    else if (!machine.gui.value) hard.push("gui required but unavailable");
    else {
      // GUI is a per-physical-host singleton.
      const g = groups.find((x) => x.machineIds.includes(machine.id));
      if (g && c.busyGuiGroups?.includes(g.key)) hard.push(`gui singleton already in use on host group ${g.key}`);
    }
  }

  if (c.preferOs?.length && !(machine.os.value && c.preferOs.includes(machine.os.value))) soft.push("os not preferred or unknown");
  if (c.preferArch?.length && !(machine.arch.value && c.preferArch.includes(machine.arch.value))) soft.push("arch not preferred or unknown");

  const g = groups.find((x) => x.machineIds.includes(machine.id));
  if (g?.sharedHostUnknown) why.push("host identity unknown: capacity counted conservatively");

  return {
    machineId: machine.id,
    suitable: hard.length === 0,
    hardViolations: hard,
    softMisses: soft,
    reasoning: why,
    score: hard.length === 0 ? Math.max(0, 1 - 0.1 * soft.length) : 0,
  };
}

/**
 * Pick a machine. If `requested` is given only that machine is considered:
 * when it is unsuitable the result is null — never a silent retry elsewhere.
 */
export function selectMachine(
  machines: Machine[],
  c: PlacementConstraints,
  requested?: string,
): { selected: Machine | null; evaluations: Suitability[] } {
  const groups = groupHosts(machines);
  const pool = requested === undefined ? machines : machines.filter((m) => m.id === requested);
  const evaluations = pool.map((m) => evaluate(m, c, groups));
  const best = evaluations.filter((e) => e.suitable).sort((a, b) => b.score - a.score)[0];
  return { selected: best ? (pool.find((m) => m.id === best.machineId) ?? null) : null, evaluations };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(args: string[] = process.argv.slice(2)): void {
  const [cmd = "help", ...rest] = args;
  if (cmd === "help") {
    console.log("Usage: machines <list [--json] | get ID | hosts | probe>  (read-only)");
    return;
  }
  let declared: Record<string, Declared> = {};
  try {
    declared = loadDeclared();
  } catch (e) {
    console.error(`declared config ignored: ${e instanceof Error ? e.message : String(e)}`);
  }
  const inv = getInventory({ declared });
  if (cmd === "list") {
    if (rest.includes("--json")) console.log(toJson(inv));
    else {
      for (const m of inv.machines) {
        console.log(`${m.id} ${m.label} local=${m.isLocal} availability=${m.availability} os=${m.os.value ?? "unknown"} arch=${m.arch.value ?? "unknown"}`);
      }
      for (const e of inv.errors) console.log(`inventory error: ${e}`);
    }
  } else if (cmd === "get") {
    const m = inv.machines.find((x) => x.id === rest[0]);
    if (!m) throw new Error(`machine ${rest[0] ?? ""} not found`);
    console.log(toJson(m));
  } else if (cmd === "hosts") {
    console.log(toJson(groupHosts(inv.machines)));
  } else if (cmd === "probe") {
    console.log(toJson(getLocalMachine(declared.local)));
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }
  if (inv.errors.length) process.exitCode = 1;
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error(`machines: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
