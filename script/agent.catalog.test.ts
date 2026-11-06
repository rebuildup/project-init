/**
 * Catalog tests for script/agent/catalog.ts (issue #89, T003).
 *
 * Pure unit/contract tests over fixtures and the real config: no network,
 * no secrets, no harness binaries, no launcher execution. One integration
 * test runs `agent check` as a child process to prove the additive
 * `[catalog.*]` tables leave the launcher's config validation untouched.
 *
 * Run: bun test script/agent.catalog.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadCatalog, effectiveQuotaKey, modelEntry, type Catalog } from "./agent/catalog";
import { ContractError, isUsable } from "./agent/contract";

const REPO = dirname(dirname(realpathSync(import.meta.path)));
const REAL_CONFIG = join(REPO, "config", "agents.toml");

/** Reference clock for freshness checks: fresh for every recorded evidence date. */
const NOW = Date.parse("2026-11-06T12:00:00Z");

let catalog: Catalog;

// Minimal valid launcher config (adapter contract included) that fixtures
// extend with `[catalog.*]` tables under test.
const BASE_CONFIG = `
[providers.testprov]
label = "Test Provider"
base_url = "https://example.test/v1"
secret = "TEST_API_KEY"
env = "TEST_API_KEY"
default_model = "test-model"
models = ["test-model", "alt-model"]

[harnesses.claude]
label = "Claude Code"
command = "claude"
adapter = "anthropic"

[harnesses.claude.env]
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[routes."claude.testprov"]
`;

/** Write a fixture config (base + catalog snippet) and return its path. */
function configWith(catalogToml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-catalog-test-"));
  const path = join(dir, "agents.toml");
  writeFileSync(path, BASE_CONFIG + "\n" + catalogToml);
  return path;
}

const TOOL_CALL_OK = `
[catalog.providers.testprov.models."test-model".tool_call]
value = true
status = "verified-live"
provenance = "measured"
[catalog.providers.testprov.models."test-model".tool_call.evidence]
at = "2026-11-01T00:00:00Z"
source = "live-e2e"
note = "fixture"
`;

describe("loadCatalog: real config", () => {
  beforeAll(() => {
    catalog = loadCatalog(REAL_CONFIG);
  });

  test("loads every catalogued provider and route", () => {
    expect(Object.keys(catalog.providers).sort()).toEqual([
      "deepseek",
      "logfare",
      "minimax",
      "mistral",
      "opencode-go",
      "openrouter",
      "openrouter-free",
      "zen",
    ]);
    expect(Object.keys(catalog.routes).sort()).toEqual([
      "claude.opencode-go",
      "claude.openrouter-free",
      "omp.deepseek",
      "omp.minimax",
      "omp.opencode-go",
      "omp.openrouter-free",
      "opencode.logfare",
      "opencode.openrouter-free",
    ]);
  });

  test("shared account quota collapses to one scope key across routes", () => {
    // openrouter and openrouter-free draw on ONE account allowance.
    expect(effectiveQuotaKey(catalog, "claude.openrouter")).toBe("account:openrouter");
    expect(effectiveQuotaKey(catalog, "claude.openrouter-free")).toBe("account:openrouter");
    expect(effectiveQuotaKey(catalog, "omp.openrouter-free")).toBe("account:openrouter");
    // Both Go routes draw on the same subscription allowance.
    expect(effectiveQuotaKey(catalog, "claude.opencode-go")).toBe("plan:opencode-go");
    expect(effectiveQuotaKey(catalog, "omp.opencode-go")).toBe("plan:opencode-go");
    // Distinct allowances never share a key.
    const keys = new Set(
      ["claude.openrouter", "claude.opencode-go", "omp.deepseek", "omp.minimax", "opencode.logfare"].map(
        (r) => effectiveQuotaKey(catalog, r),
      ),
    );
    expect(keys.size).toBe(5);
  });

  test("model metadata is consistent across omp/claude/opencode routes", () => {
    const model = "nvidia/nemotron-3-ultra-550b-a55b:free";
    const views = ["claude.openrouter-free", "opencode.openrouter-free", "omp.openrouter-free"].map(
      (route) => modelEntry(catalog, route, model),
    );
    for (const view of views) {
      expect(view).not.toBeNull();
      expect(view!.tool_call?.value).toBe(true);
      expect(view!.pricing?.kind).toBe("free");
      expect(view!.pricing?.input_per_mtok?.value).toBe(0);
      expect(view!.pricing?.output_per_mtok?.value).toBe(0);
    }
    expect(JSON.stringify(views[0])).toBe(JSON.stringify(views[1]));
    expect(JSON.stringify(views[1])).toBe(JSON.stringify(views[2]));
  });

  test("live E2E observations are verified-live, measured and fresh", () => {
    for (const route of ["claude.openrouter-free", "opencode.openrouter-free", "omp.openrouter-free"]) {
      const e2e = catalog.routes[route]!.e2e!;
      expect(e2e.status).toBe("verified-live");
      expect(e2e.provenance).toBe("measured");
      expect(e2e.evidence?.source).toBe("live-e2e");
      expect(isUsable(e2e, { now: NOW })).toBe(true);
    }
  });

  test("observed restrictions are recorded, never guessed", () => {
    const deepseek = catalog.routes["omp.deepseek"]!.restriction!;
    expect(deepseek.status).toBe("restricted");
    expect(deepseek.value).toBeNull();
    expect(deepseek.note).toContain("402");
    const minimax = catalog.routes["omp.minimax"]!.restriction!;
    expect(minimax.status).toBe("restricted");
    expect(minimax.note).toContain("429");
    // A restriction is not a usable capability: fail-closed.
    expect(isUsable(deepseek, { now: NOW })).toBe(false);
  });

  test("unknown stays unknown: no invented facts", () => {
    // deepseek has provider terms but NO model-level facts.
    expect(modelEntry(catalog, "omp.deepseek", "deepseek-flash")).toBeNull();
    expect(modelEntry(catalog, "claude.deepseek", "deepseek-flash")).toBeNull();
    // mistral has pricing only; no tool-call or context claims.
    const glm = modelEntry(catalog, "omp.mistral", "zai-glm-5-3-flash")!;
    expect(glm.pricing?.input_per_mtok?.value).toBe(0.15);
    expect(glm.pricing?.output_per_mtok?.value).toBe(0.5);
    expect(glm.pricing?.currency).toBe("USD");
    expect(glm.tool_call).toBeNull();
    expect(glm.context_window).toBeNull();
  });

  test("published capability facts cite provider catalogs, not invention", () => {
    const glm = modelEntry(catalog, "opencode.logfare", "glm-5.3")!;
    expect(glm.tool_call?.provenance).toBe("official");
    expect(glm.tool_call?.evidence?.source).toBe("provider-catalog");
    expect(glm.context_window?.value).toBe(262144);
    expect(glm.context_window?.evidence?.note).toContain("1M claim");
  });
});

