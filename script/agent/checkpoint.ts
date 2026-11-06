/**
 * Durable checkpoints and the external side-effect journal (Epic #86, T013 / issue #99).
 *
 * A checkpoint is a structured, secret-free snapshot of one attempt's
 * recoverable facts: immutable input/result refs, children, and — for hard
 * checkpoints — a durable GitHub reference (issue / PR / git ref) that
 * survives local state loss. A SOFT checkpoint (`durable: null`) exists only
 * under `agentStateDir()/checkpoints` and may be lost with the machine; a
 * HARD checkpoint (`kind: "hard-remote"`) carries a well-formed GitHub
 * reference a recovery flow can fetch back.
 *
 * The side-effect journal records every external write INTENT before it
 * happens ("pre") and its OUTCOME afterwards ("post"). A "pre" without a
 * "post" is an effect whose outcome is UNKNOWN — recovery must verify it
 * externally, never assume it did not happen.
 *
 * Fail-closed rules (shared with script/agent/attempts.ts):
 *   - every persisted byte passes a strict parser; unknown fields throw;
 *   - secret-shaped data is REFUSED, not silently redacted: a checkpoint or
 *     journal entry that would need redaction must not be persisted at all —
 *     the caller removes the secret at the source;
 *   - provider conversations/sessions are never a recovery source here; only
 *     immutable refs (git SHAs, GitHub URLs) are recorded.
 *
 * Run: bun test script/agent.attempts.test.ts
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  agentStateDir,
  expectFields,
  isPlainObject,
  isSecretKeyName,
  looksLikeSecretValue,
  optionalInt,
  optionalStr,
  parseAttemptKey,
  parseEnvelope,
  parseJson,
  requireStr,
  stringList,
  toJson,
} from "./contract.ts";
import {
  assertLeaseCurrent,
  attemptStateName,
  isoTime,
  optionalImmutableRef,
  requireGeneration,
  requireImmutableRef,
  requireIsoTime,
  type AttemptStore,
  type Lease,
} from "./attempts.ts";

// ---------------------------------------------------------------------------
// Checkpoint records
// ---------------------------------------------------------------------------

export type CheckpointKind = "soft-local" | "hard-remote";

/** Where a hard checkpoint's durable copy lives. */
export interface DurableRef {
  kind: "issue" | "issue-comment" | "pull" | "git-ref";
  /** `owner/repo` the durable copy lives in. */
  repo: string;
  /** Issue or PR number (null for `git-ref`). */
  n: number | null;
  /** Git commit SHA the checkpoint pins (required for `git-ref`). */
  sha: string | null;
  /** https GitHub URL a human or recovery flow can fetch. */
  url: string;
}

export interface CheckpointRecord {
  attemptKey: string;
  generation: number;
  kind: CheckpointKind;
  inputRef: string | null;
  resultRef: string | null;
  children: string[];
  notes: string[];
  durable: DurableRef | null;
  createdAt: string;
}

const DURABLE_KINDS: readonly DurableRef["kind"][] = [
  "issue",
  "issue-comment",
  "pull",
  "git-ref",
];

const CHECKPOINT_KINDS: readonly CheckpointKind[] = ["soft-local", "hard-remote"];

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** https GitHub URL, no credentials, no whitespace/control characters. */
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._/#-]+$/;

/** Target strings must never carry credentials or credential-bearing queries. */
const TARGET_QUERY_SECRET_RE = /[?&](token|key|secret|password|access_token|sig)=/i;

/**
 * Refuse to persist secret-shaped data: the first path whose key name is
 * secret-bearing or whose string value looks like a credential. `redact`
 * would silently replace these; for durable state that is a bug, so this
 * throws `ContractError("schema")` instead.
 */
export function assertNoSecrets(value: unknown, where: string): void {
  const offending = findSecretShaped(value, "");
  if (offending !== null) {
    throw new ContractError(
      "schema",
      `${where}: refusing to persist secret-shaped data at '${offending}'`,
    );
  }
}

