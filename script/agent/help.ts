#!/usr/bin/env bun
/**
 * Progressive-disclosure help/guide/routes data for the agent launcher
 * (issue #88, Epic #86 T002).
 *
 * This module owns ONE source of truth per command: a plain data object that
 * is rendered either as human-readable text or as redacted canonical JSON.
 * Human and machine output therefore cannot drift apart. It imports the
 * landed contract/catalog modules (T001/T003) and never invents facts:
 * anything without an attestation stays `null` / "unknown".
 *
 * Readiness probes (#90), quota/reset telemetry (#91) and the recommendation
 * engine (#94) are separate issues; they appear only as clearly-marked
 * `not_yet_available` placeholders, never as guessed values.
 *
 * Run: tested by script/agent.help.test.ts
 */

import { type Attested } from "./contract";
import {
  effectiveQuotaKey,
  modelEntry,
  type Catalog,
  type E2eObservation,
  type RateLimits,
} from "./catalog";

// ---------------------------------------------------------------------------
// Inputs (structural subsets of script/agent.ts's Config; that file cannot be
// imported because it executes main() at module load)
// ---------------------------------------------------------------------------

export interface RouteConfigLike {
  key: string;
  harness: string;
  provider: string;
  default_model: string | null;
  models: string[] | null;
  require_model: boolean;
  note: string;
}

export interface ProviderConfigLike {
  key: string;
  label: string;
  env: string | null;
  default_model: string | null;
  require_model: boolean;
  models: string[];
  require_infisical: boolean;
}

export interface HarnessConfigLike {
  key: string;
  label: string;
  command: string;
  adapter: string;
}

export interface RoutesInput {
  providers: Record<string, ProviderConfigLike>;
  harnesses: Record<string, HarnessConfigLike>;
  routes: Record<string, RouteConfigLike>;
}

// ---------------------------------------------------------------------------
// Shared: features owned by later issues (never guessed, always marked)
// ---------------------------------------------------------------------------

export interface NotYetAvailableEntry {
  issue: number;
  task: string;
  note: string;
}

export const NOT_YET_AVAILABLE: Record<string, NotYetAvailableEntry> = {
  readiness: {
    issue: 90,
    task: "T004",
    note: "readiness probes (configured / credential present / reachable / real tool-call) are not implemented yet",
  },
  usage: {
    issue: 91,
    task: "T005",
    note: "remaining/used quota telemetry is not implemented yet; never inferred from rate limits",
  },
  reset_at: {
    issue: 91,
    task: "T005",
    note: "quota reset times are not implemented yet; unknown, never guessed",
  },
  recommendation: {
    issue: 94,
    task: "T008",
    note: "route recommendation engine is not implemented yet",
  },
};

