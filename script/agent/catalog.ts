#!/usr/bin/env bun
/**
 * Capability / pricing / terms catalog (issue #89, Epic #86 T003).
 *
 * Reads the ADDITIVE `[catalog.*]` tables from `config/agents.toml` — the
 * same file the launcher (`script/agent.ts`) reads — and validates every
 * fact against `script/agent/contract.ts` (`Attested` / `Evidence` /
 * `QuotaScope`). The launcher ignores these tables entirely: launch
 * behavior is defined exclusively by the `[providers]` / `[harnesses]` /
 * `[routes]` tables, and this module never changes it.
 *
 * Separation of authority (issue requirement):
 *   - `official`  — provider-published material (public catalog/docs).
 *   - `measured`  — our own live execution evidence (E2E, probes).
 *   - `estimated` — config-side judgment; never presented as either.
 * A fact with no entry is UNKNOWN: this module never invents prices,
 * quotas or capabilities. An attested price without provider-published,
 * measured or explicitly config-declared evidence is rejected at load
 * time, as is any attestation that violates the contract's
 * status/provenance/evidence matrix.
 *
 * Quota scopes: allowances are identified by `quotaScopeKey` (account /
 * api-key / plan / machine), never by machine, so the same account
 * allowance is not double-counted across machines or across routes that
 * share it. Scope ids name accounts, plans or Infisical secret NAMES —
 * secret values never appear here.
 *
 * Network-free by contract: only the config file is read.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ContractError,
  isPlainObject,
  parseAttested,
  parseModelId,
  parseRouteId,
  quotaScopeKey,
  requireBool,
  requireStr,
  stringList,
  type Attested,
  type QuotaScope,
} from "./contract";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Commercial charging model. `unknown` (and absence) means: no data. */
export type PricingKind = "free" | "subscription" | "metered" | "unknown";

/** Documented rate limits. Only known windows are present. */
export interface RateLimits {
  per_minute?: number;
  per_hour?: number;
  per_day?: number;
  per_month?: number;
}

/** One real launch observation: a model answered and (optionally) used tools. */
export interface E2eObservation {
  model: string;
  tool_call: boolean;
}

/** Price per million tokens. Present only when evidence exists. */
export interface ModelPricing {
  kind: PricingKind;
  /** ISO 4217 code; required whenever a per-MTok price is declared. */
  currency: string | null;
  input_per_mtok: Attested<number> | null;
  output_per_mtok: Attested<number> | null;
}

/** Per-model capability/pricing facts, keyed by provider-native model id. */
export interface ModelCatalogEntry {
  tool_call: Attested<boolean> | null;
  /** Enforced context window in tokens (may be lower than upstream claims). */
  context_window: Attested<number> | null;
  /** Config-declared recommended uses (provenance `estimated` judgment). */
  recommended_for: Attested<string[]> | null;
  /** Config-declared reason a use is discouraged. */
  discouraged_reason: Attested<string> | null;
  pricing: ModelPricing | null;
}

/** Provider-level commercial terms and shared allowance. */
export interface ProviderCatalogEntry {
  billing: PricingKind;
  terms: string | null;
  /** The allowance this provider's usage draws from (shared scope key). */
  quota: QuotaScope | null;
  rate_limits: Attested<RateLimits> | null;
  /** An OBSERVED block on using this provider (e.g. client-bound tier). */
  restriction: Attested<null> | null;
  models: Record<string, ModelCatalogEntry>;
}

/** Route-level (harness×provider) facts that are not provider-wide. */
export interface RouteCatalogEntry {
  /** Overrides the provider scope when this route draws a different allowance. */
  quota: QuotaScope | null;
  rate_limits: Attested<RateLimits> | null;
  /** Max concurrent requests for this route. */
  concurrency: Attested<number> | null;
  /** Real launch observations on this route (model + tool-call result). */
  e2e: Attested<E2eObservation[]> | null;
  /** An OBSERVED block on this route (e.g. HTTP 402/429 from the account). */
  restriction: Attested<null> | null;
}

export interface Catalog {
  path: string;
  providers: Record<string, ProviderCatalogEntry>;
  routes: Record<string, RouteCatalogEntry>;
}

// ---------------------------------------------------------------------------
// Config path (same resolution as script/agent.ts, which cannot be imported:
// it executes main() at module load)
// ---------------------------------------------------------------------------

export function catalogConfigPath(): string {
  return process.env.AGENT_CONFIG || join(repoRoot(), "config", "agents.toml");
}

function repoRoot(): string {
  return dirname(dirname(dirname(realpathSync(import.meta.path))));
}

