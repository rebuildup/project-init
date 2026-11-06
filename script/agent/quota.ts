#!/usr/bin/env bun
/**
 * Quota / rate-limit / reset-time telemetry (issue #91, Epic #86 T005).
 *
 * Acquisition and display of free/subscription allowance, rate limits and
 * reset times. Evidence rules (ADR-0015, contract.ts):
 *
 *   - A value is shown only when real evidence exists: provider response
 *     headers (`x-ratelimit-*`, `retry-after`, `anthropic-ratelimit-*`),
 *     observed 429/402 response bodies, or provider-documented limits in the
 *     catalog ([catalog.*] tables, issue #89). Everything else is `unknown`.
 *   - Live observations (headers/bodies) are `measured` evidence; catalog
 *     limits are `official`/`configured`. All evidence expires: anything
 *     stale under contract `isStale` is dropped (fail-closed), never shown.
 *   - A live observation whose reset time has passed no longer describes the
 *     current window and is dropped too.
 *   - Nothing is inferred from fixed guesses: no fabricated balances, no
 *     invented reset times, no "remaining" without an observed source.
 *
 * This module performs no network I/O and reads no secrets: responses are
 * passed in by the caller (probe / launcher / manual capture). Scope sharing
 * (account vs api-key vs plan) is resolved through the catalog's
 * `effectiveQuotaKey`, so routes drawing on one allowance are reported as
 * shared, never double-counted per machine.
 */

import {
  ContractError,
  isPlainObject,
  isStale,
  parseAttested,
  redactJson,
  type Attested,
  type Evidence,
  type Provenance,
} from "./contract";
import { effectiveQuotaKey, type Catalog, type PricingKind } from "./catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Time window a quota measurement applies to. `rolling` = window length
 * unknown/not stated by the source (e.g. bare `x-ratelimit-limit`). */
export type QuotaWindow = "minute" | "hour" | "day" | "week" | "month" | "rolling";

/** What the allowance counts. `null` = source did not say (e.g. bare
 * `retry-after`); never guessed. */
export type QuotaMetric = "requests" | "tokens" | "concurrency";

/** One evidence-backed usage observation for one window/metric of one
 * allowance. Fields absent from the source stay `null`; nothing is derived
 * except `used` (arithmetic on observed `limit`/`remaining`). */
export interface QuotaUsage {
  window: QuotaWindow;
  metric: QuotaMetric | null;
  limit: number | null;
  remaining: number | null;
  used: number | null;
  /** ISO 8601 UTC instant the window resets; null when the source is silent. */
  resetAt: string | null;
  provenance: Provenance;
  evidence: Evidence;
}

const WINDOWS: readonly string[] = ["minute", "hour", "day", "week", "month", "rolling"];
const METRICS: readonly string[] = ["requests", "tokens", "concurrency"];
/** Header suffixes that name a concrete window (anything else is ignored). */
const WINDOW_SUFFIX: Record<string, true> = {
  minute: true,
  hour: true,
  day: true,
  week: true,
  month: true,
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function checkCount(value: unknown, where: string, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ContractError("schema", `${where}: '${field}' must be a non-negative number`);
  }
  return value;
}

