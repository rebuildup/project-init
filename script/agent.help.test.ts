#!/usr/bin/env bun
/**
 * Progressive-disclosure tests for script/agent/help.ts (issue #88, T002).
 *
 * Two layers, kept separate:
 * - unit/contract tests over the pure builders and renderers (fixtures, no
 *   subprocess), including the JSON/human parity contract;
 * - integration tests that run the real launcher as a child process against
 *   the real config (no network, no secrets, no harness binaries).
 *
 * The cold-reader tests pin the progressive-disclosure contract: the short
 * `agent help` must stay small while every deeper fact stays reachable.
 *
 * Run: bun test script/agent.help.test.ts
 */

import { describe, test, expect } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildGuideData,
  buildHelpData,
  buildRoutesData,
  GUIDE_TOPICS,
  NOT_YET_AVAILABLE,
  renderGuideText,
  renderRoutesText,
  UnknownGuideTopicError,
  type RoutesInput,
} from "./agent/help";
import { loadCatalog } from "./agent/catalog";
import { redactJson } from "./agent/contract";

const REPO = dirname(dirname(realpathSync(import.meta.path)));
const LAUNCHER = join(REPO, "script", "agent.ts");
const REAL_CONFIG = join(REPO, "config", "agents.toml");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal launcher config: one catalog-backed provider, one bare one. */
const FIXTURE: RoutesInput = {
  providers: {
    known: {
      key: "known",
      label: "Known Provider",
      env: "KNOWN_API_KEY",
      default_model: "known-model",
      require_model: false,
      models: ["known-model", "other-model"],
      require_infisical: false,
    },
    bare: {
      key: "bare",
      label: "Bare Provider",
      env: null,
      default_model: null,
      require_model: true,
      models: [],
      require_infisical: false,
    },
  },
  harnesses: {
    claude: { key: "claude", label: "Claude Code", command: "claude", adapter: "anthropic" },
  },
  routes: {
    "claude.known": {
      key: "claude.known",
      harness: "claude",
      provider: "known",
      default_model: null,
      models: null,
      require_model: false,
      note: "fixture route",
    },
    "claude.bare": {
      key: "claude.bare",
      harness: "claude",
      provider: "bare",
      default_model: null,
      models: null,
      require_model: true,
      note: "",
    },
  },
};

/** Catalog tables matching FIXTURE: known facts on `known`, an observed block
 * on the bare route, and nothing for `other-model` (stays unknown). */
const FIXTURE_CATALOG_PATH = join(tmpdir(), `agent-help-test-${process.pid}-catalog.toml`);
const FIXTURE_CATALOG_TOML = `
[providers.known]
label = "Known Provider"
models = ["known-model", "other-model"]

[providers.bare]
label = "Bare Provider"
models = []

[harnesses.claude]
label = "Claude Code"
command = "claude"
adapter = "anthropic"

[routes."claude.known"]
[routes."claude.bare"]

[catalog.providers.known.quota]
scope = "account"
id = "known"

[catalog.providers.known.rate_limits]
value = { per_minute = 20, per_day = 1000 }
status = "configured"
provenance = "official"

[catalog.providers.known.rate_limits.evidence]
at = "2026-11-01T00:00:00Z"
source = "provider-docs"

[catalog.providers.known.models."known-model".tool_call]
value = true
status = "verified-live"
provenance = "measured"

[catalog.providers.known.models."known-model".tool_call.evidence]
at = "2026-11-01T00:00:00Z"
source = "live-e2e"

[catalog.routes."claude.bare".restriction]
status = "restricted"
provenance = "measured"
note = "HTTP 402 fixture block; no fallback."

[catalog.routes."claude.bare".restriction.evidence]
at = "2026-11-04T00:00:00Z"
source = "live-e2e"
`;

writeFileSync(FIXTURE_CATALOG_PATH, FIXTURE_CATALOG_TOML);
const fixtureCatalog = loadCatalog(FIXTURE_CATALOG_PATH);

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, LAUNCHER, ...args],
    env: { ...process.env, AGENT_CONFIG: REAL_CONFIG },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// ---------------------------------------------------------------------------
// Unit: guide
// ---------------------------------------------------------------------------