// ---------------------------------------------------------------------------
// Value checkers (run on the attested `value` after parseAttested)
// ---------------------------------------------------------------------------

function checkBool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractError("schema", `${where}: value must be a boolean`);
  }
  return value;
}

function checkPositiveInt(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ContractError("schema", `${where}: value must be a positive integer`);
  }
  return value;
}

function checkNonEmptyStr(value: unknown, where: string): string {
  if (typeof value !== "string" || !value) {
    throw new ContractError("schema", `${where}: value must be a non-empty string`);
  }
  return value;
}

function checkStringList(value: unknown, where: string): string[] {
  return stringList(value, where, "value");
}

function checkNullValue(value: unknown, where: string): null {
  // TOML has no null: an omitted `value` (undefined) is the declared form.
  if (value !== null && value !== undefined) {
    throw new ContractError("schema", `${where}: a restriction carries no value`);
  }
  return null;
}

function checkRateLimits(value: unknown, where: string): RateLimits {
  if (!isPlainObject(value)) {
    throw new ContractError("schema", `${where}: value must be a table`);
  }
  const allowed = ["per_minute", "per_hour", "per_day", "per_month"] as const;
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k as never));
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown window '${unknown[0]}'`);
  }
  const out: RateLimits = {};
  let count = 0;
  for (const key of allowed) {
    const v = value[key];
    if (v === undefined) continue;
    out[key] = checkPositiveInt(v, `${where}.${key}`);
    count++;
  }
  if (count === 0) {
    throw new ContractError("schema", `${where}: at least one window is required`);
  }
  return out;
}

function checkE2eValue(value: unknown, where: string): E2eObservation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContractError("schema", `${where}: value must be a non-empty list`);
  }
  return value.map((item, i) => {
    const w = `${where}[${i}]`;
    if (!isPlainObject(item)) {
      throw new ContractError("schema", `${w}: table expected`);
    }
    const unknown = Object.keys(item).filter((k) => k !== "model" && k !== "tool_call");
    if (unknown.length > 0) {
      throw new ContractError("schema", `${w}: unknown field '${unknown[0]}'`);
    }
    return {
      model: parseModelId(requireStr(item, "model", w)),
      tool_call: requireBool(item, "tool_call", w),
    };
  });
}

/**
 * Price value check. Attestation-level rules are in `checkPriceAttestation`.
 */
function checkPrice(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ContractError("schema", `${where}: price must be a non-negative finite number`);
  }
  return value;
}

function checkPriceAttestation(att: Attested<number>, where: string): void {
  if (!att.evidence) {
    throw new ContractError(
      "evidence",
      `${where}: a price requires evidence (provider-published, measured, or config-declared)`,
    );
  }
  // An 'estimated' price is acceptable only as explicitly config-declared
  // hearsay (evidence source 'config'); any other source misrepresents it.
  if (att.provenance === "estimated" && att.evidence.source !== "config") {
    throw new ContractError(
      "evidence",
      `${where}: an 'estimated' price may only cite source 'config' (config-declared, not provider-published)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/** Parse one optional `Attested<T>` field; absent (or null) means unknown. */
function attestedField<T>(
  table: Record<string, unknown>,
  key: string,
  where: string,
  checkValue: (value: unknown, where: string) => T,
): Attested<T> | null {
  const raw = table[key];
  if (raw === undefined || raw === null) return null;
  const att = parseAttested(raw, `${where}.${key}`);
  // TOML has no null: an absent value reaches the checker as undefined
  // (the restriction checker accepts it; typed checkers reject it).
  const value = checkValue(att.value, `${where}.${key}.value`);
  const out: Attested<T> = { value, status: att.status, provenance: att.provenance, evidence: att.evidence };
  if (att.note !== undefined) out.note = att.note;
  return out;
}

function parsePricingKind(raw: unknown, where: string): PricingKind {
  if (raw === undefined || raw === null) return "unknown";
  if (typeof raw !== "string" || !["free", "subscription", "metered", "unknown"].includes(raw)) {
    throw new ContractError("schema", `${where}: invalid pricing kind '${String(raw)}'`);
  }
  return raw as PricingKind;
}

function parseQuotaScope(raw: unknown, where: string): QuotaScope | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: table expected`);
  }
  const unknown = Object.keys(raw).filter((k) => k !== "scope" && k !== "id");
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown field '${unknown[0]}'`);
  }
  const scope: QuotaScope = {
    kind: requireStr(raw, "scope", where) as QuotaScope["kind"],
    id: requireStr(raw, "id", where),
  };
  quotaScopeKey(scope); // validates kind and id; throws otherwise
  return scope;
}

