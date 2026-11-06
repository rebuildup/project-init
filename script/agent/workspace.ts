#!/usr/bin/env bun
/**
 * Workspace, runtime and mutable-resource lease arbitration for agent
 * workers (Epic #86, T012 / issue #98).
 *
 * Scope (issue #98):
 *   - one isolated worktree per worker: Worktrunk preferred on Linux/WSL,
 *     native `git worktree` fallback; the backend choice is a reported
 *     fact, never proof of isolation by itself;
 *   - exclusive leases for shared mutable resources (port, db, queue,
 *     cache, credential slot, GUI singleton, target-dir) so two workers
 *     can never hold the same resource; a lease that cannot be acquired
 *     is reported (throw, or null from `tryAcquire`) so the caller can
 *     queue or block — it is never silently shared;
 *   - per-workspace mutable artifact directories (Rust `target/`, caches):
 *     always inside the workspace path, never shared between workers;
 *   - OS capability differences (Linux / WSL / macOS / Windows) are applied
 *     through an explicit capability object. A workspace is NEVER sandbox
 *     evidence: `sandbox` is true only when a separately verified isolation
 *     mechanism is passed in. Unknown facts (GUI, sandbox) stay unknown and
 *     fail closed — never guessed.
 *
 * Verification status: real behavior verified on Linux (WSL2 host). macOS
 * and Windows-native behavior is parameterized but UNVERIFIED — no test
 * below claims otherwise.
 *
 * State ownership (extends ADR-0015 §8): `<agentStateDir>/workspace/`
 * (resource leases + workspace records) belongs to issue #98 / this
 * module. Only redacted, non-secret data is written there (via
 * `redactJson`); resource ids that look like secret values are refused.
 *
 * Reused contract: identity/time/owner validation comes from
 * `contract.ts` + `attempts.ts` (#87/#99), the OS type and Runner
 * abstraction from `machines.ts` (#97). No shapes are redefined here.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  REDACTED,
  agentStateDir,
  expectFields,
  isPlainObject,
  looksLikeSecretValue,
  parseEnvelope,
  parseJson,
  redactJson,
  requireBool,
  requireStr,
} from "./contract.ts";
import {
  MAX_EPOCH_MS,
  MAX_GENERATION,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  isoTime,
  requireEpochMs,
  requireGeneration,
  requireImmutableRef,
  requireIsoTime,
  validateOwner,
} from "./attempts.ts";
import { detectWsl, type MachineOS, type Runner } from "./machines.ts";

// ---------------------------------------------------------------------------
// Resource kinds and ids
// ---------------------------------------------------------------------------

/**
 * Kinds of shared mutable resources a worker must lease exclusively before
 * use. `gui-singleton` additionally requires verified GUI capability.
 */
export type ResourceKind =
  | "port"
  | "db"
  | "queue"
  | "cache"
  | "credential"
  | "gui-singleton"
  | "target-dir";

const RESOURCE_KINDS: readonly ResourceKind[] = [
  "port",
  "db",
  "queue",
  "cache",
  "credential",
  "gui-singleton",
  "target-dir",
];

const MAX_ID_LEN = 64;

/**
 * Validate a resource/workspace id: a stable, non-secret, filesystem-safe
 * slug. Path traversal (`..`, separators, leading dots/dashes) and
 * secret-shaped values are refused outright — an id is used as a lease
 * identity and hashed into file names, but it must never carry a path or
 * a credential.
 */
export function parseResourceId(raw: unknown, where: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_ID_LEN) {
    throw new ContractError("identity", `${where}: must be a non-empty string of at most ${MAX_ID_LEN} chars`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw)) {
    throw new ContractError("identity", `${where}: only [A-Za-z0-9._-] allowed, must start alphanumeric`);
  }
  if (raw.includes("..")) {
    throw new ContractError("identity", `${where}: '..' is not allowed in an id`);
  }
  if (looksLikeSecretValue(raw)) {
    throw new ContractError("identity", `${where}: secret-shaped ids are refused`);
  }
  return raw;
}

