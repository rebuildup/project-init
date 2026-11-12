#!/usr/bin/env bun
/**
 * Same-harness fallback execution (dotfiles#139, Epic#86 T021).
 *
 * Implements authorized provider/model switching within the same harness
 * when the primary route becomes unusable. Uses the validated fallback
 * profile from #136 and error classification compatible with #92 (limits.ts).
 *
 * Does NOT implement cross-harness or cross-host migration (those belong to #101).
 */

import {
  ContractError,
  parseRouteId,
  formatRouteId,
  type RouteRef,
  type Attested,
  isUsable,
  DEFAULT_MAX_EVIDENCE_AGE_MS,
} from "./contract.ts";
import {
  FallbackProfile,
  FallbackCandidate,
  FallbackResolution,
  ResolvedCandidate,
  RejectedCandidate,
  FallbackRejectionReason,
  parseFallbackProfile,
  resolveFallbackProfile,
  type CatalogLike,
} from "./fallback.ts";
import { loadConfig, type Config, type Route, type Provider, type Harness } from "../agent.ts";
import { loadCatalog } from "./catalog.ts";
import { agentStateDir } from "./contract.ts";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Error classification (compatible with #92 limits.ts)
// ---------------------------------------------------------------------------

/**
 * Failure categories matching limits.ts taxonomy.
 * When limits.ts (#119) is merged, this module should import from there.
 */
export type LimitCategory =
  | "rate-limit"       // 429 with retry-after; transient, reset possible
  | "quota-exhausted"  // 429 with observed depleted allowance (remaining 0)
  | "concurrency"      // parallelism limit; transient, no reset
  | "billing"          // 402 payment required; NOT transient, NO reset
  | "auth"             // 401/403; NOT transient, NO reset
  | "network"          // timeout/dns/unreachable/5xx; transient
  | "context"          // context length exceeded; deterministic
  | "model-invalid"    // unknown/mismatched model id; config error
  | "unknown";         // fail closed

export const LIMIT_CATEGORIES: readonly LimitCategory[] = [
  "rate-limit",
  "quota-exhausted",
  "concurrency",
  "billing",
  "auth",
  "network",
  "context",
  "model-invalid",
  "unknown",
];

/** Policy facts per category — single authority for decisions. */
export interface CategoryFacts {
  transient: boolean;
  resetPossible: boolean;
  scopeBlock: boolean;
  checkpointRecovery: boolean;
}

export const CATEGORY_FACTS: Record<LimitCategory, CategoryFacts> = {
  "rate-limit": { transient: true, resetPossible: true, scopeBlock: true, checkpointRecovery: true },
  "quota-exhausted": { transient: true, resetPossible: true, scopeBlock: true, checkpointRecovery: true },
  concurrency: { transient: true, resetPossible: false, scopeBlock: true, checkpointRecovery: true },
  billing: { transient: false, resetPossible: false, scopeBlock: true, checkpointRecovery: false },
  auth: { transient: false, resetPossible: false, scopeBlock: true, checkpointRecovery: false },
  network: { transient: true, resetPossible: false, scopeBlock: false, checkpointRecovery: true },
  context: { transient: false, resetPossible: false, scopeBlock: false, checkpointRecovery: false },
  "model-invalid": { transient: false, resetPossible: false, scopeBlock: false, checkpointRecovery: false },
  unknown: { transient: false, resetPossible: false, scopeBlock: false, checkpointRecovery: false },
};

/** Severity for admission block merging: lower = more severe. */
export const CATEGORY_SEVERITY: Record<LimitCategory, number> = {
  billing: 0,
  auth: 0,
  "quota-exhausted": 1,
  "rate-limit": 2,
  concurrency: 3,
  network: 4,
  context: 5,
  "model-invalid": 5,
  unknown: 6,
};

/** Classification result with structured evidence (no message scraping). */
export interface ClassifiedError {
  category: LimitCategory;
  observedAt: string;
  resetAt: string | null;
  retryAfterMs: number | null;
  exhausted: boolean;
  reason: string;
  quotaScopeKey: string | null;
}

const REASON_BY_CATEGORY: Record<LimitCategory, string> = {
  "rate-limit": "HTTP 429: rate limited",
  "quota-exhausted": "HTTP 429: allowance depleted (remaining 0 observed)",
  concurrency: "concurrency limit observed",
  billing: "HTTP 402: payment required; no provider reset time exists",
  auth: "credential or authorization failure; not transient",
  network: "transport or provider unavailable",
  context: "request exceeds the model context window",
  "model-invalid": "model id unknown or mismatched",
  unknown: "unrecognized failure; failing closed",
};

const ERROR_KIND_CATEGORY: Record<string, LimitCategory> = {
  context_length_exceeded: "context",
  model_not_found: "model-invalid",
  invalid_api_key: "auth",
  insufficient_quota: "billing",
  overloaded_error: "network",
};

const MIRRORED_EXIT_CODES: Record<number, LimitCategory> = {
  401: "auth",
  402: "billing",
  403: "auth",
  429: "rate-limit",
};

const PROBE_FAILURE_CATEGORY: Record<string, LimitCategory> = {
  config: "unknown",
  "model-mismatch": "model-invalid",
  "credential-missing": "auth",
  "not-launchable": "unknown",
  dns: "network",
  network: "network",
  timeout: "network",
  auth: "auth",
  payment: "billing",
  forbidden: "auth",
  "rate-limit": "rate-limit",
  "rate-limit-cooldown": "rate-limit",
  restricted: "auth",
  "no-tool-call": "unknown",
  "unsupported-wire": "unknown",
  http: "unknown",
};

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const MAX_RESET_HORIZON_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface FailureSignal {
  httpStatus?: number | null;
  failureKind?: string | null;
  exitCode?: number | null;
  retryAfterMs?: number | null;
  resetAt?: string | null;
  usage?: Array<{ metric: string; remaining: number }> | null;
  errorKind?: string | null;
  quotaScopeKey?: string | null;
}

function requireIsoTime(ts: string, where: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(ts)) {
    throw new ContractError("schema", `${where}: not a valid ISO 8601 UTC timestamp`);
  }
  return ts;
}

