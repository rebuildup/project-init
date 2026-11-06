/**
 * Execution preflight / admission for agent workers (Epic #86, T010).
 *
 * Pure functions only: every input is injected, nothing here launches a
 * process, touches the network, or reads the filesystem.
 *
 * Design rule: the ENTIRE request and limits object are validated with a
 * strict schema FIRST. Any malformed field — wrong type, missing, empty,
 * whitespace-only, non-finite number, non-boolean boolean — throws
 * `ContractError` and never produces a decision. Only after the shape is
 * proven clean do semantic checks run; a semantic violation (over budget,
 * forbidden delegation, untrusted repo, unendorsed main landing) returns a
 * `blocked` decision, it never degrades to an admission.
 */

import { ContractError, isPlainObject } from "./contract.ts";

// ---------------------------------------------------------------------------
// Task classification
// ---------------------------------------------------------------------------

/** How much judgement a task needs, which drives its review requirements. */
export type TaskClass =
  | "mechanical" // deterministic, no discretion: solo is fine
  | "localized" // small contained change, limited blast radius
  | "cross-boundary" // touches multiple modules/subsystems
  | "judgment-heavy"; // needs human-visible discretion or tradeoffs

/** Whether a task changes durable state or only observes it. */
export type Durability = "observational" | "mutable" | "durable";

/** Where a landed result integrates: a ticket branch or the release line. */
export type LandingClass = "ticket" | "release";

export interface TaskDescriptor {
  id: string;
  taskClass: TaskClass;
  durability: Durability;
}

/** Review a task requires before its result may land. */
export interface ReviewRequirement {
  /** Named reviewer must sign off before landing. */
  coldReview: boolean;
  /** Task must run as a node in an explicit dependency DAG. */
  dagCoordination: boolean;
}

/**
 * Review matrix (release-driven-solo profile): mechanical and localized work
 * lands solo; anything cross-boundary or judgement-heavy needs cold review,
 * and cross-boundary work must additionally be coordinated in a DAG.
 */
export function reviewRequirement(taskClass: TaskClass): ReviewRequirement {
  switch (taskClass) {
    case "mechanical":
      return { coldReview: false, dagCoordination: false };
    case "localized":
      return { coldReview: false, dagCoordination: false };
    case "cross-boundary":
      return { coldReview: true, dagCoordination: true };
    case "judgment-heavy":
      return { coldReview: true, dagCoordination: false };
  }
}

// ---------------------------------------------------------------------------
// Limits and admission request
// ---------------------------------------------------------------------------

/** Hard ceilings injected by the caller (policy holder), not discovered here. */
export interface HardLimits {
  maxWorkers: number;
  maxCostUsd: number;
  maxDurationMs: number;
  maxNetworkCalls: number;
  maxExternalWrites: number;
  maxSpawnDepth: number;
  allowNativeDelegation: boolean;
  allowSecretAccess: boolean;
  requireTrustedRepo: boolean;
}

export interface AdmissionRequest {
  task: TaskDescriptor;
  /** Principal requesting admission; must be on the caller's allowlist. */
  principal: string;
  /** Parallel workers requested (solo task classes are capped at 1). */
  workers: number;
  /** Estimated cost in USD; must be a finite number when known. */
  estimatedCostUsd: number;
  /** Wall-clock budget in milliseconds. */
  estimatedDurationMs: number;
  /** Outbound network calls the plan will make. */
  networkCalls: number;
  /** Writes leaving the repo/sandbox (publish, provision, external APIs). */
  externalWrites: number;
  /** Depth of the spawn chain requesting admission (0 = top-level). */
  spawnDepth: number;
  /** Execution is sandboxed (worker isolation, not the repo itself). */
  sandboxed: boolean;
  /** Repo the work runs in is trusted (reviewed checkout, not foreign). */
  repoTrusted: boolean;
  /** Plan uses native sub-agent delegation. */
  nativeDelegation: boolean;
  /** Plan was granted explicit secret access by the caller. */
  secretsGranted: boolean;
  /** Where the result lands: a ticket branch or the release line. */
  landingClass: LandingClass;
  /** Branch the result is proposed against. */
  targetBranch: string;
  /** Explicit user authorization, required for any main-bound landing. */
  authorizedByUser: boolean;
  /** A dependency DAG is present and this task is a coordinated node. */
  dependencyDagPresent: boolean;
  /** Named reviewer for cold-review task classes; distinct from principal. */
  reviewer: string | null;
}

