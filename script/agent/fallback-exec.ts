#!/usr/bin/env bun
/**
 * Same-harness fallback execution (dotfiles#139, Epic#86 T021).
 *
 * Implements authorized provider/model switching within the same harness
 * when the primary route becomes unusable. Uses the validated fallback
 * profile from #136 and error classification from #92.
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
// Error classification (integrates with #92 limits.ts)
// ---------------------------------------------------------------------------

export type ProviderErrorClass =
  | "rate-limited"      // 429 with retry-after
  | "quota-exhausted"   // 402/429 account/plan limit
  | "auth-failed"       // 401/403 authentication/authorization
  | "payment-required"  // 402 billing/payment
  | "upstream-error"    // 5xx provider errors
  | "network-error"     // timeout, connection failure
  | "context-overflow"  // context length exceeded
  | "model-invalid"     // model not found/supported
  | "unknown";          // unclassified

export interface ClassifiedError {
  class: ProviderErrorClass;
  retryAfterMs: number | null;
  quotaScopeKey: string | null;
  isRetryable: boolean;
  isTerminal: boolean;
  evidence: {
    httpStatus?: number;
    errorCode?: string;
    message?: string;
    timestamp: string;
  };
}

/**
 * Classify a provider error from structured evidence.
 * Mirrors the classification logic from #92 limits.ts.
 */
