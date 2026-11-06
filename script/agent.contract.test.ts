/**
 * Contract tests for script/agent/contract.ts (issue #87, T001).
 *
 * Pure unit/contract tests over fixtures and the real config: no network,
 * no real secrets, no harness binaries, no launcher execution. Existing
 * launcher behavior tests live in script/agent.test.ts and are untouched.
 *
 * Run: bun test script/agent.contract.test.ts
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ContractError,
  CONTRACT_VERSION,
  DEFAULT_MAX_EVIDENCE_AGE_MS,
  agentStateDir,
  assertCompatibleVersion,
  assertSameAttempt,
  assertSameRoute,
  attest,
  expectFields,
  formatAttemptKey,
  formatRouteId,
  isCompatibleVersion,
  isSecretKeyName,
  isStale,
  isUsable,
  legacyRouteShortcut,
  looksLikeSecretValue,
  parseAttemptKey,
  parseAttested,
  parseEnvelope,
  parseJson,
  parseModelId,
  parseMachineId,
  parseRouteId,
  quotaScopeKey,
  redact,
  redactJson,
  requireUsable,
  resolveLegacyRouteRef,
  toJson,
  type Attested,
  type AttemptIdentity,
} from "./agent/contract";

const REPO = dirname(dirname(realpathSync(import.meta.path)));
const REAL_CONFIG = join(REPO, "config", "agents.toml");
const FIXTURES = join(REPO, "script", "test-fixtures", "contract");
const ENTRY = JSON.parse(readFileSync(join(FIXTURES, "catalog-entry.json"), "utf8")) as Record<string, unknown>;
const ENTRY_UNKNOWN = JSON.parse(readFileSync(join(FIXTURES, "unknown-field.json"), "utf8")) as Record<string, unknown>;
const LEGACY_ROUTES = Bun.TOML.parse(readFileSync(join(FIXTURES, "legacy-routes.toml"), "utf8")) as { routes: Record<string, unknown> };
const REAL_ROUTES = Bun.TOML.parse(readFileSync(REAL_CONFIG, "utf8")) as { routes: Record<string, unknown>; providers: Record<string, unknown> };

const SHA = "9b9fff9aaa4c619d97f0f10ea3b510dd422c44fd";
const T0 = "2026-11-01T00:00:00Z";
const DAY = 24 * 60 * 60 * 1000;
/** Reference time: exactly 7 days after T0. */
const NOW = Date.parse(T0) + 7 * DAY;

/** A known-good verified-live attestation used as the base for mutations. */
function liveAttest(value: unknown = { tool_call: true }): Attested<unknown> {
  return attest({
    value,
    status: "verified-live",
    provenance: "measured",
    evidence: { at: T0, source: "live-e2e", sha: SHA, note: "real response + tool call" },
  });
}