/** One named admission check and its outcome. */
export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PreflightDecision {
  admitted: boolean;
  checks: CheckResult[];
  review: ReviewRequirement;
  reasons: string[];
}

const TASK_CLASSES: readonly TaskClass[] = [
  "mechanical",
  "localized",
  "cross-boundary",
  "judgment-heavy",
];

/** Task classes that never fan out: one worker, no exceptions. */
const SOLO_CLASSES: readonly TaskClass[] = ["mechanical", "localized"];

const DURABILITIES: readonly Durability[] = ["observational", "mutable", "durable"];

/** Valid landing targets: `main`, a `release-x-y-z` line, or an issue branch. */
const TARGET_BRANCH_RE =
  /^(main|release-\d+-\d+-\d+|\d+)$/;

function requireNonNegativeFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ContractError("schema", `preflight: '${field}' must be a finite non-negative number`);
  }
  return value;
}

/**
 * Strict shape validation. Throws `ContractError` on the FIRST malformed
 * field; never coerces, never accepts `undefined` for a required field, and
 * rejects truthy impostors such as `'yes'` where a real boolean is required.
 * Returns trimmed, typed views of the fields the semantic checks need.
 */
interface ValidatedRequest {
  task: TaskDescriptor;
  principal: string;
  workers: number;
  estimatedCostUsd: number;
  estimatedDurationMs: number;
  networkCalls: number;
  externalWrites: number;
  spawnDepth: number;
  sandboxed: boolean;
  repoTrusted: boolean;
  nativeDelegation: boolean;
  secretsGranted: boolean;
  authorizedByUser: boolean;
  landingClass: LandingClass;
  targetBranch: string;
  reviewer: string | null;
  dependencyDagPresent: boolean;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractError("schema", `preflight: '${field}' must be a non-empty string`);
  }
  return value.trim();
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractError("schema", `preflight: '${field}' must be a boolean`);
  }
  return value;
}

function requireNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ContractError("schema", `preflight: '${field}' must be a non-negative integer`);
  }
  return value;
}

