/**
 * Quota / rate-limit / reset-time telemetry tests (issue #91, T005).
 *
 * MOCK: header/body fixtures below are synthetic provider responses (no
 * network, no secrets) — they exercise known header shapes, unknown shapes,
 * 429/402 bodies, date boundaries and staleness.
 * REAL: catalog-backed report tests load the actual `config/agents.toml`
 * and assert its committed evidence against a fixed reference clock.
 *
 * Run: bun test script/agent.quota.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import {
  parseRateLimitHeaders,
  parseQuotaResponse,
  quotaReport,
  formatQuotaReport,
  quotaReportJson,
  type QuotaUsage,
} from "./agent/quota";
import { loadCatalog, type Catalog } from "./agent/catalog";
import { ContractError } from "./agent/contract";

const REPO = dirname(dirname(realpathSync(import.meta.path)));
const REAL_CONFIG = join(REPO, "config", "agents.toml");

/** Reference clock: fresh for every evidence date committed in the catalog. */
const NOW = Date.parse("2026-11-06T12:00:00Z");
const OBSERVED = "2026-11-06T12:00:00Z";

function evidence(at = OBSERVED): QuotaUsage["evidence"] {
  return { at, source: "probe", note: "fixture" };
}

// ---------------------------------------------------------------------------
// parseRateLimitHeaders (mock header shapes)
// ---------------------------------------------------------------------------

describe("parseRateLimitHeaders", () => {
  test("generic windowed headers (limit/remaining/reset per window)", () => {
    const usage = parseRateLimitHeaders(
      {
        "X-RateLimit-Limit-Minute": "20",
        "x-ratelimit-remaining-minute": "13",
        "X-RateLimit-Reset-Minute": "42",
        "x-ratelimit-limit-day": "1000",
        "x-ratelimit-remaining-day": "987",
      },
      OBSERVED,
    );
    expect(usage).toHaveLength(2);
    const minute = usage.find((entry) => entry.window === "minute");
    expect(minute).toMatchObject({
      window: "minute",
      metric: "requests",
      limit: 20,
      remaining: 13,
      used: 7,
      resetAt: "2026-11-06T12:00:42.000Z",
      provenance: "measured",
    });
    expect(minute?.evidence).toMatchObject({ at: OBSERVED, source: "probe" });
    expect(usage.find((entry) => entry.window === "day")).toMatchObject({
      limit: 1000,
      remaining: 987,
      used: 13,
      resetAt: null,
    });
  });

  test("OpenAI-style channels with duration-string reset", () => {
    const usage = parseRateLimitHeaders(
      {
        "x-ratelimit-limit-requests": "60",
        "x-ratelimit-remaining-requests": "59",
        "x-ratelimit-reset-requests": "1s",
        "x-ratelimit-limit-tokens": "90000",
        "x-ratelimit-remaining-tokens": "89000",
        "x-ratelimit-reset-tokens": "6m0s",
      },
      OBSERVED,
    );
    expect(usage).toHaveLength(2);
    const tokens = usage.find((entry) => entry.metric === "tokens");
    expect(tokens).toMatchObject({
      window: "rolling",
      metric: "tokens",
      limit: 90000,
      remaining: 89000,
      used: 1000,
      resetAt: "2026-11-06T12:06:00.000Z",
    });
  });

  test("Anthropic-style delta-seconds reset", () => {
    const usage = parseRateLimitHeaders(
      {
        "anthropic-ratelimit-requests-limit": "50",
        "anthropic-ratelimit-requests-remaining": "49",
        "anthropic-ratelimit-requests-reset": "30",
        "anthropic-ratelimit-tokens-limit": "40000",
        "anthropic-ratelimit-tokens-remaining": "39000",
      },
      OBSERVED,
    );
    expect(usage).toHaveLength(2);
    const requests = usage.find((entry) => entry.metric === "requests");
    expect(requests).toMatchObject({
      limit: 50,
      remaining: 49,
      used: 1,
      resetAt: "2026-11-06T12:00:30.000Z",
    });
    expect(usage.find((entry) => entry.metric === "tokens")).toMatchObject({
      limit: 40000,
      remaining: 39000,
      resetAt: null,
    });
  });

  test("retry-after: delta seconds and HTTP-date; metric stays unknown", () => {
    const delta = parseRateLimitHeaders({ "retry-after": "12" }, OBSERVED);
    expect(delta).toHaveLength(1);
    expect(delta[0]).toMatchObject({
      window: "rolling",
      metric: null,
      limit: null,
      remaining: null,
      resetAt: "2026-11-06T12:00:12.000Z",
    });
    const dated = parseRateLimitHeaders(
      { "Retry-After": "Fri, 06 Nov 2026 13:30:00 GMT" },
      OBSERVED,
    );
    expect(dated[0]?.resetAt).toBe("2026-11-06T13:30:00.000Z");
  });

  test("unrecognized headers produce nothing (no fabrication)", () => {
    expect(
      parseRateLimitHeaders(
        { "x-quota-left": "5", "x-ratelimit-remaining": "many", "retry-after": "soon" },
        OBSERVED,
      ),
    ).toEqual([]);
    expect(parseRateLimitHeaders({}, OBSERVED)).toEqual([]);
  });

  test("malformed values are skipped; valid siblings still parse", () => {
    const usage = parseRateLimitHeaders(
      {
        "x-ratelimit-limit-minute": "abc",
        "x-ratelimit-remaining-minute": "7",
        "x-ratelimit-reset-minute": "tomorrow",
        "retry-after": "-5",
      },
      OBSERVED,
    );
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ window: "minute", remaining: 7, limit: null, resetAt: null });
  });

  test("rejects a non-ISO observedAt", () => {
    expect(() => parseRateLimitHeaders({}, "2026-11-06")).toThrow(ContractError);
  });
});

