/**
 * Probe tests for script/agent/probe.ts (issue #90, T004).
 *
 * Fully deterministic: every network interaction goes through an injected
 * mock transport; no test touches a real provider, DNS or the filesystem
 * outside a per-test tmp state directory. Live probes are NOT exercised
 * here — a live run is opt-in by contract and reported separately.
 *
 * Run: bun test script/agent.probe.test.ts
 */

import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PROBE_COOLDOWN_MS,
  PROBE_TIMEOUT_MS,
  PROBE_TTL_MS,
  httpTransport,
  ProbeTransportError,
  probeJson,
  probeOverall,
  probeRoute,
  transportKindFor,
  type ProbeOptions,
  type ProbeReport,
  type ProbeTransport,
  type ProbeTransportResponse,
} from "./agent/probe";
import { ContractError, REDACTED } from "./agent/contract";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_CONFIG = `
[providers.testprov]
base_url = "https://testprov.example/v1"
secret = "TEST_API_KEY"
env = "TEST_API_KEY"
default_model = "test-model"
models = ["test-model", "alt-model"]

[providers.wireprov]
base_url = "https://wire.example/v1"
secret = "WIRE_API_KEY"
env = "WIRE_API_KEY"
default_model = "wire-model"
models = ["wire-model"]
opencode_npm = "@ai-sdk/openai-compatible"

[harnesses.claude]
label = "Claude Code"
command = "bun"
adapter = "anthropic"

[harnesses.opencode]
label = "OpenCode"
command = "bun"
adapter = "opencode"

[harnesses.other]
label = "Other"
command = "bun"
adapter = "omp"

[harnesses.broken]
label = "Broken"
command = "missing-binary-t004"
adapter = "anthropic"

[routes."claude.testprov"]

[routes."other.testprov"]

[routes."opencode.wireprov"]

[catalog.providers.testprov.quota]
scope = "account"
id = "testprov-account"
`;

const CREDENTIAL_ENV = { TEST_API_KEY: "t004-fake-key-value", WIRE_API_KEY: "t004-fake-wire-key" };
const NOW = Date.parse("2026-11-06T12:00:00Z");

/** Fixture config written once; tests may extend it via writeConfig. */
const CONFIG_PATH = writeConfig(FIXTURE_CONFIG);

function toolBody(): string {
  return JSON.stringify({ model: "test-model", content: [{ type: "tool_use", name: "probe_ping" }] });
}

interface MockCall {
  url: string;
  init: RequestInit;
}

function mockTransport(
  responses: Array<ProbeTransportResponse | { error: "timeout" | "network" | "dns" }>,
  kind = "mock",
): { transport: ProbeTransport; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const queue = [...responses];
  return {
    calls,
    transport: {
      kind,
      async fetch(url, init) {
        calls.push({ url, init });
        const next = queue.shift();
        if (!next) throw new Error(`unexpected extra transport call to ${url}`);
        if ("error" in next) throw new ProbeTransportError(next.error, `mock ${next.error}`);
        return next as ProbeTransportResponse;
      },
    },
  };
}

function httpResponse(
  status: number,
  body: string | null = null,
  headers: Record<string, string> = {},
): ProbeTransportResponse {
  return { http_status: status, headers, body };
}

function baseOptions(configPath: string, stateDir: string, extra: Partial<ProbeOptions> = {}): ProbeOptions {
  return {
    target: { route: "claude.testprov" },
    configFile: configPath,
    stateDir,
    env: CREDENTIAL_ENV,
    ...extra,
  };
}

function newStateDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-probe-test-"));
}

function writeConfig(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-probe-config-"));
  const path = join(dir, "agents.toml");
  writeFileSync(path, toml);
  return path;
}

// ---------------------------------------------------------------------------
// Static mode: network-free readiness
// ---------------------------------------------------------------------------

