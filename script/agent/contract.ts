/**
 * Shared contract for the agent router modules (Epic #86, T001 / issue #87).
 *
 * This module is the only cross-module dependency surface of `script/agent/*`
 * and the modules that follow (#88 help/JSON, #89 catalog, #90 probes, #91
 * quota telemetry, #92 error classes, #93 usage ledger, #94 recommendations,
 * #97 machine inventory, #99 checkpoints). It defines:
 *
 *   - identity: route ids (`harness.provider`), model ids, machine ids,
 *     attempt identities and their legacy `<harness>-<provider>` spelling;
 *   - attestation: how a fact is labelled (verification status, provenance,
 *     evidence) so that unknown and stale can never be promoted to usable;
 *   - quota scope: which shared allowance a measurement belongs to, so the
 *     same account quota is not double-counted across machines;
 *   - redaction: one deterministic secret-redaction pass for JSON output and
 *     non-secret local state;
 *   - schema helpers: unknown-field rejection and strict field readers with
 *     the same semantics as the launcher's own parsers in `script/agent.ts`;
 *   - JSON: one canonical serializer (sorted keys) shared by human-facing and
 *     machine-facing output so both always agree;
 *   - local state: the root directory for non-secret launcher state and the
 *     rule that nothing secret is ever written there.
 *
 * Versioning: `CONTRACT_VERSION` is semver. Consumers embed it in JSON they
 * emit; readers assert major-version compatibility with
 * `assertCompatibleVersion` before interpreting foreign data. A major bump
 * means a breaking shape change; minor/patch bumps are additive.
 *
 * Security invariants:
 *   - Secret VALUES never appear in contract data, JSON output or local
 *     state. Config carries Infisical secret NAMES only (existing
 *     `config/agents.toml` rule); `redact`/`redactJson` are the mandatory
 *     last step before persisting or logging anything.
 *   - Nothing in this module performs I/O on config or credentials; it never
 *     launches a process and never changes an existing launch path.
 *
 * Run: bun test script/agent.contract.test.ts
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/** Semver of this contract. Breaking shape changes bump the major version. */
export const CONTRACT_VERSION = "1.0.0";

/** Error thrown for every contract violation. `code` is machine-readable. */
export type ContractErrorCode =
  | "schema" // wrong shape, unknown field, bad type
  | "version" // incompatible contract version
  | "identity" // malformed or ambiguous id
  | "evidence" // attestation/provenance/staleness violation
  | "state"; // local-state path violation

export class ContractError extends Error {
  code: ContractErrorCode;