function parsePricing(table: Record<string, unknown>, where: string): ModelPricing | null {
  const raw = table["pricing"];
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}.pricing: table expected`);
  }
  const unknown = Object.keys(raw).filter(
    (k) => !["kind", "currency", "input_per_mtok", "output_per_mtok"].includes(k),
  );
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}.pricing: unknown field '${unknown[0]}'`);
  }
  const kind = parsePricingKind(raw["kind"], `${where}.pricing`);
  const input = attestedField(raw, "input_per_mtok", where, checkPrice);
  const output = attestedField(raw, "output_per_mtok", where, checkPrice);
  for (const [name, att] of [["input_per_mtok", input], ["output_per_mtok", output]] as const) {
    if (att) checkPriceAttestation(att, `${where}.pricing.${name}`);
  }
  let currency: string | null = null;
  if (raw["currency"] !== undefined && raw["currency"] !== null) {
    currency = requireStr(raw, "currency", `${where}.pricing`);
  }
  if ((input || output) && !currency) {
    throw new ContractError(
      "schema",
      `${where}.pricing: 'currency' is required when a per-MTok price is declared`,
    );
  }
  if (kind === "free" && ((input && input.value > 0) || (output && output.value > 0))) {
    throw new ContractError(
      "schema",
      `${where}.pricing: kind 'free' contradicts a nonzero price`,
    );
  }
  return { kind, currency, input_per_mtok: input, output_per_mtok: output };
}

function parseModelEntry(raw: unknown, where: string): ModelCatalogEntry {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: table expected`);
  }
  const unknown = Object.keys(raw).filter(
    (k) =>
      !["tool_call", "context_window", "recommended_for", "discouraged_reason", "pricing"].includes(k),
  );
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown field '${unknown[0]}'`);
  }
  return {
    tool_call: attestedField(raw, "tool_call", where, checkBool),
    context_window: attestedField(raw, "context_window", where, checkPositiveInt),
    recommended_for: attestedField(raw, "recommended_for", where, checkStringList),
    discouraged_reason: attestedField(raw, "discouraged_reason", where, checkNonEmptyStr),
    pricing: parsePricing(raw, where),
  };
}

function parseProviderEntry(
  raw: unknown,
  where: string,
  providerModelIds: readonly string[],
): ProviderCatalogEntry {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: table expected`);
  }
  const unknown = Object.keys(raw).filter(
    (k) => !["billing", "terms", "quota", "rate_limits", "restriction", "models"].includes(k),
  );
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown field '${unknown[0]}'`);
  }
  let terms: string | null = null;
  if (raw["terms"] !== undefined && raw["terms"] !== null) {
    terms = requireStr(raw, "terms", where);
  }
  const models: Record<string, ModelCatalogEntry> = {};
  const rawModels = raw["models"];
  if (rawModels !== undefined && rawModels !== null) {
    if (!isPlainObject(rawModels)) {
      throw new ContractError("schema", `${where}.models: table expected`);
    }
    for (const [modelId, entry] of Object.entries(rawModels)) {
      parseModelId(modelId);
      if (!providerModelIds.includes(modelId)) {
        throw new ContractError(
          "identity",
          `${where}.models.'${modelId}': model is not declared in the provider's models list`,
        );
      }
      models[modelId] = parseModelEntry(entry, `${where}.models.'${modelId}'`);
    }
  }
  return {
    billing: parsePricingKind(raw["billing"], where),
    terms,
    quota: parseQuotaScope(raw["quota"], `${where}.quota`),
    rate_limits: attestedField(raw, "rate_limits", where, checkRateLimits),
    restriction: attestedField(raw, "restriction", where, checkNullValue),
    models,
  };
}