/** Validate a QuotaUsage (write path). Throws ContractError on any violation. */
export function assertQuotaUsage(value: unknown, where: string): QuotaUsage {
  if (!isPlainObject(value)) {
    throw new ContractError("schema", `${where}: object expected`);
  }
  const usage = value as Partial<QuotaUsage>;
  if (typeof usage.window !== "string" || !WINDOWS.includes(usage.window)) {
    throw new ContractError("schema", `${where}: invalid window '${String(usage.window)}'`);
  }
  if (usage.metric !== null && usage.metric !== undefined) {
    if (!METRICS.includes(usage.metric)) {
      throw new ContractError("schema", `${where}: invalid metric '${String(usage.metric)}'`);
    }
  }
  const limit = checkCount(usage.limit, where, "limit");
  const remaining = checkCount(usage.remaining, where, "remaining");
  const used = checkCount(usage.used, where, "used");
  let resetAt: string | null = null;
  if (usage.resetAt !== undefined && usage.resetAt !== null) {
    if (typeof usage.resetAt !== "string" || !ISO_UTC.test(usage.resetAt)) {
      throw new ContractError("schema", `${where}: 'resetAt' must be an ISO 8601 UTC timestamp`);
    }
    resetAt = usage.resetAt;
  }
  if (limit === null && remaining === null && used === null && resetAt === null) {
    throw new ContractError("schema", `${where}: observation carries no evidence-backed value`);
  }
  const evidence = usage.evidence;
  if (
    !isPlainObject(evidence) ||
    typeof evidence["at"] !== "string" ||
    !ISO_UTC.test(evidence["at"]) ||
    (evidence["source"] !== "probe" && evidence["source"] !== "live-e2e")
  ) {
    throw new ContractError(
      "schema",
      `${where}: 'evidence' must carry an ISO UTC 'at' and a live source (probe|live-e2e)`,
    );
  }
  if (usage.provenance !== "measured") {
    throw new ContractError("schema", `${where}: live observations require provenance 'measured'`);
  }
  return {
    window: usage.window as QuotaWindow,
    metric: (usage.metric ?? null) as QuotaMetric | null,
    limit,
    remaining,
    used,
    resetAt,
    provenance: "measured",
    evidence: evidence as unknown as Evidence,
  };
}

// ---------------------------------------------------------------------------
// Header parsing (observed provider responses -> QuotaUsage)
// ---------------------------------------------------------------------------

/** Lowercase-keyed view over a header map (fetch Headers entries, plain object). */
function headerMap(headers: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" && value !== "") map.set(name.toLowerCase(), value.trim());
  }
  return map;
}