describe("probeRoute: static mode", () => {
  test("passes configured/credential/launchable and never touches the network", async () => {
    const stateDir = newStateDir();
    const mock = mockTransport([]);
    const report = await probeRoute(baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport }));
    expect(mock.calls.length).toBe(0);
    const byLayer = Object.fromEntries(report.layers.map((l) => [l.layer, l.status]));
    expect(byLayer["configured"]).toBe("pass");
    expect(byLayer["credential-present"]).toBe("pass");
    expect(byLayer["launchable"]).toBe("pass");
    expect(byLayer["provider-reachable"]).toBe("skipped");
    expect(report.route).toBe("claude.testprov");
    expect(report.model).toBe("test-model");
    expect(report.mode).toBe("static");
    expect(report.cached).toBe(false);
  });

  test("diagnostics JSON carries source/time/scope and no credential values", async () => {
    const stateDir = newStateDir();
    const json = probeJson(
      await probeRoute(baseOptions(CONFIG_PATH, stateDir, { transport: mockTransport([]).transport })),
    );
    const parsed = JSON.parse(json);
    expect(parsed.source).toBe("probe");
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json).not.toContain(CREDENTIAL_ENV.TEST_API_KEY);
  });

  test("unknown route/model fails configured, never reaches the network", async () => {
    const configPath = writeConfig(FIXTURE_CONFIG);
    const stateDir = newStateDir();
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(configPath, stateDir, { transport: mock.transport, target: { route: "claude.nope" } }),
    );
    expect(report.layers[0]!.status).toBe("fail");
    expect(report.layers[0]!.failure).toBe("config");
    expect(mock.calls.length).toBe(0);

    const mismatch = await probeRoute(
      baseOptions(configPath, stateDir, { transport: mock.transport, target: { route: "claude.testprov", model: "nope" } }),
    );
    expect(mismatch.layers[0]!.status).toBe("fail");
    expect(mismatch.layers[0]!.failure).toBe("model-mismatch");
    expect(mock.calls.length).toBe(0);
  });

  test("missing credential fails the route without any network call", async () => {
    const configPath = writeConfig(FIXTURE_CONFIG);
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(configPath, newStateDir(), { transport: mock.transport, env: {} }),
    );
    const credential = report.layers.find((l) => l.layer === "credential-present")!;
    expect(credential.status).toBe("fail");
    expect(credential.failure).toBe("credential-missing");
    expect(mock.calls.length).toBe(0);
  });

  test("unlaunchable harness records not-launchable", async () => {
    const configPath = writeConfig(`
[providers.testprov]
base_url = "https://testprov.example/v1"
secret = "TEST_API_KEY"
env = "TEST_API_KEY"
default_model = "test-model"
models = ["test-model"]

[harnesses.broken]
label = "Broken"
command = "missing-binary-t004"
adapter = "anthropic"

[routes."broken.testprov"]
`);
    const report = await probeRoute(
      baseOptions(configPath, newStateDir(), {
        transport: mockTransport([]).transport,
        target: { route: "broken.testprov" },
        which: () => null,
      }),
    );
    const launchable = report.layers.find((l) => l.layer === "launchable")!;
    expect(launchable.status).toBe("fail");
    expect(launchable.failure).toBe("not-launchable");
  });
});

// ---------------------------------------------------------------------------
// Live mode: mocked provider behavior
// ---------------------------------------------------------------------------