function validateStructure(
  request: unknown,
  limits: unknown,
  knownAuthorities: readonly string[],
): ValidatedRequest {
  if (!isPlainObject(request)) {
    throw new ContractError("schema", "preflight: request must be an object");
  }
  if (!isPlainObject(limits)) {
    throw new ContractError("schema", "preflight: limits must be an object");
  }
  if (!Array.isArray(knownAuthorities)) {
    throw new ContractError("schema", "preflight: knownAuthorities must be an array");
  }
  if (knownAuthorities.length === 0) {
    throw new ContractError("schema", "preflight: knownAuthorities must be a non-empty array");
  }
  for (const authority of knownAuthorities) {
    if (typeof authority !== "string" || authority.trim() === "") {
      throw new ContractError(
        "schema",
        "preflight: every knownAuthorities entry must be a non-empty string",
      );
    }
  }

  // Task descriptor: id non-empty, enums exact.
  if (!isPlainObject(request.task)) {
    throw new ContractError("schema", "preflight: request.task must be an object");
  }
  requireString(request.task.id, "task.id");
  if (!TASK_CLASSES.includes(request.task.taskClass as TaskClass)) {
    throw new ContractError("schema", `preflight: unknown taskClass '${request.task.taskClass}'`);
  }
  if (!DURABILITIES.includes(request.task.durability as Durability)) {
    throw new ContractError(
      "schema",
      `preflight: unknown durability '${request.task.durability}'`,
    );
  }

  // Numeric request fields: exact integers, non-negative; workers positive.
  requireNonNegativeFinite(request.estimatedCostUsd, "request.estimatedCostUsd");
  for (const key of [
    "estimatedDurationMs",
    "networkCalls",
    "externalWrites",
    "spawnDepth",
  ] as const) {
    requireNonNegativeInt(request[key], `request.${key}`);
  }
  if (typeof request.workers !== "number" || !Number.isInteger(request.workers) || request.workers < 1) {
    throw new ContractError("schema", "preflight: 'request.workers' must be a positive integer");
  }

  // Boolean request fields: real booleans only, `'yes'`/`1`/`undefined` die here.
  for (const key of [
    "sandboxed",
    "repoTrusted",
    "nativeDelegation",
    "secretsGranted",
    "authorizedByUser",
    "dependencyDagPresent",
  ] as const) {
    requireBoolean(request[key], `request.${key}`);
  }

  // Reviewer: null (no reviewer) or a non-empty trimmed string.
  if (request.reviewer !== null) {
    requireString(request.reviewer, "request.reviewer");
  }

  // Landing class: exact enum.
  if (request.landingClass !== "ticket" && request.landingClass !== "release") {
    throw new ContractError("schema", `preflight: unknown landingClass '${request.landingClass}'`);
  }

  // Target branch: `main`, a `release-x-y-z` line, or an issue-number branch.
  const branch = request.targetBranch;
  if (typeof branch !== "string" || !TARGET_BRANCH_RE.test(branch)) {
    throw new ContractError(
      "schema",
      `preflight: targetBranch must be 'main', 'release-<n>-<n>-<n>', or an issue-number branch`,
    );
  }

  // Numeric limit fields: non-negative integers.
  requireNonNegativeFinite(limits.maxCostUsd, "limits.maxCostUsd");
  for (const key of [
    "maxWorkers",
    "maxDurationMs",
    "maxNetworkCalls",
    "maxExternalWrites",
    "maxSpawnDepth",
  ] as const) {
    requireNonNegativeInt(limits[key], `limits.${key}`);
  }

  // Boolean limit fields: real booleans.
  for (const key of [
    "allowNativeDelegation",
    "allowSecretAccess",
    "requireTrustedRepo",
  ] as const) {
    requireBoolean(limits[key], `limits.${key}`);
  }

  return {
    task: request.task as unknown as TaskDescriptor,
    principal: requireString(request.principal, "request.principal"),
    workers: request.workers as number,
    estimatedCostUsd: request.estimatedCostUsd as number,
    estimatedDurationMs: request.estimatedDurationMs as number,
    networkCalls: request.networkCalls as number,
    externalWrites: request.externalWrites as number,
    spawnDepth: request.spawnDepth as number,
    sandboxed: request.sandboxed as boolean,
    repoTrusted: request.repoTrusted as boolean,
    nativeDelegation: request.nativeDelegation as boolean,
    secretsGranted: request.secretsGranted as boolean,
    authorizedByUser: request.authorizedByUser as boolean,
    landingClass: request.landingClass as LandingClass,
    targetBranch: request.targetBranch as string,
    reviewer: request.reviewer === null ? null : requireString(request.reviewer, "request.reviewer"),
    dependencyDagPresent: request.dependencyDagPresent as boolean,
  };
}

/**
 * Validate one admission request against injected hard limits. Throws
 * `ContractError` on malformed input (null request, non-object limits, wrong
 * field types, unknown enum values, empty strings); returns a decision with
 * per-check results otherwise. A semantic violation (over budget, forbidden
 * delegation, untrusted repo, unendorsed main landing) blocks the request.
 */
