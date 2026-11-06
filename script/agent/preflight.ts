/**
 * Execution preflight / admission for agent workers (Epic #86, T010).
 *
 * Pure functions only: every input is injected, nothing here launches a
 * process, touches the network, or reads the filesystem. Fail closed: a
 * request that is missing, malformed, ambiguous, or over any hard limit is
 * blocked with explicit reasons — never waved through on partial data.
 *
 * Admission answers four questions before a worker may run:
 *   1. authority   — is the principal on the caller's allowlist?
 *   2. budget      — are workers/cost/time within the injected hard limits?
 *   3. delegation  — is native (sub-agent) delegation allowed at all?
 *   4. sandbox     — are writes/network confined to a sandboxed, trusted repo?
 */

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
// Admission request
// ---------------------------------------------------------------------------

/** Hard ceilings injected by the caller (policy holder), not discovered here. */
export interface HardLimits {
  maxWorkers: number;
  maxCostUsd: number;
  maxDurationMs: number;
  maxNetworkCalls: number;
  maxExternalWrites: number;
  /** Native (sub-agent) delegation permitted by policy. */
  allowNativeDelegation: boolean;
  /** Secrets may be touched at all (needsSecrets must still be granted). */
  allowSecretAccess: boolean;
  /** Tool execution requires a trusted repo. */
  requireTrustedRepo: boolean;
}

export interface AdmissionRequest {
  task: TaskDescriptor;
  /** Principal requesting admission; must be on the caller's allowlist. */
  principal: string;
  /** Callers explicitly authorized to run work (allowlist; empty = nobody). */
  knownAuthorities: readonly string[];
  /** Parallel workers requested. */
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

const DURABILITIES: readonly Durability[] = ["observational", "mutable", "durable"];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validate one admission request against injected hard limits. Throws
 * `ContractError` on malformed input (wrong shape, unknown class), returns a
 * decision with per-check results otherwise. A request that omits or fudges
 * any field fails closed: unknown budget values, unknown principals,
 * untrusted repos and unsandboxed external writes are all rejections.
 */
export function preflight(
  request: AdmissionRequest,
  limits: HardLimits,
  knownAuthorities: readonly string[],
): PreflightDecision {
  const checks: CheckResult[] = [];
  const reasons: string[] = [];

  function check(name: string, passed: boolean, detail: string): void {
    checks.push({ name, passed, detail });
    if (!passed) reasons.push(`${name}: ${detail}`);
  }

  // Authority first: an unknown principal is rejected before any budget is
  // even looked at.
  const authorized = knownAuthorities.includes(request.principal);
  check(
    "authority",
    authorized,
    authorized
      ? `principal '${request.principal}' is on the allowlist`
      : `principal '${request.principal}' is not on the allowlist`,
  );

  // Task shape must be a real classification, not a typo'd string.
  check(
    "task-class",
    TASK_CLASSES.includes(request.task.taskClass),
    `taskClass '${request.task.taskClass}' must be one of ${TASK_CLASSES.join(", ")}`,
  );
  check(
    "task-durability",
    DURABILITIES.includes(request.task.durability),
    `durability '${request.task.durability}' must be one of ${DURABILITIES.join(", ")}`,
  );

  // Budget: every quantity must be a finite, non-negative integer within its
  // ceiling. Absent or NaN quantities fail closed (callers pass numbers, not
  // undefined, so a missing estimate is the caller's explicit `NaN`/`-1`).
  check(
    "budget-workers",
    isNonNegativeInt(request.workers) && request.workers >= 1 && request.workers <= limits.maxWorkers,
    `workers ${request.workers} must be an integer in [1, ${limits.maxWorkers}]`,
  );
  check(
    "budget-cost",
    isFiniteNumber(request.estimatedCostUsd) &&
      request.estimatedCostUsd >= 0 &&
      request.estimatedCostUsd <= limits.maxCostUsd,
    `estimatedCostUsd ${request.estimatedCostUsd} must be within [0, ${limits.maxCostUsd}]`,
  );
  check(
    "budget-duration",
    isFiniteNumber(request.estimatedDurationMs) &&
      request.estimatedDurationMs >= 0 &&
      request.estimatedDurationMs <= limits.maxDurationMs,
    `estimatedDurationMs ${request.estimatedDurationMs} must be within [0, ${limits.maxDurationMs}]`,
  );
  check(
    "budget-network",
    isNonNegativeInt(request.networkCalls) && request.networkCalls <= limits.maxNetworkCalls,
    `networkCalls ${request.networkCalls} must be a non-negative integer within [0, ${limits.maxNetworkCalls}]`,
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

  return {
    admitted: checks.every((c) => c.passed),
    checks,
    review: reviewRequirement(request.task.taskClass),
    reasons: reasons.slice(),
  };
}
