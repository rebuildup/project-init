/**
 * Durable attempt records, generation leases and fencing (Epic #86, T013 / issue #99).
 *
 * Ownership (ADR-0015 §8): everything under `<agentStateDir>/attempts` belongs
 * to this module. One directory per attempt key (SHA-256 of the canonical
 * `route#model#machine#attempt` key), containing:
 *
 *   record.json        — the attempt record (see `AttemptRecord`)
 *   lease-<gen>.json   — one file per generation, created with O_EXCL
 *
 * Fencing model:
 *   - A lease is an EXCLUSIVE create (`open(path, "wx")`). Two workers racing
 *     for the same generation cannot both win: the loser's O_EXCL fails.
 *     This is the CAS/atomic generation update.
 *   - A generation advances only by creating the next `lease-<gen>.json`, so
 *     history is append-only and a stale worker's generation is always
 *     detectable (`max(existing generations) !== my generation`).
 *   - `assertLeaseCurrent` rejects a worker whose generation is no longer the
 *     newest, whose lease was released/expired, or whose attempt record is
 *     fenced. Every write path (results, children, side-effect journal posts)
 *     goes through it, so stale generations can never commit.
 *
 * Parent/child: children are independent attempt records linked by key, never
 * nested objects. Fencing or losing a parent does not touch child records, so
 * child state survives parent death and stays recoverable.
 *
 * Fail-closed rules: every externally supplied value (record JSON, lease JSON,
 * options) is strictly validated — finite integer generations, ISO 8601 UTC
 * timestamps (epoch numbers are rejected, never coerced), bounded strings,
 * secret-shaped owner labels refused. Unknown fields are rejected; missing
 * facts throw; nothing is guessed. Only redacted, non-secret data is written
 * (always through `redactJson`).
 *
 * Storage is injected (`AttemptStore`) so the fencing logic is testable
 * against both the real filesystem store and an explicit mock.
 *
 * Run: bun test script/agent.attempts.test.ts
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  agentStateDir,
  isPlainObject,
  looksLikeSecretValue,
  parseAttemptKey,
  parseEnvelope,
  parseJson,
  redactJson,
  requireBool,
  requireStr,
  optionalStr,
  stringList,
} from "./contract.ts";

// ---------------------------------------------------------------------------
// Constants and small validators
// ---------------------------------------------------------------------------

/** All fields of a persisted attempt record; unknown fields are rejected. */
export const ATTEMPT_RECORD_FIELDS = [
  "attemptKey",
  "generation",
  "status",
  "owner",
  "parent",
  "children",
  "inputRef",
  "resultRef",
  "createdAt",
  "updatedAt",
] as const;

/** All fields of a persisted lease file. */
export const LEASE_FIELDS = [
  "attemptKey",
  "generation",
  "owner",
  "acquiredAt",
  "expiresAt",
  "released",
] as const;

/** Upper bound on generations; keeps hostile values from overflowing dates. */
export const MAX_GENERATION = 1_000_000;

/** A lease must be at least 1s (never immediately stale) and at most 7 days. */
export const MIN_LEASE_MS = 1_000;
export const MAX_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

/** Largest epoch millisecond value `Date` can represent. */
export const MAX_EPOCH_MS = 8_640_000_000_000_000;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

/**
 * Validate an epoch-milliseconds value. NaN, Infinity, strings, negative and
 * out-of-range values all throw — a hostile clock value can never silently
 * become "now".
 */
export function requireEpochMs(value: unknown, where: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_EPOCH_MS
  ) {
    throw new ContractError(
      "schema",
      `${where}: must be a finite non-negative integer epoch in milliseconds`,
    );
  }
  return value;
}

/** Validate an ISO 8601 UTC timestamp. Epoch NUMBERS are explicitly rejected. */
export function requireIsoTime(value: unknown, where: string): string {
  if (typeof value === "number") {
    throw new ContractError(
      "schema",
      `${where}: epoch numbers are not accepted; use an ISO 8601 UTC string`,
    );
  }
  if (typeof value !== "string" || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ContractError("schema", `${where}: must be an ISO 8601 UTC timestamp string`);
  }
  return value;
}

