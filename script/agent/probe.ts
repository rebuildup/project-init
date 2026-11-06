#!/usr/bin/env bun
/**
 * Provider/route readiness and real-response probes (issue #90, Epic #86 T004).
 *
 * Treats readiness as DISTINCT states instead of a single "works" bit:
 *
 *   configured        — route/harness/provider/model resolve from agents.toml
 *   credential-present — the provider's Infisical-injected env var is set in
 *                        this process (NAME only; the value is never read
 *                        into diagnostics)
 *   launchable        — the harness command resolves on PATH (no launch)
 *   provider-reachable — any HTTP response from the provider base URL
 *                        (live only, opt-in)
 *   real-response     — one bounded completion request was answered by the
 *                       requested model (live only, opt-in)
 *   tool-call         — that response used the probe tool (live only, opt-in)
 *
 * Non-negotiable rules (issue #90):
 *   - Opt-in and bounded: static checks are network-free; live checks run
 *     only with mode "live", make at most ONE reachability GET and ONE
 *     completion request with a small max_tokens, under a hard timeout.
 *   - Rate-limit aware: a live probe is refused while a rate-limit cooldown
 *     (observed 429 + Retry-After, or the default cooldown) is active for
 *     the route's quota scope (from the #89 catalog), and while the catalog
 *     records an observed restriction for the route/provider.
 *   - Secrets never appear in reports, state or logs. Credentials come from
 *     the process environment (Infisical process-scoped injection via the
 *     existing `script/with-secrets` wrapper — run
 *     `script/with-secrets bun <cli> probe ...` once the CLI wires this
 *     module). Output always goes through `redactJson`.
 *   - NEVER switches provider/route/model on failure: a probe targets
 *     exactly one route and one model; failures are recorded and reported
 *     as-is. There is no retry, no fallback and no alternate target.
 *   - Live evidence and mocks are never conflated: every report records
 *     `mode` ("static"/"live") and `transport` ("http" for real network
 *     runs; tests inject a transport whose `kind` is "mock").
 *
 * State: last live observations are cached under
 * `agentStateDir()/probe/state.json` (redacted, envelope-wrapped, TTL-
 * bounded; this subpath is owned by #90 per ADR-0015). The cache is never
 * a source of truth: stale entries are reported as `stale`, never usable.
 * NOTE: there is no cross-process lock — two concurrent probe processes may
 * race on the state file (last writer wins); each run's own report is
 * unaffected.
 *
 * Network-free by default; the only network I/O is the opt-in live probe
 * through the transport. No process is launched and no existing launch
 * path is touched (script/agent.ts is owned by #88).
 *
 * Run: bun test script/agent.probe.test.ts
 */

import { mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CONTRACT_VERSION,
  ContractError,
  REDACTED,
  agentStateDir,
  isPlainObject,
  isStale,
  parseEnvelope,
  parseModelId,
  parseRouteId,
  redactJson,
  requireStr,
  stringList,
  type Evidence,
} from "./contract";
import { effectiveQuotaKey, loadCatalog, type Catalog } from "./catalog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cached live results older than this are reported as `stale`. */
export const PROBE_TTL_MS = 15 * 60 * 1000;

/** Default live-probe refusal window after an observed rate limit. */
export const PROBE_COOLDOWN_MS = 60 * 1000;

/** Hard per-request timeout for the default HTTP transport. */
export const PROBE_TIMEOUT_MS = 20 * 1000;

/** Upper bound for an honored Retry-After (an hour; never unbounded). */
const MAX_COOLDOWN_MS = 60 * 60 * 1000;

/** max_tokens for the one real-response request: deliberately tiny. */
const PROBE_MAX_TOKENS = 16;

/** Subpath of `agentStateDir()` owned by this module (ADR-0015, #90). */
const STATE_SUBPATH = join("probe", "state.json");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The distinct readiness layers, in evaluation order. */
export type ProbeLayer =
  | "configured"
  | "credential-present"
  | "launchable"
  | "provider-reachable"
  | "real-response"
  | "tool-call";

/** Outcome of one layer. `stale` = observed before, outside the TTL. */
export type ProbeLayerStatus = "pass" | "fail" | "stale" | "skipped" | "not-applicable";

/** The distinct readiness layers, in evaluation order. */
export const PROBE_LAYERS: readonly ProbeLayer[] = [
  "configured",
  "credential-present",
  "launchable",
  "provider-reachable",
  "real-response",
  "tool-call",
];

/** Valid statuses for a layer result (state validation vocabulary). */
export const PROBE_LAYER_STATUSES: readonly ProbeLayerStatus[] = [
  "pass",
  "fail",
  "stale",
  "skipped",
  "not-applicable",
];

/**
 * Machine-readable failure classification. `rate-limit-cooldown` and
 * `restricted` mark probes that were REFUSED (no request sent), which is
 * different from an observed provider refusal.
 */
export type ProbeFailureKind =
  | "config"
  | "model-mismatch"
  | "credential-missing"
  | "not-launchable"
  | "dns"
  | "network"
  | "timeout"
  | "auth"
  | "payment"
  | "forbidden"
  | "rate-limit"
  | "rate-limit-cooldown"
  | "restricted"
  | "no-tool-call"
  | "unsupported-wire"
  | "http";

export interface ProbeLayerResult {
  layer: ProbeLayer;
  status: ProbeLayerStatus;
  failure?: ProbeFailureKind;
  /** HTTP status when a response was received. */
  http_status?: number;
  /** Seconds requested by the provider's Retry-After (429 only). */
  retry_after_s?: number;
  /** Non-secret human context. */
  detail?: string;
  evidence: Evidence | null;
  /** True when taken from the TTL cache instead of run now. */
  cached?: boolean;
}