function expectContractError(code: string, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected ContractError(${code}), nothing thrown`);
}

describe("route identity", () => {
  test("parses canonical route ids at the first dot only", () => {
    expect(parseRouteId("claude.openrouter-free")).toEqual({ harness: "claude", provider: "openrouter-free" });
    expect(parseRouteId("omp.opencode-go")).toEqual({ harness: "omp", provider: "opencode-go" });
  });

  test("rejects malformed route ids", () => {
    expectContractError("identity", () => parseRouteId("claude"));
    expectContractError("identity", () => parseRouteId(".openrouter"));
    expectContractError("identity", () => parseRouteId("claude."));
    expectContractError("identity", () => parseRouteId("claude.openrouter.free"));
    expectContractError("identity", () => parseRouteId("Claude.openrouter"));
    expectContractError("identity", () => parseRouteId("claude openrouter"));
  });

  test("roundtrips format/parse", () => {
    const ref = parseRouteId("opencode.openrouter-free");
    expect(formatRouteId(ref)).toBe("opencode.openrouter-free");
    expectContractError("identity", () => formatRouteId({ harness: "claude", provider: "OpenRouter" }));
  });

  test("legacy shortcut resolution is exact-match only", () => {
    const known = Object.keys(LEGACY_ROUTES.routes);
    expect(resolveLegacyRouteRef("claude-openrouter-free", known)).toBe("claude.openrouter-free");
    // negative: the free route must never be misparsed as the paid route
    expect(resolveLegacyRouteRef("claude-openrouter-free", ["claude.openrouter"])).toBeNull();
    expect(resolveLegacyRouteRef("claude-openrouter", known)).toBe("claude.openrouter");
    // unknown combination fails closed instead of splitting on hyphens
    expect(resolveLegacyRouteRef("unknown-provider", known)).toBeNull();
    expect(resolveLegacyRouteRef("claude", known)).toBeNull();
  });

  test("ambiguous legacy names fail closed like the launcher's config load", () => {
    // `a-b.c` and `a.b-c` both derive the shortcut `a-b-c`
    const ambiguous = ["a-b.c", "a.b-c"];
    expectContractError("identity", () => resolveLegacyRouteRef("a-b-c", ambiguous));
    // non-colliding names in the same list still resolve
    expect(resolveLegacyRouteRef("a-b-c", ["a.b-c"])).toBe("a.b-c");
  });

  test("legacy shortcut matches the launcher's shortcut spelling", () => {
    expect(legacyRouteShortcut("omp.opencode-go")).toBe("omp-opencode-go");
    expectContractError("identity", () => legacyRouteShortcut("omp-opencode-go"));
  });

  test("assertSameRoute rejects cross-route records", () => {
    assertSameRoute("omp.opencode-go", "omp.opencode-go");
    expectContractError("identity", () => assertSameRoute("omp.opencode-go", "omp.openrouter"));
    expectContractError("identity", () => assertSameRoute("not-a-route", "omp.openrouter"));
  });
});

describe("model and machine identity", () => {
  test("accepts provider-native model ids", () => {
    expect(parseModelId("z-ai/glm-5.3-flash")).toBe("z-ai/glm-5.3-flash");
    expect(parseModelId("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(parseModelId("@cf/meta/llama-3")).toBe("@cf/meta/llama-3");
  });

  test("rejects model ids that could carry or hide other fields", () => {
    expectContractError("identity", () => parseModelId(""));
    expectContractError("identity", () => parseModelId("a#b"));
    expectContractError("identity", () => parseModelId("a b"));
    expectContractError("identity", () => parseModelId("a\nb"));
  });

  test("machine ids exclude dots so they can never look like route ids", () => {
    expect(parseMachineId("workstation-m1")).toBe("workstation-m1");
    expectContractError("identity", () => parseMachineId("host.example.com"));
    expectContractError("identity", () => parseMachineId("omp.opencode-go"));
    expectContractError("identity", () => parseMachineId(""));
  });
});

describe("attempt identity", () => {
  const base: AttemptIdentity = { route: "omp.opencode-go", model: "mimo-v2.6-flash", machine: "workstation-m1", attempt: "a1b2c3" };

  test("roundtrips", () => {
    const key = formatAttemptKey(base);
    expect(parseAttemptKey(key)).toEqual(base);
  });

  test("different route/model/machine never share a key", () => {
    const key = formatAttemptKey(base);
    expect(formatAttemptKey({ ...base, route: "omp.openrouter" })).not.toBe(key);
    expect(formatAttemptKey({ ...base, model: "deepseek-v4.1-flash" })).not.toBe(key);
    expect(formatAttemptKey({ ...base, machine: "wsl-desktop" })).not.toBe(key);
    expect(formatAttemptKey({ ...base, attempt: "zzzz" })).not.toBe(key);
  });

  test("parse enforces the same nonce rules as format", () => {
    expectContractError("identity", () => parseAttemptKey("omp.openrouter#m#host#a b"));
    expectContractError("identity", () => parseAttemptKey(`omp.openrouter#m#host#${"x".repeat(129)}`));
    // 128 chars is the exact limit and still parses
    const nonce = "x".repeat(128);
    expect(parseAttemptKey(`omp.openrouter#m#host#${nonce}`).attempt).toBe(nonce);
  });

  test("rejects swapped or rebuilt identities", () => {
    // route string in the machine slot: dot fails the machine pattern
    expectContractError("identity", () => parseAttemptKey(formatAttemptKey({ ...base, machine: "omp.opencode-go" })));
    // machine string in the route slot: no dot fails the route pattern
    expectContractError("identity", () => parseAttemptKey(formatAttemptKey({ route: "workstation-m1", model: base.model, machine: base.machine, attempt: base.attempt })));
    // wrong part count
    expectContractError("identity", () => parseAttemptKey("a#b#c"));
    expectContractError("identity", () => parseAttemptKey("a#b#c#d#e"));
    // empty nonce
    expectContractError("identity", () => parseAttemptKey("omp.openrouter#m#host#"));
  });

  test("assertSameAttempt rejects records read under the wrong identity", () => {
    const record = parseAttemptKey(formatAttemptKey(base));
    assertSameAttempt(base, record);
    // cross-route record: a quota entry for openrouter is not the Go route's
    expectContractError("identity", () =>
      assertSameAttempt(base, { ...record, route: "omp.openrouter" }),
    );
    // cross-attempt record: another attempt's ledger row is not this one's
    expectContractError("identity", () =>
      assertSameAttempt(base, { ...record, attempt: "different" }),
    );
    expectContractError("identity", () =>
      assertSameAttempt(base, { ...record, machine: "wsl-desktop" }),
    );
  });
});

