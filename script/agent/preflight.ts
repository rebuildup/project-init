/**
 * Execution preflight / admission for agent workers (Epic #86, T010).
 *
 * Pure functions only: every input is injected, nothing here launches a
 * process, touches the network, or reads the filesystem. Fail closed: a
 * request that is missing, malformed, ambiguous, or over any hard limit is
 * blocked with explicit reasons — never waved through on partial data.
 *
 * This module is ADVISORY to the caller's launch path: it returns a decision,
 * it never launches, writes, or enforces anything by itself. Unresolved or
 * out-of-policy requests are `blocked`, never degraded to a weaker admission.
 *
 * Malformed input (null request/task, non-finite numbers, unknown enum
 * values) throws `ContractError` from script/agent/contract.ts rather than
 * returning a decision: a caller that cannot shape the contract does not get
 * an admission verdict to misread.
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
  /** Plan uses native sub-agent delegation. */
  nativeDelegation: boolean;
  /** Execution is sandboxed (worker isolation, not the repo itself). */
  sandboxed: boolean;
  /** Repo the work runs in is trusted (reviewed checkout, not foreign). */
  repoTrusted: boolean;
  /** Plan was granted explicit secret access by the caller. */
  secretsGranted: boolean;
  /** Where the result lands: a ticket branch or the release line. */
  landingClass: LandingClass;
  /** Branch the result is proposed against (e.g. a release-* branch). */
  targetBranch: string;
  /** Explicit user authorization, required for any main-bound landing. */
  authorizedByUser: boolean;
  /** A dependency DAG is present and this task is a coordinated node. */
  dependencyDagPresent: boolean;
  /** Named reviewer for cold-review task classes; distinct from principal. */
  reviewer: string | null;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PreflightDecision {
  admitted: boolean;
  checks: CheckResult[];
  review: ReviewRequirement;
  /** Fail-closed reasons, empty when admitted. */
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validate one admission request against injected hard limits. Throws
 * `ContractError` on malformed input (null request/task, non-finite limit or
 * budget numbers, unknown task class); returns a decision with per-check
 * results otherwise. Semantic violations (over budget, forbidden delegation,
 * missing reviewer) block the request instead of throwing.
 */
export function preflight(
  request: AdmissionRequest,
  limits: HardLimits,
  knownAuthorities: readonly string[],
): PreflightDecision {
  // Shape validation: malformed input is a caller bug, throw — never guess.
  if (!isPlainObject(request) || !isPlainObject(request.task)) {
    throw new ContractError("schema", "preflight: request and request.task must be objects");
  }
  if (!TASK_CLASSES.includes(request.task.taskClass)) {
    throw new ContractError("schema", `preflight: unknown taskClass '${request.task.taskClass}'`);
  }
  if (!DURABILITIES.includes(request.task.durability)) {
    throw new ContractError(
      "schema",
      `preflight: unknown durability '${request.task.durability}'`,
    );
  }
  const NUMERIC_LIMIT_KEYS = [
    "maxWorkers",
    "maxCostUsd",
    "maxDurationMs",
    "maxNetworkCalls",
    "maxExternalWrites",
    "maxSpawnDepth",
  ] as const;

  for (const key of NUMERIC_LIMIT_KEYS) {
    if (!isFiniteNumber(limits[key])) {
      throw new ContractError("schema", `preflight: limit '${key}' must be a finite number`);
    }
  }
  for (const key of ["allowNativeDelegation", "allowSecretAccess", "requireTrustedRepo"] as const) {
    if (typeof limits[key] !== "boolean") {
      throw new ContractError("schema", `preflight: limit '${key}' must be a boolean`);
    }
  }
  for (const key of [
    "workers",
    "estimatedCostUsd",
    "estimatedDurationMs",
    "networkCalls",
    "externalWrites",
  ] as const) {
    if (!isFiniteNumber(request[key])) {
      throw new ContractError("schema", `preflight: request.${key} must be a finite number`);
    }
  }

  const checks: CheckResult[] = [];
  const reasons: string[] = [];
  function check(name: string, passed: boolean, detail: string): void {
    checks.push({ name, passed, detail });
    if (!passed) reasons.push(`${name}: ${detail}`);
  }

  // Authority: an unknown principal is rejected before any budget is read.
  const authorized = knownAuthorities.includes(request.principal);
  check(
    "authority",
    authorized,
    authorized
      ? `principal '${request.principal}' is on the allowlist`
      : `principal '${request.principal}' is not on the allowlist`,
  );

  // Solo classes never fan out; every class respects maxWorkers.
  const solo = SOLO_CLASSES.includes(request.task.taskClass);
  check(
    "budget-workers",
    request.workers >= 1 && request.workers <= limits.maxWorkers && (!solo || request.workers === 1),
    solo
      ? `${request.task.taskClass} tasks run solo: workers must be 1, got ${request.workers}`
      : `workers ${request.workers} must be an integer in [1, ${limits.maxWorkers}]`,
  );

  check(
    "budget-cost",
    request.estimatedCostUsd >= 0 && request.estimatedCostUsd <= limits.maxCostUsd,
    `estimatedCostUsd ${request.estimatedCostUsd} must be within [0, ${limits.maxCostUsd}]`,
  );
  check(
    "budget-duration",
    request.estimatedDurationMs >= 0 && request.estimatedDurationMs <= limits.maxDurationMs,
    `estimatedDurationMs ${request.estimatedDurationMs} must be within [0, ${limits.maxDurationMs}]`,
  );
  check(
    "budget-network",
    isNonNegativeInt(request.networkCalls) && request.networkCalls <= limits.maxNetworkCalls,
    `networkCalls ${request.networkCalls} must be a non-negative integer within [0, ${limits.maxNetworkCalls}]`,
  );
  check(
    "budget-spawn-depth",
    isNonNegativeInt(request.spawnDepth) && request.spawnDepth <= limits.maxSpawnDepth,
    `spawnDepth ${request.spawnDepth} must be a non-negative integer within [0, ${limits.maxSpawnDepth}]`,
  );
  check(
    "budget-external-writes",
    isNonNegativeInt(request.externalWrites) &&
      request.externalWrites <= limits.maxExternalWrites,
    `externalWrites ${request.externalWrites} must be a non-negative integer within [0, ${limits.maxExternalWrites}]`,
  );

  // Delegation: native sub-agents are forbidden unless policy allows them.
  check(
    "delegation",
    !request.nativeDelegation || limits.allowNativeDelegation,
    request.nativeDelegation
      ? "native delegation is forbidden by policy"
      : "no native delegation requested",
  );

  // Sandbox: anything that leaves the repo (writes, network, tools) must run
  // inside a sandbox when the repo is not explicitly trusted.
  check(
    "sandbox",
    request.sandboxed || (request.repoTrusted && request.externalWrites === 0),
    request.sandboxed
      ? "execution is sandboxed"
      : "unsandboxed execution requires a trusted repo and no external writes",
  );

  // Secrets: touching secrets requires both an explicit grant and an
  // allowlist that permits the principal at all.
  check(
    "secrets",
    !request.secretsGranted || (authorized && limits.allowSecretAccess),
    request.secretsGranted
      ? "secret access requires an authorized principal and allowSecretAccess"
      : "no secret access requested",
  );

  // Cross-boundary preconditions: coordinated work needs a DAG node and an
  // independent reviewer; judgement-heavy work needs the reviewer too.
  const review = reviewRequirement(request.task.taskClass);
  if (review.dagCoordination) {
    check(
      "dag",
      request.dependencyDagPresent,
      "cross-boundary work must run as a node in an explicit dependency DAG",
    );
  }
  if (review.coldReview) {
    check(
      "reviewer",
      typeof request.reviewer === "string" &&
        request.reviewer.length > 0 &&
        request.reviewer !== request.principal,
      "cold-review task classes require a named reviewer distinct from the author",
    );
  }

  // Release-line integrity: only an explicitly user-authorized release
  // landing may write to main; ticket-class work lands on ticket branches.
  if (request.targetBranch === "main") {
    check(
      "landing",
      request.landingClass === "release" && request.authorizedByUser,
      "a main-bound landing must be release-class and explicitly user-authorized",
    );
  }

  return {
    admitted: checks.every((c) => c.passed),
    checks,
    review,
    reasons: reasons.slice(),
  };
}