/** Format an epoch (validated) as ISO 8601 UTC. */
export function isoTime(now: number): string {
  requireEpochMs(now, "isoTime");
  const text = new Date(now).toISOString();
  if (!ISO_UTC.test(text)) {
    throw new ContractError("schema", `isoTime: produced a non-ISO timestamp '${text}'`);
  }
  return text;
}

/** Validate a generation number: a finite integer in [1, MAX_GENERATION]. */
export function requireGeneration(value: unknown, where: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_GENERATION
  ) {
    throw new ContractError(
      "schema",
      `${where}: must be an integer in [1, ${MAX_GENERATION}]`,
    );
  }
  return value;
}

/**
 * Validate an immutable ref: a git commit SHA (sha1 or sha256, hex). Anything
 * else — URLs, branch names, "latest", empty strings — fails closed.
 */
export function requireImmutableRef(value: unknown, where: string): string {
  if (typeof value !== "string" || !GIT_SHA.test(value)) {
    throw new ContractError(
      "schema",
      `${where}: must be an immutable git commit SHA (40 or 64 lowercase hex)`,
    );
  }
  return value;
}

/** Like `requireImmutableRef` but the field may be absent/null. */
export function optionalImmutableRef(
  data: Record<string, unknown>,
  key: string,
  where: string,
): string | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  return requireImmutableRef(value, `${where}.${key}`);
}

/**
 * Validate a lease owner label: a stable, non-secret slug (e.g. `herdr:w5F`,
 * `worker-1`). Secret-shaped values are refused outright, never redacted and
 * stored — the caller must not pass credentials here at all.
 */
export function validateOwner(value: unknown, where: string): string {
  if (typeof value !== "string" || !OWNER_RE.test(value) || looksLikeSecretValue(value)) {
    throw new ContractError("schema", `${where}: must be a non-secret owner slug`);
  }
  return value;
}

/** Filesystem-safe, collision-free directory/file name for an attempt key. */
export function attemptStateName(attemptKey: string): string {
  parseAttemptKey(attemptKey);
  return createHash("sha256").update(attemptKey).digest("hex");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttemptStatus = "admitted" | "running" | "completed" | "failed" | "fenced";

const STATUSES: readonly AttemptStatus[] = [
  "admitted",
  "running",
  "completed",
  "failed",
  "fenced",
];

/** Durable record of one attempt. Stored as `{contract_version, …}` JSON. */
export interface AttemptRecord {
  attemptKey: string; // canonical `route#model#machine#attempt`
  generation: number; // current generation (== newest lease file)
  status: AttemptStatus;
  owner: string | null; // lease owner of the current generation
  parent: string | null; // parent attempt key, if spawned
  children: string[]; // child attempt keys (independent records)
  inputRef: string | null; // immutable input (git SHA the worker started from)
  resultRef: string | null; // immutable result (git SHA), set on completion
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
}

/** One generation lease; persisted as `lease-<generation>.json`. */
export interface Lease {
  attemptKey: string;
  generation: number;
  owner: string;
  acquiredAt: string; // ISO 8601 UTC
  expiresAt: string; // ISO 8601 UTC
  released: boolean;
}

// ---------------------------------------------------------------------------
// Strict parsers (read path — every persisted byte is untrusted)
// ---------------------------------------------------------------------------

function requirePresent(
  payload: Record<string, unknown>,
  fields: readonly string[],
  where: string,
): void {
  for (const field of fields) {
    if (!(field in payload)) {
      throw new ContractError("schema", `${where}: missing field '${field}'`);
    }
  }
}

/** Parse an attempt record from untrusted data. Unknown/missing fields throw. */
export function parseAttemptRecord(raw: unknown, where: string): AttemptRecord {
  const { payload } = parseEnvelope(raw, ATTEMPT_RECORD_FIELDS, where);
  requirePresent(payload, ATTEMPT_RECORD_FIELDS, where);
  const attemptKey = requireStr(payload, "attemptKey", where);
  parseAttemptKey(attemptKey);
  // Record generation 0 = admitted, no lease yet; leased generations are >= 1
  // (requireGeneration). The generation still never moves backwards
  // (updateRecord) and a record generation must always match the newest
  // lease once one exists (assertLeaseCurrent).
  const generation = payload["generation"];
  if (
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation < 0 ||
    generation > MAX_GENERATION
  ) {
    throw new ContractError(
      "schema",
      `${where}.generation: must be an integer in [0, ${MAX_GENERATION}] (0 = admitted, not yet leased)`,
    );
  }
  const status = requireStr(payload, "status", where);
  if (!STATUSES.includes(status as AttemptStatus)) {
    throw new ContractError("schema", `${where}: unknown status '${status}'`);
  }
  const owner = optionalStr(payload, "owner", where);
  if (owner !== null) validateOwner(owner, `${where}.owner`);
  const parent = optionalStr(payload, "parent", where);
  if (parent !== null) {
    parseAttemptKey(parent);
    if (parent === attemptKey) {
      throw new ContractError("identity", `${where}: an attempt cannot be its own parent`);
    }
  }
  const children = stringList(payload["children"], where, "children");
  for (const child of children) {
    parseAttemptKey(child);
    if (child === attemptKey) {
      throw new ContractError("identity", `${where}: an attempt cannot be its own child`);
    }
  }
  const inputRef = optionalImmutableRef(payload, "inputRef", where);
  const resultRef = optionalImmutableRef(payload, "resultRef", where);
  const createdAt = requireIsoTime(payload["createdAt"], `${where}.createdAt`);
  const updatedAt = requireIsoTime(payload["updatedAt"], `${where}.updatedAt`);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new ContractError("schema", `${where}: updatedAt precedes createdAt`);
  }
  return {
    attemptKey,
    generation,
    status: status as AttemptStatus,
    owner,
    parent,
    children,
    inputRef,
    resultRef,
    createdAt,
    updatedAt,
  };
}