describe("guide data", () => {
  test("the issue's topics exist with non-empty content", () => {
    const ids = GUIDE_TOPICS.map((t) => t.id);
    for (const required of ["distributed", "limits", "recovery", "quality", "routes", "status", "misfire"]) {
      expect(ids).toContain(required);
    }
    for (const topic of GUIDE_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.summary.length).toBeGreaterThan(0);
      expect(topic.details.length).toBeGreaterThan(0);
    }
  });

  test("overview lists every topic; detail carries the full content", () => {
    const overview = buildGuideData(null);
    expect(overview.topics.map((t) => t.id).sort()).toEqual(
      GUIDE_TOPICS.map((t) => t.id).sort(),
    );
    const detail = buildGuideData("limits");
    expect(detail.topic).toBe("limits");
    expect(detail.details.join("\n")).toContain("Quota scopes");
    expect(detail.related).not.toContain("limits");
  });

  test("unknown topic fails closed naming the valid topics", () => {
    expect(() => buildGuideData("nope")).toThrow(UnknownGuideTopicError);
    expect(() => buildGuideData("nope")).toThrow("routes, status");
  });

  test("guide text and JSON are rendered from the same data", () => {
    const data = buildGuideData("status");
    const text = renderGuideText(data);
    expect(text).toContain("agent guide status");
    expect(text).toContain("unknown");
    expect(JSON.parse(redactJson(data))).toEqual(data);
    const overview = buildGuideData(null);
    const overviewText = renderGuideText(overview);
    for (const topic of GUIDE_TOPICS) {
      expect(overviewText).toContain(`agent guide ${topic.id}`);
    }
  });

  test("not-yet-available fields are present and never route data", () => {
    expect(Object.keys(NOT_YET_AVAILABLE).sort()).toEqual(
      ["readiness", "recommendation", "reset_at", "usage"],
    );
  });
});

// ---------------------------------------------------------------------------
// Unit: routes data + human/JSON parity
// ---------------------------------------------------------------------------

describe("routes data", () => {
  const data = buildRoutesData(FIXTURE, fixtureCatalog);

  test("config facts are exact; catalog facts attach to the right route", () => {
    const known = data.routes.find((r) => r.id === "claude.known");
    expect(known?.shortcut).toBe("claude-known");
    expect(known?.default_model).toBe("known-model");
    expect(known?.credential).toEqual({ env: "KNOWN_API_KEY", infisical_required: false });
    expect(known?.catalog.quota_scope).toBe("account:known");
    expect(known?.catalog.rate_limits?.value).toEqual({ per_minute: 20, per_day: 1000 });
    // A model without a catalog entry stays absent (unknown).
    expect(known?.catalog.models).toEqual({ "known-model": expect.anything() });
    expect(known?.catalog.models["other-model"]).toBeUndefined();
  });

  test("unknown stays unknown: no catalog entry means nulls, never invented values", () => {
    const bare = data.routes.find((r) => r.id === "claude.bare");
    expect(bare?.catalog.quota_scope).toBeNull();
    expect(bare?.catalog.rate_limits).toBeNull();
    expect(bare?.catalog.e2e).toBeNull();
    expect(bare?.catalog.models).toEqual({});
    expect(bare?.default_model).toBeNull();
    // The not-yet-available markers exist exactly once at the top level.
    expect(Object.keys(data.not_yet_available)).toContain("usage");
  });

  test("human text renders the same facts, with explicit unknowns", () => {
    const text = renderRoutesText(data);
    expect(text).toContain("claude.known");
    expect(text).toContain("claude.bare");
    expect(text).toContain("quota scope: account:known");
    expect(text).toContain("rate limits: 20/min, 1000/day");
    expect(text).toContain("unknown"); // absent facts are stated, not hidden
    expect(text).toContain("not yet available: readiness (#90/T004)");
  });

  test("restricted routes render RESTRICTED, never unknown", () => {
    const text = renderRoutesText(data);
    expect(text).toContain("RESTRICTED: HTTP 402 fixture block");
    expect(text).not.toContain("RESTRICTED: HTTP 429");
  });

  test("JSON output is the redacted canonical form of the human source data", () => {
    const json = JSON.parse(redactJson(data)) as typeof data;
    expect(json.routes.map((r) => r.id)).toEqual(data.routes.map((r) => r.id));
    expect(json.config).toBe(FIXTURE_CATALOG_PATH);
  });
});