// ---------------------------------------------------------------------------
// parseQuotaResponse (mock 429/402 bodies)
// ---------------------------------------------------------------------------

describe("parseQuotaResponse", () => {
  test("429 with ISO reset_at in the body", () => {
    const verdict = parseQuotaResponse(
      {
        status: 429,
        headers: { "retry-after": "60" },
        body: { error: { type: "rate_limit_error", reset_at: "2026-11-06T12:05:00Z" } },
      },
      OBSERVED,
    );
    expect(verdict).toMatchObject({
      status: 429,
      throttled: true,
      paymentRequired: false,
      // retry-after (60s) is earlier than the body's reset_at (5m).
      resetAt: "2026-11-06T12:01:00.000Z",
    });
    expect(verdict.usage.map((entry) => entry.resetAt)).toContain("2026-11-06T12:05:00.000Z");
  });

  test("429 with error.retry_after in delta seconds", () => {
    const verdict = parseQuotaResponse(
      { status: 429, body: { error: { retry_after: 30 } } },
      OBSERVED,
    );
    expect(verdict.resetAt).toBe("2026-11-06T12:00:30.000Z");
    expect(verdict.throttled).toBe(true);
  });

  test("429 with an unreadable body yields no reset (unknown stays unknown)", () => {
    const verdict = parseQuotaResponse(
      { status: 429, body: { error: { message: "Rate limit exceeded. Try again later." } } },
      OBSERVED,
    );
    expect(verdict.throttled).toBe(true);
    expect(verdict.resetAt).toBeNull();
    expect(verdict.usage).toEqual([]);
  });

  test("402 never yields a reset time, even when the body claims one", () => {
    const verdict = parseQuotaResponse(
      {
        status: 402,
        body: { error: { message: "Insufficient Balance", reset_at: "2026-11-06T13:00:00Z" } },
      },
      OBSERVED,
    );
    expect(verdict.paymentRequired).toBe(true);
    expect(verdict.throttled).toBe(false);
    expect(verdict.resetAt).toBeNull();
    expect(verdict.usage).toEqual([]);
  });

  test("200 with headers parses usage; not throttled", () => {
    const verdict = parseQuotaResponse(
      { status: 200, headers: { "x-ratelimit-remaining-minute": "19", "x-ratelimit-limit-minute": "20" } },
      OBSERVED,
    );
    expect(verdict.throttled).toBe(false);
    expect(verdict.paymentRequired).toBe(false);
    expect(verdict.usage[0]).toMatchObject({ limit: 20, remaining: 19, used: 1 });
  });
});

// ---------------------------------------------------------------------------
// quotaReport over the REAL config/agents.toml
// ---------------------------------------------------------------------------