/** Parse a lease from untrusted data. Unknown/missing fields throw. */
export function parseLease(raw: unknown, where: string): Lease {
  const { payload } = parseEnvelope(raw, LEASE_FIELDS, where);
  requirePresent(payload, LEASE_FIELDS, where);
  const attemptKey = requireStr(payload, "attemptKey", where);
  parseAttemptKey(attemptKey);
  const generation = requireGeneration(payload["generation"], `${where}.generation`);
  const owner = validateOwner(payload["owner"], `${where}.owner`);
  const acquiredAt = requireIsoTime(payload["acquiredAt"], `${where}.acquiredAt`);
  const expiresAt = requireIsoTime(payload["expiresAt"], `${where}.expiresAt`);
  const released = requireBool(payload, "released", where);
  if (Date.parse(expiresAt) <= Date.parse(acquiredAt)) {
    throw new ContractError("schema", `${where}: expiresAt must be after acquiredAt`);
  }
  return { attemptKey, generation, owner, acquiredAt, expiresAt, released };
}

// ---------------------------------------------------------------------------
// Storage (injected; the fencing logic below never touches the filesystem)
// ---------------------------------------------------------------------------

/**
 * Wrap a typed record/lease in the contract envelope for persistence. Used on
 * every store write path so disk state and read-path parsers agree.
 */
function withContract(value: object): Record<string, unknown> {
  return { contract_version: CONTRACT_VERSION, ...value };
}

/**
 * Durable storage for attempt records and generation leases. Implementations
 * MUST make `createLease`/`createRecord` atomic exclusive creates — that is
 * the CAS on which the whole fencing model rests.
 */
export interface AttemptStore {
  /** Existing generation numbers for an attempt, ascending; [] when none. */
  listGenerations(attemptKey: string): number[];
  /** Atomic exclusive create. true = created; false = generation already exists. */
  createLease(attemptKey: string, generation: number, lease: Lease): boolean;
  /** Raw lease JSON value, or null when absent. */
  readLease(attemptKey: string, generation: number): unknown;
  /** Atomically mark an existing lease released. Throws when absent. */
  markLeaseReleased(attemptKey: string, generation: number): void;
  /** Atomic exclusive create. true = created; false = attempt already exists. */
  createRecord(attemptKey: string, record: AttemptRecord): boolean;
  /** Raw record JSON value, or null when absent. */
  readRecord(attemptKey: string): unknown;
  /** Atomic replace (temp file + rename; never a torn write). */
  writeRecord(attemptKey: string, record: AttemptRecord): void;
}

/**
 * Real filesystem store. Lease creation is `open(path, "wx")` (O_EXCL) —
 * kernel-atomic, so concurrent acquirers race on the syscall itself, not on
 * read-then-write logic. Record writes go through temp file + rename.
 */
export class FsAttemptStore implements AttemptStore {
  private readonly root: string;