describe("loadCatalog: rejections", () => {
  test("unknown route reference", () => {
    expect(() =>
      loadCatalog(configWith(`
[catalog.routes."claude.nope".e2e]
value = [{ model = "test-model", tool_call = true }]
status = "verified-live"
provenance = "measured"
[catalog.routes."claude.nope".e2e.evidence]
at = "2026-11-01T00:00:00Z"
source = "live-e2e"
`)),
    ).toThrow(ContractError);
  });

  test("unknown provider reference", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.nope]
billing = "free"
`))).toThrow(ContractError);
  });

  test("model not declared in the provider's models list", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."ghost".tool_call]
value = true
status = "verified-live"
provenance = "measured"
[catalog.providers.testprov.models."ghost".tool_call.evidence]
at = "2026-11-01T00:00:00Z"
source = "live-e2e"
`))).toThrow(ContractError);
  });

  test("e2e model not selectable on the route", () => {
    expect(() => loadCatalog(configWith(`
[catalog.routes."claude.testprov".e2e]
value = [{ model = "elsewhere-model", tool_call = true }]
status = "verified-live"
provenance = "measured"
[catalog.routes."claude.testprov".e2e.evidence]
at = "2026-11-01T00:00:00Z"
source = "live-e2e"
`))).toThrow(ContractError);
  });

  test("price without evidence", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".pricing]
currency = "USD"
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok]
value = 1.5
status = "configured"
provenance = "official"
`))).toThrow(/price requires evidence/);
  });

  test("estimated price", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".pricing]
currency = "USD"
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok]
value = 1.5
status = "configured"
provenance = "estimated"
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok.evidence]
at = "2026-11-01T00:00:00Z"
source = "provider-docs"
`))).toThrow(/never 'estimated'/);
  });

  test("price without currency", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".pricing]
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok]
value = 1.5
status = "configured"
provenance = "official"
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok.evidence]
at = "2026-11-01T00:00:00Z"
source = "provider-docs"
`))).toThrow(/currency/);
  });

  test("kind 'free' contradicts a nonzero price", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".pricing]
kind = "free"
currency = "USD"
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok]
value = 1.5
status = "configured"
provenance = "official"
[catalog.providers.testprov.models."test-model".pricing.input_per_mtok.evidence]
at = "2026-11-01T00:00:00Z"
source = "provider-docs"
`))).toThrow(/contradicts/);
  });

  test("unknown field in a model entry", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".bogus]
value = true
status = "configured"
provenance = "official"
`))).toThrow(ContractError);
  });

  test("invalid quota scope kind", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.quota]
scope = "galaxy"
id = "testprov"
`))).toThrow(ContractError);
  });

  test("configured capability with no value", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".tool_call]
status = "configured"
provenance = "official"
`))).toThrow(ContractError);
  });

  test("live evidence claimed for a configured fact", () => {
    expect(() => loadCatalog(configWith(`
[catalog.providers.testprov.models."test-model".tool_call]
value = true
status = "configured"
provenance = "measured"
[catalog.providers.testprov.models."test-model".tool_call.evidence]
at = "2026-11-01T00:00:00Z"
source = "live-e2e"
`))).toThrow(ContractError);
  });
});

describe("loadCatalog: shape", () => {
  test("config without a [catalog] table loads as an empty catalog", () => {
    const empty = loadCatalog(configWith(""));
    expect(Object.keys(empty.providers)).toHaveLength(0);
    expect(Object.keys(empty.routes)).toHaveLength(0);
    expect(effectiveQuotaKey(empty, "claude.testprov")).toBeNull();
  });

  test("route quota overrides the provider scope when declared", () => {
    const overridden = loadCatalog(configWith(`
[catalog.providers.testprov.quota]
scope = "api-key"
id = "TEST_API_KEY"

[catalog.routes."claude.testprov".quota]
scope = "plan"
id = "test-plan"
`));
    expect(effectiveQuotaKey(overridden, "claude.testprov")).toBe("plan:test-plan");
  });
});

describe("launcher compatibility", () => {
  test("agent check still passes with the additive catalog tables", () => {
    const proc = Bun.spawnSync(["bun", join(REPO, "script", "agent.ts"), "check"], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new TextDecoder().decode(proc.stdout);
    expect(proc.exitCode).toBe(0);
    expect(out).toContain("config OK");
    expect(out).toContain("8 providers");
  });
});