describe("quotaReport: real catalog", () => {
  let catalog: Catalog;

  beforeAll(() => {
    catalog = loadCatalog(REAL_CONFIG);
  });

  test("openrouter-free: free billing, shared account scope, documented limits", () => {
    const report = quotaReport(catalog, "claude.openrouter-free", { now: NOW });
    expect(report.billing).toBe("free");
    expect(report.scopeKey).toBe("account:openrouter");
    expect(report.documented).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ window: "minute", value: 20 }),
        expect.objectContaining({ window: "day", value: 1000 }),
      ]),
    );
    expect(report.sharedWith).toEqual(["omp.openrouter-free", "opencode.openrouter-free"]);
  });

  test("stale documented evidence is dropped fail-closed (滞留cache)", () => {
    // 7-day contract window: catalog evidence at 2026-11-05 is fresh at NOW,
    // expired two weeks later.
    const fresh = quotaReport(catalog, "claude.openrouter-free", { now: NOW });
    expect(fresh.documented.length).toBeGreaterThan(0);
    const stale = quotaReport(catalog, "claude.openrouter-free", {
      now: NOW + 14 * 24 * 60 * 60 * 1000,
    });
    expect(stale.documented).toEqual([]);
    expect(formatQuotaReport(stale)).toContain("documented limits: unknown");
  });

  test("route entry overrides provider limits; unknown route stays unknown", () => {
    const known = quotaReport(catalog, "claude.openrouter-free", { now: NOW });
    expect(known.billing).toBe("free");
    const unknown = quotaReport(catalog, "claude.nowhere", { now: NOW });
    expect(unknown).toMatchObject({
      billing: "unknown",
      scopeKey: null,
      documented: [],
      concurrency: null,
      live: [],
      restriction: null,
      sharedWith: [],
    });
  });

  test("observed restriction is surfaced with its evidence date (zen)", () => {
    const report = quotaReport(catalog, "opencode.zen", { now: NOW });
    expect(report.restriction).not.toBeNull();
    expect(report.restriction?.evidence.at).toBe("2026-10-16T00:00:00Z");
    expect(formatQuotaReport(report)).toContain("restriction: HTTP 403");
  });

  test("live observations: fresh + future reset shown, expired reset dropped (date boundary)", () => {
    const fresh: QuotaUsage = {
      window: "minute",
      metric: "requests",
      limit: 20,
      remaining: 13,
      used: 7,
      resetAt: "2026-11-06T12:00:42Z",
      provenance: "measured",
      evidence: evidence(),
    };
    // Date boundary: a daily window observed just before UTC midnight, whose
    // resetAt (00:00Z) has passed at the reference clock, is not shown.
    const beforeMidnight: QuotaUsage = {
      window: "day",
      metric: "requests",
      limit: 1000,
      remaining: 5,
      used: 995,
      resetAt: "2026-11-07T00:00:00Z",
      provenance: "measured",
      evidence: evidence("2026-11-06T23:59:30Z"),
    };
    const report = quotaReport(catalog, "claude.openrouter-free", {
      now: NOW,
      live: [fresh, beforeMidnight],
    });
    expect(report.live).toEqual([fresh]);
    const displayed = formatQuotaReport(report);
    expect(displayed).toContain("remaining 13/20");
    expect(displayed).toContain("resets 2026-11-06T12:00:42Z");
    expect(displayed).not.toContain("remaining 5/1000");
  });

  test("stale live observation is dropped; malformed entry never throws", () => {
    const stale: QuotaUsage = {
      window: "minute",
      metric: "requests",
      limit: 20,
      remaining: 0,
      used: 20,
      resetAt: "2026-11-06T12:01:00Z",
      provenance: "measured",
      evidence: evidence("2026-10-01T00:00:00Z"),
    };
    const forged = {
      window: "minute",
      metric: "requests",
      limit: 999,
      remaining: 999,
      used: 0,
      provenance: "estimated", // not measured: never displayable
      evidence: evidence(),
    } as unknown as QuotaUsage;
    const report = quotaReport(catalog, "claude.openrouter-free", {
      now: NOW,
      live: [stale, forged],
    });
    expect(report.live).toEqual([]);
    expect(formatQuotaReport(report)).not.toContain("999");
  });
});

// ---------------------------------------------------------------------------
// Display / JSON contract
// ---------------------------------------------------------------------------

describe("display", () => {
  test("all-unknown report renders unknown, never a fabricated value", () => {
    const report = quotaReport(loadCatalog(REAL_CONFIG), "claude.nowhere", { now: NOW });
    const text = formatQuotaReport(report);
    expect(text).toContain("billing: unknown");
    expect(text).toContain("allowance: unknown");
    expect(text).toContain("documented limits: unknown");
    expect(text).toContain("concurrency: unknown");
    expect(text).toContain("live: unknown");
    expect(text).toContain("reset: unknown");
    expect(text).not.toMatch(/remaining \d/);
    expect(text).not.toMatch(/resets \d{4}/);
  });

  test("JSON carries the same facts as the human display", () => {
    const report = quotaReport(loadCatalog(REAL_CONFIG), "claude.openrouter-free", { now: NOW });
    const parsed = JSON.parse(quotaReportJson(report));
    expect(parsed.billing).toBe(report.billing);
    expect(parsed.scopeKey).toBe(report.scopeKey);
    expect(parsed.documented).toHaveLength(report.documented.length);
    expect(parsed.sharedWith).toEqual(report.sharedWith);
    expect(quotaReportJson(report)).not.toMatch(/sk-|Bearer|token/i);
  });
});