/** Diagnostic report for ONE route + model. Never contains secret values. */
export interface ProbeReport {
  contract_version: string;
  source: "probe";
  route: string;
  model: string;
  mode: "static" | "live";
  /** "http" for real network runs; injected test transports declare their own. */
  transport: string;
  /** ISO 8601 UTC time of this probe run. */
  time: string;
  duration_ms: number;
  /** Shared-allowance key (`quotaScopeKey`) or null when unknown. */
  quota_scope: string | null;
  layers: ProbeLayerResult[];
  /** True when any layer came from the TTL cache. */
  cached: boolean;
}

/**
 * Overall readiness: the deepest passing layer, or the failure that stopped
 * the probe. `stale` means the only evidence for deeper layers is outside
 * the TTL — unknown, not passing.
 */
export type ProbeOverall =
  | { state: "failed"; layer: ProbeLayer; failure: ProbeFailureKind }
  | { state: "stale"; layer: ProbeLayer }
  | { state: ProbeLayer };

// ---------------------------------------------------------------------------
// Transport (injection point for deterministic tests)
// ---------------------------------------------------------------------------

export interface ProbeTransportResponse {
  http_status: number;
  /** Lowercase header names. */
  headers: Record<string, string>;
  body: string | null;
}

export interface ProbeTransport {
  /** Kind label recorded in the report ("http"; tests use "mock"). */
  kind: string;
  fetch(url: string, init: RequestInit): Promise<ProbeTransportResponse>;
}

/** Transport failure with a machine-readable kind. */
export class ProbeTransportError extends Error {
  kind: "timeout" | "network" | "dns";

  constructor(kind: "timeout" | "network" | "dns", message: string) {
    super(message);
    this.name = "ProbeTransportError";
    this.kind = kind;
  }
}

/**
 * Split DNS failure from offline/unreachable when the runtime exposes the
 * cause code (Node/Bun fetch wraps socket errors in `error.cause`).
 * Distinguishable cases get their own failure kind; everything else stays
 * "network" — never guessed.
 */