describe("version compatibility", () => {
  test("same major is compatible", () => {
    const major = CONTRACT_VERSION.split(".")[0];
    expect(isCompatibleVersion(CONTRACT_VERSION)).toBe(true);
    expect(isCompatibleVersion(`${major}.9.9`)).toBe(true);
  });

  test("different major, malformed versions are incompatible", () => {
    expect(isCompatibleVersion("999.0.0")).toBe(false);
    expect(isCompatibleVersion("1.0")).toBe(false);
    expect(isCompatibleVersion("one.zero.zero")).toBe(false);
    expectContractError("version", () => assertCompatibleVersion("999.0.0"));
    assertCompatibleVersion(CONTRACT_VERSION);
  });
});

describe("attestation matrix (write path)", () => {
  test("accepts a valid verified-live attestation", () => {
    const att = liveAttest();
    expect(att.status).toBe("verified-live");
    expect(att.provenance).toBe("measured");
  });

  test("verified-live requires measured live evidence and a value", () => {
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: null }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "official", evidence: { at: T0, source: "provider-docs" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "provider-docs" } }));
    expectContractError("evidence", () => attest({ value: null, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "live-e2e" } }));
  });

  test("restricted requires observed live evidence and a note", () => {
    // published docs do not observe a restriction
    expectContractError("evidence", () =>
      attest({ value: null, status: "restricted", provenance: "official", evidence: { at: T0, source: "provider-docs" }, note: "docs say retired" }),
    );
    expectContractError("evidence", () => attest({ value: null, status: "restricted", provenance: "measured" }));
    expectContractError("evidence", () => attest({ value: null, status: "restricted", provenance: "measured", evidence: { at: T0, source: "live-e2e" } }));
    const ok = attest({
      value: null,
      status: "restricted",
      provenance: "measured",
      evidence: { at: T0, source: "live-e2e" },
      note: "HTTP 402 Insufficient Balance",
    });
    expect(ok.status).toBe("restricted");
    expect(ok.note).toBe("HTTP 402 Insufficient Balance");
  });

  test("unknown carries no value and no evidence", () => {
    expectContractError("evidence", () => attest({ value: 5, status: "unknown", provenance: "estimated" }));
    expectContractError("evidence", () => attest({ value: null, status: "unknown", provenance: "estimated", evidence: { at: T0, source: "config" } }));
    expect(attest({ value: null, status: "unknown", provenance: "estimated" })).toEqual({
      value: null,
      status: "unknown",
      provenance: "estimated",
      evidence: null,
    });
  });

  test("provenance and evidence source must agree", () => {
    expectContractError("evidence", () => attest({ value: 1, status: "configured", provenance: "measured", evidence: { at: T0, source: "provider-docs" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "configured", provenance: "official", evidence: { at: T0, source: "live-e2e" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "configured", provenance: "estimated", evidence: { at: T0, source: "probe" } }));
    // official value citing the provider catalog is fine
    expect(attest({ value: 1048576, status: "configured", provenance: "official", evidence: { at: T0, source: "provider-catalog" } }).value).toBe(1048576);
    // an unverified declaration must not borrow live-evidence credibility
    expectContractError("evidence", () => attest({ value: 1, status: "configured", provenance: "measured", evidence: { at: T0, source: "live-e2e" } }));
  });

  test("evidence timestamps and digests are validated", () => {
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: "2026-11-01 00:00:00", source: "live-e2e" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: "not-a-date", source: "live-e2e" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "live-e2e", sha: "DEADBEEF" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "telepathy" as never } }));
    expect(attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: "2026-11-01T12:34:56.789Z", source: "probe" } }).status).toBe("verified-live");
  });
});