export function preflight(
  request: unknown,
  limits: unknown,
  knownAuthorities: readonly string[],
): PreflightDecision {
  const v = validateStructure(request, limits, knownAuthorities);
  const lim = limits as HardLimits;

  const checks: CheckResult[] = [];
  const reasons: string[] = [];
  function check(name: string, passed: boolean, detail: string): void {
    checks.push({ name, passed, detail });
    if (!passed) reasons.push(`${name}: ${detail}`);
  }

  // Authority first: an unknown principal is rejected before any budget is
  // even looked at.
  const authorized = knownAuthorities.some((a) => a.trim() === v.principal);
  check(
    "authority",
    authorized,
    authorized
      ? `principal '${v.principal}' is on the allowlist`
      : `principal '${v.principal}' is not on the allowlist`,
  );

  // Solo classes never fan out; every class respects maxWorkers.
  const solo = SOLO_CLASSES.includes(v.task.taskClass);
  check(
    "budget-workers",
    v.workers >= 1 && v.workers <= lim.maxWorkers && (!solo || v.workers === 1),
    solo
      ? `${v.task.taskClass} tasks run solo: workers must be 1, got ${v.workers}`
      : `workers ${v.workers} must be an integer in [1, ${lim.maxWorkers}]`,
  );

  check(
    "budget-cost",
    v.estimatedCostUsd >= 0 && v.estimatedCostUsd <= lim.maxCostUsd,
    `estimatedCostUsd ${v.estimatedCostUsd} must be within [0, ${lim.maxCostUsd}]`,
  );
  check(
    "budget-duration",
    v.estimatedDurationMs >= 0 && v.estimatedDurationMs <= lim.maxDurationMs,
    `estimatedDurationMs ${v.estimatedDurationMs} must be within [0, ${lim.maxDurationMs}]`,
  );
  check(
    "budget-network",
    v.networkCalls <= lim.maxNetworkCalls,
    `networkCalls ${v.networkCalls} must be within [0, ${lim.maxNetworkCalls}]`,
  );
  check(
    "budget-external-writes",
    v.externalWrites <= lim.maxExternalWrites,
    `externalWrites ${v.externalWrites} must be within [0, ${lim.maxExternalWrites}]`,
  );
  check(
    "budget-spawn-depth",
    v.spawnDepth <= lim.maxSpawnDepth,
    `spawnDepth ${v.spawnDepth} must be within [0, ${lim.maxSpawnDepth}]`,
  );

  // Delegation: native sub-agents are forbidden unless policy allows them.
  check(
    "delegation",
    !v.nativeDelegation || lim.allowNativeDelegation,
    v.nativeDelegation
      ? "native delegation is forbidden by policy"
      : "no native delegation requested",
  );

  // Sandbox: anything that leaves the repo (writes, network) must run inside
  // a sandbox when the repo is not explicitly trusted.
  check(
    "sandbox",
    v.sandboxed || (v.repoTrusted && v.externalWrites === 0 && v.networkCalls === 0),
    v.sandboxed
      ? "execution is sandboxed"
      : "unsandboxed execution requires a trusted repo and no external writes or network calls",
  );

  // Repo trust: when policy requires a trusted repo, an untrusted one is
  // rejected even if the execution is sandboxed.
  check(
    "repo-trust",
    !lim.requireTrustedRepo || v.repoTrusted,
    v.repoTrusted
      ? "repo is trusted"
      : "policy requires a trusted repo; untrusted repo execution is rejected",
  );

  // Secrets: touching secrets requires both an explicit grant and an
  // allowlist that permits the principal at all.
  check(
    "secrets",
    !v.secretsGranted || (authorized && lim.allowSecretAccess),
    v.secretsGranted
      ? "secret access requires an authorized principal and allowSecretAccess"
      : "no secret access requested",
  );

  // Cross-boundary preconditions: coordinated work needs a DAG node and an
  // independent reviewer; judgement-heavy work needs the reviewer too.
  const review = reviewRequirement(v.task.taskClass);
  if (review.dagCoordination) {
    check(
      "dag",
      v.dependencyDagPresent,
      "cross-boundary work must run as a node in an explicit dependency DAG",
    );
  }
  if (review.coldReview) {
    const independent =
      v.reviewer !== null && v.reviewer.toLowerCase() !== v.principal.toLowerCase();
    check(
      "reviewer",
      independent,
      "cold-review task classes require a named reviewer distinct from the author",
    );
  }

  // Release-line integrity: a main-bound landing must be release-class and
  // explicitly user-authorized; release-class landings elsewhere need user
  // authorization too; ticket-class landings on release/issue branches do not.
  if (v.targetBranch === "main") {
    check(
      "landing",
      v.landingClass === "release" && v.authorizedByUser,
      "a main-bound landing must be release-class and explicitly user-authorized",
    );
  } else if (/^\d+$/.test(v.targetBranch)) {
    check(
      "landing",
      v.landingClass === "ticket",
      "an issue-branch target must be a ticket-class landing",
    );
  } else if (v.landingClass === "release") {
    check(
      "landing",
      v.authorizedByUser,
      "a release-class landing requires explicit user authorization",
    );
  }

  return {
    admitted: checks.every((c) => c.passed),
    checks,
    review,
    reasons: reasons.slice(),
  };
}