  constructor(root: string = join(agentStateDir(), "attempts")) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new ContractError("state", "FsAttemptStore: root must be a non-empty path");
    }
    this.root = root;
  }

  private dir(attemptKey: string): string {
    return join(this.root, attemptStateName(attemptKey));
  }

  listGenerations(attemptKey: string): number[] {
    const dir = this.dir(attemptKey);
    if (!existsSync(dir)) return [];
    const generations: number[] = [];
    for (const name of readdirSync(dir)) {
      const match = /^lease-(\d+)\.json$/.exec(name);
      if (match) generations.push(Number(match[1]));
    }
    return generations.sort((a, b) => a - b);
  }

  createLease(attemptKey: string, generation: number, lease: Lease): boolean {
    parseLease(lease, "FsAttemptStore.createLease");
    const dir = this.dir(attemptKey);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `lease-${generation}.json`);
    let fd: number;
    try {
      fd = openSync(path, "wx"); // O_EXCL: the CAS primitive
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeFileSync(fd, redactJson(lease), "utf8");
    } finally {
      closeSync(fd);
    }
    return true;
  }

  readLease(attemptKey: string, generation: number): unknown {
    const path = join(this.dir(attemptKey), `lease-${generation}.json`);
    if (!existsSync(path)) return null;
    return parseJson(readFileSync(path, "utf8"));
  }

  markLeaseReleased(attemptKey: string, generation: number): void {
    const raw = this.readLease(attemptKey, generation);
    if (raw === null) {
      throw new ContractError(
        "state",
        `FsAttemptStore.markLeaseReleased: lease ${generation} of '${attemptKey}' does not exist`,
      );
    }
    const lease = parseLease(raw, `lease(${attemptKey}#${generation})`);
    this.writeAtomic(
      join(this.dir(attemptKey), `lease-${generation}.json`),
      redactJson(withContract({ ...lease, released: true })),
    );
  }

  createRecord(attemptKey: string, record: AttemptRecord): boolean {
    parseAttemptRecord(record, "FsAttemptStore.createRecord");
    const dir = this.dir(attemptKey);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "record.json");
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeFileSync(fd, redactJson(record), "utf8");
    } finally {
      closeSync(fd);
    }
    return true;
  }

  readRecord(attemptKey: string): unknown {
    const path = join(this.dir(attemptKey), "record.json");
    if (!existsSync(path)) return null;
    return parseJson(readFileSync(path, "utf8"));
  }

  writeRecord(attemptKey: string, record: AttemptRecord): void {
    parseAttemptRecord(record, "FsAttemptStore.writeRecord");
    this.writeAtomic(join(this.dir(attemptKey), "record.json"), redactJson(record));
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
        renameSync(tmp, path);
      } catch {
        throw error;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core operations (pure against the injected store)
// ---------------------------------------------------------------------------

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

function newRecord(input: {
  attemptKey: string;
  generation: number;
  status: AttemptStatus;
  owner: string | null;
  parent: string | null;
  inputRef: string | null;
  now: number;
}): AttemptRecord {
  const at = isoTime(input.now);
  return {
    attemptKey: input.attemptKey,
    generation: input.generation,
    status: input.status,
    owner: input.owner,
    parent: input.parent,
    children: [],
    inputRef: input.inputRef,
    resultRef: null,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Register a new attempt. `inputRef` pins the immutable input (git SHA) the
 * worker starts from. Creating the same attempt twice fails closed — a
 * re-entry must go through generations, not record re-creation.
 */
export function initAttempt(
  store: AttemptStore,
  attemptKey: string,
  options: { now: number; parent?: string | null; inputRef?: string | null },
): AttemptRecord {
  parseAttemptKey(attemptKey);
  if (!isPlainObject(options)) {
    throw new ContractError("schema", "initAttempt: options must be an object");
  }
  const now = requireEpochMs(options["now"], "initAttempt.now");
  const parent = options["parent"] ?? null;
  if (parent !== null) {
    if (typeof parent !== "string") {
      throw new ContractError("schema", "initAttempt.parent: must be an attempt key string or null");
    }
    parseAttemptKey(parent);
    if (parent === attemptKey) {
      throw new ContractError("identity", "initAttempt: an attempt cannot be its own parent");
    }
  }
  const inputRef = options["inputRef"] ?? null;
  if (inputRef !== null) requireImmutableRef(inputRef, "initAttempt.inputRef");
  const record = newRecord({
    attemptKey,
    generation: 0,
    status: "admitted",
    owner: null,
    parent: typeof parent === "string" ? parent : null,
    inputRef: typeof inputRef === "string" ? inputRef : null,
    now,
  });
  if (!store.createRecord(attemptKey, withContract(record))) {
    throw new ContractError("state", `attempt '${attemptKey}' already exists`);
  }
  return record;
}

/**
 * Acquire the next generation lease for an attempt. The generation advance is
 * an exclusive create, so:
 *   - an actively leased attempt refuses a second lease (double lease is
 *     impossible — the CAS decide it, not a timestamp comparison);
 *   - after release/expiry the new generation supersedes the old one, which
 *     fences every worker still holding a previous generation.
 * A missing record is created (status `running`); an existing record is
 * CAS-updated on its current generation.
 */
export function acquireLease(
  store: AttemptStore,
  attemptKey: string,
  owner: string,
  options: { now: number; leaseMs: number },
): Lease {
  parseAttemptKey(attemptKey);
  validateOwner(owner, "acquireLease.owner");
  const { now, leaseMs } = requireLeaseOptions(options);

  const generations = store.listGenerations(attemptKey);
  const current = generations.length > 0 ? generations[generations.length - 1] : 0;
  if (current > 0) {
    const raw = store.readLease(attemptKey, current);
    if (raw !== null) {
      const currentLease = parseLease(raw, `lease(${attemptKey}#${current})`);
      if (!currentLease.released && Date.parse(currentLease.expiresAt) > now) {
        throw new ContractError(
          "state",
          `attempt '${attemptKey}' generation ${current} is actively leased to '${currentLease.owner}' until ${currentLease.expiresAt}; refusing double lease`,
        );
      }
    }
  }

  const generation = current + 1;
  const lease: Lease = {
    attemptKey,
    generation,
    owner,
    acquiredAt: isoTime(now),
    expiresAt: isoTime(now + leaseMs),
    released: false,
  };
  if (!store.createLease(attemptKey, generation, withContract(lease))) {
    throw new ContractError(
      "state",
      `attempt '${attemptKey}' generation ${generation} already exists; lost the lease CAS race`,
    );
  }

  let raw = store.readRecord(attemptKey);
  if (raw === null) {
    const fresh = newRecord({
      attemptKey,
      generation,
      status: "running",
      owner,
      parent: null,
      inputRef: null,
      now,
    });
    if (store.createRecord(attemptKey, withContract(fresh))) return lease;
    raw = store.readRecord(attemptKey);
    if (raw === null) {
      throw new ContractError(
        "state",
        `attempt '${attemptKey}' record vanished during lease acquisition`,
      );
    }
  }
  const record = parseAttemptRecord(raw, `attempt(${attemptKey})`);
  if (record.generation > current) {
    throw new ContractError(
      "state",
      `attempt '${attemptKey}': record generation ${record.generation} is ahead of the newest lease ${current}; refusing to move the generation backwards`,
    );
  }
  updateRecord(store, attemptKey, record.generation, now, (r) => ({
    ...r,
    generation,
    status: "running",
    owner,
  }));
  return lease;
}

/**
 * CAS record update: refuses when the record's generation no longer matches
 * `expectedGeneration`. The generation never moves backwards.
 */
export function updateRecord(
  store: AttemptStore,
  attemptKey: string,
  expectedGeneration: number,
  now: number,
  mutate: (record: AttemptRecord) => AttemptRecord,
): AttemptRecord {
  // expectedGeneration is the record's CURRENT generation; 0 is valid
  // (admitted, not yet leased). See parseAttemptRecord for the range rule.
  if (
    typeof expectedGeneration !== "number" ||
    !Number.isInteger(expectedGeneration) ||
    expectedGeneration < 0 ||
    expectedGeneration > MAX_GENERATION
  ) {
    throw new ContractError(
      "schema",
      `updateRecord.expectedGeneration: must be an integer in [0, ${MAX_GENERATION}]`,
    );
  }
  requireEpochMs(now, "updateRecord.now");
  const raw = store.readRecord(attemptKey);
  if (raw === null) {
    throw new ContractError("state", `attempt '${attemptKey}' has no record`);
  }
  const record = parseAttemptRecord(raw, `attempt(${attemptKey})`);
  if (record.generation !== expectedGeneration) {
    throw new ContractError(
      "evidence",
      `attempt '${attemptKey}': generation moved from ${expectedGeneration} to ${record.generation}; refusing stale update`,
    );
  }
  const next = mutate({ ...record, children: [...record.children] });
  if (next.generation < record.generation) {
    throw new ContractError("state", "attempt generation must never move backwards");
  }
  next.updatedAt = isoTime(now);
  store.writeRecord(attemptKey, withContract(next));
  return next;
}

/**
 * Fencing gate for every write path. Throws (never degrades) when the lease
 * is released or expired, a newer generation exists, the stored lease or
 * record disagrees with the caller's view, or the attempt is fenced.
 */
export function assertLeaseCurrent(
  store: AttemptStore,
  lease: Lease,
  now: number,
): void {
  const parsed = parseLease(withContract(lease), "assertLeaseCurrent.lease");
  requireEpochMs(now, "assertLeaseCurrent.now");
  const key = parsed.attemptKey;
  if (parsed.released) {
    throw new ContractError("evidence", `attempt '${key}': lease generation ${parsed.generation} was released`);
  }
  if (Date.parse(parsed.expiresAt) <= now) {
    throw new ContractError(
      "evidence",
      `attempt '${key}': lease generation ${parsed.generation} expired at ${parsed.expiresAt}`,
    );
  }
  const generations = store.listGenerations(key);
  const newest = generations.length > 0 ? generations[generations.length - 1] : 0;
  if (newest !== parsed.generation) {
    throw new ContractError(
      "evidence",
      `attempt '${key}': fenced — current generation is ${newest}, lease is generation ${parsed.generation}`,
    );
  }
  const storedRaw = store.readLease(key, parsed.generation);
  if (storedRaw === null) {
    throw new ContractError("state", `attempt '${key}': lease generation ${parsed.generation} is missing`);
  }
  const stored = parseLease(storedRaw, `lease(${key}#${parsed.generation})`);
  if (stored.released) {
    throw new ContractError("evidence", `attempt '${key}': lease generation ${parsed.generation} was released`);
  }
  if (Date.parse(stored.expiresAt) <= now) {
    throw new ContractError(
      "evidence",
      `attempt '${key}': lease generation ${parsed.generation} expired at ${stored.expiresAt}`,
    );
  }
  if (stored.owner !== parsed.owner || stored.acquiredAt !== parsed.acquiredAt) {
    throw new ContractError(
      "evidence",
      `attempt '${key}': lease identity mismatch; the caller's lease is not the stored one`,
    );
  }
  const recordRaw = store.readRecord(key);
  if (recordRaw === null) {
    throw new ContractError("state", `attempt '${key}' has no record`);
  }
  const record = parseAttemptRecord(recordRaw, `attempt(${key})`);
  if (record.generation !== parsed.generation) {
    throw new ContractError(
      "evidence",
      `attempt '${key}': record generation ${record.generation} does not match lease generation ${parsed.generation}`,
    );
  }
  if (record.status === "fenced") {
    throw new ContractError("evidence", `attempt '${key}' is fenced`);
  }
}

/** Read and strictly parse an attempt record; null when the attempt is unknown. */
export function readAttempt(store: AttemptStore, attemptKey: string): AttemptRecord | null {
  parseAttemptKey(attemptKey);
  const raw = store.readRecord(attemptKey);
  return raw === null ? null : parseAttemptRecord(raw, `attempt(${attemptKey})`);
}

/**
 * Commit an immutable result ref. Stale generations are rejected by
 * `assertLeaseCurrent` before anything is written. Re-committing the same ref
 * is idempotent; a different ref for an already-completed attempt fails.
 */
export function recordResult(
  store: AttemptStore,
  lease: Lease,
  resultRef: string,
  now: number,
): AttemptRecord {
  const parsed = parseLease(withContract(lease), "recordResult.lease");
  requireEpochMs(now, "recordResult.now");
  assertLeaseCurrent(store, parsed, now);
  const ref = requireImmutableRef(resultRef, "recordResult.resultRef");
  return updateRecord(store, parsed.attemptKey, parsed.generation, now, (r) => {
    if (r.status === "completed") {
      if (r.resultRef === ref) return r;
      throw new ContractError(
        "state",
        `attempt '${parsed.attemptKey}' already completed with result ${r.resultRef}; refusing to overwrite with ${ref}`,
      );
    }
    if (r.status === "failed") {
      throw new ContractError(
        "state",
        `attempt '${parsed.attemptKey}' is failed; acquire a new generation instead of completing it`,
      );
    }
    return { ...r, status: "completed", resultRef: ref };
  });
}

/**
 * Link a child attempt to this attempt. Children are independent records;
 * this only appends the key to the parent's `children` list.
 */
export function recordChild(
  store: AttemptStore,
  lease: Lease,
  childKey: string,
  now: number,
): AttemptRecord {
  const parsed = parseLease(withContract(lease), "recordChild.lease");
  requireEpochMs(now, "recordChild.now");
  assertLeaseCurrent(store, parsed, now);
  parseAttemptKey(childKey);
  if (childKey === parsed.attemptKey) {
    throw new ContractError("identity", "an attempt cannot be its own child");
  }
  return updateRecord(store, parsed.attemptKey, parsed.generation, now, (r) => {
    if (r.children.includes(childKey)) return r; // idempotent
    return { ...r, children: [...r.children, childKey].sort() };
  });
}

/**
 * Fence an attempt: its current holder loses the ability to write (results,
 * children, side effects) even if its lease file still exists. The current
 * lease is released so a supervisor can immediately re-acquire the next
 * generation. Child records are NOT touched — parent death must not kill
 * child state. Fencing a completed attempt is refused (its result is already
 * durable); fencing an already-fenced attempt is idempotent.
 */
export function fenceAttempt(
  store: AttemptStore,
  attemptKey: string,
  now: number,
): AttemptRecord {
  parseAttemptKey(attemptKey);
  requireEpochMs(now, "fenceAttempt.now");
  const raw = store.readRecord(attemptKey);
  if (raw === null) {
    throw new ContractError("state", `cannot fence unknown attempt '${attemptKey}'`);
  }
  const record = parseAttemptRecord(raw, `attempt(${attemptKey})`);
  if (record.status === "fenced") return record;
  if (record.status === "completed") {
    throw new ContractError("state", `attempt '${attemptKey}' is completed; fencing is refused`);
  }
  const fenced = updateRecord(store, attemptKey, record.generation, now, (r) => ({
    ...r,
    status: "fenced",
  }));
  const generations = store.listGenerations(attemptKey);
  const newest = generations.length > 0 ? generations[generations.length - 1] : 0;
  if (newest > 0) {
    const leaseRaw = store.readLease(attemptKey, newest);
    if (leaseRaw !== null) {
      const lease = parseLease(leaseRaw, `lease(${attemptKey}#${newest})`);
      if (!lease.released) store.markLeaseReleased(attemptKey, newest);
    }
  }
  return fenced;
}

/**
 * Release the current lease (only its own holder may). Idempotent. Releasing
 * an EXPIRED lease is allowed (cleanup); releasing someone else's lease or a
 * non-newest generation is not.
 */
export function releaseLease(store: AttemptStore, lease: Lease, now: number): void {
  const parsed = parseLease(withContract(lease), "releaseLease.lease");
  requireEpochMs(now, "releaseLease.now");
  const storedRaw = store.readLease(parsed.attemptKey, parsed.generation);
  if (storedRaw === null) {
    throw new ContractError(
      "state",
      `attempt '${parsed.attemptKey}': lease generation ${parsed.generation} does not exist`,
    );
  }
  const stored = parseLease(storedRaw, `lease(${parsed.attemptKey}#${parsed.generation})`);
  if (stored.released) return;
  if (stored.owner !== parsed.owner || stored.acquiredAt !== parsed.acquiredAt) {
    throw new ContractError(
      "evidence",
      `attempt '${parsed.attemptKey}': lease identity mismatch; refusing to release another holder's lease`,
    );
  }
  const generations = store.listGenerations(parsed.attemptKey);
  const newest = generations.length > 0 ? generations[generations.length - 1] : 0;
  if (newest !== parsed.generation) {
    throw new ContractError(
      "evidence",
      `attempt '${parsed.attemptKey}': generation ${newest} supersedes ${parsed.generation}; nothing to release`,
    );
  }
  store.markLeaseReleased(parsed.attemptKey, parsed.generation);
}