  constructor(code: ContractErrorCode, message: string) {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

/** True when `version` has the same major version as this contract. */
export function isCompatibleVersion(version: string): boolean {
  const mine = CONTRACT_VERSION.split(".");
  const theirs = version.split(".");
  if (mine.length !== 3 || theirs.length !== 3) return false;
  if (!theirs.every((part) => /^\d+$/.test(part))) return false;
  return mine[0] === theirs[0];
}

/** Throw a version ContractError unless `version` is compatible. */
export function assertCompatibleVersion(version: string): void {
  if (!isCompatibleVersion(version)) {
    throw new ContractError(
      "version",
      `contract version ${version} is incompatible with ${CONTRACT_VERSION}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Identity: routes, models, machines, attempts
// ---------------------------------------------------------------------------

/** Harness/provider key as used in `config/agents.toml` table names. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** A parsed `<harness>.<provider>` route id. */
export interface RouteRef {
  harness: string;
  provider: string;
}

/**
 * Parse a canonical route id `<harness>.<provider>`. The split is at the
 * FIRST dot only (same rule as the launcher's `splitRouteKey`), and both
 * halves must be valid config keys — so `claude.openrouter.free` and
 * `.openrouter` fail instead of being silently truncated.
 */
export function parseRouteId(raw: string): RouteRef {
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) {
    throw new ContractError("identity", `route id '${raw}' must be '<harness>.<provider>'`);
  }
  const harness = raw.slice(0, dot);
  const provider = raw.slice(dot + 1);
  if (!KEY_PATTERN.test(harness) || !KEY_PATTERN.test(provider)) {
    throw new ContractError("identity", `route id '${raw}' has an invalid harness or provider key`);
  }
  return { harness, provider };
}

/** Format a parsed route ref back into the canonical `<harness>.<provider>` id. */
export function formatRouteId(ref: RouteRef): string {
  if (!KEY_PATTERN.test(ref.harness) || !KEY_PATTERN.test(ref.provider)) {
    throw new ContractError("identity", `invalid route ref '${ref.harness}'.'${ref.provider}'`);
  }
  return `${ref.harness}.${ref.provider}`;
}

/**
 * The legacy spelling of a route id: the launcher's shortcut name
 * `<harness>-<provider>` (see `shortcutName` in `script/agent.ts`).
 */
export function legacyRouteShortcut(routeId: string): string {
  const ref = parseRouteId(routeId);
  return `${ref.harness}-${ref.provider}`;
}

/**
 * Resolve a legacy route reference by EXACT match against the known route
 * ids' shortcut spellings, mirroring the launcher's `resolveShortcut`
 * (never split on hyphens). Returns the canonical route id, or null when
 * nothing matches — unknown combinations fail closed upstream.
 *
 * `claude-openrouter-free` therefore resolves only when
 * `claude.openrouter-free` is a known route, never as `claude.openrouter`
 * with a stray suffix.
 */
export function resolveLegacyRouteRef(
  raw: string,
  knownRouteIds: readonly string[],
): string | null {
  for (const routeId of knownRouteIds) {
    if (legacyRouteShortcut(routeId) === raw) return routeId;
  }
  return null;
}

/**
 * Validate a provider-native model id. Model ids are opaque to this
 * contract (ids contain dots, slashes, colons, `@`), but they must be
 * non-empty, free of whitespace/control characters, and never contain the
 * attempt-key separator `#`.
 */
export function parseModelId(raw: string): string {
  if (!raw || raw.length > 200 || /[\s\u0000-\u001f\u007f#]/.test(raw)) {
    throw new ContractError("identity", `invalid model id '${raw.slice(0, 50)}'`);
  }
  return raw;
}

/**
 * Validate a machine id: a stable, non-secret slug that identifies one
 * execution host (e.g. `workstation-m1`, `wsl-desktop`). Dots are excluded
 * so a machine id can never be mistaken for a route id.
 */
export function parseMachineId(raw: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw)) {
    throw new ContractError("identity", `invalid machine id '${raw.slice(0, 50)}'`);
  }
  return raw;
}

/**
 * Identity of one launch attempt. Two attempts with different route, model
 * or machine can never share a key, so a quota observation or ledger entry
 * recorded under one identity can never be read back as another.
 */
export interface AttemptIdentity {
  route: string; // canonical route id (`harness.provider`)
  model: string; // provider-native model id
  machine: string; // machine id ("" = this machine, unnamed)
  attempt: string; // opaque per-attempt nonce (uuid/hex); never a secret
}

const ATTEMPT_SEPARATOR = "#";

/** Deterministic, parseable key for an attempt identity. */
export function formatAttemptKey(id: AttemptIdentity): string {
  parseRouteId(id.route);
  parseModelId(id.model);
  if (id.machine !== "") parseMachineId(id.machine);
  if (!id.attempt || /[\s\u0000-\u001f\u007f#]/.test(id.attempt) || id.attempt.length > 128) {
    throw new ContractError("identity", "invalid attempt nonce");
  }
  return [id.route, id.model, id.machine, id.attempt].join(ATTEMPT_SEPARATOR);
}

/**
 * Parse an attempt key back into its identity. Every component is
 * re-validated, so a key whose fields were swapped or rebuilt for another
 * route/model/machine is rejected instead of silently reinterpreted.
 */
export function parseAttemptKey(key: string): AttemptIdentity {
  const parts = key.split(ATTEMPT_SEPARATOR);
  if (parts.length !== 4) {
    throw new ContractError("identity", `attempt key must have 4 '#'-separated parts`);
  }
  const [route, model, machine, attempt] = parts;
  parseRouteId(route);
  parseModelId(model);
  if (machine !== "") parseMachineId(machine);
  if (!attempt) throw new ContractError("identity", "attempt key has an empty nonce");
  return { route, model, machine, attempt };
}

// ---------------------------------------------------------------------------
// Attestation: status, provenance, evidence
// ---------------------------------------------------------------------------

/**
 * Where a fact stands. Escalation to `verified-live` requires real evidence;
 * `unknown` and stale evidence can never be promoted to usable (see
 * `isUsable`/`requireUsable`).
 *
 *   configured    — declared in config, never verified against reality
 *   verified-live — confirmed by a real call/probe on a recorded date
 *   restricted    — known to be blocked (401/402/429, quota, opt-in, network)
 *   unknown       — no data at all; value and evidence must be absent
 */
export type VerificationStatus = "configured" | "verified-live" | "restricted" | "unknown";

/**
 * How a value was obtained. A `measured` value cites real execution
 * evidence; `official` cites provider-published material; `estimated` is a
 * derivation that must never be presented as either.
 */
export type Provenance = "measured" | "estimated" | "official";

/** What kind of observation the evidence records. */
export type EvidenceSource = "live-e2e" | "probe" | "provider-catalog" | "provider-docs" | "config";

/**
 * Evidence for one attestation. `at` is an ISO 8601 UTC timestamp; `sha`
 * pins the exact repository state the observation was made on (40-hex git
 * SHA, or 64-hex for a content hash); `note` is human-readable context and
 * must never contain a secret value.
 */
export interface Evidence {
  at: string;
  source: EvidenceSource;
  sha?: string;
  note?: string;
}

/**
 * A value plus the metadata that says how much it can be trusted. `value`
 * is null for `unknown` (and MAY be null for `restricted`, where the fact
 * being recorded is the restriction itself).
 */
export interface Attested<T> {
  value: T | null;
  status: VerificationStatus;
  provenance: Provenance;
  evidence: Evidence | null;
}

const MEASURED_SOURCES: readonly EvidenceSource[] = ["live-e2e", "probe"];
const PUBLISHED_SOURCES: readonly EvidenceSource[] = ["provider-catalog", "provider-docs"];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function validateEvidence(evidence: Evidence, where: string): void {
  if (!ISO_UTC.test(evidence.at) || !Number.isFinite(Date.parse(evidence.at))) {
    throw new ContractError("evidence", `${where}: evidence.at must be an ISO 8601 UTC timestamp`);
  }
  if (evidence.sha !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(evidence.sha) && !/^[0-9a-f]{64}$/.test(evidence.sha)) {
      throw new ContractError("evidence", `${where}: evidence.sha must be a 40- or 64-hex digest`);
    }
  }
  if (evidence.note !== undefined && typeof evidence.note !== "string") {
    throw new ContractError("evidence", `${where}: evidence.note must be a string`);
  }
}

/**
 * Build an attested value, enforcing the status/provenance/evidence matrix:
 *
 *   - `verified-live`: evidence REQUIRED (live-e2e/probe), provenance
 *     `measured`. A live verification is always a measurement.
 *   - `restricted`: evidence REQUIRED and a note explaining the restriction
 *     (e.g. "HTTP 402 Insufficient Balance on 2026-11-04").
 *   - `unknown`: value and evidence must both be absent.
 *   - `measured` provenance: evidence with a live-e2e/probe source.
 *   - `official` provenance: evidence citing provider-published material.
 *   - `configured` may not carry live evidence — an unverified declaration
 *     must not borrow the credibility of a probe.
 */
export function attest<T>(input: {
  value: T | null;
  status: VerificationStatus;
  provenance: Provenance;
  evidence?: Evidence | null;
}): Attested<T> {
  const evidence = input.evidence ?? null;
  const where = `attest(${input.status}/${input.provenance})`;
  if (input.status === "unknown") {
    if (input.value !== null || evidence !== null) {
      throw new ContractError("evidence", `${where}: unknown must carry no value and no evidence`);
    }
    return { value: null, status: "unknown", provenance: input.provenance, evidence: null };
  }
  if (input.status === "verified-live") {
    if (!evidence) {
      throw new ContractError("evidence", `${where}: verified-live requires evidence`);
    }
    if (input.provenance !== "measured") {
      throw new ContractError("evidence", `${where}: verified-live requires provenance 'measured'`);
    }
  }
  if (input.status === "restricted" && !evidence) {
    throw new ContractError("evidence", `${where}: restricted requires evidence`);
  }
  if (input.status === "restricted" && !input.note) {
    throw new ContractError("evidence", `${where}: restricted requires a note`);
  }
  if (evidence) {
    validateEvidence(evidence, where);
    if (input.provenance === "measured" && !MEASURED_SOURCES.includes(evidence.source)) {
      throw new ContractError(
        "evidence",
        `${where}: provenance 'measured' requires a live-e2e or probe evidence source`,
      );
    }
    if (input.provenance === "official" && !PUBLISHED_SOURCES.includes(evidence.source)) {
      throw new ContractError(
        "evidence",
        `${where}: provenance 'official' requires provider-published evidence`,
      );
    }
    if (input.provenance === "estimated" && MEASURED_SOURCES.includes(evidence.source)) {
      throw new ContractError(
        "evidence",
        `${where}: a live observation is 'measured', never 'estimated'`,
      );
    }
    if (input.status === "configured" && MEASURED_SOURCES.includes(evidence.source)) {
      throw new ContractError(
        "evidence",
        `${where}: 'configured' must not carry live execution evidence`,
      );
    }
  } else if (input.provenance === "measured") {
    throw new ContractError("evidence", `${where}: provenance 'measured' requires evidence`);
  }
  return {
    value: input.value,
    status: input.status,
    provenance: input.provenance,
    evidence,
  };
}

/** True when the evidence timestamp is older than `maxAgeMs` at `now`. */
export function isStale(evidence: Evidence, now: number, maxAgeMs: number): boolean {
  validateEvidence(evidence, "isStale");
  return now - Date.parse(evidence.at) > maxAgeMs;
}

export interface UsableOptions {
  /** Reference time (ms epoch); defaults to Date.now(). */
  now?: number;
  /** Maximum evidence age; omit to accept any age. */
  maxAgeMs?: number;
}

/**
 * A fact is USABLE only when it is `verified-live` AND its evidence is
 * fresh. Everything else — configured, restricted, unknown, stale — is not,
 * and no caller may treat it as available.
 */
export function isUsable<T>(att: Attested<T>, options: UsableOptions = {}): boolean {
  if (att.status !== "verified-live") return false;
  if (!att.evidence) return false;
  if (options.maxAgeMs !== undefined) {
    const now = options.now ?? Date.now();
    if (isStale(att.evidence, now, options.maxAgeMs)) return false;
  }
  return true;
}

/** Like `isUsable`, but throws an evidence ContractError explaining why not. */
export function requireUsable<T>(att: Attested<T>, options: UsableOptions = {}): T {
  if (att.status !== "verified-live" || !att.evidence) {
    throw new ContractError(
      "evidence",
      `not usable: status is '${att.status}', not verified-live with evidence`,
    );
  }
  if (options.maxAgeMs !== undefined) {
    const now = options.now ?? Date.now();
    if (isStale(att.evidence, now, options.maxAgeMs)) {
      throw new ContractError(
        "evidence",
        `not usable: evidence from ${att.evidence.at} is older than ${options.maxAgeMs}ms`,
      );
    }
  }
  return att.value as T;
}

// ---------------------------------------------------------------------------
// Quota scope
// ---------------------------------------------------------------------------

/**
 * Which shared allowance a quota/usage fact belongs to. The same account
 * quota applies on every machine, so consumers must dedupe by
 * `quotaScopeKey`, never by machine.
 *
 *   account  — provider-account-wide allowance (e.g. OpenRouter free tier)
 *   api-key  — allowance tied to one credential; `id` is the Infisical
 *              secret NAME (never the value), e.g. `OPENCODE_API_KEY`
 *   plan     — subscription-plan allowance (e.g. MiniMax M Plan, OpenCode Go)
 *   machine  — a per-machine local budget (e.g. concurrency of one host)
 */
export type QuotaScopeKind = "account" | "api-key" | "plan" | "machine";

export interface QuotaScope {
  kind: QuotaScopeKind;
  /** Stable non-secret label of the scoped entity. */
  id: string;
}

/** Dedupe key for a quota scope (`<kind>:<id>`); equal keys = same allowance. */
export function quotaScopeKey(scope: QuotaScope): string {
  if (
    scope.kind !== "account" &&
    scope.kind !== "api-key" &&
    scope.kind !== "plan" &&
    scope.kind !== "machine"
  ) {
    throw new ContractError("schema", `invalid quota scope kind '${scope.kind}'`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(scope.id)) {
    throw new ContractError("identity", `invalid quota scope id '${scope.id.slice(0, 50)}'`);
  }
  return `${scope.kind}:${scope.id}`;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Replacement value written for every redacted field. */
export const REDACTED = "[redacted]";

/** Exact key names that are always treated as secret-bearing. */
const SECRET_EXACT: Record<string, true> = {
  secret: true,
  key: true,
  token: true,
  password: true,
  credentials: true,
  credential: true,
};

/** Substring patterns for compound key names (never matches `tokens_used`). */
const SECRET_SUBSTRING =
  /(^|[_-])(secret|password|passwd|credential|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|bearer|cookie)([_-]|$)|(_|^)(secret|password|credential|apikey)/i;

/** True when a field with this key may carry a secret value. */
export function isSecretKeyName(name: string): boolean {
  return name.toLowerCase() in SECRET_EXACT || SECRET_SUBSTRING.test(name);
}

/**
 * Deep-copy `value` replacing every secret-bearing field's value with
 * `REDACTED`. Objects, arrays and primitives are handled; cycles throw
 * (contract data is plain JSON, cycles are a bug).
 */
export function redact(value: unknown): unknown {
  return redactInto(value, new Set());
}

function redactInto(value: unknown, seen: Set<object>): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) throw new ContractError("schema", "cannot redact cyclic data");
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactInto(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSecretKeyName(key) ? REDACTED : redactInto(item, seen);
  }
  return out;
}

/**
 * Canonical JSON: secret-redacted, object keys sorted recursively, 2-space
 * indent. Every module serializing contract data for output or local state
 * goes through this so human-facing and machine-facing output always agree
 * and persisted files are byte-stable across runs.
 */
export function redactJson(value: unknown): string {
  return toJson(redact(value));
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted (UTF-16 order), 2-space indent. */
export function toJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** Parse JSON, throwing a schema ContractError on malformed input. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ContractError("schema", `malformed JSON: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Schema helpers (same semantics as script/agent.ts's own parsers)
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reject unknown fields: every key of `value` must be in `allowed`. Used on
 * every externally supplied object (fixture, state file, CLI JSON) so a
 * typo can never silently drop part of a contract.
 */
export function expectFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const known = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown field '${unknown[0]}'`);
  }
}

export function requireStr(data: Record<string, unknown>, key: string, where: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value) {
    throw new ContractError("schema", `${where}: missing or invalid string '${key}'`);
  }
  return value;
}

export function optionalStr(data: Record<string, unknown>, key: string, where: string): string | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value) {
    throw new ContractError("schema", `${where}: '${key}' must be a non-empty string`);
  }
  return value;
}