function parseRouteEntry(
  raw: unknown,
  where: string,
  effectiveModels: readonly string[],
): RouteCatalogEntry {
  if (!isPlainObject(raw)) {
    throw new ContractError("schema", `${where}: table expected`);
  }
  const unknown = Object.keys(raw).filter(
    (k) => !["quota", "rate_limits", "concurrency", "e2e", "restriction"].includes(k),
  );
  if (unknown.length > 0) {
    throw new ContractError("schema", `${where}: unknown field '${unknown[0]}'`);
  }
  const e2e = attestedField(raw, "e2e", where, checkE2eValue);
  if (e2e && e2e.value) {
    for (const obs of e2e.value) {
      if (!effectiveModels.includes(obs.model)) {
        throw new ContractError(
          "identity",
          `${where}.e2e: observed model '${obs.model}' is not selectable on this route ` +
            `[${effectiveModels.join(", ")}]`,
        );
      }
    }
  }
  return {
    quota: parseQuotaScope(raw["quota"], `${where}.quota`),
    rate_limits: attestedField(raw, "rate_limits", where, checkRateLimits),
    concurrency: attestedField(raw, "concurrency", where, checkPositiveInt),
    e2e,
    restriction: attestedField(raw, "restriction", where, checkNullValue),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load and validate the `[catalog.*]` tables from an agents.toml file.
 * Throws `ContractError` on any invalid route/model reference, attestation
 * matrix violation, evidence-less price or unknown field. A config without
 * a `[catalog]` table loads as an empty catalog (the metadata is additive).
 */
export function loadCatalog(configFile?: string): Catalog {
  const path = configFile ?? catalogConfigPath();
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

  const providersSection = raw["providers"] ?? {};
  const routesSection = raw["routes"] ?? {};
  if (!isPlainObject(providersSection) || !isPlainObject(routesSection)) {
    throw new ContractError("schema", `${path}: providers/routes must be tables`);
  }
  const providerModelIds = (providerKey: string): string[] => {
    const table = providersSection[providerKey];
    if (!isPlainObject(table)) return [];
    const models = table["models"];
    return Array.isArray(models) ? models.filter((m): m is string => typeof m === "string") : [];
  };
  const routeEffectiveModels = (routeKey: string): string[] => {
    const table = routesSection[routeKey];
    if (!isPlainObject(table)) return [];
    if (Array.isArray(table["models"])) {
      return (table["models"] as unknown[]).filter(
        (m): m is string => typeof m === "string",
      );
    }
    // The provider is part of the route key (`<harness>.<provider>`).
    const dot = routeKey.indexOf(".");
    const providerKey = dot === -1 ? "" : routeKey.slice(dot + 1);
    return providerModelIds(providerKey);
  };

  const catalogRaw = raw["catalog"] ?? {};
  if (!isPlainObject(catalogRaw)) {
    throw new ContractError("schema", "catalog: table expected");
  }
  const unknownTop = Object.keys(catalogRaw).filter((k) => k !== "providers" && k !== "routes");
  if (unknownTop.length > 0) {
    throw new ContractError("schema", `catalog: unknown table 'catalog.${unknownTop[0]}'`);
  }

  const providers: Record<string, ProviderCatalogEntry> = {};
  const rawCatalogProviders = catalogRaw["providers"] ?? {};
  if (!isPlainObject(rawCatalogProviders)) {
    throw new ContractError("schema", "catalog.providers: table expected");
  }
  for (const [key, entry] of Object.entries(rawCatalogProviders)) {
    if (!(key in providersSection)) {
      throw new ContractError("identity", `catalog.providers.'${key}': unknown provider`);
    }
    providers[key] = parseProviderEntry(entry, `catalog.providers.'${key}'`, providerModelIds(key));
  }

  const routes: Record<string, RouteCatalogEntry> = {};
  const rawCatalogRoutes = catalogRaw["routes"] ?? {};
  if (!isPlainObject(rawCatalogRoutes)) {
    throw new ContractError("schema", "catalog.routes: table expected");
  }
  for (const [key, entry] of Object.entries(rawCatalogRoutes)) {
    parseRouteId(key);
    if (!(key in routesSection)) {
      throw new ContractError("identity", `catalog.routes.'${key}': unknown route`);
    }
    routes[key] = parseRouteEntry(
      entry,
      `catalog.routes.'${key}'`,
      routeEffectiveModels(key),
    );
  }

  return { path, providers, routes };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * The single allowance a route draws from: the route's own scope when
 * declared, else the provider's. Equal keys = one shared allowance, so
 * concurrent machines and parallel routes dedupe on this value instead of
 * double-counting an account quota.
 */
export function effectiveQuotaKey(catalog: Catalog, routeId: string): string | null {
  parseRouteId(routeId);
  const [, providerKey] = routeId.split(".") as [string, string];
  const scope = catalog.routes[routeId]?.quota ?? catalog.providers[providerKey]?.quota ?? null;
  return scope ? quotaScopeKey(scope) : null;
}

/**
 * Model facts for a route's model, resolved through the route's provider.
 * Returns null when nothing is known (unknown stays unknown).
 */
export function modelEntry(
  catalog: Catalog,
  routeId: string,
  model: string,
): ModelCatalogEntry | null {
  parseRouteId(routeId);
  parseModelId(model);
  const [, providerKey] = routeId.split(".") as [string, string];
  return catalog.providers[providerKey]?.models[model] ?? null;
}