function parseCount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Delta seconds (integer or decimal) -> milliseconds; null otherwise. */
function parseDeltaSeconds(raw: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/** OpenAI-style duration ("1s", "6m0s", "12ms", "1h2m3s") -> milliseconds. */
function parseDuration(raw: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(raw);
  if (!match) return null;
  const [, h, m, s, ms] = match;
  if (h === undefined && m === undefined && s === undefined && ms === undefined) return null;
  return (Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000 + Number(ms ?? 0);
}

/**
 * A reset header value: numeric -> delta seconds relative to the observation;
 * otherwise HTTP-date (absolute) or duration string (relative). Returns the
 * ABSOLUTE epoch ms of the reset, or null when the value is unrecognized.
 */
function parseResetValue(raw: string, observedMs: number): number | null {
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const delta = parseDeltaSeconds(raw);
    return delta === null ? null : observedMs + delta;
  }
  const duration = parseDuration(raw);
  if (duration !== null) return observedMs + duration;
  // HTTP-date: all defined formats (RFC 1123/850, asctime) contain a
  // 3-letter weekday/month name; requiring one keeps Date.parse's lenience
  // from turning numeric garbage (e.g. "-5") into a year.
  if (!/[a-z]{3}/i.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** One observed channel: a limit/remaining/reset triple sharing window+metric. */
interface Channel {
  window: QuotaWindow;
  metric: QuotaMetric | null;
  limit?: number;
  remaining?: number;
  resetMs?: number;
}

/**
 * Parse rate-limit headers from one observed provider response into
 * QuotaUsage entries. Recognized shapes:
 *
 *   - generic windowed:  `x-ratelimit-(limit|remaining|reset)-<window>`
 *     (window: minute|hour|day|week|month), plus bare `x-ratelimit-*`
 *     (window `rolling`, metric requests — the de-facto convention);
 *   - OpenAI-style:      `x-ratelimit-(limit|remaining|reset)-(requests|tokens)`
 *     with duration-string resets ("6m0s");
 *   - Anthropic-style:   `anthropic-ratelimit-(requests|tokens)-(limit|remaining|reset)`
 *     with delta-seconds resets;
 *   - `retry-after` (delta seconds or HTTP-date) — reset signal only, metric
 *     stays unknown.
 *
 * Unrecognized or malformed header values are skipped, never guessed.
 * Every entry's `evidence.at` is `observedAt` (ISO 8601 UTC).
 */
export function parseRateLimitHeaders(
  headers: Record<string, string>,
  observedAt: string,
  note = "rate-limit response headers",
): QuotaUsage[] {
  if (typeof observedAt !== "string" || !ISO_UTC.test(observedAt)) {
    throw new ContractError("schema", "parseRateLimitHeaders: observedAt must be ISO 8601 UTC");
  }
  const observedMs = Date.parse(observedAt);
  const map = headerMap(headers);
  const channels = new Map<string, Channel>();

  const channel = (window: QuotaWindow, metric: QuotaMetric | null): Channel => {
    const key = `${window}|${metric ?? "*"}`;
    let existing = channels.get(key);
    if (!existing) {
      existing = { window, metric };
      channels.set(key, existing);
    }
    return existing;
  };

  const countInto = (
    name: string,
    kind: "limit" | "remaining",
    window: QuotaWindow,
    metric: QuotaMetric | null,
  ): void => {
    const raw = map.get(name);
    if (raw === undefined) return;
    const value = parseCount(raw);
    if (value === null) return;
    const target = channel(window, metric);
    if (kind === "limit") target.limit = value;
    else target.remaining = value;
  };

  const resetInto = (name: string, window: QuotaWindow, metric: QuotaMetric | null): void => {
    const raw = map.get(name);
    if (raw === undefined) return;
    const ms = parseResetValue(raw, observedMs);
    if (ms === null) return;
    channel(window, metric).resetMs = ms;
  };

  for (const [name] of map) {
    let match = /^x-ratelimit-(limit|remaining)-([a-z]+)$/.exec(name);
    if (match) {
      const [, kind, suffix] = match;
      if (WINDOW_SUFFIX[suffix]) {
        countInto(name, kind as "limit" | "remaining", suffix as QuotaWindow, "requests");
      } else if (suffix === "requests" || suffix === "tokens") {
        countInto(name, kind as "limit" | "remaining", "rolling", suffix);
      }
      continue;
    }
    match = /^x-ratelimit-reset-([a-z]+)$/.exec(name);
    if (match) {
      const [, suffix] = match;
      if (WINDOW_SUFFIX[suffix]) resetInto(name, suffix as QuotaWindow, "requests");
      else if (suffix === "requests" || suffix === "tokens") resetInto(name, "rolling", suffix);
      continue;
    }
    // Bare x-ratelimit-(limit|remaining|reset): window length not stated.
    match = /^x-ratelimit-(limit|remaining|reset)$/.exec(name);
    if (match) {
      const [, kind] = match;
      if (kind === "reset") resetInto(name, "rolling", "requests");
      else countInto(name, kind as "limit" | "remaining", "rolling", "requests");
      continue;
    }
    // Anthropic-style: anthropic-ratelimit-(requests|tokens)-(limit|remaining|reset)
    match = /^anthropic-ratelimit-(requests|tokens)-(limit|remaining|reset)$/.exec(name);
    if (match) {
      const [, metric, kind] = match;
      if (kind === "reset") resetInto(name, "rolling", metric as QuotaMetric);
      else countInto(name, kind as "limit" | "remaining", "rolling", metric as QuotaMetric);
      continue;
    }
  }

  // retry-after: reset signal only; the counted allowance is not named.
  const retryAfter = map.get("retry-after");
  if (retryAfter !== undefined) {
    const ms = parseResetValue(retryAfter, observedMs);
    if (ms !== null) channel("rolling", null).resetMs = ms;
  }

  const evidence: Evidence = { at: observedAt, source: "probe", note };
  const usage: QuotaUsage[] = [];
  for (const channel of channels.values()) {
    const remaining = channel.remaining ?? null;
    const limit = channel.limit ?? null;
    usage.push(
      assertQuotaUsage(
        {
          window: channel.window,
          metric: channel.metric,
          limit,
          remaining,
          used: limit !== null && remaining !== null ? limit - remaining : null,
          resetAt: channel.resetMs === undefined ? null : new Date(channel.resetMs).toISOString(),
          provenance: "measured",
          evidence,
        },
        "parseRateLimitHeaders",
      ),
    );
  }
  return usage;
}

// ---------------------------------------------------------------------------
// Response parsing (429/402 bodies)
// ---------------------------------------------------------------------------

/** Verdict for one observed provider response. */
export interface ResponseQuota {
  status: number;
  /** HTTP 429: rate limited. */
  throttled: boolean;
  /** HTTP 402: account/payment blocked (no reset time exists for this). */
  paymentRequired: boolean;
  /** Evidence-backed usage from headers and (for 429) the response body. */
  usage: QuotaUsage[];
  /** Earliest reset instant across `usage` (ISO UTC), null when none observed. */
  resetAt: string | null;
}

/**
 * Extract reset evidence from a 429/402 JSON body. Only EXACT known key
 * names at the top level or inside `error` are read: `reset_at` (ISO UTC
 * string) and `retry_after` (delta seconds). Message text is never scraped;
 * anything else is ignored. A 402 never yields a reset time (a depleted
 * balance has no provider-stated reset; inventing one is forbidden).
 */
function bodyResetAt(body: unknown, observedMs: number): number | null {
  if (!isPlainObject(body)) return null;
  const candidates: unknown[] = [body, body["error"]];
  let found: number | null = null;
  for (const container of candidates) {
    if (!isPlainObject(container)) continue;
    const resetAt = container["reset_at"];
    if (typeof resetAt === "string" && ISO_UTC.test(resetAt)) {
      const ms = Date.parse(resetAt);
      if (found === null || ms < found) found = ms;
    }
    const retryAfter = container["retry_after"];
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0) {
      const ms = observedMs + Math.round(retryAfter * 1000);
      if (found === null || ms < found) found = ms;
    }
  }
  return found;
}

function earliestResetMs(usage: QuotaUsage[]): number | null {
  let found: number | null = null;
  for (const entry of usage) {
    if (entry.resetAt === null) continue;
    const ms = Date.parse(entry.resetAt);
    if (found === null || ms < found) found = ms;
  }
  return found;
}

/**
 * Interpret one observed provider response for quota purposes: headers are
 * always parsed; a 429 body may add a reset instant; a 402 marks the account
 * balance as depleted with NO reset time (unknown stays unknown). Any other
 * status contributes headers only. `observedAt` must be ISO 8601 UTC.
 */
export function parseQuotaResponse(
  input: { status: number; headers?: Record<string, string>; body?: unknown },
  observedAt: string,
): ResponseQuota {
  const usage = input.headers ? parseRateLimitHeaders(input.headers, observedAt) : [];
  const throttled = input.status === 429;
  const paymentRequired = input.status === 402;
  if (throttled) {
    const observedMs = Date.parse(observedAt);
    const resetMs = bodyResetAt(input.body, observedMs);
    if (resetMs !== null) {
      usage.push(
        assertQuotaUsage(
          {
            window: "rolling",
            metric: null,
            limit: null,
            remaining: null,
            used: null,
            resetAt: new Date(resetMs).toISOString(),
            provenance: "measured",
            evidence: { at: observedAt, source: "probe", note: "429 response body" },
          },
          "parseQuotaResponse",
        ),
      );
    }
  }
  const resetMs = earliestResetMs(usage);
  return {
    status: input.status,
    throttled,
    paymentRequired,
    usage,
    resetAt: resetMs === null ? null : new Date(resetMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Catalog-backed report (documented limits + live observations + sharing)
// ---------------------------------------------------------------------------

/** One provider-documented rate limit whose evidence is still fresh. */
export interface DocumentedLimit {
  window: QuotaWindow;
  metric: QuotaMetric;
  value: number;
  evidence: Evidence;
}

/** Display-ready quota picture for one route. Every unavailable fact is
 * absent/null and renders as `unknown` — never a guess. */
export interface QuotaReport {
  routeId: string;
  /** Shared allowance key (`<kind>:<id>`), null when the catalog is silent. */
  scopeKey: string | null;
  billing: PricingKind;
  terms: string | null;
  /** Fresh provider-documented limits (route entries override provider ones). */
  documented: DocumentedLimit[];
  /** Documented per-route concurrency limit, null when unknown/stale. */
  concurrency: { value: number; evidence: Evidence } | null;
  /** Fresh, unexpired live observations (headers/bodies). */
  live: QuotaUsage[];
  /** OBSERVED block on this route/provider, shown with its evidence date. */
  restriction: { note: string; evidence: Evidence } | null;
  /** Other routes drawing on the SAME allowance (account/plan/key sharing). */
  sharedWith: string[];
}

export interface QuotaReportOptions {
  /** Live observations to include (e.g. from parseQuotaResponse). */
  live?: readonly QuotaUsage[];
  /** Reference time (ms epoch); defaults to Date.now(). */
  now?: number;
  /** Freshness window; defaults to contract DEFAULT_MAX_EVIDENCE_AGE_MS. */
  maxAgeMs?: number;
}

const WINDOW_BY_FIELD: Record<string, QuotaWindow> = {
  per_minute: "minute",
  per_hour: "hour",
  per_day: "day",
  per_month: "month",
};

/**
 * True when an attested catalog value may still be shown: it parses under
 * the contract matrix, carries evidence, and that evidence is fresh
 * (fail-closed staleness per contract `isStale`/`isUsable` semantics).
 * Catalog limits are `configured`/`official`, so full `isUsable`
 * (verified-live) is intentionally NOT required — but staleness still
 * expires them.
 */
function freshAttestation<T>(
  att: Attested<T> | null,
  opts: { now: number; maxAgeMs: number },
): att is Attested<T> & { evidence: Evidence; value: T } {
  if (!att || att.value === null || att.value === undefined) return false;
  try {
    parseAttested(att, "quotaReport");
  } catch {
    return false;
  }
  if (!att.evidence) return false;
  return !isStale(att.evidence, opts.now, opts.maxAgeMs);
}

/**
 * Assemble the display-ready quota report for one route from the catalog and
 * (optionally) live observations. Static facts come from the catalog; live
 * facts must carry `measured` evidence and are dropped when stale or when
 * their reset time has already passed (the window rolled over — showing the
 * old remaining count would claim quota that no longer describes reality).
 */
export function quotaReport(catalog: Catalog, routeId: string, options: QuotaReportOptions = {}): QuotaReport {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(now)) throw new ContractError("schema", "options.now must be a finite number");
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new ContractError("schema", "options.maxAgeMs must be a positive number");
  }
  const scopeKey = effectiveQuotaKey(catalog, routeId);
  const dot = routeId.indexOf(".");
  const providerKey = dot === -1 ? "" : routeId.slice(dot + 1);
  const provider = catalog.providers[providerKey] ?? null;
  const route = catalog.routes[routeId] ?? null;

  // Documented limits: the route's own entry wins, else the provider's.
  const rateLimits = route?.rate_limits ?? provider?.rate_limits ?? null;
  const documented: DocumentedLimit[] = [];
  if (rateLimits && freshAttestation(rateLimits, { now, maxAgeMs })) {
    const limits = rateLimits.value as Record<string, unknown>;
    for (const [field, window] of Object.entries(WINDOW_BY_FIELD)) {
      const value = limits[field];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        documented.push({
          window,
          metric: "requests",
          value,
          evidence: rateLimits.evidence as Evidence,
        });
      }
    }
  }

  let concurrency: QuotaReport["concurrency"] = null;
  const routeConcurrency = route?.concurrency ?? null;
  if (routeConcurrency && freshAttestation(routeConcurrency, { now, maxAgeMs })) {
    concurrency = {
      value: routeConcurrency.value as number,
      evidence: routeConcurrency.evidence as Evidence,
    };
  }

  // Live observations: measured evidence, fresh, reset not already passed.
  const live: QuotaUsage[] = [];
  for (const entry of options.live ?? []) {
    let validated: QuotaUsage;
    try {
      validated = assertQuotaUsage(entry, `quotaReport(${routeId}).live`);
    } catch {
      continue; // fail-closed: malformed observation is never shown
    }
    if (isStale(validated.evidence, now, maxAgeMs)) continue;
    if (validated.resetAt !== null && Date.parse(validated.resetAt) <= now) continue;
    live.push(validated);
  }

  // Restriction: observed block; shown with its evidence date (a stale
  // warning is the safe direction and is labeled with its observed date).
  const restrictionAtt = route?.restriction ?? provider?.restriction ?? null;
  let restriction: QuotaReport["restriction"] = null;
  if (restrictionAtt && restrictionAtt.status === "restricted" && restrictionAtt.note) {
    restriction = {
      note: restrictionAtt.note,
      evidence: (restrictionAtt.evidence ?? {
        at: "1970-01-01T00:00:00Z",
        source: "config",
      }) as Evidence,
    };
  }

  const sharedWith =
    scopeKey === null
      ? []
      : Object.keys(catalog.routes)
          .filter((other) => other !== routeId && effectiveQuotaKey(catalog, other) === scopeKey)
          .sort();

  return {
    routeId,
    scopeKey,
    billing: provider?.billing ?? "unknown",
    terms: provider?.terms ?? null,
    documented,
    concurrency,
    live,
    restriction,
    sharedWith,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function formatUsage(entry: QuotaUsage): string {
  const scope = entry.metric === null ? "" : `${entry.metric} `;
  const parts: string[] = [];
  if (entry.remaining !== null) {
    parts.push(
      entry.limit === null
        ? `remaining ${entry.remaining}`
        : `remaining ${entry.remaining}/${entry.limit}`,
    );
  } else if (entry.limit !== null) {
    parts.push(`limit ${entry.limit}`);
  }
  if (entry.used !== null && entry.remaining === null) parts.push(`used ${entry.used}`);
  if (entry.resetAt !== null) parts.push(`resets ${entry.resetAt}`);
  const body = parts.length === 0 ? "observed (no values)" : parts.join(", ");
  return `${entry.window}${entry.metric === null ? "" : " "}${scope}${body}`.replace(/\s+/g, " ").trim();
}

/**
 * Human display for a report. Every fact without valid evidence renders as
 * `unknown`; evidence-backed values carry their provenance and observation
 * date so measured and documented values are never conflated.
 */
export function formatQuotaReport(report: QuotaReport): string {
  const lines: string[] = [];
  const scope = report.scopeKey ?? "unknown";
  lines.push(`${report.routeId} — billing: ${report.billing} — allowance: ${scope}`);
  if (report.sharedWith.length > 0) {
    lines.push(`  shared allowance, also drawn by: ${report.sharedWith.join(", ")}`);
  }
  if (report.documented.length > 0) {
    const at = report.documented[0].evidence.at;
    const limits = report.documented
      .map((limit) => `${limit.value} ${limit.metric}/${limit.window}`)
      .join(", ");
    lines.push(`  documented limits: ${limits} [${at}]`);
  } else {
    lines.push("  documented limits: unknown");
  }
  lines.push(`  concurrency: ${report.concurrency === null ? "unknown" : String(report.concurrency.value)}`);
  if (report.live.length > 0) {
    for (const entry of report.live) {
      lines.push(`  live: ${formatUsage(entry)} [observed ${entry.evidence.at}]`);
    }
  } else {
    lines.push("  live: unknown");
  }
  const resets = report.live
    .map((entry) => entry.resetAt)
    .filter((resetAt): resetAt is string => resetAt !== null)
    .sort();
  lines.push(`  reset: ${resets.length === 0 ? "unknown" : resets[0]}`);
  if (report.restriction !== null) {
    lines.push(`  restriction: ${report.restriction.note} [observed ${report.restriction.evidence.at}]`);
  }
  return lines.join("\n");
}

/**
 * Machine-readable report (JSON). Same facts as `formatQuotaReport`, passed
 * through contract redaction so a secret-shaped stray value can never land
 * in output.
 */
export function quotaReportJson(report: QuotaReport): string {
  return redactJson(report);
}