// ---------------------------------------------------------------------------
// Unit: help data
// ---------------------------------------------------------------------------

describe("help data", () => {
  test("subcommands and further entries are backed by the usage text", () => {
    const usage = "usage:\n  agent list\n  agent models <provider>\n  agent shortcuts\n  agent check\n  agent guide [topic]\n  agent routes [--json]\n  agent help\n";
    const data = buildHelpData(usage);
    expect(data.usage).toBe(usage);
    // Every listed subcommand's first word must exist in the usage text.
    for (const sub of data.subcommands) {
      const head = sub.name.split(" ")[0];
      expect(usage).toContain(`agent ${head}`);
    }
    for (const entry of data.further) {
      expect(entry.command).toMatch(/^agent (guide|routes)/);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: real launcher, real config (cold-reader contract)
// ---------------------------------------------------------------------------

describe("launcher integration", () => {
  test("`agent help` keeps its short entry point and points deeper", () => {
    const result = run(["help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage:");
    // Progressive disclosure: the entry stays bounded and names the doors.
    expect(result.stdout.split("\n").length).toBeLessThanOrEqual(100);
    expect(result.stdout).toContain("agent guide [topic]");
    expect(result.stdout).toContain("agent routes [--json]");
  });

  test("`agent help --json` quotes the same usage text", () => {
    const human = run(["help"]);
    const result = run(["help", "--json"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout) as { command: string; usage: string };
    expect(data.command).toBe("help");
    // console.log appends the final newline the usage string lacks.
    expect(data.usage + "\n").toBe(human.stdout);
  });

  test("`--help` spelling stays plain (no accidental --json contract)", () => {
    const result = run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).toThrow();
    expect(run(["--help", "--json"]).exitCode).toBe(2);
  });

  test("every guide topic is reachable and exits 0", () => {
    const overview = run(["guide"]);
    expect(overview.exitCode).toBe(0);
    for (const topic of GUIDE_TOPICS) {
      const detail = run(["guide", topic.id]);
      expect(detail.exitCode).toBe(0);
      expect(detail.stdout).toContain(`agent guide ${topic.id}`);
    }
    // The overview itself stays small: no giant always-on prompt.
    expect(overview.stdout.split("\n").length).toBeLessThanOrEqual(20);
  });

  test("unknown guide topic and extra args exit 2", () => {
    const bad = run(["guide", "bogus"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain("valid topics");
    expect(run(["guide", "limits", "extra"]).exitCode).toBe(2);
    expect(run(["routes", "extra"]).exitCode).toBe(2);
    expect(run(["routes", "--json", "extra"]).exitCode).toBe(2);
  });

  test("`agent routes` human and --json agree on the route set", () => {
    const human = run(["routes"]);
    expect(human.exitCode).toBe(0);
    const json = run(["routes", "--json"]);
    expect(json.exitCode).toBe(0);
    const data = JSON.parse(json.stdout) as {
      routes: Array<{ id: string; catalog: { quota_scope: string | null } }>;
      not_yet_available: Record<string, unknown>;
    };
    const humanIds = human.stdout
      .split("\n")
      .filter((line) => /^\S+\.\S+ \[/.test(line))
      .map((line) => line.split(" ")[0]);
    expect(data.routes.map((r) => r.id)).toEqual(humanIds);
    expect(Object.keys(data.not_yet_available)).toContain("readiness");
    // Real catalog facts come through with their scopes.
    const scopes = Object.fromEntries(data.routes.map((r) => [r.id, r.catalog.quota_scope]));
    expect(scopes["claude.openrouter-free"]).toBe("account:openrouter");
    expect(scopes["omp.opencode-go"]).toBe("plan:opencode-go");
  });

  test("`agent list` output contract is unchanged", () => {
    const result = run(["list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ROUTE");
    expect(result.stdout).toContain("'agent models <provider>' for credential names");
  });

  test("`agent guide` never launches a process (no harness, no injection)", () => {
    const result = run(["guide", "misfire"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("ARGV");
  });
});
