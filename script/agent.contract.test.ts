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
  agentStateDir,
  assertCompatibleVersion,
  attest,
  expectFields,
  formatAttemptKey,
  formatRouteId,
  isCompatibleVersion,
  isSecretKeyName,
  isStale,
  isUsable,
  legacyRouteShortcut,
  parseAttemptKey,
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

/** A known-good verified-live attestation used as the base for mutations. */
function liveAttest(value: unknown = { tool_call: true }): Attested<unknown> {
  return { value, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "live-e2e", sha: SHA, note: "real response + tool call" } };
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

  test("legacy shortcut matches the launcher's shortcut spelling", () => {
    expect(legacyRouteShortcut("omp.opencode-go")).toBe("omp-opencode-go");
    expectContractError("identity", () => legacyRouteShortcut("omp-opencode-go"));
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

describe("attestation matrix", () => {
  test("accepts a valid verified-live attestation", () => {
    const att = { value: { tool_call: true }, status: "verified-live" as const, provenance: "measured" as const, evidence: { at: T0, source: "live-e2e" as const, sha: SHA } };
    expect(attest(att)).toEqual(att);
  });

  test("verified-live requires measured live evidence", () => {
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: null }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "official", evidence: { at: T0, source: "provider-docs" } }));
    expectContractError("evidence", () => attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: T0, source: "provider-docs" } }));
  });

  test("restricted requires evidence and a note", () => {
    expectContractError("evidence", () => attest({ value: null, status: "restricted", provenance: "measured" }));
    expectContractError("evidence", () => attest({ value: null, status: "restricted", provenance: "measured", evidence: { at: T0, source: "live-e2e" } }));
    const ok = attest({ value: null, status: "restricted", provenance: "measured", evidence: { at: T0, source: "live-e2e" }, note: "HTTP 402 Insufficient Balance" });
    expect(ok.status).toBe("restricted");
  });

  test("unknown carries no value and no evidence", () => {
    expectContractError("evidence", () => attest({ value: 5, status: "unknown", provenance: "estimated" }));
    expectContractError("evidence", () => attest({ value: null, status: "unknown", provenance: "estimated", evidence: { at: T0, source: "config" } }));
    expect(attest({ value: null, status: "unknown", provenance: "estimated" })).toEqual({ value: null, status: "unknown", provenance: "estimated", evidence: null });
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
    expect(attest({ value: 1, status: "verified-live", provenance: "measured", evidence: { at: "2026-11-01T12:34:56.789Z", source: "probe" } }).status).toBe("verified-live");
  });
});

describe("usability and staleness", () => {
  const now = Date.parse("2026-11-08T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;

  test("only fresh verified-live is usable", () => {
    expect(isUsable(liveAttest(), { now, maxAgeMs: 7 * day })).toBe(true);
    // stale evidence is never promoted to available
    expect(isUsable(liveAttest(), { now, maxAgeMs: 6 * day })).toBe(false);
    // without a freshness bound, any age is accepted
    expect(isUsable(liveAttest(), {})).toBe(true);
  });

  test("configured/restricted/unknown are never usable", () => {
    expect(isUsable({ value: 1, status: "configured", provenance: "official", evidence: { at: T0, source: "provider-catalog" } }, { now })).toBe(false);
    expect(isUsable({ value: null, status: "restricted", provenance: "measured", evidence: { at: T0, source: "live-e2e" } }, { now })).toBe(false);
    expect(isUsable({ value: null, status: "unknown", provenance: "estimated", evidence: null }, { now })).toBe(false);
  });

  test("requireUsable throws with the blocking reason", () => {
    expect(requireUsable(liveAttest(), { now, maxAgeMs: 7 * day })).toEqual({ tool_call: true });
    expectContractError("evidence", () => requireUsable(liveAttest(), { now, maxAgeMs: day }));
    expectContractError("evidence", () => requireUsable({ value: null, status: "unknown", provenance: "estimated", evidence: null }));
  });

  test("isStale compares evidence age", () => {
    // exactly maxAgeMs old is still fresh; one more second is stale
    expect(isStale({ at: T0, source: "live-e2e" }, now, 7 * day)).toBe(false);
    expect(isStale({ at: T0, source: "live-e2e" }, now + 1, 7 * day)).toBe(true);
    expect(isStale({ at: T0, source: "live-e2e" }, Date.parse(T0) + 1000, 7 * day)).toBe(false);
    expectContractError("evidence", () => isStale({ at: "bogus", source: "live-e2e" }, now, day));
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
  test("redacts secret-bearing keys, keeps usage counters", () => {
    const input = {
      api_key: "sk-live-123",
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

  test("key classification is name-based", () => {
    expect(isSecretKeyName("api_key")).toBe(true);
    expect(isSecretKeyName("apiKey")).toBe(true);
    expect(isSecretKeyName("OPENROUTER_API_KEY")).toBe(true);
    expect(isSecretKeyName("secret")).toBe(true);
    expect(isSecretKeyName("tokens_used")).toBe(false);
    expect(isSecretKeyName("author")).toBe(false);
    expect(isSecretKeyName("route")).toBe(false);
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

describe("unknown field rejection", () => {
  test("fixture with a typo'd field is rejected", () => {
    expectFields(ENTRY.capability as Record<string, unknown>, ["value", "status", "provenance", "evidence"], "fixture.capability");
    expectContractError("schema", () => expectFields(ENTRY_UNKNOWN.capability as Record<string, unknown>, ["value", "status", "provenance", "evidence"], "fixture.capability"));
  });
});

describe("fixture roundtrip", () => {
  test("catalog entry survives JSON roundtrip with identity intact", () => {
    const capability = ENTRY.capability as Record<string, unknown>;
    expectFields(capability, ["value", "status", "provenance", "evidence"], "fixture.capability");
    const reparsed = parseJson(toJson(capability)) as Record<string, unknown>;
    expectFields(reparsed, ["value", "status", "provenance", "evidence"], "reparsed.capability");
    expect(reparsed).toEqual(capability);
    // the attested fact stays usable through the roundtrip
    const att = attest({
      value: reparsed.value,
      status: reparsed.status as "verified-live",
      provenance: reparsed.provenance as "measured",
      evidence: reparsed.evidence as { at: string; source: "live-e2e" },
    });
    expect(isUsable(att, { now: Date.parse("2026-11-08T00:00:00Z"), maxAgeMs: 7 * 24 * 60 * 60 * 1000 })).toBe(true);
    // the envelope version is compatible
    assertCompatibleVersion(ENTRY.contract_version as string);
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