describe("attestation matrix (read path: forged data)", () => {
  test("parseAttested re-validates the full matrix on an honest object", () => {
    const parsed = parseAttested(JSON.parse(toJson(liveAttest())), "roundtrip");
    expect(parsed.status).toBe("verified-live");
    expect(parsed.provenance).toBe("measured");
    expect(parsed.value).toEqual({ tool_call: true });
  });

  test("forged verified-live with wrong provenance is unusable", () => {
    const forged = { value: { tool_call: true }, status: "verified-live", provenance: "estimated", evidence: { at: T0, source: "live-e2e" } };
    expect(isUsable(forged as unknown as Attested<unknown>, { now: NOW })).toBe(false);
    expectContractError("evidence", () => requireUsable(forged as unknown as Attested<unknown>, { now: NOW }));
  });

  test("forged verified-live without a value is unusable", () => {
    const forged = { value: null, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "live-e2e" } };
    expect(isUsable(forged as unknown as Attested<unknown>, { now: NOW })).toBe(false);
    expectContractError("evidence", () => requireUsable(forged as unknown as Attested<unknown>, { now: NOW }));
  });

  test("forged restricted without a note is unusable on read", () => {
    const forged = { value: null, status: "restricted", provenance: "measured", evidence: { at: T0, source: "live-e2e" } };
    expectContractError("evidence", () => parseAttested(forged, "forged"));
  });

  test("forged object with unknown fields is rejected", () => {
    const forged = { ...JSON.parse(toJson(liveAttest())), backdoor: "extra" };
    expectContractError("schema", () => parseAttested(forged, "forged"));
    expect(isUsable(forged as unknown as Attested<unknown>, { now: NOW })).toBe(false);
  });

  test("garbage input fails closed", () => {
    expect(isUsable("verified-live" as unknown as Attested<unknown>, { now: NOW })).toBe(false);
    expect(isUsable(null as unknown as Attested<unknown>, { now: NOW })).toBe(false);
    expect(isUsable({ status: "verified-live" } as unknown as Attested<unknown>, { now: NOW })).toBe(false);
    expectContractError("schema", () => requireUsable("nope" as unknown as Attested<unknown>));
  });

  test("future-dated evidence is invalid, never fresh", () => {
    const future = attest({
      value: 1,
      status: "verified-live",
      provenance: "measured",
      evidence: { at: "2027-01-01T00:00:00Z", source: "live-e2e" },
    });
    expect(isStale(future.evidence as { at: string; source: "live-e2e" }, NOW, DAY)).toBe(true);
    expect(isUsable(future, { now: NOW })).toBe(false);
    expectContractError("evidence", () => requireUsable(future, { now: NOW }));
    // within the skew allowance it is still accepted as fresh
    const skewed = attest({
      value: 1,
      status: "verified-live",
      provenance: "measured",
      evidence: { at: "2026-11-08T00:00:30Z", source: "live-e2e" },
    });
    expect(isUsable(skewed, { now: NOW })).toBe(true);
  });
});