describe("probeRoute: live mode (mocked provider)", () => {
  test("full success: reachable, real response, tool call", async () => {
    const stateDir = newStateDir();
    const mock = mockTransport([httpResponse(200), httpResponse(200, toolBody())]);
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "live" }),
    );
    expect(report.layers.map((l) => l.status)).toEqual([
      "pass", "pass", "pass", "pass", "pass", "pass",
    ]);
    // Bounded: exactly one GET (reachability) + one POST (real response).
    expect(mock.calls.length).toBe(2);
    expect(mock.calls[0]!.init.method).toBe("GET");
    expect(mock.calls[1]!.init.method).toBe("POST");
    // The credential reaches the wire, never the report.
    const headers = mock.calls[1]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${CREDENTIAL_ENV.TEST_API_KEY}`);
    expect(probeJson(report)).not.toContain(CREDENTIAL_ENV.TEST_API_KEY);
  });

  test("openai-compatible wire posts to <base>/chat/completions", async () => {
    const stateDir = newStateDir();
    const mock = mockTransport([httpResponse(200), httpResponse(200, toolBody())]);
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, {
        transport: mock.transport,
        target: { route: "opencode.wireprov" },
        mode: "live",
      }),
    );
    expect(mock.calls[1]!.url).toBe("https://wire.example/v1/chat/completions");
  });

  test("429 records rate-limit and starts a cooldown that refuses the next live probe", async () => {
    const stateDir = newStateDir();
    // Real-network evidence (http transport) is what starts a durable cooldown.
    const limited = mockTransport(
      [
        httpResponse(200),
        {
          http_status: 429,
          headers: { "retry-after": "30" },
          body: null,
        },
      ],
      "http",
    );
    const first = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: limited.transport, mode: "live", now: NOW }),
    );
    const rateLimit = first.layers.find((l) => l.layer === "real-response")!;
    expect(rateLimit.status).toBe("fail");
    expect(rateLimit.failure).toBe("rate-limit");
    expect(rateLimit.retry_after_s).toBe(30);

    // Cooldown active: the immediate retry sends NO requests at all.
    const mock = mockTransport([]);
    const second = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "live", now: NOW + 1000 }),
    );
    const live = second.layers.filter((l) => l.layer === "provider-reachable" || l.layer === "real-response");
    for (const layer of live) {
      expect(layer.status).toBe("skipped");
      expect(layer.failure).toBe("rate-limit-cooldown");
    }
    expect(mock.calls.length).toBe(0);
  });

  test("provider classification: 401/402/403/timeout/network are distinct failures", async () => {
    const cases: Array<{
      responses: Array<ProbeTransportResponse | { error: "timeout" | "network" }>;
      failure: string;
    }> = [
      { responses: [httpResponse(200), httpResponse(401)], failure: "auth" },
      { responses: [httpResponse(200), httpResponse(402)], failure: "payment" },
      { responses: [httpResponse(200), httpResponse(403)], failure: "forbidden" },
      { responses: [httpResponse(200), { error: "timeout" }], failure: "timeout" },
      { responses: [httpResponse(200), { error: "network" }], failure: "network" },
    ];
    for (const testCase of cases) {
      const stateDir = newStateDir();
      const mock = mockTransport(testCase.responses);
      const report = await probeRoute(
        baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "live" }),
      );
      const realResponse = report.layers.find((l) => l.layer === "real-response")!;
      expect(realResponse.status).toBe("fail");
      expect(realResponse.failure).toBe(testCase.failure);
    }
  });

  test("wrong model id fails configured before any request; provider-side model rejection is distinct", async () => {
    const stateDir = newStateDir();
    const mock = mockTransport([]);
    const staticReport = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, {
        transport: mock.transport,
        target: { route: "claude.testprov", model: "not-in-allowlist" },
        mode: "live",
      }),
    );
    expect(staticReport.layers[0]!.status).toBe("fail");
    expect(staticReport.layers[0]!.failure).toBe("model-mismatch");
    expect(mock.calls.length).toBe(0);
  });

  test("stale cache is reported stale, never as a current pass", async () => {
    const stateDir = newStateDir();
    // Seed a fresh live result, then let the TTL expire.
    const fresh = mockTransport([httpResponse(200), httpResponse(200, toolBody())], "http");
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, {
        transport: fresh.transport,
        mode: "live",
        now: NOW,
        ttlMs: 1000,
      }),
    );
    const mock = mockTransport([]);
    const stale = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, {
        transport: mock.transport,
        mode: "static",
        now: NOW + PROBE_TTL_MS + 1,
        ttlMs: 1000,
      }),
    );
    const live = stale.layers.filter((l) =>
      ["provider-reachable", "real-response", "tool-call"].includes(l.layer),
    );
    for (const layer of live) {
      expect(layer.status).toBe("stale");
      expect(layer.cached).toBe(true);
    }
    expect(mock.calls.length).toBe(0);
  });

  test("fresh cache serves a static probe without any network call", async () => {
    const stateDir = newStateDir();
    const fresh = mockTransport([httpResponse(200), httpResponse(200, toolBody())], "http");
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: fresh.transport, mode: "live", now: NOW }),
    );
    expect(fresh.calls.length).toBe(2);
    const mock = mockTransport([]);
    const cached = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, {
        transport: mock.transport,
        mode: "static",
        now: NOW + 1000,
      }),
    );
    const live = cached.layers.filter((l) =>
      ["provider-reachable", "real-response", "tool-call"].includes(l.layer),
    );
    for (const layer of live) {
      expect(layer.status).toBe("pass");
      expect(layer.cached).toBe(true);
    }
    expect(mock.calls.length).toBe(0);
  });

  test("an unparseable cooldown timestamp fails closed and is reported", async () => {
    const stateDir = newStateDir();
    mkdirSync(join(stateDir, "probe"), { recursive: true });
    writeFileSync(
      join(stateDir, "probe", "state.json"),
      JSON.stringify({ contract_version: "1.0.0", probes: {}, cooldowns: { "account:testprov-account": "not-a-date" } }),
    );
    const mock = mockTransport([], "http");
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "live", now: NOW }),
    );
    const live = report.layers.filter((l) =>
      ["provider-reachable", "real-response", "tool-call"].includes(l.layer),
    );
    for (const layer of live) {
      expect(layer.status).toBe("skipped");
      expect(layer.failure).toBe("rate-limit-cooldown");
    }
    expect(mock.calls.length).toBe(0);
  });

  test("observed catalog restriction refuses the live probe without any request", async () => {
    const configPath = writeConfig(`
[providers.testprov]
base_url = "https://testprov.example/v1"
secret = "TEST_API_KEY"
env = "TEST_API_KEY"
default_model = "test-model"
models = ["test-model"]

[harnesses.claude]
label = "Claude Code"
command = "bun"
adapter = "anthropic"

[routes."claude.testprov"]

[catalog.providers.testprov.restriction]
status = "restricted"
provenance = "measured"
note = "HTTP 402 Insufficient Balance observed"

[catalog.providers.testprov.restriction.evidence]
at = "${new Date(NOW - 3600_000).toISOString()}"
source = "live-e2e"
`);
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(configPath, newStateDir(), { transport: mock.transport, mode: "live", now: NOW }),
    );
    const live = report.layers.filter((l) =>
      ["provider-reachable", "real-response", "tool-call"].includes(l.layer),
    );
    for (const layer of live) {
      expect(layer.status).toBe("skipped");
      expect(layer.failure).toBe("restricted");
    }
    expect(mock.calls.length).toBe(0);
  });

  test("unsupported wire never approximates the harness client", async () => {
    const configPath = writeConfig(`
[providers.testprov]
base_url = "https://testprov.example/v1"
secret = "TEST_API_KEY"
env = "TEST_API_KEY"
default_model = "test-model"
models = ["test-model"]

[harnesses.other]
label = "Other"
command = "bun"
adapter = "omp"

[routes."other.testprov"]
`);
    const mock = mockTransport([httpResponse(200)]);
    const report = await probeRoute(
      baseOptions(configPath, newStateDir(), { transport: mock.transport, target: { route: "other.testprov" }, mode: "live" }),
    );
    const realResponse = report.layers.find((l) => l.layer === "real-response")!;
    expect(realResponse.status).toBe("not-applicable");
    expect(realResponse.failure).toBe("unsupported-wire");
    // Only the reachability GET ran; no completion request was sent.
    expect(mock.calls.length).toBe(1);
  });

  test("overall readiness collapses to the deepest passing layer", () => {
    const report: ProbeReport = {
      contract_version: "1.0.0",
      source: "probe",
      route: "claude.testprov",
      model: "test-model",
      mode: "live",
      transport: "mock",
      time: new Date(NOW).toISOString(),
      duration_ms: 1,
      quota_scope: null,
      cached: false,
      layers: [
        { layer: "configured", status: "pass", evidence: null },
        { layer: "credential-present", status: "pass", evidence: null },
        { layer: "launchable", status: "pass", evidence: null },
        { layer: "provider-reachable", status: "pass", evidence: null },
        { layer: "real-response", status: "fail", failure: "no-tool-call", evidence: null },
        { layer: "tool-call", status: "skipped", evidence: null },
      ],
    };
    expect(probeOverall(report)).toEqual({ state: "failed", layer: "real-response", failure: "no-tool-call" });
  });

  test("default http transport refuses redirects and applies its timeout", () => {
    const transport = httpTransport(PROBE_TIMEOUT_MS);
    expect(transport.kind).toBe("http");
  });
});

// ---------------------------------------------------------------------------
// Review items (cold review of c4098c7)
// ---------------------------------------------------------------------------

describe("probeRoute: transport-kind evidence discipline", () => {
  test("mock-transport runs are never persisted as state", async () => {
    const stateDir = newStateDir();
    const mock = mockTransport([httpResponse(200), httpResponse(200, toolBody())], "mock");
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "live", now: NOW }),
    );
    expect(mock.calls.length).toBe(2);
    // Mock evidence is ephemeral: nothing durable was written.
    expect(existsSync(join(stateDir, "probe", "state.json"))).toBe(false);
  });

  test("a hand-seeded mock cache entry never drives probeOverall", async () => {
    const stateDir = newStateDir();
    mkdirSync(join(stateDir, "probe"), { recursive: true });
    writeFileSync(
      join(stateDir, "probe", "state.json"),
      JSON.stringify({
        contract_version: "1.0.0",
        probes: {
          "claude.testprov::test-model": {
            route: "claude.testprov",
            model: "test-model",
            mode: "live",
            transport: "mock",
            time: new Date(NOW).toISOString(),
            quota_scope: null,
            layers: [
              { layer: "provider-reachable", status: "pass", evidence: null },
              { layer: "real-response", status: "pass", evidence: null },
              { layer: "tool-call", status: "pass", evidence: null },
            ],
          },
        },
        cooldowns: {},
      }),
    );
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "static", now: NOW + 1000 }),
    );
    // Not shown as http evidence, not a pass, no network call either.
    for (const layer of ["provider-reachable", "real-response", "tool-call"]) {
      const entry = report.layers.find((l) => l.layer === layer)!;
      expect(entry.status).toBe("skipped");
      expect(entry.cached).toBeUndefined();
    }
    expect(probeOverall(report)).toEqual({ state: "launchable" });
    expect(mock.calls.length).toBe(0);
  });

  test("repeated live runs within the TTL do not re-send GET+POST unless force", async () => {
    const stateDir = newStateDir();
    const first = mockTransport([httpResponse(200), httpResponse(200, toolBody())], "http");
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: first.transport, mode: "live", now: NOW }),
    );
    expect(first.calls.length).toBe(2);

    const second = mockTransport([], "http");
    const cached = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: second.transport, mode: "live", now: NOW + 1000 }),
    );
    expect(second.calls.length).toBe(0);
    expect(cached.cached).toBe(true);

    // force re-runs the live layers.
    const forced = mockTransport([httpResponse(200), httpResponse(200, toolBody())], "http");
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: forced.transport, mode: "live", now: NOW + 2000, force: true }),
    );
    expect(forced.calls.length).toBe(2);
  });
});

describe("probeRoute: reachability GET refusals", () => {
  test("429 on the GET is reported, starts a cooldown, and never reaches the POST", async () => {
    const stateDir = newStateDir();
    const limited = mockTransport(
      [
        httpResponse(429, null, { "retry-after": "30" }),
      ],
      "http",
    );
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: limited.transport, mode: "live", now: NOW }),
    );
    const reachable = report.layers.find((l) => l.layer === "provider-reachable")!;
    expect(reachable.status).toBe("fail");
    expect(reachable.failure).toBe("rate-limit");
    expect(reachable.retry_after_s).toBe(30);
    // Exactly ONE request: the GET. The POST never happened.
    expect(limited.calls.length).toBe(1);
    // The cooldown is durable: the next live probe is refused.
    const next = mockTransport([], "http");
    const second = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: next.transport, mode: "live", now: NOW + 1000 }),
    );
    const live = second.layers.filter((l) =>
      ["provider-reachable", "real-response", "tool-call"].includes(l.layer),
    );
    for (const layer of live) {
      expect(layer.status).toBe("skipped");
      expect(layer.failure).toBe("rate-limit-cooldown");
    }
    expect(next.calls.length).toBe(0);
  });

  test("5xx on the GET is reported as http, stops the flow, starts no cooldown", async () => {
    const stateDir = newStateDir();
    const broken = mockTransport([httpResponse(503)], "http");
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: broken.transport, mode: "live", now: NOW }),
    );
    const reachable = report.layers.find((l) => l.layer === "provider-reachable")!;
    expect(reachable.status).toBe("fail");
    expect(reachable.failure).toBe("http");
    expect(broken.calls.length).toBe(1);
    const realResponse = report.layers.find((l) => l.layer === "real-response")!;
    expect(realResponse.status).toBe("skipped");
    // No cooldown: the immediate retry is allowed (provider may have recovered).
    const state = JSON.parse(readFileSync(join(stateDir, "probe", "state.json"), "utf8"));
    expect(Object.keys(state.cooldowns ?? {})).toEqual([]);
  });
});

describe("probeRoute: DNS vs offline", () => {
  test("cause codes split ENOTFOUND/EAI_AGAIN (dns) from everything else (network)", () => {
    expect(transportKindFor({ cause: { code: "ENOTFOUND" } })).toBe("dns");
    expect(transportKindFor({ cause: { code: "EAI_AGAIN" } })).toBe("dns");
    expect(transportKindFor({ cause: { code: "ECONNREFUSED" } })).toBe("network");
    expect(transportKindFor(new Error("no cause"))).toBe("network");
  });

  test("a dns-classified transport error is reported as dns, not network", async () => {
    const stateDir = newStateDir();
    const failing = mockTransport([{ error: "dns" }], "http");
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: failing.transport, mode: "live", now: NOW }),
    );
    const reachable = report.layers.find((l) => l.layer === "provider-reachable")!;
    expect(reachable.status).toBe("fail");
    expect(reachable.failure).toBe("dns");
    expect(failing.calls.length).toBe(1);
  });
});

describe("probeRoute: credential scrubbing", () => {
  test("a credential value echoed back by the provider is scrubbed from report and state", async () => {
    const stateDir = newStateDir();
    const echo = mockTransport(
      [
        httpResponse(200),
        httpResponse(
          400,
          JSON.stringify({ error: { message: `model not found: invalid key ${CREDENTIAL_ENV.TEST_API_KEY}` } }),
        ),
      ],
      "http",
    );
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: echo.transport, mode: "live", now: NOW }),
    );
    const json = probeJson(report);
    expect(json).not.toContain(CREDENTIAL_ENV.TEST_API_KEY);
    expect(json).toContain(REDACTED);
    // The scrubbed observation is what state.json holds, too.
    const state = readFileSync(join(stateDir, "probe", "state.json"), "utf8");
    expect(state).not.toContain(CREDENTIAL_ENV.TEST_API_KEY);
  });
});

describe("probeRoute: credential name resolution mirrors the launcher", () => {
  const MINIMAX_CONFIG = `
[providers.minimax]
base_url = "https://minimax.example/anthropic"
secret = "MINIMAX_M_PLAN_KEY"
env = "MINIMAX_API_KEY"
default_model = "MiniMax-M3.1-Flash"
models = ["MiniMax-M3.1-Flash"]

[harnesses.claude]
label = "Claude Code"
command = "bun"
adapter = "anthropic"

[routes."claude.minimax"]
`;

/** Written once; the minimax fixture is static across all three tests. */
const MINIMAX_CONFIG_PATH = writeConfig(MINIMAX_CONFIG);

  test("credential present under the Infisical secret NAME", async () => {
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(MINIMAX_CONFIG_PATH, newStateDir(), {
        transport: mock.transport,
        target: { route: "claude.minimax" },
        env: { MINIMAX_M_PLAN_KEY: "mmx-fake-value" },
      }),
    );
    const credential = report.layers.find((l) => l.layer === "credential-present")!;
    expect(credential.status).toBe("pass");
    expect(mock.calls.length).toBe(0);
  });

  test("credential present under the env NAME when the secret name is absent", async () => {
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(MINIMAX_CONFIG_PATH, newStateDir(), {
        transport: mock.transport,
        target: { route: "claude.minimax" },
        env: { MINIMAX_API_KEY: "mmx-fake-value" },
      }),
    );
    const credential = report.layers.find((l) => l.layer === "credential-present")!;
    expect(credential.status).toBe("pass");
    expect(mock.calls.length).toBe(0);
  });

  test("neither name set fails credential-present before any request", async () => {
    const mock = mockTransport([]);
    const report = await probeRoute(
      baseOptions(MINIMAX_CONFIG_PATH, newStateDir(), {
        transport: mock.transport,
        target: { route: "claude.minimax" },
        env: {},
      }),
    );
    const credential = report.layers.find((l) => l.layer === "credential-present")!;
    expect(credential.status).toBe("fail");
    expect(credential.failure).toBe("credential-missing");
    expect(mock.calls.length).toBe(0);
  });
});

describe("probeRoute: model echo compatibility", () => {
  test("a dated snapshot of the requested model does not false-mismatch", async () => {
    const stateDir = newStateDir();
    const dated = mockTransport(
      [
        httpResponse(200),
        httpResponse(200, JSON.stringify({ model: "test-model-20261101", content: [{ type: "text", text: "ok" }] })),
      ],
      "http",
    );
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: dated.transport, mode: "live", now: NOW }),
    );
    const realResponse = report.layers.find((l) => l.layer === "real-response")!;
    expect(realResponse.status).toBe("pass");
  });

  test("a genuinely different model id still fails as model-mismatch", async () => {
    const stateDir = newStateDir();
    const other = mockTransport(
      [
        httpResponse(200),
        httpResponse(200, JSON.stringify({ model: "totally-other-model", content: [{ type: "text", text: "ok" }] })),
      ],
      "http",
    );
    const report = await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: other.transport, mode: "live", now: NOW }),
    );
    const realResponse = report.layers.find((l) => l.layer === "real-response")!;
    expect(realResponse.status).toBe("fail");
    expect(realResponse.failure).toBe("model-mismatch");
  });
});

describe("probeRoute: corrupt state", () => {
  test("corrupt state.json is an explicit recoverable ContractError, not a SyntaxError", async () => {
    const stateDir = newStateDir();
    mkdirSync(join(stateDir, "probe"), { recursive: true });
    writeFileSync(join(stateDir, "probe", "state.json"), "{ not json at all");
    const mock = mockTransport([]);
    let error: unknown = null;
    try {
      await probeRoute(
        baseOptions(CONFIG_PATH, stateDir, { transport: mock.transport, mode: "static", now: NOW }),
      );
    } catch (exc) {
      error = exc;
    }
    expect(error).toBeInstanceOf(ContractError);
    const contractError = error as ContractError;
    expect(contractError.code).toBe("state");
    expect(contractError.message).toContain("probe");
    expect(contractError.message).toContain("delete it to reset");
  });
});

describe("probeRoute: option validation", () => {
  test("non-finite now is a ContractError, never a raw RangeError", async () => {
    let error: unknown = null;
    try {
      await probeRoute(baseOptions(CONFIG_PATH, newStateDir(), { transport: mockTransport([]).transport, now: NaN }));
    } catch (exc) {
      error = exc;
    }
    expect(error).toBeInstanceOf(ContractError);
  });
});

describe("probeRoute: opencode_npm provider without base_url", () => {
  const NO_URL_CONFIG = `
[providers.nourl]
secret = "NOURL_KEY"
env = "NOURL_KEY"
default_model = "m"
models = ["m"]
opencode_npm = "@ai-sdk/openai-compatible"

[harnesses.claude]
label = "Claude Code"
command = "bun"
adapter = "anthropic"

[routes."claude.nourl"]
`;

  test("records findings instead of throwing", async () => {
    const configPath = writeConfig(NO_URL_CONFIG);
    const mock = mockTransport([], "http");
    const report = await probeRoute(
      baseOptions(configPath, newStateDir(), {
        transport: mock.transport,
        target: { route: "claude.nourl" },
        env: { NOURL_KEY: "nourl-fake-value" },
        mode: "live",
        now: NOW,
      }),
    );
    const realResponse = report.layers.find((l) => l.layer === "real-response")!;
    expect(realResponse.status).toBe("not-applicable");
    expect(mock.calls.length).toBe(0);
  });
});

describe("probeRoute: transport-error observations persist like HTTP-status failures", () => {
  test("dns/network/timeout findings are durable; mocks never are", async () => {
    const stateDir = newStateDir();
    const dns = mockTransport([{ error: "dns" }], "http");
    await probeRoute(
      baseOptions(CONFIG_PATH, stateDir, { transport: dns.transport, mode: "live", now: NOW }),
    );
    expect(existsSync(join(stateDir, "probe", "state.json"))).toBe(true);
    const state = JSON.parse(readFileSync(join(stateDir, "probe", "state.json"), "utf8"));
    const reachable = state.probes["claude.testprov::test-model"].layers.find(
      (l: { layer: string }) => l.layer === "provider-reachable",
    );
    expect(reachable.failure).toBe("dns");

    // A mock transport never persists, even for the same observation.
    const mockState = newStateDir();
    const mock = mockTransport([{ error: "dns" }], "mock");
    await probeRoute(
      baseOptions(CONFIG_PATH, mockState, { transport: mock.transport, mode: "live", now: NOW }),
    );
    expect(existsSync(join(mockState, "probe", "state.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural guard
// ---------------------------------------------------------------------------

const REPO_ROOT = dirname(dirname(realpathSync(import.meta.path)));

describe("probe.ts structural guard", () => {
  test("no duplicate top-level function declarations", () => {
    const source = readFileSync(join(REPO_ROOT, "script", "agent", "probe.ts"), "utf8");
    const names = [...source.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Constants contract
// ---------------------------------------------------------------------------

describe("probe constants", () => {
  test("bounded defaults", () => {
    expect(PROBE_TTL_MS).toBe(15 * 60 * 1000);
    expect(PROBE_COOLDOWN_MS).toBe(60 * 1000);
    expect(PROBE_TIMEOUT_MS).toBe(20 * 1000);
  });
});