export function classifyProviderError(evidence: {
  httpStatus?: number;
  errorCode?: string;
  message?: string;
  quotaScopeKey?: string;
}): ClassifiedError {
  const timestamp = new Date().toISOString();
  const httpStatus = evidence.httpStatus;
  const errorCode = evidence.errorCode?.toLowerCase();
  const message = evidence.message?.toLowerCase() ?? "";
  const originalMessage = evidence.message ?? "";
  const quotaScopeKey = evidence.quotaScopeKey ?? null;

  // Payment required (402 with billing/payment terms) - most specific first
  if (httpStatus === 402 && (errorCode === "payment_required" || message.includes("payment") || message.includes("billing") || message.includes("insufficient"))) {
    return {
      class: "payment-required",
      retryAfterMs: null,
      quotaScopeKey,
      isRetryable: false,
      isTerminal: true,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Authentication failure
  if (httpStatus === 401 || httpStatus === 403 || errorCode === "unauthorized" || errorCode === "forbidden" || message.includes("auth") || message.includes("unauthorized") || message.includes("forbidden")) {
    return {
      class: "auth-failed",
      retryAfterMs: null,
      quotaScopeKey,
      isRetryable: false,
      isTerminal: true, // Auth issues don't self-resolve
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Quota exhausted (402 without billing terms, OR 429 with quota/exhausted/limit context but not rate limit)
  if (httpStatus === 402 || (httpStatus === 429 && (message.includes("quota") || message.includes("exhausted") || (message.includes("limit") && !message.includes("rate limit"))))) {
    return {
      class: "quota-exhausted",
      retryAfterMs: null, // No automatic reset time known
      quotaScopeKey,
      isRetryable: false, // Requires fallback profile
      isTerminal: false,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Rate limiting with retry-after
  if (httpStatus === 429 || errorCode === "rate_limit" || errorCode === "ratelimit" || message.includes("rate limit")) {
    const retryAfterMs = extractRetryAfterMs(originalMessage);
    return {
      class: "rate-limited",
      retryAfterMs,
      quotaScopeKey,
      isRetryable: true,
      isTerminal: false,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Upstream/provider errors (5xx)
  if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
    return {
      class: "upstream-error",
      retryAfterMs: 30000, // Default 30s backoff
      quotaScopeKey,
      isRetryable: true,
      isTerminal: false,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Network errors
  if (errorCode === "timeout" || errorCode === "econnrefused" || errorCode === "enetunreach" || message.includes("timeout") || message.includes("connection") || message.includes("network")) {
    return {
      class: "network-error",
      retryAfterMs: 5000,
      quotaScopeKey,
      isRetryable: true,
      isTerminal: false,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Context overflow
  if (errorCode === "context_length_exceeded" || message.includes("context length") || message.includes("max tokens") || message.includes("token limit")) {
    return {
      class: "context-overflow",
      retryAfterMs: null,
      quotaScopeKey,
      isRetryable: false,
      isTerminal: true,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Model invalid
  if (httpStatus === 404 || errorCode === "model_not_found" || message.includes("model") && (message.includes("not found") || message.includes("invalid") || message.includes("unsupported"))) {
    return {
      class: "model-invalid",
      retryAfterMs: null,
      quotaScopeKey,
      isRetryable: false,
      isTerminal: true,
      evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
    };
  }

  // Unknown
  return {
    class: "unknown",
    retryAfterMs: null,
    quotaScopeKey,
    isRetryable: false,
    isTerminal: true,
    evidence: { httpStatus, errorCode, message: evidence.message, timestamp },
  };
}

function extractRetryAfterMs(message: string): number | null {
  // Look for retry-after patterns: "retry after 60s", "retry-after: 60", "wait 30 seconds"
  // Note: no 'g' flag because String.match() with 'g' doesn't return capture groups
  const patterns = [
    /retry.after[:\s]+(\d+)\s*s/i,
    /retry.after[:\s]+(\d+)\s*seconds?/i,
    /retry.after[:\s]+(\d+)/i,
    /wait\s+(\d+)\s*seconds?/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const seconds = parseInt(match[1], 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }
  }
  return null;
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

export const FALLBACK_CIRCUIT_BREAKER_THRESHOLD = 3; // Open after 3 failures
export const FALLBACK_CIRCUIT_BREAKER_RESET_MS = 60000; // Reset after 60s
export const FALLBACK_MAX_RETRIES_PER_CANDIDATE = 2;
export const FALLBACK_MAX_TOTAL_RETRIES = 5;

// ---------------------------------------------------------------------------
// Execution logic
// ---------------------------------------------------------------------------

/**
 * Execute a task with same-harness fallback support.
 * Returns the result of the first successful candidate, or throws if all exhausted.
 */
export async function executeWithFallback(
  config: Config,
  profileId: string,
  taskFn: (route: RouteRef, model: string, candidate: FallbackCandidate) => Promise<{ success: boolean; error?: any; result?: any }>
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
    primaryModel: "", // Will be set from task context
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

        // Task failed - classify error
        const classified = classifyProviderError(result.error ?? {});
        state.lastError = classified;

        // Handle based on error class
        switch (classified.class) {
          case "rate-limited":
            if (classified.retryAfterMs) {
              await sleep(Math.min(classified.retryAfterMs, 60000));
              candidateRetries++;
              state.retryCount++;
              continue;
            }
            break;

          case "quota-exhausted":
          case "payment-required":
          case "auth-failed":
            // Terminal for this candidate - move to next
            candidateRetries = FALLBACK_MAX_RETRIES_PER_CANDIDATE + 1;
            break;

          case "upstream-error":
          case "network-error":
            await sleep(classified.retryAfterMs ?? 5000);
            candidateRetries++;
            state.retryCount++;
            continue;

          case "context-overflow":
          case "model-invalid":
          case "unknown":
          default:
            // Terminal - move to next candidate
            candidateRetries = FALLBACK_MAX_RETRIES_PER_CANDIDATE + 1;
            break;
        }
      } catch (error) {
        // Unexpected error - treat as unknown
        const classified: ClassifiedError = {
          class: "unknown",
          retryAfterMs: null,
          quotaScopeKey: null,
          isRetryable: false,
          isTerminal: true,
          evidence: {
            message: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          },
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
  throw new ContractError("state", `All fallback candidates exhausted for profile ${profileId}. Last error: ${state.lastError?.class ?? "unknown"}`);
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