describe("usability and staleness (fail-closed freshness)", () => {
  test("only fresh verified-live is usable", () => {
    expect(isUsable(liveAttest(), { now: NOW, maxAgeMs: 7 * DAY })).toBe(true);
    // stale evidence is never promoted to available
    expect(isUsable(liveAttest(), { now: NOW + 1, maxAgeMs: 7 * DAY })).toBe(false);
  });

  test("freshness is bounded by default: no unbounded mode", () => {
    // default window is DEFAULT_MAX_EVIDENCE_AGE_MS (7 days)
    expect(DEFAULT_MAX_EVIDENCE_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isUsable(liveAttest(), { now: NOW })).toBe(true);
    expect(isUsable(liveAttest(), { now: NOW + 1 })).toBe(false);
    // an explicitly tighter bound is honored
    expect(isUsable(liveAttest(), { now: NOW, maxAgeMs: DAY })).toBe(false);
    // invalid bounds fail closed
    expect(isUsable(liveAttest(), { now: NOW, maxAgeMs: 0 })).toBe(false);
    expect(isUsable(liveAttest(), { now: NOW, maxAgeMs: -1 })).toBe(false);
    expect(isUsable(liveAttest(), { now: Number.NaN, maxAgeMs: DAY })).toBe(false);
    expectContractError("schema", () => requireUsable(liveAttest(), { now: NOW, maxAgeMs: 0 }));
  });

  test("configured/restricted/unknown are never usable", () => {
    expect(isUsable({ value: 1, status: "configured", provenance: "official", evidence: { at: T0, source: "provider-catalog" } } as Attested<unknown>, { now: NOW })).toBe(false);
    expect(isUsable({ value: null, status: "restricted", provenance: "measured", evidence: { at: T0, source: "live-e2e" }, note: "402" } as Attested<unknown>, { now: NOW })).toBe(false);
    expect(isUsable({ value: null, status: "unknown", provenance: "estimated", evidence: null } as Attested<unknown>, { now: NOW })).toBe(false);
  });

  test("requireUsable throws with the blocking reason", () => {
    expect(requireUsable(liveAttest(), { now: NOW, maxAgeMs: 7 * DAY })).toEqual({ tool_call: true });
    expectContractError("evidence", () => requireUsable(liveAttest(), { now: NOW + 1, maxAgeMs: 7 * DAY }));
    expectContractError("evidence", () => requireUsable({ value: null, status: "unknown", provenance: "estimated", evidence: null } as Attested<unknown>));
  });

  test("isStale compares evidence age", () => {
    // exactly maxAgeMs old is still fresh; one more second is stale
    expect(isStale({ at: T0, source: "live-e2e" }, NOW, 7 * DAY)).toBe(false);
    expect(isStale({ at: T0, source: "live-e2e" }, NOW + 1, 7 * DAY)).toBe(true);
    expect(isStale({ at: T0, source: "live-e2e" }, Date.parse(T0) + 1000, 7 * DAY)).toBe(false);
    expectContractError("evidence", () => isStale({ at: "bogus", source: "live-e2e" }, NOW, DAY));
  });
});

describe("quota scope", () => {
  test("scope keys dedupe shared allowances across machines", () => {
    expect(quotaScopeKey({ kind: "api-key", id: "OPENCODE_API_KEY" })).toBe("api-key:OPENCODE_API_KEY");
    expect(quotaScopeKey({ kind: "api-key", id: "OPENCODE_API_KEY" })).toBe(quotaScopeKey({ kind: "api-key", id: "OPENCODE_API_KEY" }));
    expect(quotaScopeKey({ kind: "account", id: "openrouter" })).not.toBe(quotaScopeKey({ kind: "plan", id: "openrouter" }));
  });

  test("rejects invalid kinds and ids", () => {
    expectContractError("schema", () => quotaScopeKey({ kind: "provider" as never, id: "x" }));
    expectContractError("identity", () => quotaScopeKey({ kind: "account", id: "" }));
    expectContractError("identity", () => quotaScopeKey({ kind: "account", id: "a b" }));
  });
});