/** Validate a TCP port for a `port` lease: a real integer in [1, 65535]. */
export function parsePort(raw: unknown, where: string): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 65535
  ) {
    throw new ContractError("schema", `${where}: must be an integer in [1, 65535]`);
  }
  return raw;
}

/** Canonical resource id for a port lease. */
export function portResourceId(port: number): string {
  return `tcp-${parsePort(port, "port")}`;
}

/** Filesystem-safe, collision-free directory name for a resource lease. */
export function resourceStateName(kind: ResourceKind, id: string): string {
  if (!RESOURCE_KINDS.includes(kind)) {
    throw new ContractError("schema", `resourceStateName: unknown kind '${String(kind)}'`);
  }
  parseResourceId(id, "resourceStateName.id");
  return createHash("sha256").update(`${kind}:${id}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Resource leases (generation leases; O_EXCL is the CAS)
// ---------------------------------------------------------------------------

/** All fields of a persisted resource lease; unknown fields are rejected. */
export const RESOURCE_LEASE_FIELDS = [
  "kind",
  "resourceId",
  "generation",
  "owner",
  "workspace",
  "acquiredAt",
  "expiresAt",
  "released",
] as const;

/** One exclusive lease on a shared mutable resource. */
export interface ResourceLease {
  kind: ResourceKind;
  resourceId: string;
  /** Monotonic per-resource generation; a takeover always increments it. */
  generation: number;
  owner: string;
  /** Workspace id holding the lease, when known. */
  workspace: string | null;
  acquiredAt: string;
  expiresAt: string;
  released: boolean;
}

function requireLeaseOptions(options: unknown): { now: number; leaseMs: number } {
  if (!isPlainObject(options)) {
    throw new ContractError("schema", "lease options must be an object");
  }
  const now = requireEpochMs(options["now"], "options.now");
  const leaseMs = options["leaseMs"];
  if (
    typeof leaseMs !== "number" ||
    !Number.isInteger(leaseMs) ||
    leaseMs < MIN_LEASE_MS ||
    leaseMs > MAX_LEASE_MS
  ) {
    throw new ContractError(
      "schema",
      `options.leaseMs: must be an integer in [${MIN_LEASE_MS}, ${MAX_LEASE_MS}]`,
    );
  }
  if (now + leaseMs > MAX_EPOCH_MS) {
    throw new ContractError("schema", "options: now + leaseMs overflows the representable date range");
  }
  return { now, leaseMs };
}

/** Parse a resource lease from untrusted data. Unknown/missing fields throw. */
export function parseResourceLease(raw: unknown, where: string): ResourceLease {
  const { payload } = parseEnvelope(raw, RESOURCE_LEASE_FIELDS, where);
  for (const field of RESOURCE_LEASE_FIELDS) {
    if (payload[field] === undefined) {
      throw new ContractError("schema", `${where}: missing field '${field}'`);
    }
  }
  const kind = payload["kind"];
  if (typeof kind !== "string" || !RESOURCE_KINDS.includes(kind as ResourceKind)) {
    throw new ContractError("schema", `${where}: unknown resource kind`);
  }
  const resourceId = parseResourceId(payload["resourceId"], `${where}.resourceId`);
  const generation = requireGeneration(payload["generation"], `${where}.generation`);
  const owner = validateOwner(payload["owner"], `${where}.owner`);
  const workspaceRaw = payload["workspace"];
  const workspace =
    workspaceRaw === null ? null : parseResourceId(workspaceRaw, `${where}.workspace`);
  const acquiredAt = requireIsoTime(payload["acquiredAt"], `${where}.acquiredAt`);
  const expiresAt = requireIsoTime(payload["expiresAt"], `${where}.expiresAt`);
  const released = requireBool(payload, "released", where);
  if (Date.parse(expiresAt) <= Date.parse(acquiredAt)) {
    throw new ContractError("schema", `${where}: expiresAt must be after acquiredAt`);
  }
  return { kind: kind as ResourceKind, resourceId, generation, owner, workspace, acquiredAt, expiresAt, released };
}

/** A lease read from disk must agree with the resource it was read for. */
function checkLeaseIdentity(lease: ResourceLease, kind: ResourceKind, id: string, where: string): void {
  if (lease.kind !== kind || lease.resourceId !== id) {
    throw new ContractError(
      "identity",
      `${where}: lease is for '${lease.kind}:${lease.resourceId}', not '${kind}:${id}'`,
    );
  }
}

/**
 * Real filesystem store for resource leases. Acquisition is an
 * `open(path, "wx")` (O_EXCL) exclusive create on a generation-numbered
 * lease file — kernel-atomic, so concurrent acquirers race on the syscall,
 * never on read-then-write logic. A held (unreleased, unexpired) lease
 * rejects a second acquirer; an expired or released lease is taken over
 * by the NEXT generation, which also invalidates the previous holder's
 * view.
 */
export class ResourceLeaseStore {
  private readonly root: string;

  constructor(root: string = join(agentStateDir(), "workspace", "leases")) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new ContractError("state", "ResourceLeaseStore: root must be a non-empty path");
    }
    this.root = root;
  }

  private dir(kind: ResourceKind, id: string): string {
    return join(this.root, resourceStateName(kind, id));
  }

  private leasePath(kind: ResourceKind, id: string, generation: number): string {
    return join(this.dir(kind, id), `lease-${generation}.json`);
  }

  /**
   * The newest lease for a resource (released or not), or null. Corrupt
   * state throws — a broken lease file is never silently ignored.
   */
  current(kind: ResourceKind, id: string): ResourceLease | null {
    const dir = this.dir(kind, id);
    if (!existsSync(dir)) return null;
    let newest = 0;
    for (const name of readdirSync(dir)) {
      const match = /^lease-(\d+)\.json$/.exec(name);
      if (match) newest = Math.max(newest, Number(match[1]));
    }
    if (newest === 0) return null;
    const raw = parseJson(readFileSync(this.leasePath(kind, id, newest), "utf8"));
    const lease = parseResourceLease(raw, `lease(${kind}:${id}#${newest})`);
    checkLeaseIdentity(lease, kind, id, `lease(${kind}:${id}#${newest})`);
    return lease;
  }

  /**
   * Acquire an exclusive lease. Throws `ContractError`("state") when the
   * resource is currently held by an unexpired lease — the caller queues
   * or blocks on this. An expired/released lease is taken over with an
   * incremented generation.
   *
   * `gui-singleton` leases require a `capabilities` object whose `gui` is
   * `true`; `false` (measured absence) or `null`/absent (unknown) refuses
   * the lease — GUI availability is never guessed.
   */
  acquire(
    kind: ResourceKind,
    id: string,
    owner: string,
    options: { now: number; leaseMs: number; workspace?: string | null; capabilities?: WorkspaceCapabilities | null },
  ): ResourceLease {
    if (!RESOURCE_KINDS.includes(kind)) {
      throw new ContractError("schema", `acquire: unknown resource kind '${String(kind)}'`);
    }
    parseResourceId(id, "acquire.resourceId");
    validateOwner(owner, "acquire.owner");
    const { now, leaseMs } = requireLeaseOptions(options);
    const workspace = options["workspace"] ?? null;
    if (workspace !== null) parseResourceId(workspace, "acquire.workspace");
    if (kind === "gui-singleton") {
      const caps = options["capabilities"];
      if (!isPlainObject(caps) || caps["gui"] !== true) {
        throw new ContractError(
          "state",
          "acquire: a gui-singleton lease requires capabilities with gui=true (unknown GUI is refused, never guessed)",
        );
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = this.current(kind, id);
      if (current && !current.released && Date.parse(current.expiresAt) > now) {
        throw new ContractError(
          "state",
          `resource '${kind}:${id}' is held by '${current.owner}' (workspace ${String(
            current.workspace,
          )}) until ${current.expiresAt}; queue or block instead of sharing`,
        );
      }
      const generation = current ? current.generation + 1 : 1;
      if (generation > MAX_GENERATION) {
        throw new ContractError("state", `resource '${kind}:${id}': generation overflow`);
      }
      const lease: ResourceLease = {
        kind,
        resourceId: id,
        generation,
        owner,
        workspace,
        acquiredAt: isoTime(now),
        expiresAt: isoTime(now + leaseMs),
        released: false,
      };
      if (this.exclusiveCreate(kind, id, generation, lease)) return lease;
      // Lost a takeover race (EEXIST): re-read and retry; the winner's
      // lease will be seen as held on the next pass.
    }
    throw new ContractError("state", `resource '${kind}:${id}': lost the lease takeover race repeatedly`);
  }

  /** Like `acquire`, but a held resource yields null instead of throwing. */
  tryAcquire(
    kind: ResourceKind,
    id: string,
    owner: string,
    options: { now: number; leaseMs: number; workspace?: string | null; capabilities?: WorkspaceCapabilities | null },
  ): ResourceLease | null {
    try {
      return this.acquire(kind, id, owner, options);
    } catch (error) {
      if (error instanceof ContractError && error.code === "state") return null;
      throw error;
    }
  }

  /**
   * Release a lease. Only the lease's own holder, at the newest
   * generation, may release; releasing an EXPIRED lease is allowed
   * (cleanup). Idempotent for the same holder+generation.
   */
  release(lease: ResourceLease, now: number): void {
    requireEpochMs(now, "release.now");
    const parsed = parseResourceLease(
      { contract_version: CONTRACT_VERSION, ...lease },
      "release.lease",
    );
    checkLeaseIdentity(parsed, parsed.kind, parsed.resourceId, "release.lease");
    const stored = this.current(parsed.kind, parsed.resourceId);
    if (stored === null) {
      throw new ContractError("state", `release: no lease exists for '${parsed.kind}:${parsed.resourceId}'`);
    }
    if (stored.generation !== parsed.generation) {
      throw new ContractError(
        "state",
        `release: lease generation ${parsed.generation} is superseded by ${stored.generation}`,
      );
    }
    if (stored.owner !== parsed.owner) {
      throw new ContractError("state", `release: lease is held by '${stored.owner}', not '${parsed.owner}'`);
    }
    if (stored.released) return; // idempotent
    this.writeAtomic(
      this.leasePath(parsed.kind, parsed.resourceId, parsed.generation),
      redactJson({ contract_version: CONTRACT_VERSION, ...stored, released: true }),
    );
  }

  /** O_EXCL create of one generation's lease file. false = already exists. */
  private exclusiveCreate(kind: ResourceKind, id: string, generation: number, lease: ResourceLease): boolean {
    const dir = this.dir(kind, id);
    mkdirSync(dir, { recursive: true });
    let fd: number;
    try {
      fd = openSync(this.leasePath(kind, id, generation), "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeFileSync(fd, redactJson({ contract_version: CONTRACT_VERSION, ...lease }), "utf8");
    } finally {
      closeSync(fd);
    }
    return true;
  }

  /** Atomic replace: write a temp sibling, then rename over the target. */
  private writeAtomic(path: string, contents: string): void {
    const dir = path.slice(0, path.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    writeFileSync(tmp, contents, "utf8");
    try {
      renameSync(tmp, path);
    } catch (error) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* the rename error is the one to report */
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// OS capability matrix
// ---------------------------------------------------------------------------

export type WorkspaceBackend = "worktrunk" | "git-worktree";

const BACKENDS: readonly WorkspaceBackend[] = ["worktrunk", "git-worktree"];

/**
 * Per-host capability facts applied to workspace decisions. `sandbox` is
 * true ONLY when a separately verified isolation mechanism exists — a
 * worktree/workspace alone is never sandbox evidence. `gui: null` means
 * unknown and fails closed at the lease layer.
 */
export interface WorkspaceCapabilities {
  os: MachineOS;
  wsl: boolean;
  backend: WorkspaceBackend;
  sandbox: boolean;
  gui: boolean | null;
  notes: string[];
}

const OS_VALUES: readonly MachineOS[] = ["linux", "macos", "windows"];

/** Everything the pure capability function needs to know about a host. */
export interface HostProbe {
  /** `process.platform()` value: `linux`, `darwin`, `win32`. */
  platform: string;
  /** `/proc/version` contents on Linux; null elsewhere/unreadable. */
  procVersion: string | null;
  /** `wt --version` output, or null when Worktrunk is absent/unusable. */
  worktrunkVersion: string | null;
  /** Measured GUI availability; null = unknown (SSH session, headless…). */
  gui: boolean | null;
  /** True only when a verified sandbox mechanism was measured on this host. */
  sandboxVerified: boolean;
}

/**
 * Derive workspace capabilities from a host probe. Fails closed: an
 * unknown platform throws, Worktrunk is only claimed on Linux/WSL (its
 * macOS/Windows behavior is UNVERIFIED and never selected), and `sandbox`
 * can only become true through explicit `sandboxVerified` evidence.
 */
export function capabilitiesFromProbe(probe: unknown): WorkspaceCapabilities {
  if (!isPlainObject(probe)) {
    throw new ContractError("schema", "capabilitiesFromProbe: probe must be an object");
  }
  expectFields(
    probe,
    ["platform", "procVersion", "worktrunkVersion", "gui", "sandboxVerified"],
    "probe",
  );
  const platform = requireStr(probe, "platform", "probe.platform");
  const platformOs: Record<string, MachineOS> = { darwin: "macos", win32: "windows", linux: "linux" };
  const os = platformOs[platform];
  if (os === undefined) {
    throw new ContractError("schema", `probe.platform: unsupported platform '${platform}'`);
  }
  const wsl = os === "linux" && probe["procVersion"] !== null && detectWsl(String(probe["procVersion"]));
  const worktrunkAvailable =
    typeof probe["worktrunkVersion"] === "string" && probe["worktrunkVersion"].length > 0;
  const guiRaw = probe["gui"];
  const gui = guiRaw === null ? null : requireBool(probe, "gui", "probe.gui");
  const sandboxVerified = requireBool(probe, "sandboxVerified", "probe.sandboxVerified");

  const notes: string[] = [
    "a workspace/worktree is not sandbox evidence; process/port/db/queue/cache/credential/GUI isolation comes from explicit leases and a verified sandbox mechanism only",
  ];
  let backend: WorkspaceBackend;
  if (os === "linux") {
    backend = worktrunkAvailable ? "worktrunk" : "git-worktree";
    notes.push(
      wsl
        ? "WSL host: Worktrunk preferred when available, native git worktree fallback"
        : "native Linux host: Worktrunk preferred when available, native git worktree fallback",
    );
  } else {
    backend = "git-worktree";
    notes.push(
      `${os}: Worktrunk behavior is UNVERIFIED on this OS; native git worktree is the only claimed backend`,
    );
  }
  if (!sandboxVerified) {
    notes.push("sandbox: no verified isolation mechanism recorded; sandbox=false");
  }
  if (gui === null) {
    notes.push("gui: unknown (headless or non-console session); gui-singleton leases will be refused");
  }
  return { os, wsl, backend, sandbox: sandboxVerified, gui, notes };
}

/** Probe the real host this process runs on (Linux/WSL/macOS/Windows). */
export function localProbe(run: Runner): HostProbe {
  let procVersion: string | null = null;
  if (process.platform === "linux") {
    try {
      procVersion = readFileSync("/proc/version", "utf8");
    } catch {
      procVersion = null;
    }
  }
  const wt = run(["wt", "--version"]);
  const worktrunkVersion = wt.exitCode === 0 ? wt.stdout.toString().trim() || null : null;
  return {
    platform: process.platform,
    procVersion,
    worktrunkVersion,
    gui: null, // console/GUI session detection is machines.ts (#97)'s measured fact; not re-guessed here
    sandboxVerified: false, // no sandbox mechanism is verified by this module
  };
}

// ---------------------------------------------------------------------------
// Workspaces (isolated worktree per worker)
// ---------------------------------------------------------------------------

/** Workspace record fields; unknown fields are rejected on read. */
export const WORKSPACE_RECORD_FIELDS = [
  "id",
  "ref",
  "backend",
  "path",
  "targetDir",
  "status",
  "env",
  "createdAt",
] as const;

export type WorkspaceStatus = "creating" | "ready";

/**
 * A prepared workspace: an isolated worktree pinned to an immutable SHA,
 * with its own mutable artifact directory (`targetDir`) that is never
 * shared with another worker.
 */
export interface WorkspaceRecord {
  id: string;
  /** Immutable input SHA the workspace is pinned to. */
  ref: string;
  backend: WorkspaceBackend;
  path: string;
  /** Per-workspace mutable artifact dir (Rust target/, caches). */
  targetDir: string;
  status: WorkspaceStatus;
  /** Environment identity of the host that created the workspace. */
  env: { os: MachineOS; wsl: boolean; arch: string };
  createdAt: string;
}

/** Parse a workspace record from untrusted data. Unknown/missing fields throw. */
export function parseWorkspaceRecord(raw: unknown, where: string): WorkspaceRecord {
  const { payload } = parseEnvelope(raw, WORKSPACE_RECORD_FIELDS, where);
  for (const field of WORKSPACE_RECORD_FIELDS) {
    if (payload[field] === undefined) {
      throw new ContractError("schema", `${where}: missing field '${field}'`);
    }
  }
  const id = parseResourceId(payload["id"], `${where}.id`);
  const ref = requireImmutableRef(payload["ref"], `${where}.ref`);
  const backend = payload["backend"];
  if (typeof backend !== "string" || !BACKENDS.includes(backend as WorkspaceBackend)) {
    throw new ContractError("schema", `${where}: unknown backend`);
  }
  const path = requireStr(payload, "path", where);
  const targetDir = requireStr(payload, "targetDir", where);
  if (!targetDir.startsWith(path)) {
    throw new ContractError(
      "state",
      `${where}: targetDir must live inside the workspace path (mutable artifacts are never shared)`,
    );
  }
  const status = payload["status"];
  if (status !== "creating" && status !== "ready") {
    throw new ContractError("schema", `${where}: status must be 'creating' or 'ready'`);
  }
  const envRaw = payload["env"];
  if (!isPlainObject(envRaw)) {
    throw new ContractError("schema", `${where}.env: object expected`);
  }
  expectFields(envRaw, ["os", "wsl", "arch"], `${where}.env`);
  const os = envRaw["os"];
  if (typeof os !== "string" || !OS_VALUES.includes(os as MachineOS)) {
    throw new ContractError("schema", `${where}.env.os: unknown OS`);
  }
  const wsl = requireBool(envRaw, "wsl", `${where}.env`);
  if (wsl && os !== "linux") {
    throw new ContractError("schema", `${where}.env: wsl=true requires os='linux'`);
  }
  const arch = requireStr(envRaw, "arch", `${where}.env.arch`);
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(arch)) {
    throw new ContractError("schema", `${where}.env.arch: invalid arch slug`);
  }
  const createdAt = requireIsoTime(payload["createdAt"], `${where}.createdAt`);
  return {
    id,
    ref,
    backend: backend as WorkspaceBackend,
    path,
    targetDir,
    status,
    env: { os: os as MachineOS, wsl, arch },
    createdAt,
  };
}

export interface CreateWorkspaceOptions {
  id: string;
  /** Immutable SHA to pin the worktree to (git commit SHA). */
  ref: string;
  /** Directory that holds one subdirectory per workspace. */
  rootDir: string;
  /** Git command runner; bind cwd to the source repo in the caller. */
  run: Runner;
  /** Environment identity of the creating host (measured, not guessed). */
  env: { os: MachineOS; wsl: boolean; arch: string };
  now: number;
}

function capText(raw: string, cap = 300): string {
  const flat = raw.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
  const capped = flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
  return looksLikeSecretValue(capped) ? REDACTED : capped;
}

function checkRunResult(r: { exitCode: number; stderr: unknown }, what: string): void {
  if (r.exitCode !== 0) {
    const stderr = typeof r.stderr === "string" ? r.stderr : String(r.stderr ?? "");
    throw new ContractError("state", `${what} failed (exit ${r.exitCode}): ${capText(stderr) || "no stderr"}`);
  }
}

/**
 * Create an isolated workspace. The record file is an O_EXCL create, so
 * two workers claiming the same workspace id race on the syscall and the
 * loser fails closed. If any step fails, ALL partial state (worktree
 * directory, git worktree metadata, record file) is cleaned up and the
 * error rethrown — the id is immediately reusable.
 */
export function createWorkspace(opts: unknown): WorkspaceRecord {
  if (!isPlainObject(opts)) {
    throw new ContractError("schema", "createWorkspace: options must be an object");
  }
  expectFields(opts, ["id", "ref", "rootDir", "run", "env", "now"], "createWorkspace");
  const id = parseResourceId(opts["id"], "createWorkspace.id");
  const ref = requireImmutableRef(opts["ref"], "createWorkspace.ref");
  const backend: WorkspaceBackend = "git-worktree";
  const rootDir = requireStr(opts, "rootDir", "createWorkspace.rootDir");
  const run = opts["run"];
  if (typeof run !== "function") {
    throw new ContractError("schema", "createWorkspace.run: must be a function");
  }
  const envRaw = opts["env"];
  if (!isPlainObject(envRaw)) {
    throw new ContractError("schema", "createWorkspace.env: object expected");
  }
  expectFields(envRaw, ["os", "wsl", "arch"], "createWorkspace.env");
  const os = envRaw["os"];
  if (typeof os !== "string" || !OS_VALUES.includes(os as MachineOS)) {
    throw new ContractError("schema", "createWorkspace.env.os: unknown OS");
  }
  const wsl = requireBool(envRaw, "wsl", "createWorkspace.env");
  if (wsl && os !== "linux") {
    throw new ContractError("schema", "createWorkspace.env: wsl=true requires os='linux'");
  }
  const arch = requireStr(envRaw, "arch", "createWorkspace.env.arch");
  const now = requireEpochMs(opts["now"], "createWorkspace.now");
  const env = { os: os as MachineOS, wsl, arch };

  const path = join(rootDir, id);
  const record: WorkspaceRecord = {
    id,
    ref,
    backend,
    path,
    targetDir: join(path, "target"),
    status: "creating",
    env,
    createdAt: isoTime(now),
  };
  const recordPath = join(rootDir, `${id}.json`);
  mkdirSync(rootDir, { recursive: true });

  // Claim the id with an exclusive create — the workspace CAS.
  let fd: number;
  try {
    fd = openSync(recordPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ContractError("state", `workspace '${id}' already exists`);
    }
    throw error;
  }
  try {
    writeFileSync(fd, redactJson({ contract_version: CONTRACT_VERSION, ...record }), "utf8");
  } finally {
    closeSync(fd);
  }

  try {
    checkRunResult(run(["git", "worktree", "add", "--detach", path, ref]), `git worktree add '${id}'`);
  } catch (error) {
    // Partial cleanup: remove whatever exists so the id is reusable.
    rmSync(path, { recursive: true, force: true });
    try {
      run(["git", "worktree", "prune"]);
    } catch {
      // best-effort; the original error is the one that matters
    }
    rmSync(recordPath, { force: true });
    throw error;
  }

  const ready: WorkspaceRecord = { ...record, status: "ready" };
  const tmp = `${recordPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  writeFileSync(tmp, redactJson({ contract_version: CONTRACT_VERSION, ...ready }), "utf8");
  renameSync(tmp, recordPath);
  return ready;
}

/** Read and strictly parse a workspace record; null when absent. */
export function readWorkspace(rootDir: string, id: string): WorkspaceRecord | null {
  parseResourceId(id, "readWorkspace.id");
  const recordPath = join(rootDir, `${id}.json`);
  if (!existsSync(recordPath)) return null;
  return parseWorkspaceRecord(parseJson(readFileSync(recordPath, "utf8")), `workspace '${id}'`);
}

/**
 * Remove a workspace: `git worktree remove`, prune metadata, delete the
 * record. The workspace's own leases (if any) are released separately by
 * their holder.
 */
export function removeWorkspace(rootDir: string, id: string, run: Runner): void {
  parseResourceId(id, "removeWorkspace.id");
  const record = readWorkspace(rootDir, id);
  if (record === null) {
    throw new ContractError("state", `removeWorkspace: workspace '${id}' does not exist`);
  }
  checkRunResult(run(["git", "worktree", "remove", record.path]), `git worktree remove '${id}'`);
  checkRunResult(run(["git", "worktree", "prune"]), "git worktree prune");
  rmSync(join(rootDir, `${id}.json`), { force: true });
}