export function requireBool(data: Record<string, unknown>, key: string, where: string): boolean {
  const value = data[key];
  if (typeof value !== "boolean") {
    throw new ContractError("schema", `${where}: '${key}' must be a boolean`);
  }
  return value;
}

export function optionalInt(data: Record<string, unknown>, key: string, where: string): number | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ContractError("schema", `${where}: '${key}' must be an integer`);
  }
  return value;
}

export function stringList(value: unknown, where: string, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new ContractError("schema", `${where}: '${key}' must be a list of non-empty strings`);
  }
  const list = value as string[];
  if (new Set(list).size !== list.length) {
    throw new ContractError("schema", `${where}: '${key}' contains duplicate entries`);
  }
  return [...list];
}

// ---------------------------------------------------------------------------
// Non-secret local state
// ---------------------------------------------------------------------------

/**
 * Root directory for the launcher's non-secret local state (default
 * `$XDG_STATE_HOME/agent`, else `~/.local/state/agent`; override with
 * `AGENT_STATE_DIR`). Ownership of subpaths is defined in ADR-0015:
 * catalog (#89), quota (#91), ledger (#93), machines (#97), attempts and
 * checkpoints (#99). This function creates nothing and reads nothing; it
 * only resolves the path.
 *
 * Invariant: only redacted, non-secret data may be written under this
 * directory — persist through `redactJson`, never with raw `JSON.stringify`.
 */
export function agentStateDir(): string {
  const override = process.env.AGENT_STATE_DIR;
  if (override) return override;
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "agent");
}