describe("secret redaction", () => {
  test("redacts snake_case and camelCase secret keys, keeps usage counters", () => {
    const input = {
      api_key: "sk-live-123",
      apiKey: "sk-live-456",
      clientSecret: "s3cret",
      bearerToken: "tok",
      idToken: "tok",
      githubToken: "ghp_0123456789abcdefghijklmnopqrstuv",
      secret: "hunter2",
      auth_token: "tok",
      INFISICAL_ACCESS_TOKEN: "tok",
      nested: { credential: { password: "pw" } },
      list: [{ private_key: "k" }],
      tokens_used: 4242,
      route: "omp.opencode-go",
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.api_key).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.clientSecret).toBe("[redacted]");
    expect(out.bearerToken).toBe("[redacted]");
    expect(out.idToken).toBe("[redacted]");
    expect(out.githubToken).toBe("[redacted]");
    expect(out.secret).toBe("[redacted]");
    expect(out.auth_token).toBe("[redacted]");
    expect(out.INFISICAL_ACCESS_TOKEN).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).credential).toBe("[redacted]");
    expect(out.list).toEqual([{ private_key: "[redacted]" }]);
    expect(out.tokens_used).toBe(4242);
    expect(out.route).toBe("omp.opencode-go");
    // input is not mutated
    expect(input.api_key).toBe("sk-live-123");
  });

  test("scans string values for credential shapes regardless of key name", () => {
    const out = redact({
      session_note: "got ghp_0123456789abcdefghij from gh auth",
      message: "Bearer bm9uY2VzZWNyZXQ= rejected",
      author: "samuido",
      tokens_used: 4242,
    }) as Record<string, unknown>;
    expect(out.session_note).toBe("[redacted]");
    expect(out.message).toBe("[redacted]");
    expect(out.author).toBe("samuido");
    expect(out.tokens_used).toBe(4242);
    expect(looksLikeSecretValue("sk-abcdef123456")).toBe(true);
    expect(looksLikeSecretValue("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeSecretValue("plain model id z-ai/glm-5.3-flash")).toBe(false);
  });

  test("key classification is name-based", () => {
    expect(isSecretKeyName("api_key")).toBe(true);
    expect(isSecretKeyName("apiKey")).toBe(true);
    expect(isSecretKeyName("OPENROUTER_API_KEY")).toBe(true);
    expect(isSecretKeyName("clientSecret")).toBe(true);
    expect(isSecretKeyName("githubToken")).toBe(true);
    expect(isSecretKeyName("secret")).toBe(true);
    expect(isSecretKeyName("tokens_used")).toBe(false);
    expect(isSecretKeyName("author")).toBe(false);
    expect(isSecretKeyName("route")).toBe(false);
    expect(isSecretKeyName("tokensUsed")).toBe(false);
  });

  test("shared non-cyclic references are copied, cycles throw", () => {
    const shared = { note: "ok" };
    const out = redact({ x: shared, y: shared }) as Record<string, unknown>;
    expect(out.x).toEqual({ note: "ok" });
    expect(out.y).toEqual({ note: "ok" });
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expectContractError("schema", () => redact(cyclic));
  });

  test("Dates pass through and prototype pollution is impossible", () => {
    const date = new Date(0);
    const out = redact({ at: date }) as Record<string, unknown>;
    expect(out.at).toBe(date);
    const polluted = JSON.parse('{"__proto__":{"x":1},"a":2}') as Record<string, unknown>;
    const cleaned = redact(polluted) as Record<string, unknown>;
    expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(cleaned.a).toBe(2);
  });

  test("redactJson is canonical: redacted, sorted, stable", () => {
    const a = redactJson({ b: 1, api_key: "x", a: { d: 2, c: 3 } });
    expect(a).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "api_key": "[redacted]",\n  "b": 1\n}');
    expect(redactJson({ api_key: "x", b: 1, a: { d: 2, c: 3 } })).toBe(a);
  });
});

describe("canonical JSON", () => {
  test("toJson sorts keys recursively and roundtrips", () => {
    const value = { z: [3, { y: 1, x: 2 }], a: 1 };
    expect(toJson(value)).toBe('{\n  "a": 1,\n  "z": [\n    3,\n    {\n      "x": 2,\n      "y": 1\n    }\n  ]\n}');
    expect(parseJson(toJson(value))).toEqual(value);
  });

  test("parseJson rejects malformed input", () => {
    expectContractError("schema", () => parseJson("{nope"));
  });
});

describe("envelope validation", () => {
  test("fixture envelope parses with version and payload", () => {
    const env = parseEnvelope(ENTRY, ["route", "capability"], "fixture");
    expect(env.version).toBe("1.0.0");
    expect(env.payload.route).toBe("claude.opencode-go");
    expect(env.payload.capability).toEqual(ENTRY.capability);
  });

  test("unknown top-level fields are rejected", () => {
    expectContractError("schema", () => parseEnvelope({ ...ENTRY, extra: 1 }, ["route", "capability"], "fixture"));
    // the unknown-field fixture's typo sits inside the capability payload:
    // the envelope read passes, the attested read rejects it
    const env = parseEnvelope(ENTRY_UNKNOWN, ["route", "capability"], "fixture");
    expectContractError("schema", () => parseAttested(env.payload.capability, "fixture.capability"));
  });

  test("incompatible versions are rejected", () => {
    expectContractError("version", () =>
      parseEnvelope({ contract_version: "999.0.0", route: "a.b" }, ["route"], "fixture"),
    );
  });
});

