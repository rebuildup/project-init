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
 *     evidence) so that unknown, forged and stale data can never be promoted
 *     to usable — enforced on BOTH the write path (`attest`) and the read
 *     path (`parseAttested`, used by `isUsable`/`requireUsable`);
 *   - quota scope: which shared allowance a measurement belongs to, so the
 *     same account quota is not double-counted across machines;
 *   - redaction: one deterministic secret-redaction pass (by key name and by
 *     value shape) for JSON output and non-secret local state;
 *   - schema helpers: unknown-field rejection, envelope parsing and strict
 *     field readers with the same semantics as the launcher's own parsers in
 *     `script/agent.ts`;
 *   - JSON: one canonical serializer (sorted keys) shared by human-facing and
 *     machine-facing output so both always agree;
 *   - local state: the root directory for non-secret launcher state and the
 *     rule that nothing secret is ever written there.
 *
 * Versioning: `CONTRACT_VERSION` is semver. Producers wrap data in an
 * envelope (`parseEnvelope`); readers assert major-version compatibility
 * before interpreting foreign data. A major bump means a breaking shape
 * change; minor/patch bumps are additive.
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
  | "identity" // malformed, ambiguous or mismatched id
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
 * Ambiguity fails closed like the launcher's config-load check: when two
 * known routes derive the same shortcut name and `raw` matches it, this
 * throws instead of picking one.
 *
 * `claude-openrouter-free` therefore resolves only when
 * `claude.openrouter-free` is a known route, never as `claude.openrouter`
 * with a stray suffix.
 */
export function resolveLegacyRouteRef(
  raw: string,
  knownRouteIds: readonly string[],
): string | null {
  const owner: Record<string, string> = {};
  for (const routeId of knownRouteIds) {
    const name = legacyRouteShortcut(routeId);
    if (name === raw && name in owner) {
      throw new ContractError(
        "identity",
        `legacy route name '${raw}' is ambiguous: '${owner[name]}' and '${routeId}' both map to it`,
      );
    }
    if (!(name in owner)) owner[name] = routeId;
  }
  return raw in owner ? owner[raw] : null;
}