function optionalNumber(raw: unknown, where: string, min: number, max: number): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new ContractError("schema", `${where}: must be a finite integer`);
  }
  if (raw < min || raw > max) {
    throw new ContractError("schema", `${where}: out of range`);
  }
  return raw;
}

function checkSignal(signal: FailureSignal, observedMs: number): {
  httpStatus: number | null;
  failureKind: string | null;
  exitCode: number | null;
  retryAfterMs: number | null;
  resetAt: string | null;
  usage: Array<{ metric: string; remaining: number }>;
  errorKind: string | null;
} {
  if (!signal || typeof signal !== "object") {
    throw new ContractError("schema", "signal object expected");
  }
  
  const httpStatus = optionalNumber(signal.httpStatus, "httpStatus", 100, 599);
  if (httpStatus !== null && httpStatus < 400) {
    throw new ContractError("schema", `httpStatus ${httpStatus} is not a failure`);
  }
  
  let failureKind: string | null = null;
  if (signal.failureKind !== undefined && signal.failureKind !== null) {
    if (typeof signal.failureKind !== "string" || !PROBE_FAILURE_CATEGORY[signal.failureKind]) {
      throw new ContractError("schema", `unknown failureKind`);
    }
    failureKind = signal.failureKind;
  }
  
  const exitCode = optionalNumber(signal.exitCode, "exitCode", 0, 4_294_967_295);
  const retryAfterMs = optionalNumber(signal.retryAfterMs, "retryAfterMs", 0, MAX_RETRY_AFTER_MS);
  
  let resetAt: string | null = null;
  if (signal.resetAt !== undefined && signal.resetAt !== null) {
    const parsed = requireIsoTime(signal.resetAt, "resetAt");
    if (Date.parse(parsed) - observedMs <= MAX_RESET_HORIZON_MS) resetAt = parsed;
  }
  
  let usage: Array<{ metric: string; remaining: number }> = [];
  if (signal.usage !== undefined && signal.usage !== null) {
    if (!Array.isArray(signal.usage)) {
      throw new ContractError("schema", "usage must be an array");
    }
    usage = signal.usage;
  }
  
  let errorKind: string | null = null;
  if (signal.errorKind !== undefined && signal.errorKind !== null) {
    if (typeof signal.errorKind !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(signal.errorKind)) {
      throw new ContractError("schema", "malformed errorKind");
    }
    errorKind = signal.errorKind;
  }
  
  return { httpStatus, failureKind, exitCode, retryAfterMs, resetAt, usage, errorKind };
}

/**
 * Classify a failure from structured evidence ONLY.
 * Mirrors limits.ts logic: HTTP status -> probe failureKind -> exit code -> unknown.
 * Message text is NEVER scraped; unknown fails closed.
 */