export function transportKindFor(exc: unknown): "timeout" | "network" | "dns" {
  const cause = (exc as Error & { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  return "network";
}

/**
 * Real HTTP transport: hard timeout, redirects refused (a probe must not
 * silently follow to another endpoint), any HTTP status is returned as-is
 * (reachability is about getting A response, not a 200).
 */
export function httpTransport(timeoutMs: number): ProbeTransport {
  return {
    kind: "http",
    async fetch(url, init) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (exc) {
        const name = (exc as Error)?.name ?? "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new ProbeTransportError("timeout", `request timed out after ${timeoutMs}ms: ${url}`);
        }
        throw new ProbeTransportError(transportKindFor(exc), `request failed: ${(exc as Error)?.message ?? exc}`);
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const body = await response.text();
      return { http_status: response.status, headers, body };
    },
  };
}

// ---------------------------------------------------------------------------
// Config (minimal additive read of the launcher-owned tables)
// ---------------------------------------------------------------------------

export interface ProbeProviderConfig {
  key: string;
  base_url: string | null;
  /** Infisical secret NAME (never a value). */
  secret: string | null;
  /** Environment variable NAME the credential is injected under. */
  env: string | null;
  default_model: string | null;
  models: string[];
  opencode_npm: string | null;
}

export interface ProbeHarnessConfig {
  key: string;
  command: string;
  adapter: string;
}

export interface ProbeRouteConfig {
  default_model: string | null;
  models: string[] | null;
}

export interface ProbeConfig {
  path: string;
  providers: Record<string, ProbeProviderConfig>;
  harnesses: Record<string, ProbeHarnessConfig>;
  routes: Record<string, ProbeRouteConfig>;
}

/**
 * Read the `[providers.*]` / `[harnesses.*]` / `[routes.*]` tables needed
 * to resolve a probe target. Field names mirror `script/agent.ts`; only
 * probe-relevant fields are read and secret VALUES cannot appear (config
 * carries names only, enforced repo-wide).
 */
export function loadProbeConfig(configFile?: string): ProbeConfig {
  const path = configFile ?? probeConfigPath();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ContractError("schema", `config not found: ${path}`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = Bun.TOML.parse<Record<string, unknown>>(text);
  } catch (exc) {
    throw new ContractError("schema", `invalid TOML in ${path}: ${exc}`);
  }

  const providers: Record<string, ProbeProviderConfig> = {};
  const rawProviders = raw["providers"] ?? {};
  if (!isPlainObject(rawProviders)) throw new ContractError("schema", `${path}: providers must be a table`);
  for (const [key, entry] of Object.entries(rawProviders)) {
    if (!isPlainObject(entry)) throw new ContractError("schema", `providers.'${key}': table expected`);
    const models = Array.isArray(entry["models"])
      ? stringList(entry["models"], `providers.'${key}'`, "models")
      : [];
    providers[key] = {
      key,
      base_url: optionalName(entry["base_url"], `providers.'${key}'.base_url`),
      secret: optionalName(entry["secret"], `providers.'${key}'.secret`),
      env: optionalName(entry["env"], `providers.'${key}'.env`),
      default_model: optionalName(entry["default_model"], `providers.'${key}'.default_model`),
      models,
      opencode_npm: optionalName(entry["opencode_npm"], `providers.'${key}'.opencode_npm`),
    };
  }

  const harnesses: Record<string, ProbeHarnessConfig> = {};
  const rawHarnesses = raw["harnesses"] ?? {};
  if (!isPlainObject(rawHarnesses)) throw new ContractError("schema", `${path}: harnesses must be a table`);
  for (const [key, entry] of Object.entries(rawHarnesses)) {
    if (!isPlainObject(entry)) throw new ContractError("schema", `harnesses.'${key}': table expected`);
    harnesses[key] = {
      key,
      command: requireStr(entry, "command", `harnesses.'${key}'`),
      adapter: requireStr(entry, "adapter", `harnesses.'${key}'`),
    };
  }

  const routes: Record<string, ProbeRouteConfig> = {};
  const rawRoutes = raw["routes"] ?? {};
  if (!isPlainObject(rawRoutes)) throw new ContractError("schema", `${path}: routes must be a table`);
  for (const [key, entry] of Object.entries(rawRoutes)) {
    parseRouteId(key);
    if (!isPlainObject(entry)) throw new ContractError("schema", `routes.'${key}': table expected`);
    routes[key] = {
      default_model: optionalName(entry["default_model"], `routes.'${key}'.default_model`),
      models: Array.isArray(entry["models"])
        ? stringList(entry["models"], `routes.'${key}'`, "models")
        : null,
    };
  }

  return { path, providers, harnesses, routes };
}

function probeConfigPath(): string {
  return process.env.AGENT_CONFIG || join(repoRoot(), "config", "agents.toml");
}

function repoRoot(): string {
  return dirname(dirname(dirname(realpathSync(import.meta.path))));
}

/** Non-empty string or null; a secret NAME is the same shape as any key. */
function optionalName(raw: unknown, where: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !raw) {
    throw new ContractError("schema", `${where}: must be a non-empty string when present`);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Wire formats
// ---------------------------------------------------------------------------

type Wire = "anthropic" | "openai";

/**
 * Which HTTP wire a live probe can speak for this route. Only wires the
 * probe can faithfully reproduce are supported; everything else is
 * `not-applicable` / `unsupported-wire` — never approximated.
 */
function wireFor(provider: ProbeProviderConfig, harness: ProbeHarnessConfig): Wire | null {
  if (provider.opencode_npm) return "openai"; // OpenAI-compatible custom provider
  if (harness.adapter === "anthropic" && provider.base_url) return "anthropic";
  return null;
}

const PROBE_PROMPT = "Reply with exactly: ok";
const PROBE_TOOL_NAME = "probe_ping";
const PROBE_TOOL_DESCRIPTION = "No-op probe tool; call it to confirm tool use works.";

function buildRequest(
  wire: Wire,
  baseUrl: string,
  model: string,
  credential: string,
): { url: string; init: RequestInit } {
  const base = baseUrl.replace(/\/+$/, "");
  if (wire === "anthropic") {
    return {
      url: `${base}/v1/messages`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": credential,
          "authorization": `Bearer ${credential}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: PROBE_MAX_TOKENS,
          messages: [{ role: "user", content: PROBE_PROMPT }],
          tools: [
            {
              name: PROBE_TOOL_NAME,
              description: PROBE_TOOL_DESCRIPTION,
              input_schema: { type: "object", properties: {} },
            },
          ],
        }),
      },
    };
  }
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${credential}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: "user", content: PROBE_PROMPT }],
        tools: [
          {
            type: "function",
            function: {
              name: PROBE_TOOL_NAME,
              description: PROBE_TOOL_DESCRIPTION,
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      }),
    },
  };
}

interface ResponseAnalysis {
  shape_ok: boolean;
  tool_call: boolean;
  model_echo: string | null;
}

function analyzeResponse(wire: Wire, body: string | null): ResponseAnalysis {
  const none: ResponseAnalysis = { shape_ok: false, tool_call: false, model_echo: null };
  if (!body) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return none;
  }
  if (!isPlainObject(parsed)) return none;
  if (wire === "anthropic") {
    const content = parsed["content"];
    if (!Array.isArray(content)) return none;
    return {
      shape_ok: true,
      tool_call: content.some(
        (block) => isPlainObject(block) && block["type"] === "tool_use",
      ),
      model_echo: typeof parsed["model"] === "string" ? parsed["model"] : null,
    };
  }
  const choices = parsed["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return none;
  const message = choices[0];
  if (!isPlainObject(message) || !isPlainObject(message["message"])) return none;
  const msg = message["message"] as Record<string, unknown>;
  return {
    shape_ok: true,
    tool_call: Array.isArray(msg["tool_calls"]) && msg["tool_calls"].length > 0,
    model_echo: typeof parsed["model"] === "string" ? parsed["model"] : null,
  };
}

/**
 * Model echo compatibility: a provider may answer with a dated/suffixed
 * snapshot of the requested model ("glm-5.3" requested, "glm-5.3-20261101"
 * answered) or the reverse. Prefix-compatible ids in EITHER direction match;
 * a separator must follow the prefix so "glm-5.3" never matches "glm-5.35".
 */
function modelEchoMatches(echo: string, model: string): boolean {
  if (echo === model) return true;
  const sepPrefixed = (long: string, short: string): boolean =>
    long.startsWith(short) && /^[-@:./_]/.test(long.slice(short.length));
  return sepPrefixed(echo, model) || sepPrefixed(model, echo);
}

/** Classify a non-2xx provider response; null means 2xx (handled elsewhere). */
function classifyFailure(status: number, body: string | null): { failure: ProbeFailureKind; detail: string } {
  if (status === 401) return { failure: "auth", detail: "HTTP 401: credential rejected" };
  if (status === 402) return { failure: "payment", detail: "HTTP 402: payment/allowance required" };
  if (status === 403) return { failure: "forbidden", detail: "HTTP 403: forbidden" };
  if (status === 429) return { failure: "rate-limit", detail: "HTTP 429: rate limited" };
  if (status === 400 || status === 404) {
    let message = "";
    try {
      const parsed = JSON.parse(body ?? "") as unknown;
      if (isPlainObject(parsed) && isPlainObject(parsed["error"])) {
        message = String((parsed["error"] as Record<string, unknown>)["message"] ?? "");
      }
    } catch {
      // non-JSON error body: fall through to generic 4xx
    }
    if (/model/i.test(message)) {
      return { failure: "model-mismatch", detail: `HTTP ${status}: model rejected: ${message}` };
    }
  }
  return { failure: "http", detail: `HTTP ${status} from provider` };
}

// ---------------------------------------------------------------------------
// Probe state (TTL cache + rate-limit cooldowns; redacted, non-secret)
// ---------------------------------------------------------------------------

interface CachedProbe {
  route: string;
  model: string;
  mode: "live";
  /** Transport kind that produced the observation ("http" for real runs). */
  transport: string;
  time: string;
  quota_scope: string | null;
  layers: ProbeLayerResult[];
}

interface ProbeState {
  probes: Record<string, CachedProbe>;
  /** quota scope (or route) -> ISO time until which live probes are refused. */
  cooldowns: Record<string, string>;
}

const STATE_PAYLOAD_FIELDS = ["probes", "cooldowns"] as const;

function statePath(stateDir: string): string {
  return join(stateDir, STATE_SUBPATH);
}

/**
 * Load the probe cache. A corrupt state file is an EXPLICIT recoverable
 * error (ContractError, code "state"): the caller resets it by deleting
 * the file — it is never silently ignored (false greens) and never a raw
 * SyntaxError.
 */
function loadProbeState(stateDir: string): ProbeState {
  let text: string;
  try {
    text = readFileSync(statePath(stateDir), "utf8");
  } catch {
    return { probes: {}, cooldowns: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (exc) {
    throw new ContractError(
      "state",
      `probe state at ${statePath(stateDir)} is corrupt (delete it to reset): ${(exc as Error).message}`,
    );
  }
  const envelope = parseEnvelope(parsed, STATE_PAYLOAD_FIELDS, "probe state");
  const state: ProbeState = { probes: {}, cooldowns: {} };
  if (isPlainObject(envelope.payload["probes"])) {
    for (const [key, entry] of Object.entries(envelope.payload["probes"] as Record<string, unknown>)) {
      if (!isPlainObject(entry)) {
        throw new ContractError(
          "state",
          `probe state at ${statePath(stateDir)} is corrupt: probes.'${key}' must be an object`,
        );
      }
      state.probes[key] = {
        route: requireStr(entry, "route", `probe state probes.'${key}'`),
        model: requireStr(entry, "model", `probe state probes.'${key}'`),
        mode: "live",
        time: requireStr(entry, "time", `probe state probes.'${key}'`),
        quota_scope: typeof entry["quota_scope"] === "string" ? entry["quota_scope"] : null,
        transport: typeof entry["transport"] === "string" ? entry["transport"] : "unknown",
        layers: validateCachedLayers(entry["layers"], `probe state probes.'${key}'`),
      };
    }
  }
  if (isPlainObject(envelope.payload["cooldowns"])) {
    for (const [key, until] of Object.entries(envelope.payload["cooldowns"] as Record<string, unknown>)) {
      if (typeof until === "string") state.cooldowns[key] = until;
    }
  }
  return state;
}

/** Validate cached layer entries against the known layer/status vocabulary. */
function validateCachedLayers(raw: unknown, where: string): ProbeLayerResult[] {
  if (!Array.isArray(raw)) {
    throw new ContractError("state", `${where}: layers must be an array`);
  }
  return raw.map((entry) => {
    if (!isPlainObject(entry)) {
      throw new ContractError("state", `${where}: layer entry must be an object`);
    }
    const layer = entry["layer"];
    const status = entry["status"];
    if (typeof layer !== "string" || !PROBE_LAYERS.includes(layer as ProbeLayer)) {
      throw new ContractError("state", `${where}: unknown layer '${String(layer)}'`);
    }
    if (typeof status !== "string" || !PROBE_LAYER_STATUSES.includes(status as ProbeLayerStatus)) {
      throw new ContractError("state", `${where}: unknown status '${String(status)}' for layer '${layer}'`);
    }
    return entry as ProbeLayerResult;
  });
}

function saveProbeState(stateDir: string, state: ProbeState): void {
  const path = statePath(stateDir);
  mkdirSync(dirname(path), { recursive: true });
  const envelope = {
    contract_version: CONTRACT_VERSION,
    probes: state.probes,
    cooldowns: state.cooldowns,
  };
  // Mandatory last step before persisting: never write unredacted state.
  writeFileSync(path, redactJson(envelope) + "\n");
}

function cacheKey(routeId: string, model: string): string {
  return `${routeId}::${model}`;
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

export interface ProbeTarget {
  /** Canonical route id `<harness>.<provider>`. Exactly one — never a list, never a fallback chain. */
  route: string;
  /** Model id; defaults to route/provider default_model. */
  model?: string | null;
}

export interface ProbeOptions {
  target: ProbeTarget;
  /** "static" (default): network-free. "live": opt-in bounded network checks. */
  mode?: "static" | "live";
  /** Ignore cached live results and run the live layers now. */
  force?: boolean;
  /** Cache freshness window; default PROBE_TTL_MS. */
  ttlMs?: number;
  /** Rate-limit refusal window; default PROBE_COOLDOWN_MS. */
  cooldownMs?: number;
  /** Per-request timeout for the default HTTP transport; default PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Injected transport (tests); default httpTransport(timeoutMs). */
  transport?: ProbeTransport;
  /** agents.toml path; default AGENT_CONFIG or repo config. */
  configFile?: string;
  /** State directory; default agentStateDir(). */
  stateDir?: string;
  /** Environment to inspect for credentials; default process.env. */
  env?: Record<string, string | undefined>;
  /** Reference clock (ms epoch); default Date.now(). */
  now?: number;
  /** PATH resolver; default Bun.which. */
  which?: (command: string) => string | null;
}

/**
 * Probe exactly one route (+model) and return a redaction-safe report.
 * Never throws for probe findings (failures are recorded in the report);
 * throws ContractError only for invalid input/config/state.
 */
export async function probeRoute(options: ProbeOptions): Promise<ProbeReport> {
  const started = Date.now();
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) {
    throw new ContractError("schema", "options.now must be a finite number");
  }
  const mode = options.mode ?? "static";
  const ttlMs = options.ttlMs ?? PROBE_TTL_MS;
  const cooldownMs = options.cooldownMs ?? PROBE_COOLDOWN_MS;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const transport = options.transport ?? httpTransport(timeoutMs);
  const env = options.env ?? process.env;
  const which = options.which ?? ((command: string) => Bun.which(command));
  const stateDir = options.stateDir ?? agentStateDir();
  const at = new Date(now).toISOString();
  const config = loadProbeConfig(options.configFile);

  const layers: ProbeLayerResult[] = [];
  const add = (layer: ProbeLayerResult): void => {
    layers.push(layer);
  };
  let credential = "";
  /** Credential VALUES seen this run; scrubbed from every output/state write. */
  const secrets: string[] = [];
  let model = "";
  let provider: ProbeProviderConfig | null = null;
  let harness: ProbeHarnessConfig | null = null;
  let baseUrl: string | null = null;
  let wire: Wire | null = null;
  let quotaScope: string | null = null;

  // -- configured ----------------------------------------------------------
  const ref = parseRouteId(options.target.route);
  provider = config.providers[ref.provider] ?? null;
  harness = config.harnesses[ref.harness] ?? null;
  const routeCfg = config.routes[options.target.route] ?? null;
  if (!provider || !harness || !routeCfg) {
    add({
      layer: "configured",
      status: "fail",
      failure: "config",
      detail: !provider
        ? `unknown provider '${ref.provider}'`
        : !harness
          ? `unknown harness '${ref.harness}'`
          : `route '${options.target.route}' is not declared in [routes]`,
      evidence: { at, source: "config", note: "static config check" },
    });
    return finish(skippedAll(layers, "upstream configured check failed"), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  const effectiveModels = routeCfg.models ?? provider.models;
  const requested = options.target.model ?? routeCfg.default_model ?? provider.default_model;
  if (!requested) {
    add({
      layer: "configured",
      status: "fail",
      failure: "config",
      detail: "route requires an explicit model (no default_model declared)",
      evidence: { at, source: "config", note: "static config check" },
    });
    return finish(skippedAll(layers, "upstream configured check failed"), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }
  model = parseModelId(requested);
  if (effectiveModels.length > 0 && !effectiveModels.includes(model)) {
    add({
      layer: "configured",
      status: "fail",
      failure: "model-mismatch",
      detail: `model '${model}' is not in the route allowlist [${effectiveModels.join(", ")}]`,
      evidence: { at, source: "config", note: "static config check" },
    });
    return finish(skippedAll(layers, "upstream configured check failed"), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }
  baseUrl = provider.base_url;
  wire = wireFor(provider, harness);
  add({
    layer: "configured",
    status: "pass",
    detail: `route '${options.target.route}', harness '${harness.key}', provider '${provider.key}', model '${model}'`,
    evidence: { at, source: "config", note: "static config check" },
  });

  // -- credential-present --------------------------------------------------
  // Mirror the launcher (script/agent.ts ~1196-1204): the credential env
  // NAME is `provider.env || provider.secret` and the Infisical secret NAME
  // is `provider.secret || provider.env` — the credential is present when
  // EITHER name is set in this process. Values are never recorded.
  const envName = provider.env || provider.secret;
  const secretName = provider.secret || provider.env;
  if (!provider.secret && !provider.env) {
    add({
      layer: "credential-present",
      status: "not-applicable",
      detail: "provider declares no credential",
      evidence: { at, source: "config", note: "static config check" },
    });
  } else {
    const value = env[envName!] ?? env[secretName!];
    if (value === undefined || value === "") {
      add({
        layer: "credential-present",
        status: "fail",
        failure: "credential-missing",
        detail: `credential env ${envName} is not set in this process (inject via script/with-secrets)`,
        evidence: { at, source: "probe", note: "process env checked by NAME only" },
      });
      return finish(skippedAll(layers, "upstream credential check failed"), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
    }
    credential = value; // used only to build request headers; never recorded
    secrets.push(value);
    add({
      layer: "credential-present",
      status: "pass",
      detail: `credential env ${envName} present`,
      evidence: { at, source: "probe", note: "process env checked by NAME only" },
    });
  }

  // -- launchable ----------------------------------------------------------
  const commandPath = which(harness.command);
  add({
    layer: "launchable",
    status: commandPath ? "pass" : "fail",
    failure: commandPath ? undefined : "not-launchable",
    detail: commandPath
      ? `harness command '${harness.command}' found on PATH`
      : `harness command '${harness.command}' not found on PATH`,
    evidence: { at, source: "probe", note: "PATH lookup only; no process launched" },
  });

  // -- quota scope (from the #89 catalog, when present) ---------------------
  quotaScope = loadQuotaScope(options.configFile, options.target.route);

  // -- live layers ---------------------------------------------------------
  const liveLayers: ProbeLayer[] = ["provider-reachable", "real-response", "tool-call"];
  if (mode === "static") {
    for (const layer of liveLayers) {
      add({
        layer,
        status: "skipped",
        detail: "live probe not requested (mode 'static')",
        evidence: null,
      });
    }
    return finish(overlayCache(layers, options.target.route, model, options.force ?? false, stateDir, ttlMs, now), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  // mode === "live": opt-in, bounded, rate-limit-aware.
  const state = loadProbeState(stateDir);
  const cooldownKey = quotaScope ?? options.target.route;
  const cooldownUntil = Date.parse(state.cooldowns[cooldownKey] ?? "");
  if (state.cooldowns[cooldownKey] !== undefined && !Number.isFinite(cooldownUntil)) {
    // Fail closed: an unparseable cooldown is treated as active and reported.
    for (const layer of liveLayers) {
      add({
        layer,
        status: "skipped",
        failure: "rate-limit-cooldown",
        detail: `live probe refused: unparseable cooldown timestamp '${state.cooldowns[cooldownKey]}' is treated as active (delete the probe state file to reset)`,
        evidence: { at, source: "probe", note: "no request sent" },
      });
    }
    return finish(layers, options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }
  if (Number.isFinite(cooldownUntil) && cooldownUntil > now) {
    for (const layer of liveLayers) {
      add({
        layer,
        status: "skipped",
        failure: "rate-limit-cooldown",
        detail: `live probe refused: rate-limit cooldown active until ${state.cooldowns[cooldownKey]}`,
        evidence: { at, source: "probe", note: "no request sent" },
      });
    }
    return finish(layers, options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  // Live mode honours the TTL: a fresh cached observation is served without
  // touching the network unless force is set. Only http-transport evidence is
  // eligible — mock/non-http cache entries never drive a live probe.
  if (!(options.force ?? false)) {
    const cached = loadCachedLive(stateDir, options.target.route, model);
    if (cached && cached.transport === "http" && !isStale({ at: cached.time, source: "probe" }, now, ttlMs)) {
      return finish(cached.layers.map((l) => ({ ...l, cached: true })), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
    }
  }

  const restriction = loadRestriction(options.configFile, options.target.route, ref.provider);
  if (restriction) {
    for (const layer of liveLayers) {
      add({
        layer,
        status: "skipped",
        failure: "restricted",
        detail: `live probe refused: observed restriction in catalog (${restriction})`,
        evidence: { at, source: "probe", note: "no request sent" },
      });
    }
    return finish(layers, options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  let live: ProbeLayerResult[] = [];
  // -- provider-reachable --------------------------------------------------
  if (!baseUrl) {
    live.push({
      layer: "provider-reachable",
      status: "not-applicable",
      detail: "provider declares no base_url",
      evidence: { at, source: "config", note: "static config check" },
    });
  } else {
    try {
      const res = await transport.fetch(baseUrl, { method: "GET" });
      if (res.http_status === 429 || res.http_status >= 500) {
        // The provider answered but refused/broke: report it as such, start
        // a cooldown (429), and NEVER proceed to the completion request.
        const classified = classifyFailure(res.http_status, res.body);
        const layer: ProbeLayerResult = {
          layer: "provider-reachable",
          status: "fail",
          failure: classified.failure,
          http_status: res.http_status,
          detail: classified.detail,
          evidence: { at, source: "probe", note: classified.detail },
        };
        if (classified.failure === "rate-limit") {
          const retryAfter = parseRetryAfter(res.headers["retry-after"]);
          if (retryAfter !== null) {
            layer.retry_after_s = Math.round(retryAfter / 1000);
            layer.detail = `${classified.detail}; Retry-After ${layer.retry_after_s}s`;
          }
        }
        live.push(layer);
        live.push({
          layer: "real-response",
          status: "skipped",
          detail: "upstream provider-reachable check failed",
          evidence: null,
        });
        live.push({
          layer: "tool-call",
          status: "skipped",
          detail: "upstream provider-reachable check failed",
          evidence: null,
        });
        return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
      }
      live.push({
        layer: "provider-reachable",
        status: "pass",
        http_status: res.http_status,
        detail: `GET ${baseUrl} -> HTTP ${res.http_status}`,
        evidence: { at, source: "probe", note: "any non-refusing HTTP response proves reachability" },
      });
    } catch (exc) {
      live.push(transportFailure("provider-reachable", exc, at));
      live.push({
        layer: "real-response",
        status: "skipped",
        detail: "upstream provider-reachable check failed",
        evidence: null,
      });
      live.push({
        layer: "tool-call",
        status: "skipped",
        detail: "upstream provider-reachable check failed",
        evidence: null,
      });
      return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
    }
  }

  // -- real-response + tool-call -------------------------------------------
  if (!wire) {
    live.push({
      layer: "real-response",
      status: "not-applicable",
      failure: "unsupported-wire",
      detail: `no HTTP wire implemented for harness adapter '${harness.adapter}'; the probe never approximates a harness client`,
      evidence: { at, source: "config", note: "static config check" },
    });
    live.push({
      layer: "tool-call",
      status: "skipped",
      detail: "real-response check not applicable",
      evidence: null,
    });
    return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  if (!baseUrl) {
    // No endpoint to POST: record the finding instead of crashing.
    live.push({
      layer: "real-response",
      status: "not-applicable",
      failure: "config",
      detail: "provider declares no base_url; no completion request is possible",
      evidence: { at, source: "config", note: "static config check" },
    });
    live.push({
      layer: "tool-call",
      status: "skipped",
      detail: "real-response check not applicable",
      evidence: null,
    });
    return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  const request = buildRequest(wire, baseUrl, model, credential);
  let res: ProbeTransportResponse;
  try {
    res = await transport.fetch(request.url, request.init);
  } catch (exc) {
    live.push(transportFailure("real-response", exc, at));
    live.push({
      layer: "tool-call",
      status: "skipped",
      detail: "upstream real-response check failed",
      evidence: null,
    });
    return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  if (res.http_status < 200 || res.http_status >= 300) {
    const classified = classifyFailure(res.http_status, res.body);
    const layer: ProbeLayerResult = {
      layer: "real-response",
      status: "fail",
      failure: classified.failure,
      http_status: res.http_status,
      detail: classified.detail,
      evidence: { at, source: "probe", note: classified.detail },
    };
    if (classified.failure === "rate-limit") {
      const retryAfter = parseRetryAfter(res.headers["retry-after"]);
      if (retryAfter !== null) {
        layer.retry_after_s = Math.round(retryAfter / 1000);
        layer.detail = `${classified.detail}; Retry-After ${layer.retry_after_s}s`;
      }
    }
    live.push(layer);
    live.push({
      layer: "tool-call",
      status: "skipped",
      detail: "upstream real-response check failed",
      evidence: null,
    });
    return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  const analysis = analyzeResponse(wire, res.body);
  if (!analysis.shape_ok) {
    live.push({
      layer: "real-response",
      status: "fail",
      failure: "http",
      http_status: res.http_status,
      detail: `HTTP ${res.http_status} body is not a parseable ${wire} completion response`,
      evidence: { at, source: "probe", note: "unexpected response shape" },
    });
    live.push({
      layer: "tool-call",
      status: "skipped",
      detail: "upstream real-response check failed",
      evidence: null,
    });
    return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  if (analysis.model_echo !== null && !modelEchoMatches(analysis.model_echo, model)) {
    live.push({
      layer: "real-response",
      status: "fail",
      failure: "model-mismatch",
      http_status: res.http_status,
      detail: `provider answered as model '${analysis.model_echo}', not the requested '${model}'`,
      evidence: { at, source: "probe", note: "model echo mismatch" },
    });
    live.push({
      layer: "tool-call",
      status: "skipped",
      detail: "upstream real-response check failed",
      evidence: null,
    });
    return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
  }

  live.push({
    layer: "real-response",
    status: "pass",
    http_status: res.http_status,
    detail: `HTTP ${res.http_status}; model echo ${analysis.model_echo ? `'${analysis.model_echo}'` : "absent"}`,
    evidence: { at, source: "probe", note: "one bounded completion request" },
  });
  live.push({
    layer: "tool-call",
    status: analysis.tool_call ? "pass" : "fail",
    failure: analysis.tool_call ? undefined : "no-tool-call",
    detail: analysis.tool_call ? "tool_use observed in the response" : "response did not use the probe tool",
    evidence: { at, source: "probe", note: "same bounded completion request" },
  });
  return finish(saveLive(layers, live, options.target.route, model, transport.kind, options.cooldownMs, stateDir, quotaScope, now, secrets), options.target.route, model, mode, transport, quotaScope, now, started, secrets);
}

// ---------------------------------------------------------------------------
// Helpers used by probeRoute (kept below the main flow for readability)
// ---------------------------------------------------------------------------

function skippedAll(layers: ProbeLayerResult[], detail: string): ProbeLayerResult[] {
  for (const layer of PROBE_LAYERS) {
    if (!layers.some((l) => l.layer === layer)) {
      layers.push({ layer, status: "skipped", detail, evidence: null });
    }
  }
  return layers;
}

function transportFailure(layer: ProbeLayer, exc: unknown, at: string): ProbeLayerResult {
  if (exc instanceof ProbeTransportError) {
    return {
      layer,
      status: "fail",
      failure: exc.kind,
      detail: exc.message,
      evidence: { at, source: "probe", note: exc.kind },
    };
  }
  return {
    layer,
    status: "fail",
    failure: "network",
    detail: `transport error: ${(exc as Error)?.message ?? String(exc)}`,
    evidence: { at, source: "probe", note: "network" },
  };
}

function parseRetryAfter(header: string | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_COOLDOWN_MS);
}

function loadQuotaScope(configFile: string | undefined, routeId: string): string | null {
  const catalog = loadCatalog(configFile);
  return effectiveQuotaKey(catalog, routeId);
}

function loadRestriction(
  configFile: string | undefined,
  routeId: string,
  providerKey: string,
): string | null {
  const catalog: Catalog = loadCatalog(configFile);
  const route = catalog.routes[routeId]?.restriction ?? null;
  const provider = catalog.providers[providerKey]?.restriction ?? null;
  for (const att of [route, provider]) {
    if (att && att.status === "restricted") {
      const age = att.evidence ? ` (observed ${att.evidence.at})` : "";
      return `${att.note ?? "restricted"}${age}`;
    }
  }
  return null;
}

/**
 * Static mode: overlay the TTL-cached live layers onto the skipped ones, so
 * a network-free report still shows the last known live state — marked
 * `cached`, and `stale` when outside the TTL (never presented as current).
 */
function overlayCache(
  layers: ProbeLayerResult[],
  route: string,
  model: string,
  force: boolean,
  stateDir: string,
  ttlMs: number,
  now: number,
): ProbeLayerResult[] {
  if (force) return layers;
  const cached = loadCachedLive(stateDir, route, model);
  if (!cached) return layers;
  // Only REAL network evidence may be overlaid: a cached entry produced by a
  // mock/non-http transport is never shown as http evidence and never drives
  // the overall readiness.
  if (cached.transport !== "http") return layers;
  const stale = isStale({ at: cached.time, source: "probe" }, now, ttlMs);
  const overlaid = layers.map((layer) => {
    const hit = cached.layers.find((l) => l.layer === layer.layer);
    if (!hit) return layer;
    return {
      ...hit,
      status: stale ? ("stale" as const) : hit.status,
      cached: true,
    };
  });
  return overlaid;
}

function loadCachedLive(
  stateDir: string,
  route: string,
  model: string,
): CachedProbe | null {
  const state = loadProbeState(stateDir);
  const resolvedModel = model ?? "";
  if (!resolvedModel) return null;
  return state.probes[cacheKey(route, resolvedModel)] ?? null;
}

/**
 * Persist the live layers just observed (TTL cache) and, on a rate-limit
 * observation, the cooldown for the quota scope. Redacted on write.
 */
function saveLive(
  layers: ProbeLayerResult[],
  live: ProbeLayerResult[],
  route: string,
  model: string,
  transportKind: string,
  cooldownMs: number | undefined,
  stateDir: string,
  quotaScope: string | null,
  now: number,
  secrets: readonly string[],
): ProbeLayerResult[] {
  const merged = [...layers.filter((l) => !live.some((x) => x.layer === l.layer)), ...live];
  const rateLimit = live.find((l) => l.failure === "rate-limit");
  if (!live.some((l) => l.status === "pass" || l.status === "fail") && !rateLimit) return merged;
  // Only REAL network evidence (http transport) is durable. Mock/test
  // transports never enter state, so they can never be shown as http
  // evidence or drive a later probeOverall.
  if (transportKind !== "http") return merged;
  try {
    const state = loadProbeState(stateDir);
    // Scrub credential values before anything is persisted (free-text only;
    // structural fields are never altered).
    const scrubbed = scrubLayers(live, secrets);
    state.probes[cacheKey(route, model)] = {
      route,
      model,
      mode: "live",
      transport: transportKind,
      time: new Date(now).toISOString(),
      quota_scope: quotaScope,
      layers: scrubbed,
    };
    if (rateLimit) {
      const wait = rateLimit.retry_after_s ? rateLimit.retry_after_s * 1000 : undefined;
      const until = now + Math.min(wait ?? cooldownMs ?? PROBE_COOLDOWN_MS, MAX_COOLDOWN_MS);
      state.cooldowns[quotaScope ?? route] = new Date(until).toISOString();
    }
    saveProbeState(stateDir, state);
  } catch {
    // Cache failure must never mask the probe result; the report stands as-is
    // (no duplicate "state cache unavailable" layer is synthesized).
  }
  return merged;
}

function finish(
  layers: ProbeLayerResult[],
  route: string,
  model: string,
  mode: "static" | "live",
  transport: ProbeTransport,
  quotaScope: string | null,
  now: number,
  started: number,
  secrets: readonly string[],
): ProbeReport {
  const ordered = PROBE_LAYERS.map(
    (layer) => layers.find((l) => l.layer === layer) ?? { layer, status: "skipped" as const, detail: "not evaluated", evidence: null },
  );
  const report: ProbeReport = {
    contract_version: CONTRACT_VERSION,
    source: "probe",
    route,
    model,
    mode,
    transport: transport.kind,
    time: new Date(now).toISOString(),
    duration_ms: Date.now() - started,
    quota_scope: quotaScope,
    layers: ordered,
    cached: ordered.some((l) => l.cached === true),
  };
  // Mandatory last step before any output: credential values never appear in
  // a report, even when a provider error message echoes them back. Only
  // free-text fields are scrubbed; structural fields are never altered.
  return {
    ...report,
    layers: scrubLayers(ordered, secrets),
  };
}

/** Exact-match replace of every credential value occurrence in free text. */
function scrubText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * Field-scoped scrub of layer results: only free-text fields (`detail`,
 * `evidence.note`) are scrubbed; structural fields are never altered.
 */
function scrubLayers(layers: ProbeLayerResult[], secrets: readonly string[]): ProbeLayerResult[] {
  if (secrets.length === 0) return layers;
  return layers.map((layer) => ({
    ...layer,
    detail: layer.detail ? scrubText(layer.detail, secrets) : undefined,
    evidence: layer.evidence
      ? { ...layer.evidence, note: layer.evidence.note ? scrubText(layer.evidence.note, secrets) : undefined }
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Overall readiness + canonical output
// ---------------------------------------------------------------------------

/**
 * Collapse a report into the distinct readiness state: the deepest layer
 * that passed, or the failure that stopped the probe. Cached-stale evidence
 * is reported as `stale`, never as a pass.
 */
export function probeOverall(report: ProbeReport): ProbeOverall {
  for (const layer of report.layers) {
    if (layer.status === "fail") {
      return { state: "failed", layer: layer.layer, failure: layer.failure ?? "http" };
    }
  }
  for (const layer of report.layers) {
    if (layer.status === "stale") return { state: "stale", layer: layer.layer };
  }
  let deepest: ProbeLayer = "configured";
  for (const layer of report.layers) {
    if (layer.status === "pass") deepest = layer.layer;
  }
  return { state: deepest };
}

/**
 * Canonical, secret-redacted JSON for the report. This is the ONLY approved
 * way to print or persist a report.
 */
export function probeJson(report: ProbeReport): string {
  return redactJson(report);
}