/** Assert two route ids are the same canonical route; throw `identity` if not. */
export function assertSameRoute(expected: string, actual: string): void {
  parseRouteId(expected);
  parseRouteId(actual);
  if (expected !== actual) {
    throw new ContractError(
      "identity",
      `route mismatch: expected '${expected}', got '${actual}'`,
    );
  }
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

/** Shared nonce rules for format and parse, so neither is weaker. */
function checkAttemptNonce(attempt: string): void {
  if (!attempt || /[\s\u0000-\u001f\u007f#]/.test(attempt) || attempt.length > 128) {
    throw new ContractError("identity", "invalid attempt nonce");
  }
}

/** Deterministic, parseable key for an attempt identity. */
export function formatAttemptKey(id: AttemptIdentity): string {
  parseRouteId(id.route);
  parseModelId(id.model);
  if (id.machine !== "") parseMachineId(id.machine);
  checkAttemptNonce(id.attempt);
  return [id.route, id.model, id.machine, id.attempt].join(ATTEMPT_SEPARATOR);
}

/**
 * Parse an attempt key back into its identity. Every component is
 * re-validated with the same rules `formatAttemptKey` enforces, so a key
 * whose fields were swapped or rebuilt for another route/model/machine is
 * rejected instead of silently reinterpreted.
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
  checkAttemptNonce(attempt);
  return { route, model, machine, attempt };
}

/**
 * Assert a record's attempt identity matches the expected one. Reading a
 * quota observation, ledger entry or checkpoint under the wrong
 * route/model/machine/attempt throws instead of being silently reinterpreted.
 */
export function assertSameAttempt(expected: AttemptIdentity, actual: AttemptIdentity): void {
  const expectedKey = formatAttemptKey(expected);
  const actualKey = formatAttemptKey(actual);
  if (expectedKey !== actualKey) {
    throw new ContractError(
      "identity",
      `attempt identity mismatch: expected '${expectedKey}', got '${actualKey}'`,
    );
  }
}

// ---------------------------------------------------------------------------
// Attestation: status, provenance, evidence
// ---------------------------------------------------------------------------

/**
 * Where a fact stands. Escalation to `verified-live` requires real evidence;
 * `unknown`, forged and stale data can never be promoted to usable (see
 * `isUsable`/`requireUsable`).
 *
 *   configured    — declared in config, never verified against reality
 *   verified-live — confirmed by a real call/probe on a recorded date
 *   restricted    — OBSERVED to be blocked (401/402/429, quota, opt-in,
 *                   network); requires live evidence and a reason note
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
 * must never contain a secret value (values are redacted on output anyway).
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
 * being recorded is the restriction itself). `note` carries the reason for
 * a restriction (or extra context) and is persisted with the attestation.
 */
export interface Attested<T> {
  value: T | null;
  status: VerificationStatus;
  provenance: Provenance;
  evidence: Evidence | null;
  note?: string;
}

const MEASURED_SOURCES: readonly EvidenceSource[] = ["live-e2e", "probe"];
const PUBLISHED_SOURCES: readonly EvidenceSource[] = ["provider-catalog", "provider-docs"];

const STATUS_FLAGS: Record<VerificationStatus, true> = {
  configured: true,
  "verified-live": true,
  restricted: true,
  unknown: true,
};

const PROVENANCE_FLAGS: Record<Provenance, true> = {
  measured: true,
  estimated: true,
  official: true,
};

const SOURCE_FLAGS: Record<EvidenceSource, true> = {
  "live-e2e": true,
  probe: true,
  "provider-catalog": true,
  "provider-docs": true,
  config: true,
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Validate an already-typed Evidence object (write path). */
function checkEvidence(evidence: Evidence, where: string): void {
  if (!ISO_UTC.test(evidence.at) || !Number.isFinite(Date.parse(evidence.at))) {
    throw new ContractError("evidence", `${where}: evidence.at must be an ISO 8601 UTC timestamp`);
  }
  if (!(evidence.source in SOURCE_FLAGS)) {
    throw new ContractError("evidence", `${where}: invalid evidence source '${evidence.source}'`);
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

/** Parse an Evidence object from untrusted data (read path). */
function parseEvidence(raw: unknown, where: string): Evidence {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  expectFields(raw, ["at", "source", "sha", "note"], where);
  const evidence: Evidence = {
    at: requireStr(raw, "at", where),
    source: requireStr(raw, "source", where) as EvidenceSource,
  };
  const sha = optionalStr(raw, "sha", where);
  if (sha !== null) evidence.sha = sha;
  const note = optionalStr(raw, "note", where);
  if (note !== null) evidence.note = note;
  checkEvidence(evidence, where);
  return evidence;
}

/** Internal shape validated by both `attest` (write) and `parseAttested` (read). */
interface AttestationShape {
  value: unknown;
  status: string;
  provenance: string;
  evidence: Evidence | null;
  note?: string;
}

/**
 * The status/provenance/evidence matrix, the single authority for what may
 * be claimed. Used on BOTH paths so a forged object read back from disk or
 * JSON cannot claim more than an honestly built one:
 *
 *   - `verified-live`: live evidence (live-e2e/probe) REQUIRED, provenance
 *     `measured`, value present. A live verification is always a measurement.
 *   - `restricted`: OBSERVED live evidence REQUIRED (published docs do not
 *     observe a restriction), provenance `measured`, and a `note` giving
 *     the reason (e.g. "HTTP 402 Insufficient Balance on 2026-11-04").
 *   - `unknown`: value and evidence must both be absent.
 *   - `measured` provenance: live-e2e/probe evidence, present.
 *   - `official` provenance: provider-published evidence.
 *   - `configured` may not carry live evidence — an unverified declaration
 *     must not borrow the credibility of a probe.
 */
function validateAttestation(att: AttestationShape, where: string): void {
  if (!(att.status in STATUS_FLAGS)) {
    throw new ContractError("schema", `${where}: invalid status '${att.status}'`);
  }
  if (!(att.provenance in PROVENANCE_FLAGS)) {
    throw new ContractError("schema", `${where}: invalid provenance '${att.provenance}'`);
  }
  if (att.evidence !== null) checkEvidence(att.evidence, where);
  const measured = att.provenance === "measured";
  const observed = att.evidence !== null && MEASURED_SOURCES.includes(att.evidence.source);
  if (att.status === "unknown") {
    if (att.value !== null || att.evidence !== null) {
      throw new ContractError("evidence", `${where}: unknown must carry no value and no evidence`);
    }
    return;
  }
  if (att.status === "verified-live") {
    if (!att.evidence) {
      throw new ContractError("evidence", `${where}: verified-live requires evidence`);
    }
    if (!observed) {
      throw new ContractError(
        "evidence",
        `${where}: verified-live requires a live-e2e or probe evidence source`,
      );
    }
    if (!measured) {
      throw new ContractError("evidence", `${where}: verified-live requires provenance 'measured'`);
    }
    if (att.value === null) {
      throw new ContractError("evidence", `${where}: verified-live requires a value`);
    }
  }
  if (att.status === "restricted") {
    if (!att.evidence) {
      throw new ContractError("evidence", `${where}: restricted requires evidence`);
    }
    if (!observed) {
      throw new ContractError(
        "evidence",
        `${where}: restricted requires observed (live-e2e/probe) evidence, not published docs`,
      );
    }
    if (!measured) {
      throw new ContractError("evidence", `${where}: restricted requires provenance 'measured'`);
    }
    if (!att.note) {
      throw new ContractError("evidence", `${where}: restricted requires a note`);
    }
  }
  if (measured && !att.evidence) {
    throw new ContractError("evidence", `${where}: provenance 'measured' requires evidence`);
  }
  if (measured && att.evidence && !observed) {
    throw new ContractError(
      "evidence",
      `${where}: provenance 'measured' requires a live-e2e or probe evidence source`,
    );
  }
  if (att.provenance === "official" && att.evidence && !PUBLISHED_SOURCES.includes(att.evidence.source)) {
    throw new ContractError(
      "evidence",
      `${where}: provenance 'official' requires provider-published evidence`,
    );
  }
  if (att.provenance === "estimated" && observed) {
    throw new ContractError("evidence", `${where}: a live observation is 'measured', never 'estimated'`);
  }
  if (att.status === "configured" && observed) {
    throw new ContractError(
      "evidence",
      `${where}: 'configured' must not carry live execution evidence`,
    );
  }
}

/**
 * Build an attested value (write path). See `validateAttestation` for the
 * enforced matrix. The `note` (required for `restricted`) is persisted on
 * the result.
 */
export function attest<T>(input: {
  value: T | null;
  status: VerificationStatus;
  provenance: Provenance;
  evidence?: Evidence | null;
  note?: string;
}): Attested<T> {
  const evidence = input.evidence ?? null;
  const where = `attest(${input.status}/${input.provenance})`;
  if (input.note !== undefined && typeof input.note !== "string") {
    throw new ContractError("schema", `${where}: note must be a string`);
  }
  validateAttestation(
    { value: input.value, status: input.status, provenance: input.provenance, evidence, note: input.note },
    where,
  );
  const att: Attested<T> = { value: input.value, status: input.status, provenance: input.provenance, evidence };
  if (input.note !== undefined) att.note = input.note;
  return att;
}

/**
 * Validate an attestation from untrusted data (read path: state files, CLI
 * JSON, fixtures, foreign modules). Enforces the same matrix as `attest` —
 * including unknown-field rejection — and returns a normalized Attested.
 */
export function parseAttested(raw: unknown, where: string): Attested<unknown> {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  expectFields(raw, ["value", "status", "provenance", "evidence", "note"], where);
  const evidenceRaw = raw["evidence"];
  const evidence =
    evidenceRaw === null || evidenceRaw === undefined
      ? null
      : parseEvidence(evidenceRaw, `${where}.evidence`);
  const note = optionalStr(raw, "note", where) ?? undefined;
  const shape: AttestationShape = {
    value: raw["value"],
    status: requireStr(raw, "status", where),
    provenance: requireStr(raw, "provenance", where),
    evidence,
    note,
  };
  validateAttestation(shape, where);
  const att: Attested<unknown> = {
    value: shape.value,
    status: shape.status as VerificationStatus,
    provenance: shape.provenance as Provenance,
    evidence,
  };
  if (note !== undefined) att.note = note;
  return att;
}

// ---------------------------------------------------------------------------
// Usability and staleness
// ---------------------------------------------------------------------------

/** Default maximum evidence age for usability checks: 7 days. */
export const DEFAULT_MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Evidence dated further than this in the future is treated as invalid. */
const FUTURE_SKEW_MS = 60 * 1000;

/** True when the evidence is stale: older than `maxAgeMs`, or future-dated
 * beyond the clock-skew allowance (future evidence is invalid, never fresh). */
export function isStale(evidence: Evidence, now: number, maxAgeMs: number): boolean {
  checkEvidence(evidence, "isStale");
  const at = Date.parse(evidence.at);
  if (at > now + FUTURE_SKEW_MS) return true;
  return now - at > maxAgeMs;
}

export interface UsableOptions {
  /** Reference time (ms epoch); defaults to Date.now(). */
  now?: number;
  /**
   * Maximum evidence age; defaults to `DEFAULT_MAX_EVIDENCE_AGE_MS` (7
   * days). There is NO unbounded mode: callers may tighten the bound, never
   * remove it.
   */
  maxAgeMs?: number;
}

function checkUsableOptions(now: number, maxAgeMs: number): void {
  if (!Number.isFinite(now)) {
    throw new ContractError("schema", "options.now must be a finite number");
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new ContractError("schema", "options.maxAgeMs must be a positive number");
  }
}

/**
 * A fact is USABLE only when it survives read-path validation
 * (`parseAttested`), is `verified-live` with observed evidence, AND its
 * evidence is fresh under `maxAgeMs` (default 7 days). Everything else —
 * configured, restricted, unknown, stale, future-dated, forged, malformed —
 * is not, and no caller may treat it as available. Never throws; fail-closed.
 */
export function isUsable<T>(att: Attested<T>, options: UsableOptions = {}): boolean {
  try {
    parseAttested(att, "isUsable");
    if (att.status !== "verified-live" || !att.evidence) return false;
    const { now = Date.now(), maxAgeMs = DEFAULT_MAX_EVIDENCE_AGE_MS } = options;
    checkUsableOptions(now, maxAgeMs);
    return !isStale(att.evidence, now, maxAgeMs);
  } catch {
    return false;
  }
}

/**
 * Like `isUsable`, but throws a ContractError explaining exactly why the
 * fact is not usable (schema, identity or evidence violation).
 */
export function requireUsable<T>(att: Attested<T>, options: UsableOptions = {}): T {
  parseAttested(att, "requireUsable");
  if (att.status !== "verified-live" || !att.evidence) {
    throw new ContractError(
      "evidence",
      `not usable: status is '${att.status}', not verified-live with evidence`,
    );
  }
  const { now = Date.now(), maxAgeMs = DEFAULT_MAX_EVIDENCE_AGE_MS } = options;
  checkUsableOptions(now, maxAgeMs);
  if (isStale(att.evidence, now, maxAgeMs)) {
    throw new ContractError(
      "evidence",
      `not usable: evidence from ${att.evidence.at} is outside the ${maxAgeMs}ms freshness window`,
    );
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

/** Replacement value written for every redacted field or secret-shaped value. */
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

/** snake_case / kebab-case / SCREAMING compound names (never `tokens_used`). */
const SECRET_SNAKE =
  /(^|[_-])(secret|password|passwd|credential|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|bearer|cookie)([_-]|$)/i;

/** camelCase compound names: clientSecret, bearerToken, idToken, githubToken… */
const SECRET_CAMEL =
  /[a-z0-9](Secret|Password|Passwd|Credential|Token|ApiKey|APIKey|PrivateKey|Bearer|Cookie|Authorization|AccessToken|RefreshToken|IdToken)([^a-zA-Z]|$)/;

/** Value shapes that are credentials regardless of their key name. */
const SECRET_VALUE: readonly RegExp[] = [
  /^Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

/** True when a field with this key may carry a secret value. */
export function isSecretKeyName(name: string): boolean {
  return (
    name.toLowerCase() in SECRET_EXACT || SECRET_SNAKE.test(name) || SECRET_CAMEL.test(name)
  );
}

/** True when a string value itself looks like a credential (Bearer, sk-…). */
export function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE.some((pattern) => pattern.test(value));
}

/** Own-property assignment that cannot hit the `__proto__` setter. */
function assignSafe(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

/**
 * Deep-copy `value` replacing every secret-bearing field's value — and every
 * string value that itself looks like a credential — with `REDACTED`.
 * Shared (non-cyclic) references are copied per occurrence; true cycles
 * throw (contract data is plain JSON, cycles are a bug). `Date` instances
 * pass through untouched (serialized via their own `toJSON`).
 */
export function redact(value: unknown): unknown {
  return redactInto(value, new Set());
}

function redactInto(value: unknown, seen: Set<object>): unknown {
  if (value instanceof Date) return value;
  if (typeof value === "string") return looksLikeSecretValue(value) ? REDACTED : value;
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) throw new ContractError("schema", "cannot redact cyclic data");
  seen.add(value);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      out.push(redactInto(value[i], seen));
    }
    seen.delete(value); // pop: shared siblings are not cycles
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    assignSafe(out, key, isSecretKeyName(key) ? REDACTED : redactInto(item, seen));
  }
  seen.delete(value); // pop: shared siblings are not cycles
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
  if (value instanceof Date) return value;
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    assignSafe(out, key, sortKeys((value as Record<string, unknown>)[key]));
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
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown field '${unknown[0]}'`);
  }
}

/**
 * Parse a contract envelope from untrusted data: `{ contract_version, …payload }`.
 * Rejects unknown top-level fields and incompatible versions; returns the
 * version plus the whitelisted payload fields (absent fields stay absent).
 */
export interface ContractEnvelope {
  version: string;
  payload: Record<string, unknown>;
}

export function parseEnvelope(
  raw: unknown,
  payloadFields: readonly string[],
  where: string,
): ContractEnvelope {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  expectFields(raw, ["contract_version", ...payloadFields], where);
  const version = requireStr(raw, "contract_version", where);
  assertCompatibleVersion(version);
  const payload: Record<string, unknown> = {};
  for (const field of payloadFields) {
    if (raw[field] !== undefined) payload[field] = raw[field];
  }
  return { version, payload };
}

export function requireStr(data: Record<string, unknown>, key: string, where: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value) {
    throw new ContractError("schema", `${where}: missing or invalid string '${key}'`);
  }
  return value;
}

export function optionalStr(
  data: Record<string, unknown>,
  key: string,
  where: string,
): string | null {
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

export function optionalInt(
  data: Record<string, unknown>,
  key: string,
  where: string,
): number | null {
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