export function classifyFailure(signal: FailureSignal, observedAt: string): ClassifiedError {
  requireIsoTime(observedAt, "observedAt");
  const observedMs = Date.parse(observedAt);
  const checked = checkSignal(signal, observedMs);
  
  let category: LimitCategory = "unknown";
  
  if (checked.httpStatus !== null) {
    const status = checked.httpStatus;
    if (status === 401 || status === 403) {
      category = "auth";
    } else if (status === 402) {
      category = "billing";
    } else if (status === 429) {
      if (checked.errorKind && ERROR_KIND_CATEGORY[checked.errorKind]) {
        category = ERROR_KIND_CATEGORY[checked.errorKind];
      } else if (checked.usage.some((u) => u.metric === "concurrency")) {
        category = "concurrency";
      } else if (checked.usage.some((u) => u.remaining === 0)) {
        category = "quota-exhausted";
      } else {
        category = "rate-limit";
      }
    } else if (status === 413) {
      category = "context";
    } else if (status === 400 || status === 404) {
      category = checked.errorKind && ERROR_KIND_CATEGORY[checked.errorKind]
        ? ERROR_KIND_CATEGORY[checked.errorKind]
        : "unknown";
    } else if (status >= 500) {
      category = "network";
    }
  } else if (checked.failureKind) {
    category = PROBE_FAILURE_CATEGORY[checked.failureKind];
  } else if (checked.exitCode !== null) {
    category = MIRRORED_EXIT_CODES[checked.exitCode] ?? "unknown";
  }
  
  const facts = CATEGORY_FACTS[category];
  const exhausted = checked.usage.some((u) => u.remaining === 0);
  
  return {
    category,
    observedAt,
    resetAt: facts.resetPossible ? checked.resetAt : null,
    retryAfterMs: facts.transient ? checked.retryAfterMs : null,
    exhausted,
    reason: REASON_BY_CATEGORY[category],
    quotaScopeKey: signal.quotaScopeKey ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fallback execution state
// ---------------------------------------------------------------------------

export interface FallbackExecutionState {
  profileId: string;
  primaryRoute: RouteRef;
  primaryModel: string;
  currentCandidateIndex: number;
  usableCandidates: ResolvedCandidate[];
  attemptStartTime: number;
  lastError: ClassifiedError | null;
  retryCount: number;
  maxRetries: number;
  circuitBreakerOpen: boolean;
  circuitBreakerOpenedAt: number | null;
}

export const FALLBACK_CIRCUIT_BREAKER_THRESHOLD = 3;
export const FALLBACK_CIRCUIT_BREAKER_RESET_MS = 60000;
export const FALLBACK_MAX_RETRIES_PER_CANDIDATE = 2;
export const FALLBACK_MAX_TOTAL_RETRIES = 5;

/**
 * Execute a task with same-harness fallback support.
 * Returns the result of the first successful candidate, or throws if all exhausted.
 */
export async function executeWithFallback(
  config: Config,
  profileId: string,
  taskFn: (route: RouteRef, model: string, candidate: FallbackCandidate) => Promise<{ success: boolean; error?: FailureSignal; result?: any }>
): Promise<{ route: RouteRef; model: string; candidate: FallbackCandidate; result: any }> {
  // Load and validate profile
  const tomlText = readFileSync(config.path, "utf-8");
  const parsedToml = Bun.TOML.parse(tomlText) as Record<string, unknown>;
  const profile = parseFallbackProfile(parsedToml, profileId);
  if (!profile) {
    throw new ContractError("identity", `Fallback profile not found: ${profileId}`);
  }

  // Build catalog-like
  const catalogLike = buildCatalogLike(config);

  // Load attestations
  const attestationMap = loadAttestations();

  // Get primary quota scope
  const primaryQuotaScope = getPrimaryQuotaScope(config, profile.primaryRoute);

  // Resolve profile
  const resolution = resolveFallbackProfile(profile, catalogLike, attestationMap, primaryQuotaScope);
  if (!resolution.hasUsable) {
    throw new ContractError("state", `No usable fallback candidates for profile ${profileId}: ${resolution.rejected.map(r => `${r.candidate.route}/${r.candidate.model}: ${r.reason}`).join("; ")}`);
  }

  const primaryRouteRef = parseRouteId(profile.primaryRoute);
  let state: FallbackExecutionState = {
    profileId,
    primaryRoute: primaryRouteRef,
    primaryModel: "",
    currentCandidateIndex: 0,
    usableCandidates: resolution.usable,
    attemptStartTime: Date.now(),
    lastError: null,
    retryCount: 0,
    maxRetries: FALLBACK_MAX_TOTAL_RETRIES,
    circuitBreakerOpen: false,
    circuitBreakerOpenedAt: null,
  };

  // Try each candidate in order
  for (let i = 0; i < resolution.usable.length; i++) {
    state.currentCandidateIndex = i;
    const candidate = resolution.usable[i];
    const routeRef = candidate.routeRef;
    const model = candidate.candidate.model;

    // Check circuit breaker
    if (state.circuitBreakerOpen) {
      const elapsed = Date.now() - (state.circuitBreakerOpenedAt ?? 0);
      if (elapsed > FALLBACK_CIRCUIT_BREAKER_RESET_MS) {
        state.circuitBreakerOpen = false;
        state.circuitBreakerOpenedAt = null;
        state.retryCount = 0;
      } else {
        throw new ContractError("state", `Circuit breaker open for profile ${profileId}; wait ${FALLBACK_CIRCUIT_BREAKER_RESET_MS - elapsed}ms`);
      }
    }

    let candidateRetries = 0;
    while (candidateRetries <= FALLBACK_MAX_RETRIES_PER_CANDIDATE && state.retryCount < state.maxRetries) {
      try {
        const result = await taskFn(routeRef, model, candidate.candidate);
        if (result.success) {
          return { route: routeRef, model, candidate: candidate.candidate, result: result.result };
        }

        // Task failed - classify error from structured evidence
        const classified = classifyFailure(result.error ?? {}, new Date().toISOString());
        state.lastError = classified;

        // Handle based on category
        const facts = CATEGORY_FACTS[classified.category];
        
        if (facts.transient && classified.retryAfterMs) {
          // Rate limit with explicit retry-after: wait and retry
          await sleep(Math.min(classified.retryAfterMs, 60000));
          candidateRetries++;
          state.retryCount++;
          continue;
        }

        // Non-transient or no retry-after: move to next candidate
        // Quota/billing/auth never auto-retry on same or another paid route
        candidateRetries = FALLBACK_MAX_RETRIES_PER_CANDIDATE + 1;
        
      } catch (error) {
        // Unexpected error - treat as unknown (fail closed)
        const classified: ClassifiedError = {
          category: "unknown",
          observedAt: new Date().toISOString(),
          resetAt: null,
          retryAfterMs: null,
          exhausted: false,
          reason: "unexpected error during task execution",
          quotaScopeKey: null,
        };
        state.lastError = classified;
        candidateRetries = FALLBACK_MAX_RETRIES_PER_CANDIDATE + 1;
      }
    }

    // Check if we should open circuit breaker
    state.retryCount++;
    if (state.retryCount >= FALLBACK_CIRCUIT_BREAKER_THRESHOLD) {
      state.circuitBreakerOpen = true;
      state.circuitBreakerOpenedAt = Date.now();
    }
  }

  // All candidates exhausted
  throw new ContractError("state", `All fallback candidates exhausted for profile ${profileId}. Last error: ${state.lastError?.category ?? "unknown"}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildCatalogLike(config: Config): CatalogLike {
  const routes: CatalogLike["routes"] = {};
  for (const [key, route] of Object.entries(config.routes)) {
    routes[key] = {
      provider: route.provider,
      models: route.models ?? undefined,
      require_model: route.require_model,
      default_model: route.default_model ?? undefined,
    };
  }

  const providers: CatalogLike["providers"] = {};
  for (const [key, provider] of Object.entries(config.providers)) {
    providers[key] = {
      models: provider.models,
      require_model: provider.require_model,
      default_model: provider.default_model ?? undefined,
      require_infisical: provider.require_infisical,
    };
  }

  const harnesses: CatalogLike["harnesses"] = {};
  for (const [key, harness] of Object.entries(config.harnesses)) {
    harnesses[key] = { adapter: harness.adapter };
  }

  return { routes, providers, harnesses };
}

function loadAttestations(): Map<string, any> {
  const map = new Map<string, any>();
  const stateDir = join(agentStateDir(), "catalog");
  if (!existsSync(stateDir)) return map;

  for (const file of readdirSync(stateDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = readFileSync(join(stateDir, file), "utf-8");
      const data = JSON.parse(content);
      if (data.attestations && typeof data.attestations === "object") {
        for (const [key, value] of Object.entries(data.attestations)) {
          map.set(key, value);
        }
      }
    } catch {
      // ignore malformed files
    }
  }
  return map;
}

function getPrimaryQuotaScope(config: Config, primaryRoute: string): string | null {
  const route = config.routes[primaryRoute];
  if (!route) return null;
  const provider = config.providers[route.provider];
  if (!provider) return null;
  return `${provider.secret}:${provider.env}`;
}