function findSecretShaped(value: unknown, path: string): string | null {
  if (typeof value === "string") {
    return looksLikeSecretValue(value) ? path : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecretShaped(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      if (isSecretKeyName(key)) return childPath;
      const hit = findSecretShaped(item, childPath);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * Parse a checkpoint from untrusted data — a local state file OR the JSON
 * this module posted to GitHub and recovery later read back (same parser on
 * both paths, so a round-trip through GitHub-durable state cannot drift).
 * Unknown fields throw; `kind` must agree with the presence of a durable
 * reference; secret-shaped data is refused.
 */
export function parseCheckpoint(raw: unknown, where: string): CheckpointRecord {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  const { payload } = parseEnvelope(
    raw,
    [
      "attemptKey",
      "generation",
      "kind",
      "inputRef",
      "resultRef",
      "children",
      "notes",
      "durable",
      "createdAt",
    ],
    where,
  );
  const attemptKey = requireStr(payload, "attemptKey", where);
  parseAttemptKey(attemptKey);
  const generation = requireGeneration(payload["generation"], `${where}.generation`);
  const kind = requireStr(payload, "kind", where);
  if (!CHECKPOINT_KINDS.includes(kind as CheckpointKind)) {
    throw new ContractError("schema", `${where}: unknown checkpoint kind '${kind}'`);
  }
  const durableRaw = payload["durable"];
  const durable =
    durableRaw === null || durableRaw === undefined
      ? null
      : parseDurableRef(durableRaw, `${where}.durable`);
  const derived: CheckpointKind = durable === null ? "soft-local" : "hard-remote";
  if (kind !== derived) {
    throw new ContractError(
      "schema",
      `${where}: kind '${kind}' does not match its durable reference (${derived})`,
    );
  }
  const record: CheckpointRecord = {
    attemptKey,
    generation,
    kind: kind as CheckpointKind,
    inputRef: optionalImmutableRef(payload, "inputRef", where),
    resultRef: optionalImmutableRef(payload, "resultRef", where),
    children: stringList(payload["children"], where, "children"),
    notes: stringList(payload["notes"], where, "notes"),
    durable,
    createdAt: requireIsoTime(payload["createdAt"], `${where}.createdAt`),
  };
  assertNoSecrets(record, where);
  return record;
}

/** Parse a durable reference from untrusted data. */
export function parseDurableRef(raw: unknown, where: string): DurableRef {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  expectFields(raw, ["kind", "repo", "n", "sha", "url"], where);
  const kind = requireStr(raw, "kind", where);
  if (!DURABLE_KINDS.includes(kind as DurableRef["kind"])) {
    throw new ContractError("schema", `${where}: unknown durable ref kind '${kind}'`);
  }
  const repo = requireStr(raw, "repo", where);
  if (!REPO_RE.test(repo)) {
    throw new ContractError("schema", `${where}: repo must be 'owner/repo'`);
  }
  const url = requireStr(raw, "url", where);
  if (!GITHUB_URL_RE.test(url) || looksLikeSecretValue(url)) {
    throw new ContractError(
      "schema",
      `${where}: url must be a credential-free https GitHub URL`,
    );
  }
  const n = optionalInt(raw, "n", where);
  const sha = optionalStr(raw, "sha", where);
  if (kind === "git-ref") {
    if (sha === null) {
      throw new ContractError("schema", `${where}: git-ref requires a commit SHA`);
    }
    requireImmutableRef(sha, `${where}.sha`);
    if (n !== null) {
      throw new ContractError("schema", `${where}: git-ref must not carry an issue/PR number`);
    }
  } else if (n === null || n < 1) {
    throw new ContractError("schema", `${where}: '${kind}' requires a positive issue/PR number`);
  }
  return { kind: kind as DurableRef["kind"], repo, n, sha, url };
}

/** Canonical JSON for persisting or posting a checkpoint (strict, sorted). */
export function toCheckpointJson(record: CheckpointRecord): string {
  const enveloped = { contract_version: CONTRACT_VERSION, ...record };
  parseCheckpoint(enveloped, "checkpoint"); // validate BEFORE serializing
  return toJson(enveloped);
}

/** Path of the local checkpoint file for one attempt key. */
export function checkpointPath(root: string, attemptKey: string): string {
  parseAttemptKey(attemptKey);
  return join(root, `${attemptStateName(attemptKey)}.json`);
}

/**
 * Persist a checkpoint locally (atomic temp+rename). Refuses to overwrite a
 * NEWER generation with an older one (regression guard); same-generation
 * overwrite is allowed (idempotent re-save with evolved notes).
 */
export function saveLocalCheckpoint(root: string, record: CheckpointRecord): void {
  const path = checkpointPath(root, record.attemptKey);
  const existing = loadLocalCheckpoint(root, record.attemptKey);
  if (existing !== null && existing.generation > record.generation) {
    throw new ContractError(
      "state",
      `refusing to overwrite checkpoint of generation ${existing.generation} with generation ${record.generation}`,
    );
  }
  mkdirSync(root, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, toCheckpointJson(record), "utf8");
  renameSync(tmp, path);
}

/** Load the local checkpoint for an attempt; null when none was saved. */
export function loadLocalCheckpoint(root: string, attemptKey: string): CheckpointRecord | null {
  parseAttemptKey(attemptKey);
  const path = checkpointPath(root, attemptKey);
  if (!existsSync(path)) return null;
  return parseCheckpoint(parseJson(readFileSync(path, "utf8")), `checkpoint(${attemptKey})`);
}

// ---------------------------------------------------------------------------
// Side-effect journal
// ---------------------------------------------------------------------------

export type SideEffectOutcome = "succeeded" | "failed";

export interface SideEffectEntry {
  effectId: string;
  attemptKey: string;
  generation: number;
  phase: "pre" | "post";
  kind: string; // e.g. "git-push", "issue-comment"
  target: string; // non-secret target (repo, ref, path)
  outcome: SideEffectOutcome | null; // null on "pre"
  ref: string | null; // immutable ref of the result ("post" only)
  at: string; // ISO 8601 UTC
}

/** One declared-but-incomplete effect: its outcome is UNKNOWN. */
export interface SideEffectPending {
  effectId: string;
  generation: number;
  kind: string;
  target: string;
  declaredAt: string;
}

/** Durable append-only journal storage; `readAll` returns lines in order. */
export interface JournalStore {
  append(attemptKey: string, line: string): void;
  readAll(attemptKey: string): string[];
}

/**
 * Real filesystem journal: one append-only JSONL file per attempt under
 * `<root>/<sha256(attemptKey)>.jsonl`. Appends are O_APPEND writes; readers
 * parse every line strictly.
 */
export class FsJournalStore implements JournalStore {
  private readonly root: string;

  constructor(root: string = join(agentStateDir(), "journal")) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new ContractError("state", "FsJournalStore: root must be a non-empty path");
    }
    this.root = root;
  }

  private path(attemptKey: string): string {
    return join(this.root, `${attemptStateName(attemptKey)}.jsonl`);
  }

  append(attemptKey: string, line: string): void {
    parseAttemptKey(attemptKey);
    mkdirSync(this.root, { recursive: true });
    appendFileSync(this.path(attemptKey), `${line}\n`, "utf8");
  }

  readAll(attemptKey: string): string[] {
    parseAttemptKey(attemptKey);
    const path = this.path(attemptKey);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
  }
}

const EFFECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EFFECT_KIND_RE = /^[a-z][a-z0-9-]{0,47}$/;
const EFFECT_TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._\/:@#-]{0,200}$/;

const SIDE_EFFECT_FIELDS = [
  "effectId",
  "attemptKey",
  "generation",
  "phase",
  "kind",
  "target",
  "outcome",
  "ref",
  "at",
];

/** Parse one journal entry from untrusted data (a JSONL line's JSON value). */
export function parseSideEffectEntry(raw: unknown, where: string): SideEffectEntry {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  const { payload } = parseEnvelope(raw, SIDE_EFFECT_FIELDS, where);
  const effectId = requireStr(payload, "effectId", where);
  if (!EFFECT_ID_RE.test(effectId)) {
    throw new ContractError("schema", `${where}: invalid effectId '${effectId.slice(0, 50)}'`);
  }
  const attemptKey = requireStr(payload, "attemptKey", where);
  parseAttemptKey(attemptKey);
  const generation = requireGeneration(payload["generation"], `${where}.generation`);
  const phase = requireStr(payload, "phase", where);
  if (phase !== "pre" && phase !== "post") {
    throw new ContractError("schema", `${where}: unknown phase '${phase}'`);
  }
  const kind = requireStr(payload, "kind", where);
  if (!EFFECT_KIND_RE.test(kind)) {
    throw new ContractError("schema", `${where}: invalid effect kind '${kind.slice(0, 50)}'`);
  }
  const target = requireStr(payload, "target", where);
  if (
    !EFFECT_TARGET_RE.test(target) ||
    looksLikeSecretValue(target) ||
    TARGET_QUERY_SECRET_RE.test(target)
  ) {
    throw new ContractError("schema", `${where}: invalid or secret-shaped effect target`);
  }
  const outcomeRaw = payload["outcome"];
  const outcome =
    outcomeRaw === null || outcomeRaw === undefined ? null : requireStr(payload, "outcome", where);
  if (outcome !== null && outcome !== "succeeded" && outcome !== "failed") {
    throw new ContractError("schema", `${where}: unknown outcome '${outcome}'`);
  }
  const ref = optionalImmutableRef(payload, "ref", where);
  const at = requireIsoTime(payload["at"], `${where}.at`);
  if (phase === "pre" && (outcome !== null || ref !== null)) {
    throw new ContractError("schema", `${where}: a 'pre' entry carries no outcome or ref`);
  }
  if (phase === "post" && outcome === null) {
    throw new ContractError("schema", `${where}: a 'post' entry requires an outcome`);
  }
  const entry: SideEffectEntry = {
    effectId,
    attemptKey,
    generation,
    phase: phase as SideEffectEntry["phase"],
    kind,
    target,
    outcome,
    ref,
    at,
  };
  assertNoSecrets(entry, where);
  return entry;
}

/** Read and strictly parse every journal entry for one attempt, in order. */
export function readJournal(journal: JournalStore, attemptKey: string): SideEffectEntry[] {
  parseAttemptKey(attemptKey);
  return journal
    .readAll(attemptKey)
    .map((line, index) =>
      parseSideEffectEntry(parseJson(line), `journal(${attemptKey}) line ${index + 1}`),
    );
}

/**
 * Record the INTENT to perform an external side effect, BEFORE it happens.
 * The lease must still be current: a fenced, expired or released generation
 * cannot declare new external writes. Duplicate effect ids fail closed.
 */
export function journalPreEffect(
  attempts: AttemptStore,
  journal: JournalStore,
  lease: Lease,
  effect: { effectId: string; kind: string; target: string },
  now: number,
): SideEffectEntry {
  assertLeaseCurrent(attempts, lease, now);
  const parsed = parseSideEffectEntry(
    {
      contract_version: CONTRACT_VERSION,
      effectId: effect.effectId,
      attemptKey: lease.attemptKey,
      generation: lease.generation,
      phase: "pre",
      kind: effect.kind,
      target: effect.target,
      outcome: null,
      ref: null,
      at: isoTime(now),
    },
    `journalPreEffect(${effect.effectId})`,
  );
  if (readJournal(journal, lease.attemptKey).some((e) => e.effectId === effect.effectId)) {
    throw new ContractError(
      "state",
      `effect '${effect.effectId}' already has a journal entry for '${lease.attemptKey}'`,
    );
  }
  journal.append(
    lease.attemptKey,
    JSON.stringify({ contract_version: CONTRACT_VERSION, ...parsed }),
  );
  return parsed;
}

/**
 * Record the OUTCOME of a previously declared effect. Rejected when no pre
 * entry exists (post without pre fails closed), when the pre entry was
 * declared under a NEWER generation (the caller is stale — a current
 * generation holder may confirm effects declared under older generations,
 * which is the recovery path after a worker died), or when the effect
 * already has a post entry. Fencing itself is enforced by
 * `assertLeaseCurrent`: a stale worker cannot post at all.
 */
export function journalPostEffect(
  attempts: AttemptStore,
  journal: JournalStore,
  lease: Lease,
  effect: { effectId: string; outcome: SideEffectOutcome; ref: string | null },
  now: number,
): SideEffectEntry {
  assertLeaseCurrent(attempts, lease, now);
  const entries = readJournal(journal, lease.attemptKey);
  const pre = entries.find((e) => e.effectId === effect.effectId && e.phase === "pre");
  if (pre === undefined) {
    throw new ContractError(
      "state",
      `no 'pre' journal entry for effect '${effect.effectId}' of '${lease.attemptKey}'`,
    );
  }
  if (pre.generation > lease.generation) {
    throw new ContractError(
      "evidence",
      `effect '${effect.effectId}' was declared under generation ${pre.generation}, newer than ${lease.generation}`,
    );
  }
  if (entries.some((e) => e.effectId === effect.effectId && e.phase === "post")) {
    throw new ContractError("state", `effect '${effect.effectId}' already has a post entry`);
  }
  if (effect.ref !== null) requireImmutableRef(effect.ref, "journalPostEffect.ref");
  const parsed = parseSideEffectEntry(
    {
      contract_version: CONTRACT_VERSION,
      effectId: effect.effectId,
      attemptKey: lease.attemptKey,
      generation: lease.generation,
      phase: "post",
      kind: pre.kind,
      target: pre.target,
      outcome: effect.outcome,
      ref: effect.ref,
      at: isoTime(now),
    },
    `journalPostEffect(${effect.effectId})`,
  );
  journal.append(
    lease.attemptKey,
    JSON.stringify({ contract_version: CONTRACT_VERSION, ...parsed }),
  );
  return parsed;
}

/**
 * Effects declared but never completed. Recovery must treat every returned
 * effect as UNKNOWN — verify externally before assuming it did or did not
 * happen; never guess.
 */
export function pendingSideEffects(
  journal: JournalStore,
  attemptKey: string,
): SideEffectPending[] {
  parseAttemptKey(attemptKey);
  const entries = readJournal(journal, attemptKey);
  const pending: SideEffectPending[] = [];
  for (const pre of entries.filter((e) => e.phase === "pre")) {
    const completed = entries.some((e) => e.effectId === pre.effectId && e.phase === "post");
    if (!completed) {
      pending.push({
        effectId: pre.effectId,
        generation: pre.generation,
        kind: pre.kind,
        target: pre.target,
        declaredAt: pre.at,
      });
    }
  }
  return pending;
}