function notYetAvailableFooter(): string {
  const parts = Object.entries(NOT_YET_AVAILABLE).map(
    ([field, entry]) => `${field} (#${entry.issue}/${entry.task})`,
  );
  return `not yet available: ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// agent routes
// ---------------------------------------------------------------------------

/** Catalog facts for one model, as far as they are known (else null). */
export interface ModelFactsData {
  tool_call: Attested<boolean> | null;
  context_window: Attested<number> | null;
  pricing: {
    kind: string;
    currency: string | null;
    input_per_mtok: Attested<number> | null;
    output_per_mtok: Attested<number> | null;
  } | null;
}

export interface RouteData {
  id: string;
  harness: string;
  provider: string;
  adapter: string;
  shortcut: string;
  /** null = no configured default; an explicit --model is required. */
  default_model: string | null;
  models: string[];
  note: string;
  /** null = harness-native login (no Infisical secret on the provider).
   * Keyed `cred`, never `credential`: the redactor treats every
   * `credential*` compound key as secret-shaped and would redact the whole
   * object. Only the env var NAME travels, never a value. */
  cred: { env: string; infisical_required: boolean } | null;
  catalog: {
    quota_scope: string | null;
    billing: string | null;
    terms: string | null;
    /** Route-level entry when present, else the provider-level one. */
    rate_limits: Attested<RateLimits> | null;
    /** Route-level entry when present, else the provider-level one. */
    restriction: Attested<null> | null;
    concurrency: Attested<number> | null;
    e2e: Attested<E2eObservation[]> | null;
    /** Per-model facts; a model without an entry is simply absent (unknown). */
    models: Record<string, ModelFactsData>;
  };
}

export interface RoutesData {
  command: "routes";
  config: string;
  routes: RouteData[];
  not_yet_available: Record<string, NotYetAvailableEntry>;
}

export function buildRoutesData(config: RoutesInput, catalog: Catalog): RoutesData {
  const routes: RouteData[] = [];
  for (const key of Object.keys(config.routes).sort()) {
    const route = config.routes[key];
    const provider = config.providers[route.provider];
    const harness = config.harnesses[route.harness];
    if (!provider || !harness) {
      // Config validation (agent check) rejects this first; never guess.
      throw new Error(`route '${key}' references an unknown harness or provider`);
    }
    const providerEntry = catalog.providers[route.provider] ?? null;
    const routeEntry = catalog.routes[route.key] ?? null;

    const models: Record<string, ModelFactsData> = {};
    for (const model of route.models ?? provider.models) {
      const entry = modelEntry(catalog, route.key, model);
      if (entry) {
        models[model] = {
          tool_call: entry.tool_call,
          context_window: entry.context_window,
          pricing: entry.pricing,
        };
      }
    }

    routes.push({
      id: route.key,
      harness: route.harness,
      provider: route.provider,
      adapter: harness.adapter,
      shortcut: `${route.harness}-${route.provider}`,
      // Route default model, same precedence as the launcher's
      // routeDefaultModel: route default > provider default.
      default_model: route.default_model || provider.default_model,
      models: route.models ?? provider.models,
      note: route.note,
      cred: provider.env
        ? { env: provider.env, infisical_required: provider.require_infisical }
        : null,
      catalog: {
        quota_scope: effectiveQuotaKey(catalog, route.key),
        billing: providerEntry?.billing ?? null,
        terms: providerEntry?.terms ?? null,
        rate_limits: routeEntry?.rate_limits ?? providerEntry?.rate_limits ?? null,
        restriction: routeEntry?.restriction ?? providerEntry?.restriction ?? null,
        concurrency: routeEntry?.concurrency ?? null,
        e2e: routeEntry?.e2e ?? null,
        models,
      },
    });
  }
  return {
    command: "routes",
    config: catalog.path,
    routes,
    not_yet_available: NOT_YET_AVAILABLE,
  };
}

// --- human rendering (routes) ----------------------------------------------

const UNKNOWN = "unknown";

/** Compact one-line rendering of an attestation; null attestation = unknown.
 * A `restricted` attestation is its own fact even when the value is null
 * (e.g. an observed HTTP 402/403/429 block), so it is never "unknown". */
function attestedText<T>(
  att: Attested<T> | null,
  formatValue: (value: T) => string,
): string {
  if (!att) return UNKNOWN;
  const evidence = att.evidence
    ? ` (${att.provenance}, ${att.evidence.source} ${att.evidence.at.slice(0, 10)})`
    : ` (${att.provenance})`;
  if (att.status === "restricted") {
    return `RESTRICTED: ${att.note ?? ""}${evidence}`.trimEnd();
  }
  if (att.value === null) return UNKNOWN;
  return `${formatValue(att.value)}${evidence}`;
}

function rateLimitsText(limits: RateLimits): string {
  const unit: Record<string, string> = {
    per_minute: "/min",
    per_hour: "/hour",
    per_day: "/day",
    per_month: "/month",
  };
  return Object.entries(unit)
    .filter(([key]) => limits[key as keyof RateLimits] !== undefined)
    .map(([key, suffix]) => `${limits[key as keyof RateLimits]}${suffix}`)
    .join(", ");
}

function e2eText(observations: E2eObservation[]): string {
  return observations
    .map((obs) => `${obs.model}: tool_call=${obs.tool_call}`)
    .join("; ");
}

function pricingValue(pricing: NonNullable<ModelFactsData["pricing"]>): string {
  const parts: string[] = [pricing.kind];
  if (pricing.input_per_mtok?.value !== null && pricing.input_per_mtok) {
    parts.push(`in $${pricing.input_per_mtok.value}/MTok`);
  }
  if (pricing.output_per_mtok?.value !== null && pricing.output_per_mtok) {
    parts.push(`out $${pricing.output_per_mtok.value}/MTok`);
  }
  return parts.join(", ");
}

export function renderRoutesText(data: RoutesData): string {
  const lines: string[] = [];
  lines.push(
    `routes (catalog facts from ${data.config}; absent facts are ${UNKNOWN}, never guessed)`
  );
  lines.push("");
  for (const route of data.routes) {
    lines.push(
      `${route.id} [${route.harness}/${route.adapter}]  shortcut: ${route.shortcut}`
    );
    lines.push(
      `  default model: ${route.default_model ?? "(none configured; --model required)"}`
    );
    lines.push(`  models: ${route.models.length > 0 ? route.models.join(", ") : UNKNOWN}`);
    lines.push(
      route.cred
        ? `  credential: env ${route.cred.env}` +
          (route.cred.infisical_required ? " (Infisical-required)" : " (Infisical)")
        : "  credential: harness-native login"
    );
    if (route.note) {
      lines.push(`  note: ${route.note}`);
    }
    lines.push(`  billing: ${route.catalog.billing ?? UNKNOWN}`);
    lines.push(`  quota scope: ${route.catalog.quota_scope ?? UNKNOWN}`);
    lines.push(`  rate limits: ${attestedText(route.catalog.rate_limits, rateLimitsText)}`);
    lines.push(`  concurrency: ${attestedText(route.catalog.concurrency, (n) => String(n))}`);
    lines.push(`  restriction: ${attestedText(route.catalog.restriction, () => "")}`);
    lines.push(`  e2e: ${attestedText(route.catalog.e2e, e2eText)}`);
    if (route.catalog.terms) {
      lines.push(`  terms: ${route.catalog.terms}`);
    }
    const modelIds = Object.keys(route.catalog.models);
    if (modelIds.length > 0) {
      lines.push("  model facts:");
      for (const model of modelIds) {
        const facts = route.catalog.models[model];
        const tool = attestedText(facts.tool_call, (v) => String(v));
        const ctx = attestedText(facts.context_window, (v) => `${v} tokens`);
        const price = facts.pricing ? pricingValue(facts.pricing) : UNKNOWN;
        lines.push(`    ${model}: tool_call=${tool}, context=${ctx}, pricing=${price}`);
      }
    } else {
      lines.push(`  model facts: ${UNKNOWN}`);
    }
    lines.push("");
  }
  lines.push(notYetAvailableFooter());
  lines.push("'agent models <provider>' shows credential names and the full model list.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// agent guide
// ---------------------------------------------------------------------------

export interface GuideTopicData {
  id: string;
  title: string;
  summary: string;
  details: string[];
}

export const GUIDE_TOPICS: GuideTopicData[] = [
  {
    id: "routes",
    title: "Providers, routes and OS support",
    summary: "How harness x provider routes, shortcuts and adapters work",
    details: [
      "A route is `<harness>.<provider>` in config/agents.toml — the single",
      "source of truth for endpoints, model ids and credential NAMES (values",
      "stay in Infisical, injected process-scoped by script/with-secrets).",
      "",
      "Adapters: anthropic (Claude Code), opencode, omp, passthrough (dsh).",
      "Model resolution: --model > route default > provider default >",
      "harness-native default (last step only for passthrough harnesses).",
      "",
      "Entry forms:",
      "  agent <harness> <provider> [--model <id>] [-- <args>...]   route mode",
      "  agent <harness> [-- <args>...]                             native mode",
      "  <harness>-<provider> [args...]                             shortcut",
      "",
      "OS support: macOS/WSL/Linux use the ~/.local/bin/agent shim plus",
      "symlinked shortcuts; Windows native uses script/agent.ps1 and generated",
      ".cmd shortcuts. The portable spelling `agent <harness>-<provider>`",
      "works everywhere without a link. Windows .cmd shims reject arguments",
      "containing quotes or % (exit 1) instead of corrupting them.",
      "",
      "Inspect: agent list (all routes), agent models <provider> (credentials",
      "+ models), agent routes (catalog facts), agent shortcuts (link state).",
    ],
  },
  {
    id: "status",
    title: "Checking status and evidence",
    summary: "Where route/quota/limit facts live and how to read their provenance",
    details: [
      "Static facts (always available, offline):",
      "  agent check               validate config/agents.toml (CI runs this)",
      "  agent list                every configured route + shortcut name",
      "  agent models <provider>   credential names and model list",
      "  agent routes              routes + catalog facts (quota scopes, rate",
      "                            limits, restrictions, e2e observations)",
      "  agent routes --json       the same data as redacted canonical JSON",
      "",
      "Every catalog fact carries an attestation: status (configured /",
      "verified-live / restricted / unknown), provenance (measured / official",
      "/ estimated) and evidence (timestamp, source, SHA). A value without",
      "evidence is reported as unknown — unknown stays unknown; balances and",
      "reset times are never invented.",
      "",
      "Not yet available (do not guess): readiness probes (#90/T004),",
      "usage/reset telemetry (#91/T005), recommendations (#94/T008).",
    ],
  },
  {
    id: "limits",
    title: "Quota scopes, rate limits and restrictions",
    summary: "Shared allowances, documented limits, observed blocks",
    details: [
      "Quota scopes are `<kind>:<id>` with kind account | api-key | plan |",
      "machine. Equal keys mean one shared allowance: concurrent routes and",
      "machines drawing the same scope must dedupe on it, not double-count.",
      "`agent routes` shows the effective scope per route (route-level",
      "override wins over the provider scope).",
      "",
      "Rate limits and concurrency come from the [catalog.*] tables in",
      "config/agents.toml with provenance; only documented windows are shown.",
      "Remaining/used quota and reset times are NOT implemented yet (#91):",
      "never infer them from rate limits.",
      "",
      "Observed blocks (HTTP 402/403/429 from the account) are recorded as",
      "restriction attestations and shown by `agent routes`. On 401/402/429:",
      "stop and report; never switch provider, model or endpoint yourself,",
      "and never fall back to another route or native mode.",
    ],
  },
  {
    id: "distributed",
    title: "Distributed execution",
    summary: "Supervisor/Worker roles, launch modes, orchestration boundaries",
    details: [
      "Roles: Claude Code is the Supervisor; OMP is the Worker slot",
      "(docs/adr/ADR-0014.md). Workers get explicit routes; the launcher",
      "never picks or switches a provider implicitly.",
      "",
      "Orchestration boundaries: Herdr owns session/agent control, Worktrunk",
      "owns worktree lifecycle. A Herdr pane or an existing worktree is NOT",
      "proof of completion or isolation — verify via Issues/PRs/Git.",
      "",
      "Mutable ownership: one implementation owner per file set at a time;",
      "shared files (script/agent.ts, config/agents.toml) are integrated by",
      "one actor, modules stay separate (script/agent/*.ts).",
      "",
      "Not yet available: Herdr dispatch/collect (#100/T014), runtime",
      "isolation/leases (#98/T012), machine placement (#97/T011).",
    ],
  },
  {
    id: "recovery",
    title: "Recovery after failure or disconnect",
    summary: "Durable truth, exit codes, no silent fallback",
    details: [
      "Durable truth lives in GitHub Issues/PRs, Git refs and committed docs",
      "— never only in a live conversation. Bind validation evidence to the",
      "exact SHA it was produced on.",
      "",
      "Exit codes: usage/config errors exit 2, runtime failures exit 1, a",
      "signal-killed child reports 128+signal. A failing route never falls",
      "back to another route or to native mode; fix the cause and re-run the",
      "same explicit route.",
      "",
      "On 401/402/429 or network loss: stop and report; do not retry into a",
      "different provider/model and do not switch credentials yourself.",
      "",
      "Not yet available: durable checkpoints (#99/T013), error classifier",
      "(#92/T006), disconnect/quota recovery (#101/T015).",
    ],
  },
  {
    id: "quality",
    title: "Quality gates and evidence",
    summary: "Repository invariants, required validation, authority boundaries",
    details: [
      "Read AGENTS.md first: project-local invariants (symlink idempotence,",
      "Infisical control plane, no secrets in home/) outrank generic practice.",
      "Durable decisions go to docs/adr/, research to docs/research/.",
      "",
      "Before presenting work: ./script/test, ./script/test-workflow,",
      "./script/check-secrets, plus relevant ./script/check validation.",
      "Keep mocks and real-machine evidence separate; never claim live",
      "operation from mocks.",
      "",
      "Policy facts (baseline pin, skill hash drift, landing policy) come",
      "from script/agent/policy.ts. Authority boundaries: PR readiness and",
      "merge authorization are separate; ticket PRs target the current",
      "release branch; landing is merge-commit only.",
      "",
      "Not yet available: profile/preflight authority resolution (#96/T010),",
      "quality/cold review automation (#102/T016).",
    ],
  },
  {
    id: "misfire",
    title: "Misfire handling",
    summary: "Wrong harness started, help confusion, fail-closed errors",
    details: [
      "Wrong harness or model started: Ctrl+C. Nothing is persisted —",
      "--model/--agent-model affect one process only.",
      "",
      "Help: `agent <harness> <provider> --help` prints THIS launcher's help;",
      "`agent <harness> <provider> -- --help` asks the harness itself.",
      "`agent guide` (this command) never launches a process.",
      "",
      "Fail-closed errors (exit 2) list the valid choices: unknown harness,",
      "unknown provider, no route, unknown model, unknown shortcut. There is",
      "no implicit fallback. `agent pi` is retired: it exits 2 with a",
      "migration hint pointing at `agent omp <provider>`.",
      "",
      "Native mode is explicit: `agent <harness>` passes the environment",
      "through untouched. A failing route never falls back to native mode.",
    ],
  },
];

export interface GuideOverviewData {
  command: "guide";
  topic: null;
  topics: Array<{ id: string; title: string; summary: string }>;
  not_yet_available: Record<string, NotYetAvailableEntry>;
}

export interface GuideDetailData {
  command: "guide";
  topic: string;
  title: string;
  summary: string;
  details: string[];
  related: string[];
  not_yet_available: Record<string, NotYetAvailableEntry>;
}

export type GuideData = GuideOverviewData | GuideDetailData;

/** Exit-2 error for an unknown topic, with the valid choices. */
export class UnknownGuideTopicError extends Error {}

/** Guide data for `agent guide` (overview) or `agent guide <topic>`. */
export function buildGuideData(topic: string | null): GuideData {
  if (topic === null) {
    return {
      command: "guide",
      topic: null,
      topics: GUIDE_TOPICS.map(({ id, title, summary }) => ({ id, title, summary })),
      not_yet_available: NOT_YET_AVAILABLE,
    };
  }
  const entry = GUIDE_TOPICS.find((t) => t.id === topic);
  if (!entry) {
    // Unknown stays unknown: name the valid topics, invent nothing.
    throw new UnknownGuideTopicError(
      `unknown guide topic '${topic}'; valid topics: ${GUIDE_TOPICS.map((t) => t.id).join(", ")}`,
    );
  }
  return {
    command: "guide",
    topic: entry.id,
    title: entry.title,
    summary: entry.summary,
    details: entry.details,
    related: GUIDE_TOPICS.filter((t) => t.id !== entry.id).map((t) => t.id),
    not_yet_available: NOT_YET_AVAILABLE,
  };
}

export function renderGuideText(data: GuideData): string {
  const lines: string[] = [];
  if (data.topic === null) {
    lines.push("agent guide — progressive disclosure; read one topic at a time:");
    lines.push("");
    for (const topic of data.topics) {
      lines.push(`  agent guide ${topic.id.padEnd(12)} ${topic.summary}`);
    }
    lines.push("");
    lines.push(notYetAvailableFooter());
  } else {
    lines.push(`agent guide ${data.topic} — ${data.title}`);
    lines.push("");
    lines.push(...data.details);
    lines.push("");
    lines.push(`related topics: agent guide ${data.related.join(" | agent guide ")}`);
    lines.push(notYetAvailableFooter());
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// agent help --json
// ---------------------------------------------------------------------------

export interface HelpData {
  command: "help";
  /** The exact human-facing usage text (same string `agent help` prints). */
  usage: string;
  subcommands: Array<{ name: string; summary: string }>;
  /** Deeper entry points (progressive disclosure). */
  further: Array<{ command: string; summary: string }>;
  not_yet_available: Record<string, NotYetAvailableEntry>;
}

/**
 * Build the machine-readable help. `usage` is the launcher's canonical usage
 * text passed in by script/agent.ts, so the JSON quotes the exact human
 * output instead of maintaining a second copy.
 */
export function buildHelpData(usage: string): HelpData {
  return {
    command: "help",
    usage,
    subcommands: [
      { name: "help", summary: "show this help (--json for machine-readable)" },
      { name: "list", summary: "show every configured harness/provider route" },
      { name: "models <provider>", summary: "credential names and models of a provider" },
      { name: "shortcuts", summary: "list/check/create/remove shortcut entry points" },
      { name: "check", summary: "validate config/agents.toml" },
      { name: "guide [topic]", summary: "progressive-disclosure guide (see --json)" },
      { name: "routes", summary: "route table with catalog facts (see --json)" },
    ],
    further: [
      { command: "agent guide", summary: "topics: routes, status, limits, distributed, recovery, quality, misfire" },
      { command: "agent routes --json", summary: "route catalog facts as redacted canonical JSON" },
    ],
    not_yet_available: NOT_YET_AVAILABLE,
  };
}