describe("unknown field rejection", () => {
  test("fixture with a typo'd field is rejected", () => {
    expectFields(ENTRY.capability as Record<string, unknown>, ["value", "status", "provenance", "evidence"], "fixture.capability");
    expectContractError("schema", () => expectFields(ENTRY_UNKNOWN.capability as Record<string, unknown>, ["value", "status", "provenance", "evidence"], "fixture.capability"));
  });
});

describe("fixture roundtrip through the read path", () => {
  test("catalog entry survives JSON roundtrip with identity and usability intact", () => {
    // read path: envelope -> attested, not a comparison with the write-side object
    const env = parseEnvelope(ENTRY, ["route", "capability"], "fixture");
    const att = parseAttested(env.payload.capability, "fixture.capability");
    expect(env.payload.route).toBe("claude.opencode-go");
    expect(isUsable(att, { now: NOW, maxAgeMs: 7 * DAY })).toBe(true);

    // serialize the parsed value and re-read it through the same path
    const serialized = toJson({ contract_version: env.version, route: env.payload.route, capability: att });
    const env2 = parseEnvelope(parseJson(serialized), ["route", "capability"], "reparsed");
    const att2 = parseAttested(env2.payload.capability, "reparsed.capability");
    expect(att2).toEqual(att);
    expect(isUsable(att2, { now: NOW, maxAgeMs: 7 * DAY })).toBe(true);
    expect(env2.version).toBe("1.0.0");
  });

  test("a mutated serialized entry loses usability on read", () => {
    const env = parseEnvelope(ENTRY, ["route", "capability"], "fixture");
    const att = parseAttested(env.payload.capability, "fixture.capability");
    const tampered = { ...att, provenance: "estimated" };
    // fail-closed on read: the forged object is unusable, never promoted
    expect(isUsable(tampered as unknown as Attested<unknown>, { now: NOW, maxAgeMs: 7 * DAY })).toBe(false);
    expectContractError("evidence", () => parseAttested(tampered, "tampered"));
  });
});

describe("real config consistency", () => {
  test("every configured route and provider key satisfies the identity contract", () => {
    const routeIds = Object.keys(REAL_ROUTES.routes);
    expect(routeIds.length).toBeGreaterThan(0);
    for (const routeId of routeIds) {
      const ref = parseRouteId(routeId);
      expect(formatRouteId(ref)).toBe(routeId);
      expect(resolveLegacyRouteRef(legacyRouteShortcut(routeId), routeIds)).toBe(routeId);
    }
    for (const providerKey of Object.keys(REAL_ROUTES.providers)) {
      expect(parseRouteId(`harness.${providerKey}`).provider).toBe(providerKey);
    }
    // the hyphen trap from the fixture also holds against the real config
    expect(routeIds).toContain("claude.openrouter-free");
    expect(resolveLegacyRouteRef("claude-openrouter-free", routeIds)).toBe("claude.openrouter-free");
    // the real config has no ambiguous shortcut names
    const owner: Record<string, string> = {};
    for (const routeId of routeIds) {
      const name = legacyRouteShortcut(routeId);
      expect(owner[name]).toBeUndefined();
      owner[name] = routeId;
    }
  });
});

describe("non-secret local state", () => {
  test("respects AGENT_STATE_DIR and XDG_STATE_HOME", () => {
    const saved = process.env.AGENT_STATE_DIR;
    const savedXdg = process.env.XDG_STATE_HOME;
    try {
      process.env.AGENT_STATE_DIR = "/tmp/agent-state-test";
      expect(agentStateDir()).toBe("/tmp/agent-state-test");
      delete process.env.AGENT_STATE_DIR;
      process.env.XDG_STATE_HOME = "/tmp/state-home";
      expect(agentStateDir()).toBe("/tmp/state-home/agent");
      delete process.env.XDG_STATE_HOME;
      expect(agentStateDir()).toContain("agent");
    } finally {
      if (saved === undefined) delete process.env.AGENT_STATE_DIR;
      else process.env.AGENT_STATE_DIR = saved;
      if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = savedXdg;
    }
  });
});
