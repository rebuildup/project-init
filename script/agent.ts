#!/usr/bin/env bun
/**
 * agent — unified launcher for AI coding harnesses (Bun + TypeScript).
 *
 * Reads the declarative config (config/agents.toml) and starts exactly one
 * harness with exactly one provider:
 *
 *     agent <harness> <provider> [--model <id>] [-- <harness args>...]
 *     <harness>-<provider> [<harness args>...]      # shortcut form
 *     agent list | models <provider> | shortcuts [list|check|create|remove]
 *         | check | help
 *
 * Design contract:
 *   * Thin: parse TOML (Bun.TOML) -> build environment -> spawn the native
 *     CLI with inherited stdio (interactive TUIs keep working; on Unix the
 *     harness used to be exec'd — a single child process per launch is now
 *     used uniformly because Bun has no execve).
 *   * No hardcoded model ids, endpoints or credential env names; they all
 *     come from config/agents.toml (this file only contains adapters, i.e.
 *     how a harness selects a provider/model with its verified native CLI).
 *   * Model resolution: --model / --agent-model > route default > provider
 *     default > harness-native default (only for passthrough harnesses).
 *     Anything else fails before a process starts.
 *   * Credentials come from script/with-secrets (Infisical) process-scoped;
 *     on Windows the PowerShell mirror script/with-secrets.ps1 is used.
 *     The environment is filtered so other providers' secrets never reach
 *     the harness process, and no secret value is ever placed in argv.
 *   * No implicit provider switching, no silent model fallback, no quota
 *     failover. Plain `claude` remains native and untouched.
 *
 * Shortcuts are exact route names (`opencode-zen` = `agent opencode zen`)
 * resolved against config/agents.toml. They are provided as symlinks to
 * this script (Unix) or generated .cmd entry points (Windows); the invoked
 * name is recovered from the kernel-level argv because Bun resolves
 * symlinked argv[1]. Native `claude`/`opencode`/`omp`/`dsh` are never
 * wrapped or overridden.
 */

import { Database } from "bun:sqlite";
import { basename, delimiter, dirname, join } from "node:path";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, homedir } from "node:os";

const PROGRAM = "agent";
const EXIT_USAGE = 2;
const EXIT_RUNTIME = 1;

const ADAPTERS = ["anthropic", "opencode", "omp", "passthrough"];

// argv-safe assign marker handled inside the child stage: only the model id
// crosses argv, the surrounding config is merged from the environment.
const MODEL_MARKER = "@@model:";
// argv-safe marker for the OpenCode custom-provider block: the payload is a
// JSON object mapping the provider id to its block (npm package, endpoint
// URL, credential env NAME, model specs). It never contains a credential
// value — OpenCode reads the key from the named env var — so it is safe to
// carry in argv like every other plan token.
const PROVIDER_MARKER = "@@provider:";
// argv-safe marker for "copy this secret from another env name"; kept
// distinct from a bare `@` so real model ids that start with `@`
// (e.g. Cloudflare's `@cf/...`) pass through as literal values.
const CRED_MARKER = "@@cred:";

const SHORTCUT_MODEL_FLAG = "--agent-model";
const IS_WINDOWS = process.platform === "win32";
const LAUNCHER_BASENAME = basename(import.meta.path);

const USAGE = `\
usage:
  agent <harness> <provider> [--model <id>] [-- <harness args>...]
  agent <harness> [-- <harness args>...]        # native: no provider, no injection
  <harness>-<provider> [<harness args>...]      # shortcut (agent shortcuts create)
  agent list
  agent models <provider>
  agent shortcuts [list|check|create|remove]
  agent check
  agent help

subcommands:
  agent help                 show this help
  agent list                 show every configured harness/provider route
                             (with its shortcut name)
  agent models <provider>    show a provider's credential names and models
  agent shortcuts            list the shortcut names derived from the routes
                             and whether each link is in place
  agent shortcuts check      exit non-zero unless every shortcut link is ours
  agent shortcuts create     create ~/.local/bin/<harness>-<provider> entry
                             points (Unix: symlinks to this launcher;
                             Windows: generated .cmd files). Idempotent;
                             never overwrites a file or command it does not own
  agent shortcuts remove     remove only the entries that point at this
                             launcher; other files are left untouched
  agent check                validate config/agents.toml (used by CI)

shortcut form:
  Invoking <harness>-<provider> (e.g. opencode-zen) is resolved by exact
  match against the routes in config/agents.toml — never by splitting on
  hyphens — and behaves exactly like \`agent <harness> <provider>\`.
  \`agent <harness>-<provider>\` is the portable spelling of the same route.
  Arguments go to the harness directly (no '--' needed; a leading '--' is
  tolerated). The launcher-owned model option is:
    --agent-model <id>        equals the route's --model <id> (this process
                              only; never persisted)

native mode (provider omitted):
  \`agent <harness>\` runs the harness natively: the environment is passed
  through untouched — no endpoint, no model and no credential injection
  (Claude Code uses its subscription login, opencode/omp their own account).
  A leading flag or '--' passes harness arguments:
    agent claude -p "say ok"
    agent opencode -- run "explain this repo"
  --model / -m still require a provider route (exit 2); use plain
  \`<harness>\` when you want the harness's own model flags. A failing
  route never falls back to native mode.

run options:
  --model <id>, -m <id>      model for this process only (never persisted)
  --                         everything after it goes to the harness verbatim
  --help, -h                 show this help (after a route: harness -- --help
                             is the way to ask the harness itself)

model resolution for a run:
  --model  >  route default  >  provider default  >  harness-native default
  (harness-native applies only to passthrough harnesses such as dsh)

examples:
  agent opencode zen
  agent opencode zen -- run "explain this repo"
  agent opencode logfare -- run "say ok" # Logfare (explicit route; 5k req/day)
  agent claude deepseek -- -p "say ok"
  agent claude opencode-go -- -p "say ok"   # Go plan, default DeepSeek V4.1 Flash
  agent omp opencode-go -- -p "hello"       # Go plan, default MiMo V2.6 Flash
  agent claude minimax -- -p "say ok"   # default MiniMax-M3.1-Flash (--model overrides)
  agent omp openrouter -- -p "hello"
  agent dsh deepseek -- web
  agent claude -p "say ok"              # native: subscription login, no injection
  agent dsh -- web                      # native dsh (args after '--')
  opencode-zen -- run "explain this repo"   # shortcut form
  claude                       # plain claude keeps official native auth

config: {config_path}
credentials: {with_secrets} (Infisical, process-scoped)
`;

class AgentError extends Error {
  code: number;
  constructor(message: string, code: number = EXIT_USAGE) {
    super(message);
    this.code = code;
  }
}

interface Provider {
  key: string;
  label: string;
  base_url: string | null;
  secret: string | null;
  env: string | null;
  default_model: string | null;
  require_model: boolean;
  models: string[];
  opencode_id: string;
  omp_id: string;
  // Always source the credential from `secret` (Infisical): the ambient env
  // value is removed before the with-secrets stage, a missing Infisical value
  // fails, and OMP-local auth/model overrides are rejected. See
  // config/agents.toml [providers.opencode-go].
  require_infisical: boolean;
  // OpenCode custom-provider registration (opencode adapter only): npm
  // package for base_url plus a per-model capability/limit contract. Set only
  // when the provider id is unknown to OpenCode's built-in catalog (see
  // config/agents.toml [providers.logfare]); the credential reaches OpenCode
  // as the env NAME, never as a value in config content or argv.
  opencode_npm: string | null;
  opencode_models: Record<string, OcModelSpec>;
}

/** OpenCode model entry built from config: tool support + enforced limits. */
interface OcModelSpec {
  tool_call: boolean;
  limit: { context: number; output: number };
}

interface Harness {
  key: string;
  label: string;
  command: string;
  adapter: string;
  env: Record<string, string>;
}

interface Route {
  key: string;
  harness: string;
  provider: string;
  default_model: string | null;
  models: string[] | null;
  require_model: boolean;
  note: string;
}

interface Config {
  path: string;
  drop_env: string[];
  providers: Record<string, Provider>;
  harnesses: Record<string, Harness>;
  routes: Record<string, Route>;
}

interface Plan {
  command: string[];
  keep: Set<string>;
  copy: Array<[string, string]>;
  unset: string[];
  assign: Array<[string, string]>;
  // (env_name, secret_name) that must hold a credential before exec
  require_cred: Array<[string, string]>;
  // always inject this route's credential from Infisical (no ambient fast path)
  require_infisical: boolean;
  // OMP credential/endpoint override guard, re-checked immediately before spawn
  omp_guard: { providerId: string; envName: string } | null;
  drop: string[];
  baseline: string[] | null; // null = current process env
}

function repoRoot(): string {
  return dirname(dirname(realpathSync(import.meta.path)));
}

function configPath(): string {
  return process.env.AGENT_CONFIG || join(repoRoot(), "config", "agents.toml");
}

function withSecretsPath(): string {
  return (
    process.env.AGENT_WITH_SECRETS ||
    join(repoRoot(), "script", IS_WINDOWS ? "with-secrets.ps1" : "with-secrets")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Route keys are `<harness>.<provider>`; split at the first dot only.
 * (JS String.split's limit argument is not Python's maxsplit.) */
function splitRouteKey(key: string): [string, string] {
  const index = key.indexOf(".");
  return [key.slice(0, index), key.slice(index + 1)];
}

function requireStr(data: Record<string, unknown>, key: string, where: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value) {
    throw new AgentError(`${where}: missing or invalid string '${key}'`);
  }
  return value;
}

function optionalStr(data: Record<string, unknown>, key: string, where: string): string | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value) {
    throw new AgentError(`${where}: '${key}' must be a non-empty string`);
  }
  return value;
}

function stringList(value: unknown, where: string, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new AgentError(`${where}: '${key}' must be a list of non-empty strings`);
  }
  const list = value as string[];
  if (new Set(list).size !== list.length) {
    throw new AgentError(`${where}: '${key}' contains duplicate entries`);
  }
  return [...list];
}

/**
 * Parse a provider's optional `opencode_models` table: one strict entry per
 * model (`tool_call` plus `limit.context`/`limit.output`). Unknown keys fail
 * closed so a typo can never silently drop a model's tool/limit contract and
 * no free-form passthrough (which could carry a credential) exists. Returns
 * null when the table is absent.
 */
function parseOcModels(
  table: Record<string, unknown>,
  where: string
): Record<string, OcModelSpec> | null {
  const raw = table["opencode_models"];
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new AgentError(`${where}: 'opencode_models' must be a table of model entries`);
  }
  const specs: Record<string, OcModelSpec> = {};
  for (const [modelId, entryValue] of Object.entries(raw)) {
    const entryWhere = `${where}.opencode_models.'${modelId}'`;
    if (!isPlainObject(entryValue)) {
      throw new AgentError(`${entryWhere}: table expected`);
    }
    const unknown = Object.keys(entryValue).filter((k) => k !== "tool_call" && k !== "limit");
    if (unknown.length > 0) {
      throw new AgentError(`${entryWhere}: unknown key '${unknown[0]}'`);
    }
    const toolCall = entryValue["tool_call"];
    if (typeof toolCall !== "boolean") {
      throw new AgentError(`${entryWhere}: 'tool_call' must be a boolean`);
    }
    const limit = entryValue["limit"];
    if (!isPlainObject(limit)) {
      throw new AgentError(`${entryWhere}: 'limit' table with context and output expected`);
    }
    const limitUnknown = Object.keys(limit).filter((k) => k !== "context" && k !== "output");
    if (limitUnknown.length > 0) {
      throw new AgentError(`${entryWhere}: unknown limit key '${limitUnknown[0]}'`);
    }
    const context = limit["context"];
    const output = limit["output"];
    if (typeof context !== "number" || !Number.isInteger(context) || context <= 0) {
      throw new AgentError(`${entryWhere}: limit.context must be a positive integer`);
    }
    if (typeof output !== "number" || !Number.isInteger(output) || output <= 0) {
      throw new AgentError(`${entryWhere}: limit.output must be a positive integer`);
    }
    specs[modelId] = { tool_call: toolCall, limit: { context, output } };
  }
  return specs;
}

function loadConfig(path?: string): Config {
  const configPathResolved = path || configPath();
  let text: string;
  try {
    text = readFileSync(configPathResolved, "utf8");
  } catch {
    throw new AgentError(`config not found: ${configPathResolved}`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = Bun.TOML.parse<Record<string, unknown>>(text);
  } catch (exc) {
    throw new AgentError(`invalid TOML in ${configPathResolved}: ${exc}`);
  }

  const defaults = raw["defaults"] ?? {};
  if (!isPlainObject(defaults)) {
    throw new AgentError("defaults: table expected");
  }
  const drop_env = stringList(defaults["drop_env"] ?? [], "defaults", "drop_env");

  const providers: Record<string, Provider> = {};
  const rawProviders = raw["providers"] ?? {};
  if (!isPlainObject(rawProviders)) {
    throw new AgentError("providers: table expected");
  }
  for (const [key, tableValue] of Object.entries(rawProviders)) {
    const where = `providers.${key}`;
    if (!isPlainObject(tableValue)) {
      throw new AgentError(`${where}: table expected`);
    }
    const table = tableValue;
    const secret = optionalStr(table, "secret", where);
    const env = optionalStr(table, "env", where) || secret;
    const models = stringList(table["models"] ?? [], where, "models");
    const default_model = optionalStr(table, "default_model", where);
    const require_model = table["require_model"] ?? false;
    if (typeof require_model !== "boolean") {
      throw new AgentError(`${where}: 'require_model' must be a boolean`);
    }
    const require_infisical = table["require_infisical"] ?? false;
    if (typeof require_infisical !== "boolean") {
      throw new AgentError(`${where}: 'require_infisical' must be a boolean`);
    }
    if (require_infisical && !secret) {
      throw new AgentError(
        `${where}: require_infisical = true requires an Infisical 'secret' name`
      );
    }
    if (default_model && require_model) {
      throw new AgentError(
        `${where}: require_model = true contradicts default_model = '${default_model}'`
      );
    }
    if (default_model && models.length > 0 && !models.includes(default_model)) {
      throw new AgentError(
        `${where}: default_model '${default_model}' is not in models [${models.join(", ")}]`
      );
    }
    const opencode_npm = optionalStr(table, "opencode_npm", where);
    const opencode_models = parseOcModels(table, where);
    if (opencode_models && !opencode_npm) {
      throw new AgentError(
        `${where}: opencode_models requires opencode_npm (a custom-provider registration)`
      );
    }
    if (opencode_npm) {
      // The block is assembled from these fields only, so a credential value
      // can never travel in it; each one must therefore exist.
      if (!optionalStr(table, "base_url", where)) {
        throw new AgentError(`${where}: opencode_npm requires base_url`);
      }
      if (!env) {
        throw new AgentError(`${where}: opencode_npm requires a credential (secret/env name)`);
      }
      if (models.length === 0) {
        throw new AgentError(`${where}: opencode_npm requires a models list`);
      }
      const specs = opencode_models ?? {};
      const missing = models.filter((id) => !(id in specs));
      if (missing.length > 0) {
        throw new AgentError(
          `${where}: opencode_npm requires an opencode_models entry for every model; ` +
            `missing: ${missing.join(", ")}`
        );
      }
      const extra = Object.keys(specs).filter((id) => !models.includes(id));
      if (extra.length > 0) {
        throw new AgentError(
          `${where}: opencode_models entry '${extra[0]}' is not in models [${models.join(", ")}]`
        );
      }
    }
    providers[key] = {
      key,
      label: requireStr(table, "label", where),
      base_url: optionalStr(table, "base_url", where),
      secret,
      env,
      default_model,
      require_model,
      models,
      opencode_id: optionalStr(table, "opencode_id", where) || key,
      omp_id: optionalStr(table, "omp_id", where) || key,
      require_infisical,
      opencode_npm,
      opencode_models: opencode_models ?? {},
    };
  }
  if (Object.keys(providers).length === 0) {
    throw new AgentError("config declares no providers");
  }

  const harnesses: Record<string, Harness> = {};
  const rawHarnesses = raw["harnesses"] ?? {};
  if (!isPlainObject(rawHarnesses)) {
    throw new AgentError("harnesses: table expected");
  }
  for (const [key, tableValue] of Object.entries(rawHarnesses)) {
    const where = `harnesses.${key}`;
    if (!isPlainObject(tableValue)) {
      throw new AgentError(`${where}: table expected`);
    }
    const table = tableValue;
    const adapter = requireStr(table, "adapter", where);
    if (!ADAPTERS.includes(adapter)) {
      throw new AgentError(
        `${where}: unknown adapter '${adapter}' (expected one of ${ADAPTERS.join(", ")})`
      );
    }
    const envTable = table["env"] ?? {};
    if (!isPlainObject(envTable) || Object.values(envTable).some((v) => typeof v !== "string")) {
      throw new AgentError(`${where}: env must map string -> string (names only)`);
    }
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(envTable)) {
      env[name] = value as string;
    }
    if (adapter === "anthropic") {
      const required = [
        "base_url",
        "auth_token",
        "api_key",
        "model",
        "small_fast_model",
        "default_opus",
        "default_sonnet",
        "default_haiku",
      ];
      const missing = required.filter((name) => !(name in env));
      if (missing.length > 0) {
        throw new AgentError(`${where}: adapter anthropic requires env names [${missing.join(", ")}]`);
      }
    }
    if (adapter === "opencode" && !("config_content" in env)) {
      throw new AgentError(`${where}: adapter opencode requires env name 'config_content'`);
    }
    harnesses[key] = {
      key,
      label: requireStr(table, "label", where),
      command: requireStr(table, "command", where),
      adapter,
      env,
    };
  }
  if (Object.keys(harnesses).length === 0) {
    throw new AgentError("config declares no harnesses");
  }

  const routes: Record<string, Route> = {};
  const rawRoutes = raw["routes"] ?? {};
  if (!isPlainObject(rawRoutes)) {
    throw new AgentError("routes: table expected");
  }
  for (const [key, tableValue] of Object.entries(rawRoutes)) {
    const where = `routes.'${key}'`;
    if (!isPlainObject(tableValue)) {
      throw new AgentError(`${where}: table expected`);
    }
    const table = tableValue;
    if (!key.includes(".")) {
      throw new AgentError(`${where}: key must be '<harness>.<provider>'`);
    }
    const [harness_key, provider_key] = splitRouteKey(key);
    if (!(harness_key in harnesses)) {
      throw new AgentError(`${where}: unknown harness '${harness_key}'`);
    }
    if (!(provider_key in providers)) {
      throw new AgentError(`${where}: unknown provider '${provider_key}'`);
    }
    let route_models: string[] | null = null;
    if (table["models"] !== undefined && table["models"] !== null) {
      route_models = stringList(table["models"], where, "models");
    }
    const require_model = table["require_model"] ?? false;
    if (typeof require_model !== "boolean") {
      throw new AgentError(`${where}: 'require_model' must be a boolean`);
    }
    const route: Route = {
      key,
      harness: harness_key,
      provider: provider_key,
      default_model: optionalStr(table, "default_model", where),
      models: route_models,
      require_model,
      note: optionalStr(table, "note", where) || "",
    };
    validateRouteDefaults(route, providers[provider_key]);
    routes[key] = route;
  }
  if (Object.keys(routes).length === 0) {
    throw new AgentError("config declares no routes");
  }

  // Every claude-anthropic route needs an Anthropic-compatible endpoint;
  // an OpenCode custom-provider registration only the opencode adapter can
  // honor must not be declared silently inert on another adapter's route.
  for (const route of Object.values(routes)) {
    const harness = harnesses[route.harness];
    const provider = providers[route.provider];
    if (harness.adapter === "anthropic" && !provider.base_url) {
      throw new AgentError(
        `routes.${route.key}: adapter anthropic needs provider '${provider.key}' to declare base_url`
      );
    }
    if (provider.opencode_npm && harness.adapter !== "opencode") {
      throw new AgentError(
        `routes.${route.key}: provider '${provider.key}' declares opencode_npm but harness ` +
          `'${route.harness}' uses adapter '${harness.adapter}'; the custom-provider block ` +
          "can only be registered on an 'opencode' route"
      );
    }
  }

  // Shortcut names must be unambiguous: `harness-provider` is derived from
  // the route key, and two different routes must never map to one name.
  const seen: Record<string, string> = {};
  for (const key of Object.keys(routes)) {
    const [harness_key, provider_key] = splitRouteKey(key);
    const name = shortcutName(harness_key, provider_key);
    if (name in seen) {
      throw new AgentError(
        `routes.${key}: shortcut name '${name}' collides with route ${seen[name]}; ` +
          "rename the harness or provider key"
      );
    }
    seen[name] = key;
  }

  return { path: configPathResolved, drop_env, providers, harnesses, routes };
}

function effectiveModels(route: Route, provider: Provider): string[] {
  return route.models ?? provider.models;
}

function routeRequiresModel(route: Route, provider: Provider): boolean {
  return route.require_model || provider.require_model;
}

function routeDefaultModel(route: Route, provider: Provider): string | null {
  return route.default_model || provider.default_model;
}

function validateRouteDefaults(route: Route, provider: Provider): void {
  const where = `routes.'${route.key}'`;
  const defaultModel = routeDefaultModel(route, provider);
  const models = effectiveModels(route, provider);
  if (routeRequiresModel(route, provider)) {
    if (defaultModel) {
      throw new AgentError(
        `${where}: require_model = true but a default model '${defaultModel}' exists`
      );
    }
    if (models.length === 0) {
      throw new AgentError(
        `${where}: require_model = true needs a models list to validate --model`
      );
    }
    return;
  }
  if (!defaultModel) {
    throw new AgentError(
      `${where}: no default model and require_model is not set; ` +
        "declare route.default_model, provider.default_model or require_model = true"
    );
  }
  if (models.length > 0 && !models.includes(defaultModel)) {
    throw new AgentError(
      `${where}: default model '${defaultModel}' is not in models [${models.join(", ")}]`
    );
  }
}

function resolveModel(route: Route, provider: Provider, cliModel: string | null): string {
  let model: string | null;
  if (cliModel) {
    model = cliModel;
  } else {
    if (process.env.AGENT_MODEL) {
      console.error("agent: warning: AGENT_MODEL is no longer read; use --model");
    }
    model = routeDefaultModel(route, provider);
    if (model === null) {
      throw new AgentError(
        `route '${route.key}' requires an explicit model; pass --model <id>. ` +
          `Known models: ${effectiveModels(route, provider).join(", ")}`
      );
    }
  }
  const models = effectiveModels(route, provider);
  if (models.length > 0 && !models.includes(model)) {
    throw new AgentError(
      `unknown model '${model}' for route '${route.key}'; known models:\n  ` +
        models.join("\n  ") +
        "\nModels are declared in config/agents.toml (edit it to add one)."
    );
  }
  return model;
}

// ---------------------------------------------------------------------------
// Shortcut form: `<harness>-<provider>` invoked directly (symlink to this
// script on Unix, generated .cmd on Windows). The name is resolved by exact
// match against the configured routes, never by splitting on hyphens.
// ---------------------------------------------------------------------------

function shortcutName(harnessKey: string, providerKey: string): string {
  return `${harnessKey}-${providerKey}`;
}

function shortcutMap(config: Config): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const key of Object.keys(config.routes)) {
    const [harness_key, provider_key] = splitRouteKey(key);
    mapping[shortcutName(harness_key, provider_key)] = key;
  }
  return mapping;
}

function resolveShortcut(config: Config, name: string): [string, string] {
  const routeKey = shortcutMap(config)[name];
  if (!routeKey) {
    if (name.startsWith("pi-")) {
      // Stale links from the retired Pi Worker slot still point at this
      // launcher. Name the replacement and the exact path to remove; the
      // launcher never deletes a link it did not create in this generation.
      throw new AgentError(
        `'${name}' is a retired Pi Worker shortcut; the slot moved to OMP. ` +
          `Use '${name.replace(/^pi-/, "omp-")}' after 'agent shortcuts create', ` +
          `and remove the stale link if present: rm ${join(binDir(), name)}`
      );
    }
    const known = Object.keys(shortcutMap(config)).sort().join(", ");
    throw new AgentError(
      `unknown shortcut '${name}'; shortcuts exist for these routes: ${known}\n` +
        "Define the route in config/agents.toml and run 'agent shortcuts create' to link it."
    );
  }
  const [harnessKey, providerKey] = splitRouteKey(routeKey);
  return [harnessKey, providerKey];
}

function parseShortcutArgs(argv: string[]): { model: string | null; passthru: string[] } {
  // Shortcut argv: only --agent-model is launcher-owned, the rest is the
  // harness's own argument vector (passed verbatim, no '--' required).
  let model: string | null = null;
  const passthru: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === SHORTCUT_MODEL_FLAG) {
      if (index + 1 >= argv.length) {
        throw new AgentError(`${token} requires a value`);
      }
      model = argv[index + 1];
      index += 2;
      continue;
    }
    if (token.startsWith(`${SHORTCUT_MODEL_FLAG}=`)) {
      const value = token.slice(SHORTCUT_MODEL_FLAG.length + 1);
      if (!value) {
        throw new AgentError(`'${token}' requires a value`);
      }
      model = value;
      index += 1;
      continue;
    }
    passthru.push(token);
    index += 1;
  }
  if (passthru.length > 0 && passthru[0] === "--") {
    // tolerated so `opencode-zen -- run …` matches the agent-form habit
    passthru.shift();
  }
  return { model, passthru };
}

/**
 * Recover the script path this process was invoked as. Bun resolves the
 * symlinked argv[1] to the real file, so the kernel-level argv is consulted
 * instead: /proc/self/cmdline on Linux (WSL included), `ps` on macOS.
 */
function invokedScriptPath(): string | null {
  const a1 = process.argv[1];
  if (a1) {
    const base = basename(a1);
    if (base !== LAUNCHER_BASENAME && base !== "bun") {
      return a1; // invoked as another file (or an unresolved symlink)
    }
  }
  let kernelArgv: string[] | null = null;
  if (process.platform === "linux") {
    try {
      kernelArgv = readFileSync("/proc/self/cmdline", "utf8").split("\0").filter(Boolean);
    } catch {
      kernelArgv = null;
    }
  } else if (process.platform === "darwin") {
    try {
      const result = Bun.spawnSync(["ps", "-p", String(process.pid), "-o", "args="]);
      if (result.exitCode === 0) {
        kernelArgv = result.stdout.toString().trim().split(/\s+/).filter(Boolean);
      }
    } catch {
      kernelArgv = null;
    }
  }
  const token = kernelArgv && kernelArgv.length > 1 ? kernelArgv[1] : null;
  if (token && basename(token) !== LAUNCHER_BASENAME && basename(token) !== "bun") {
    return token;
  }
  return null;
}

function binDir(): string {
  if (process.env.AGENT_BIN_DIR) return process.env.AGENT_BIN_DIR;
  return join(homedir(), ".local", "bin");
}

function launcherLinkTarget(): string {
  return realpathSync(import.meta.path);
}

function shortcutPath(name: string): string {
  const ext = IS_WINDOWS ? ".cmd" : "";
  return join(binDir(), `${name}${ext}`);
}

function which(cmd: string, pathEnv?: string): string | null {
  const hasSeparator = cmd.includes("/") || (IS_WINDOWS && cmd.includes("\\"));
  const isExecutable = (candidate: string): boolean => {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (hasSeparator) {
    return isExecutable(cmd) ? cmd : null;
  }
  const pathValue = pathEnv ?? process.env.PATH ?? "";
  // Windows: PATHEXT candidates BEFORE the bare name. npm generates an
  // extensionless Bash-style shim next to `opencode.cmd` for Cygwin-style
  // shells; that file is not a Windows executable, so trying the bare name
  // first would pick an unrunnable target.
  const exts = IS_WINDOWS
    ? [...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean), ""]
    : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const base = join(dir, cmd);
    for (const suffix of exts) {
      const candidate = base + suffix;
      if (existsSync(candidate) && isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

const WINDOWS_CMD_MARKER = "rem managed-by: agent-launcher";

/** A Windows batch shim (.cmd/.bat, e.g. npm's cmd-shim output) cannot be
 * started by CreateProcess/Bun.spawn directly; it needs cmd.exe. */
function isBatchShim(path: string): boolean {
  return IS_WINDOWS && /\.(cmd|bat)$/i.test(path);
}

/**
 * Build the argv used to launch a resolved harness. Batch shims run through
 * cmd.exe, which re-parses its command tail per batch semantics and does not
 * understand the backslash-escaped quotes that CreateProcess argv
 * serialization produces — so the fully quoted command line travels through
 * an environment variable and is expanded by cmd itself (quotes in the
 * expanded text toggle cmd's quoting state, keeping `& | < > ( )` and spaces
 * inside quoted arguments literal). Double quotes and `%` cannot be
 * represented faithfully at all; those arguments are rejected up front
 * (fail closed) instead of risking corruption or injection.
 */
function launchArgv(
  resolved: string,
  args: string[],
  env: Record<string, string>
): string[] {
  if (!isBatchShim(resolved)) {
    return [resolved, ...args];
  }
  if (resolved.includes("%")) {
    throw new AgentError(
      `harness path '${resolved}' contains '%' which cannot be passed safely ` +
        "through cmd.exe; move the harness to a path without '%'",
      EXIT_RUNTIME
    );
  }
  for (const arg of args) {
    if (/["%\r\n]/.test(arg)) {
      throw new AgentError(
        `harness argument ${JSON.stringify(arg)} contains \" or % which cannot be passed ` +
          "safely through a Windows batch shim (.cmd/.bat); remove it from the " +
          "harness arguments or invoke the harness directly",
        EXIT_RUNTIME
      );
    }
  }
  const quote = (arg: string): string =>
    arg === "" || /[\s&|<>^(),;]/.test(arg) ? `"${arg}"` : arg;
  env["AGENT_LAUNCH_CMD"] = [resolved, ...args].map(quote).join(" ");
  const comspec = process.env.ComSpec || "cmd.exe";
  return [comspec, "/d", "/c", "%AGENT_LAUNCH_CMD%"];
}

function shortcutLinkTargetContent(target: string, name: string): string {
  // Minimal Windows entry point generated from the routes; the name is the
  // only thing in argv, everything else stays in script/agent.ts.
  return `@echo off\r\n${WINDOWS_CMD_MARKER} ${target}\r\nbun "${target}" ${name} %*\r\n`;
}

function linkStatus(name: string, target: string): string {
  const path = shortcutPath(name);
  if (IS_WINDOWS) {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf8");
      return content.includes(`${WINDOWS_CMD_MARKER} ${target}`) ? "linked" : "conflict (existing file)";
    }
    return which(name) ? `conflict (command exists at ${which(name)})` : "missing";
  }
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      // realpathSync throws for a dangling link (e.g. after the checkout
      // moved); treat it as a conflict so `create` never tries EEXIST and
      // the user gets an actionable message instead of "missing".
      try {
        return realpathSync(path) === target ? "linked" : "conflict (foreign symlink)";
      } catch {
        return "conflict (dangling symlink)";
      }
    }
    return "conflict (existing file)";
  } catch {
    return which(name) ? `conflict (command exists at ${which(name)})` : "missing";
  }
}

function cmdShortcuts(config: Config, action: string | null): number {
  const target = launcherLinkTarget();
  const names = Object.keys(shortcutMap(config)).sort();
  const where = binDir();

  if (action === null || action === "list") {
    console.log(`shortcut commands (from ${config.path}):`);
    for (const name of names) {
      console.log(`  ${name.padEnd(24)} ${linkStatus(name, target)}`);
    }
    console.log(`location: ${where}   target: ${target}`);
    console.log("create/remove with: agent shortcuts create | remove");
    return 0;
  }

  if (action === "check") {
    const bad = names.filter((name) => linkStatus(name, target) !== "linked");
    if (bad.length > 0) {
      console.error(
        `shortcuts not ready: ${bad.join(", ")}\n` +
          `run 'agent shortcuts create' (location: ${where})`
      );
      return EXIT_RUNTIME;
    }
    console.log(`shortcuts OK: ${names.length} links in ${where} point at ${target}`);
    return 0;
  }

  if (action === "create") {
    const conflicts: string[] = [];
    for (const name of names) {
      const status = linkStatus(name, target);
      if (status === "linked") continue;
      if (status.startsWith("conflict")) {
        conflicts.push(`${shortcutPath(name)}: ${status}`);
      }
    }
    if (conflicts.length > 0) {
      throw new AgentError(
        `refusing to overwrite:\n  ${conflicts.join("\n  ")}\n` +
          "remove or rename these entries, then re-run 'agent shortcuts create'",
        EXIT_RUNTIME
      );
    }
    mkdirSync(where, { recursive: true });
    let created = 0;
    let linked = 0;
    for (const name of names) {
      const path = shortcutPath(name);
      if (existsSync(path)) {
        linked += 1;
        continue;
      }
      if (IS_WINDOWS) {
        writeFileSync(path, shortcutLinkTargetContent(target, name));
      } else {
        symlinkSync(target, path);
      }
      created += 1;
    }
    console.log(`shortcuts ready: ${created} created, ${linked} already linked in ${where}`);
    return 0;
  }

  if (action === "remove") {
    let removed = 0;
    for (const name of names) {
      const path = shortcutPath(name);
      if (IS_WINDOWS) {
        if (existsSync(path) && readFileSync(path, "utf8").includes(`${WINDOWS_CMD_MARKER} ${target}`)) {
          unlinkSync(path);
          removed += 1;
        } else if (existsSync(path)) {
          console.log(`left untouched (not managed by the launcher): ${path}`);
        }
        continue;
      }
      try {
        const stat = lstatSync(path);
        if (!stat.isSymbolicLink()) {
          console.log(`left untouched (not managed by the launcher): ${path}`);
          continue;
        }
        let pointsHere = false;
        try {
          pointsHere = realpathSync(path) === target;
        } catch {
          // dangling: the target cannot be verified, so it is not provably
          // ours — keep it and tell the user instead of silently skipping.
          console.log(`left untouched (dangling symlink): ${path}`);
          continue;
        }
        if (pointsHere) {
          unlinkSync(path);
          removed += 1;
        } else {
          console.log(`left untouched (not managed by the launcher): ${path}`);
        }
      } catch {
        // nothing to remove
      }
    }
    console.log(`shortcuts removed: ${removed}`);
    return 0;
  }

  throw new AgentError(
    `unknown shortcuts action '${action}'; use list, check, create or remove`
  );
}

// ---------------------------------------------------------------------------
// argv parsing (agent-form)
// ---------------------------------------------------------------------------

const FORBIDDEN_PASSTHRU: Record<string, string> = {
  "--model": "use the launcher's model option instead (--model for `agent …`, --agent-model for shortcuts)",
  "-m": "use the launcher's model option instead (--model for `agent …`, --agent-model for shortcuts)",
  "--provider": "the provider is chosen as: agent <harness> <provider>",
  "--api-key": "credentials come from Infisical via script/with-secrets",
  "--fallback-model": "automatic model fallback is intentionally unsupported",
};

// OMP reads its credential/config ladder from files and env that the launcher
// verifies before starting. These flags would move that source after the check
// (or re-point the model roles), so they are rejected for the omp adapter.
// The same flag spellings are harmless or meaningful to other harnesses, so
// the list is adapter-scoped.
const OMP_FORBIDDEN_PASSTHRU: Record<string, string> = {
  "--profile": "profiles relocate OMP's auth/config dir; the launcher verifies only the default profile",
  "--config": "an extra config overlay is outside the launcher's credential-source check and would re-place the launcher's tool-surface overlay arrays",
  "--cwd": "changing cwd changes the project .omp config and .env that OMP reads",
  "--smol": "the launcher pins this model role to the route model",
  "--slow": "the launcher pins this model role to the route model",
  "--plan": "the launcher pins this model role to the route model",
  "--prewalk": "prewalk switches to another model automatically; implicit switching is unsupported",
  "--prewalk-into": "prewalk switches to another model automatically; implicit switching is unsupported",
  "--plan-yolo": "plan-yolo changes the model and auto-approves the plan; the launcher does not imply either",
  "--plan-yolo-into": "plan-yolo changes the model and auto-approves the plan; the launcher does not imply either",
  "--trusted-extension": "the launcher names every trusted module; an extra module can register a credential/model fallback outside the guard",
  "--extension": "an extra extension can register a credential/model fallback outside the guard and change routing mid-session",
  "-e": "an extra extension can register a credential/model fallback outside the guard and change routing mid-session",
  "--hook": "an extra hook/extension can register a credential/model fallback outside the guard and change routing mid-session",
  "--advisor": "the launcher rejects advisor.enabled: true in config; the CLI flag must not enable the advisor runtime anyway",
  "--tools": "the Worker tool surface is fixed at read,bash,edit,write; a later --tools replaces the launcher's list (last-wins)",
  "--models": "the launcher validates the route model; --models feeds unvalidated ids to Ctrl+P cycling",
};

function checkPassthru(passthru: string[], harness: Harness): void {
  const forbidden =
    harness.adapter === "omp"
      ? { ...FORBIDDEN_PASSTHRU, ...OMP_FORBIDDEN_PASSTHRU }
      : FORBIDDEN_PASSTHRU;
  for (const token of passthru) {
    // Match `--flag` and `--flag=value` forms alike so an inline value
    // cannot smuggle a forbidden selector past this filter.
    const flag = token.startsWith("-") ? token.split("=", 1)[0] : token;
    const reason = forbidden[flag];
    if (reason) {
      throw new AgentError(
        `harness argument '${token}' is not allowed for adapter '${harness.adapter}': ${reason}`
      );
    }
  }
}

type Action =
  | ["help"]
  | ["version"]
  | ["list"]
  | ["check"]
  | ["models", string]
  | ["shortcuts", string | null]
  | ["native", string, string[]]
  | ["run", string, string, string | null, string[]];

function parseArgs(argv: string[]): Action {
  // Parse argv without touching the config.
  const head = argv[0];
  if (head === "help" || head === "--help" || head === "-h") {
    if (argv.length > 1) {
      throw new AgentError(`unexpected arguments for 'help': ${argv.slice(1).join(" ")}`);
    }
    return ["help"];
  }
  if (head === "--version" || head === "-V") {
    return ["version"];
  }
  if (head === "list") {
    if (argv.length > 1) {
      throw new AgentError(`unexpected arguments for 'list': ${argv.slice(1).join(" ")}`);
    }
    return ["list"];
  }
  if (head === "check") {
    if (argv.length > 1) {
      throw new AgentError(`unexpected arguments for 'check': ${argv.slice(1).join(" ")}`);
    }
    return ["check"];
  }
  if (head === "models") {
    if (argv.length !== 2) {
      throw new AgentError("usage: agent models <provider>");
    }
    return ["models", argv[1]];
  }
  if (head === "shortcuts") {
    if (argv.length < 2) {
      return ["shortcuts", null];
    }
    if (argv.length === 2 && ["list", "check", "create", "remove"].includes(argv[1])) {
      return ["shortcuts", argv[1]];
    }
    throw new AgentError(
      `unknown shortcuts action '${argv.slice(1).join(" ")}'; ` +
        "usage: agent shortcuts [list|check|create|remove]"
    );
  }

  const harnessKey = head;
  if (argv.length < 2) {
    // Provider omitted: native mode — run the harness untouched (no
    // endpoint/model/credential injection; its own subscription/account).
    return ["native", harnessKey, []];
  }
  if (argv[1] === "--help" || argv[1] === "-h" || argv[1] === "help") {
    return ["help"];
  }
  if (argv[1] === "--model" || argv[1] === "-m") {
    throw new AgentError(
      `--model requires a provider route: agent ${harnessKey} <provider> --model <id> ` +
        "(native mode keeps the harness's own model selection)"
    );
  }
  if (argv[1].startsWith("-")) {
    // No provider name starts with '-': everything here belongs to the
    // harness in native mode. Only a '--' as the first harness token is a
    // separator; any later '--' is forwarded with the rest of the tail.
    const passthru = argv[1] === "--" ? argv.slice(2) : argv.slice(1);
    return ["native", harnessKey, passthru];
  }
  const providerKey = argv[1];

  let model: string | null = null;
  let passthru: string[] = [];
  const rest = argv.slice(2);
  let index = 0;
  while (index < rest.length) {
    const token = rest[index];
    if (token === "--") {
      passthru = rest.slice(index + 1);
      break;
    }
    if (token === "--model" || token === "-m") {
      if (index + 1 >= rest.length) {
        throw new AgentError(`${token} requires a value`);
      }
      model = rest[index + 1];
      index += 2;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return ["help"];
    }
    throw new AgentError(
      `unexpected argument '${token}'; pass harness arguments after '--' ` +
        `(e.g. agent ${harnessKey} ${providerKey} -- <args>)`
    );
  }
  return ["run", harnessKey, providerKey, model, passthru];
}

// ---------------------------------------------------------------------------
// Plan building (adapters = verified native CLI contracts)
// ---------------------------------------------------------------------------

function buildPlan(
  config: Config,
  harness: Harness,
  provider: Provider,
  route: Route,
  model: string | null,
  passthru: string[]
): Plan {
  checkPassthru(passthru, harness);

  const keep = new Set<string>();
  const copy: Array<[string, string]> = [];
  const require_cred: Array<[string, string]> = [];
  if (provider.secret || provider.env) {
    const envName = provider.env || provider.secret;
    const secretName = provider.secret || provider.env;
    if (!envName || !secretName) throw new AgentError(`provider '${provider.key}' declares no credential`);
    keep.add(envName);
    keep.add(secretName);
    require_cred.push([envName, secretName]);
    if (envName !== secretName) {
      // stage 2 copies the secret value into the env name the harness reads
      copy.push([envName, secretName]);
    }
  }

  // Every credential name declared anywhere in the config is dropped by
  // default; the route's own keep-set always wins over it. This keeps a
  // newly added provider's shell value out of unrelated harness processes
  // even on the fast path (no script/with-secrets round trip).
  const providerCreds = new Set<string>();
  for (const p of Object.values(config.providers)) {
    if (p.secret) providerCreds.add(p.secret);
    if (p.env) providerCreds.add(p.env);
  }
  const plan: Plan = {
    command: [harness.command, ...passthru],
    keep,
    copy,
    unset: [],
    assign: [],
    require_cred,
    require_infisical: provider.require_infisical,
    omp_guard: null,
    drop: [...new Set([...config.drop_env, ...providerCreds])].sort(),
    baseline: null,
  };

  if (harness.adapter === "anthropic") {
    planAnthropic(plan, harness, provider, route, model);
  } else if (harness.adapter === "opencode") {
    planOpencode(plan, harness, provider, model);
  } else if (harness.adapter === "omp") {
    planOmp(plan, harness, provider, model);
  } else if (harness.adapter === "passthrough") {
    // Model selection stays native for passthrough harnesses; --model is
    // rejected in cmdRun before we get here.
  } else {
    // guarded by loadConfig
    throw new AgentError(`unknown adapter '${harness.adapter}'`);
  }
  return plan;
}

function planAnthropic(
  plan: Plan,
  harness: Harness,
  provider: Provider,
  route: Route,
  model: string | null
): void {
  if (model === null) {
    // defensive; routes validate their defaults
    throw new AgentError(`route '${route.key}' resolved no model`);
  }
  if (!provider.base_url) {
    throw new AgentError(`provider '${provider.key}' has no base_url for adapter anthropic`);
  }
  if (!provider.env) {
    throw new AgentError(`provider '${provider.key}' declares no credential env name`);
  }
  const env = harness.env;
  plan.unset.push(env["api_key"]);
  plan.assign.push(
    [env["base_url"], provider.base_url],
    [env["auth_token"], CRED_MARKER + provider.env],
    [env["model"], model],
    [env["small_fast_model"], model],
    // Single-model routes map every model role (including subagents, which
    // follow ANTHROPIC_DEFAULT_HAIKU_MODEL) to the route model;
    // CLAUDE_CODE_SUBAGENT_MODEL stays unset because it is not needed.
    [env["default_opus"], model],
    [env["default_sonnet"], model],
    [env["default_haiku"], model]
  );
}

function planOpencode(plan: Plan, harness: Harness, provider: Provider, model: string | null): void {
  if (model === null) {
    throw new AgentError("resolved no model for adapter opencode");
  }
  const configEnv = harness.env["config_content"];
  // v2: the global `--model` flag does not exist (it prints help), so the
  // model is selected through the inline config override, which merges last
  // over global/project config. Only the *model id* travels in argv; the
  // merge with an existing OPENCODE_CONFIG_CONTENT happens in finalize(),
  // because a caller's inline config may itself contain credentials.
  plan.assign.push([configEnv, MODEL_MARKER + `${provider.opencode_id}/${model}`]);

  // Custom OpenCode provider registration (e.g. Logfare): OpenCode does not
  // know this provider id natively, so the inline config must define it.
  // The block is assembled only from validated config fields; the credential
  // travels as the env NAME (`env: [...]`), which is how OpenCode resolves
  // the key — no secret value enters config content or argv.
  if (provider.opencode_npm) {
    if (!provider.base_url || !provider.env) {
      // defensive; loadConfig rejects these combinations
      throw new AgentError(`provider '${provider.key}' lacks base_url/credential for opencode_npm`);
    }
    const models: Record<string, OcModelSpec> = {};
    for (const id of provider.models) {
      const spec = provider.opencode_models[id];
      if (!spec) {
        throw new AgentError(`provider '${provider.key}' has no opencode_models entry for '${id}'`);
      }
      models[id] = spec;
    }
    const block: Record<string, unknown> = {
      npm: provider.opencode_npm,
      name: provider.label,
      env: [provider.env],
      options: { baseURL: provider.base_url },
      models,
    };
    plan.assign.push([
      configEnv,
      PROVIDER_MARKER + JSON.stringify({ [provider.opencode_id]: block }),
    ]);
  }

  // A running background `opencode` service loads config and credentials
  // from ITS OWN environment, so without a private server both the model
  // above and the provider credential would be ignored (verified: the
  // service keeps answering with the global config model and reports
  // "Model unavailable" for providers it never saw a key for). Force
  // process-scoped `--standalone` unless the caller chose a server mode.
  const passthru = plan.command.slice(1);
  if (passthru.includes("--standalone") || passthru.includes("--server")) {
    return;
  }
  if (passthru.length > 0 && !passthru[0].startsWith("-")) {
    const subcommand = passthru[0];
    if (subcommand === "run" || subcommand === "mini") {
      // subcommands that accept the flag
      plan.command = [plan.command[0], subcommand, "--standalone", ...passthru.slice(1)];
    }
    // other subcommands (models, auth, ...) do not launch a session and
    // are passed through untouched
    return;
  }
  plan.command = [plan.command[0], "--standalone", ...passthru];
}

const OMP_DESTRUCTIVE_GUARD = "omp-destructive-guard.ts";
const OMP_WORKER_OVERLAY = "omp-worker-overlay.yml";
const OMP_WORKER_TOOLS = "read,bash,edit,write";

/** Absolute real path of the destructive guard shipped next to this launcher.
 * It is loaded with --trusted-extension, which aborts when loading fails, so
 * a missing file must fail before a process starts. */
function ompDestructiveGuardPath(): string {
  const candidate = join(import.meta.dir, OMP_DESTRUCTIVE_GUARD);
  try {
    return realpathSync(candidate);
  } catch {
    throw new AgentError(
      `missing OMP destructive guard: ${candidate}; refusing to start without ` +
        "the Worker permission boundary",
      EXIT_RUNTIME
    );
  }
}

/** Absolute real path of the Worker tool-surface overlay shipped next to this
 * launcher. It disables the OMP discovery providers that mount MCP tools
 * (ADR-0014 item 5): `--tools` only filters built-in tools. OMP's strict
 * `--config` loader aborts on a missing file, but the launcher must fail
 * before it builds a command — without the overlay a session would start
 * with MCP servers mounted. */
function ompWorkerOverlayPath(): string {
  const candidate = join(import.meta.dir, OMP_WORKER_OVERLAY);
  try {
    return realpathSync(candidate);
  } catch {
    throw new AgentError(
      `missing OMP worker overlay: ${candidate}; refusing to start without ` +
        "the MCP tool-surface boundary",
      EXIT_RUNTIME
    );
  }
}

/** Herdr's OMP integration lives in the OMP agent extension directory.
 * --trusted-extension disables ambient extension discovery, so it must be
 * passed explicitly while the launcher runs inside Herdr. */
function ompHerdrExtensionPath(): string {
  const candidate = join(homedir(), ".omp", "agent", "extensions", "herdr-omp-agent-state.ts");
  try {
    return realpathSync(candidate);
  } catch {
    throw new AgentError(
      `Herdr integration missing: ${candidate}; run 'herdr integration install omp' ` +
        "or start the agent outside Herdr",
      EXIT_RUNTIME
    );
  }
}

/** True when the launcher itself runs inside a Herdr pane. OMP treats any of
 * its pane/tab/workspace variables as inside Herdr, not just HERDR_ENV. */
function insideHerdr(): boolean {
  return (
    process.env.HERDR_ENV === "1" ||
    Boolean(
      process.env.HERDR_PANE_ID ||
        process.env.HERDR_TAB_ID ||
        process.env.HERDR_WORKSPACE_ID
    )
  );
}

function planOmp(plan: Plan, harness: Harness, provider: Provider, model: string | null): void {
  if (model === null) throw new AgentError("resolved no model for adapter omp");
  const selector = `${provider.omp_id}/${model}`;
  const guardPath = ompDestructiveGuardPath();

  // Model-pinning boundary for EVERY omp route, not just require_infisical:
  // agents.toml forbids implicit model fallback on all routes, so
  // omp.openrouter-free must fail closed on a user fallback chain that could
  // move a rate-limited free request to a paid model. The credential-source
  // checks below (dotenv/profile, broker, models.*, stored credentials) stay
  // require_infisical-only.
  guardOmpImplicitSwitch(provider.omp_id);

  const args: string[] = [
    "--provider", provider.omp_id,
    "--model", model,
  ];
  if (provider.require_infisical) {
    const envName = provider.env || provider.secret;
    if (!envName) {
      throw new AgentError(`provider '${provider.key}' declares no credential env name`);
    }
    guardOmpCredentialSource(provider.omp_id, envName);
    plan.omp_guard = { providerId: provider.omp_id, envName };
    // Pin the model roles. --models only drives Ctrl+P cycling, so it is not
    // a security allowlist and is intentionally not passed.
    args.push(
      "--smol", selector,
      "--slow", selector,
      "--plan", selector,
    );
  }
  // Worker tool parity with the former Pi slot: no task sub-agents, web,
  // browser, python or todo tools. --trusted-extension disables ambient
  // extension discovery; the destructive guard (and Herdr, when present) are
  // the only extensions loaded. The overlay disables the discovery providers
  // that would mount MCP servers: --tools only filters built-in tools.
  args.push(
    "--tools", OMP_WORKER_TOOLS,
    "--no-lsp",
    "--no-pty",
    "--no-title",
    "--trusted-extension", guardPath,
    "--config", ompWorkerOverlayPath(),
  );
  if (insideHerdr()) {
    args.push("--trusted-extension", ompHerdrExtensionPath());
  }
  // A fresh machine's first interactive run otherwise blocks on OMP's setup
  // wizard before the Worker can accept a Herdr prompt. The slot is fully
  // configured by the launcher flags; onboarding choices must not be made
  // implicitly. `omp setup` remains available explicitly outside the launcher.
  plan.assign.push(["OMP_SKIP_SETUP", "1"]);
  plan.command = [harness.command, ...args, ...plan.command.slice(1)];
}

const OMP_REJECTED_ENV_KEYS = [
  "OMP_PROFILE",
  "PI_PROFILE",
  "PI_CONFIG_DIR",
  "OMP_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
  "OMP_CODING_AGENT_DIR",
];

/** The default-profile OMP agent dir. A relocated dir is rejected, never
 * followed: the guard must inspect the directory OMP actually reads. */
function ompAgentDir(): string {
  return join(homedir(), ".omp", "agent");
}

/**
 * Dotenv files OMP loads, in its own order: project cwd `.env`, active agent
 * `.env`, config-root `.env`, home `.env`. OMP only fills keys absent from the
 * process env and mirrors `OMP_*` to `PI_*` within each file, so any
 * assignment is a conflict for an Infisical-backed route. Parsing is
 * line-oriented and never evaluates or expands values.
 */
function readOmpDotenvAssignments(): Array<{ path: string; names: Set<string> }> {
  const files: Array<{ path: string; names: Set<string> }> = [];
  for (const path of [
    join(process.cwd(), ".env"),
    join(ompAgentDir(), ".env"),
    join(homedir(), ".omp", ".env"),
    join(homedir(), ".env"),
  ]) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      // Only ENOENT proves "no dotenv override". Any other error means the
      // credential source cannot be verified, so the route must not start.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentError(
        `cannot read OMP dotenv file (${path}): ${detail}; refusing to start ` +
          "because the credential source cannot be verified",
        EXIT_RUNTIME
      );
    }
    const names = new Set<string>();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) names.add(match[1]);
    }
    files.push({ path, names });
  }
  return files;
}

/**
 * Read an OMP config/models file as a mapping. `null` means the file does not
 * exist; empty content means an empty mapping; anything unreadable, invalid,
 * or not a mapping fails closed (the override layer cannot be verified).
 */
function readOmpMapping(
  path: string,
  label: string,
  format: "yaml" | "json"
): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentError(
      `cannot read OMP ${label} (${path}): ${detail}; refusing to start because ` +
        "the credential source cannot be verified",
      EXIT_RUNTIME
    );
  }
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = format === "yaml" ? Bun.YAML.parse(text) : JSON.parse(text);
  } catch {
    throw new AgentError(
      `invalid ${format.toUpperCase()} in OMP ${label} (${path}); refusing to start ` +
        "because the credential source cannot be verified",
      EXIT_RUNTIME
    );
  }
  if (parsed === null || parsed === undefined) return {};
  if (!isPlainObject(parsed)) {
    throw new AgentError(
      `OMP ${label} (${path}) is not a mapping; refusing to start because the ` +
        "credential source cannot be verified",
      EXIT_RUNTIME
    );
  }
  return parsed;
}

/** `auth.broker.url` as a nested key or a flat literal key, non-empty only. */
function ompBrokerUrl(config: Record<string, unknown>): string | null {
  const flat = config["auth.broker.url"];
  if (typeof flat === "string" && flat.trim() !== "") return flat;
  const auth = config["auth"];
  if (isPlainObject(auth)) {
    const broker = auth["broker"];
    if (isPlainObject(broker)) {
      const url = broker["url"];
      if (typeof url === "string" && url.trim() !== "") return url;
    }
  }
  return null;
}

function rejectOmpProviderOverride(
  config: Record<string, unknown>,
  path: string,
  providerId: string,
  envName: string
): void {
  const providers = config["providers"];
  if (!isPlainObject(providers)) return;
  if (!Object.prototype.hasOwnProperty.call(providers, providerId)) return;
  throw new AgentError(
    `OMP ${basename(path)} defines provider '${providerId}' (${path}), which can ` +
      `override baseUrl/apiKey ahead of the injected ${envName}; remove that ` +
      "provider entry or run native `omp`.",
    EXIT_RUNTIME
  );
}

/**
 * Describe a setting that can move an Infisical-pinned session onto another
 * model/provider, or enable a background runtime that does so. Only explicit
 * opt-ins count: OMP's default `retry.modelFallback: true` with an empty
 * `retry.fallbackChains` is safe, and `modelRoles` alone only renames roles
 * (the launcher pins default/smol/slow/plan and the active model).
 */
function ompImplicitSwitchRisk(config: Record<string, unknown>): string | null {
  const retry = config["retry"];
  if (isPlainObject(retry)) {
    const chains = retry["fallbackChains"];
    if (isPlainObject(chains) && Object.keys(chains).length > 0) {
      return `retry.fallbackChains declares ${Object.keys(chains).length} fallback chain(s)`;
    }
  }
  const advisor = config["advisor"];
  if (isPlainObject(advisor) && advisor["enabled"] === true) {
    return "advisor.enabled is true";
  }
  const promotion = config["contextPromotion"];
  if (isPlainObject(promotion) && promotion["enabled"] === true) {
    return "contextPromotion.enabled is true";
  }
  return null;
}

/** Existing local OMP credential stores. XDG data relocates `agent.db` only
 * when the corresponding `omp` directory already exists. */
function ompAuthDbPaths(): string[] {
  const paths = [join(ompAgentDir(), "agent.db")];
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) {
    const base = join(xdgData, "omp");
    if (existsSync(base)) paths.push(join(base, "agent.db"));
  }
  return paths;
}

/**
 * Reject config that can switch the pinned model/provider implicitly: retry
 * fallback chains (modelFallback is true by default, so a non-empty chain is
 * the switch), the Advisor runtime, and context promotion. An absent retry
 * block or `fallbackChains: {}` stays allowed. Legacy global settings.json is
 * included because OMP migrates it at startup, after this check would
 * otherwise have inspected the config files. Project config.yaml is
 * deliberately not checked: OMP reads it only under the global agent
 * directory; the project compatibility spelling is config.yml.
 *
 * This runs at plan time for EVERY omp route: agents.toml forbids implicit
 * model fallback on all routes, so it is a model-pinning boundary rather than
 * a credential-trust one (those checks stay require_infisical-only). On
 * require_infisical routes the cmdExec pre-spawn recheck runs it again
 * alongside guardOmpCredentialSource, so those routes get plan-time plus
 * immediately-before-spawn coverage.
 */
function guardOmpImplicitSwitch(providerId: string): void {
  const agentDir = ompAgentDir();
  const switchConfigs: Array<{ path: string; label: string; format: "yaml" | "json" }> = [
    { path: join(agentDir, "config.yml"), label: "config.yml", format: "yaml" },
    { path: join(agentDir, "config.yaml"), label: "config.yaml", format: "yaml" },
    { path: join(agentDir, "settings.json"), label: "settings.json", format: "json" },
    { path: join(process.cwd(), ".omp", "config.yml"), label: ".omp/config.yml", format: "yaml" },
    {
      path: join(process.cwd(), ".omp", "settings.json"),
      label: ".omp/settings.json",
      format: "json",
    },
  ];
  for (const file of switchConfigs) {
    const config = readOmpMapping(file.path, file.label, file.format);
    if (config === null) continue;
    const risk = ompImplicitSwitchRisk(config);
    if (risk !== null) {
      throw new AgentError(
        `OMP ${file.label} (${file.path}) enables an implicit model switch for ` +
          `the '${providerId}' OMP route: ${risk}. Remove that setting or run ` +
          "native `omp`.",
        EXIT_RUNTIME
      );
    }
  }
}

/**
 * OMP credential ladder: runtime override > models.yml apiKey > stored OAuth >
 * stored login key > extension fallback > environment > other stored key.
 * For a `require_infisical` route the launcher's process-scoped env must be
 * authoritative, so refuse to start when OMP could resolve a profile/agent
 * dir, a dotenv override, an auth broker, a models.* provider override, or a
 * stored credential ahead of it. Nothing is edited or deleted and no secret
 * value is printed.
 *
 * Known residual risk: an extension can register a config fallback
 * (`keys.setConfig(..., { fallback: true })`) that this file-based guard does
 * not inspect, and internal helper roles the user configures (for example an
 * advisor or subagent role with its own model) are outside this guard. The
 * explicit `--smol/--slow/--plan` pinning on the route is the
 * defense-in-depth stop for those cases.
 */
function guardOmpCredentialSource(providerId: string, envName: string): void {
  const dotenv = readOmpDotenvAssignments();
  const agentDir = ompAgentDir();

  // A. Reject relocated config/agent dir and profiles.
  for (const key of OMP_REJECTED_ENV_KEYS) {
    if (key in process.env) {
      throw new AgentError(
        `OMP ${key} is defined in the ambient environment for the ` +
          `Infisical-backed '${envName}' route. Infisical-backed OMP routes ` +
          "require the default OMP profile/agent directory; unset it (or remove " +
          "the .env entry) or run native `omp`.",
        EXIT_RUNTIME
      );
    }
    for (const file of dotenv) {
      if (file.names.has(key)) {
        throw new AgentError(
          `OMP ${key} is assigned in ${file.path} for the Infisical-backed ` +
            `'${envName}' route. Infisical-backed OMP routes require the default ` +
            "OMP profile/agent directory; unset it (or remove the .env entry) or " +
            "run native `omp`.",
          EXIT_RUNTIME
        );
      }
    }
  }

  // A2. Reject a dotenv XDG_DATA_HOME: OMP would relocate `agent.db` there,
  // but ompAuthDbPaths() follows only the ambient process.env value, so the
  // stored-credential check below would inspect the wrong store and a stored
  // credential could outrank the Infisical key. An ambient (process.env)
  // XDG_DATA_HOME is already followed by ompAuthDbPaths and stays allowed.
  for (const file of dotenv) {
    if (file.names.has("XDG_DATA_HOME")) {
      throw new AgentError(
        `OMP XDG_DATA_HOME is assigned in ${file.path} for the Infisical-backed ` +
          `'${envName}' route: it would relocate agent.db away from the store the ` +
          "launcher verifies. Unset it (or remove the .env entry) or run native " +
          "`omp`.",
        EXIT_RUNTIME
      );
    }
  }

  // B. Reject an auth broker: it replaces the local store and resolves
  // credentials outside the injected env.
  if ("OMP_AUTH_BROKER_URL" in process.env) {
    throw new AgentError(
      `OMP_AUTH_BROKER_URL is defined in the ambient environment for the ` +
        `Infisical-backed '${envName}' route; remove the broker setting or run ` +
        "native `omp`.",
      EXIT_RUNTIME
    );
  }
  for (const file of dotenv) {
    if (file.names.has("OMP_AUTH_BROKER_URL")) {
      throw new AgentError(
        `OMP_AUTH_BROKER_URL is assigned in ${file.path} for the Infisical-backed ` +
          `'${envName}' route; remove the broker setting or run native \`omp\`.`,
        EXIT_RUNTIME
      );
    }
  }
  for (const name of ["config.yml", "config.yaml"]) {
    const path = join(agentDir, name);
    const config = readOmpMapping(path, name, "yaml");
    if (config === null) continue;
    if (ompBrokerUrl(config) !== null) {
      throw new AgentError(
        `OMP ${name} configures auth.broker.url (${path}) for the ` +
          `Infisical-backed '${envName}' route; remove the broker setting or run ` +
          "native `omp`.",
        EXIT_RUNTIME
      );
    }
  }

  // C. Reject local provider/model overrides. Both YAML spellings are checked
  // whenever present; the legacy JSON file is migrated by OMP only when no
  // YAML exists, but it can still take effect, so it is checked too.
  for (const name of ["models.yml", "models.yaml"]) {
    const path = join(agentDir, name);
    const models = readOmpMapping(path, name, "yaml");
    if (models !== null) rejectOmpProviderOverride(models, path, providerId, envName);
  }
  const legacyPath = join(agentDir, "models.json");
  const legacy = readOmpMapping(legacyPath, "models.json", "json");
  if (legacy !== null) rejectOmpProviderOverride(legacy, legacyPath, providerId, envName);

  // D. Reject stored credentials for the provider: a stored OAuth/login/API
  // key outranks the injected environment variable.
  for (const dbPath of ompAuthDbPaths()) {
    if (!existsSync(dbPath)) continue;
    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const table = db
        .query(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_credentials' LIMIT 1"
        )
        .get();
      if (table) {
        // OMP ignores disabled credentials; only an active row outranks env.
        const row = db
          .query(
            "SELECT 1 FROM auth_credentials WHERE provider = ? AND disabled_cause IS NULL LIMIT 1"
          )
          .get(providerId);
        if (row) {
          throw new AgentError(
            `OMP has a stored '${providerId}' credential in ${dbPath} that ` +
              `outranks the injected ${envName}; remove or relocate it ` +
              `(\`omp logout ${providerId}\` or the relevant auth UI) or run ` +
              "native `omp`.",
            EXIT_RUNTIME
          );
        }
      }
    } catch (error) {
      if (error instanceof AgentError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentError(
        `cannot verify the OMP credential store (${dbPath}): ${detail}; refusing ` +
          "to start because the credential source cannot be verified",
        EXIT_RUNTIME
      );
    } finally {
      try {
        db?.close();
      } catch {
        // already closed
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Execution (child process with inherited stdio; no execve in Bun)
// ---------------------------------------------------------------------------

const SIGNAL_NUMBERS: Record<string, number> = osConstants.signals as unknown as Record<
  string,
  number
>;

async function runInherited(cmd: string[], env?: Record<string, string | undefined>): Promise<number> {
  const child = Bun.spawn({
    cmd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const forward = (signal: NodeJS.Signals) => () => {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  };
  const handlers: Array<[NodeJS.Signals, () => void]> = [
    ["SIGINT", forward("SIGINT")],
    ["SIGTERM", forward("SIGTERM")],
    ["SIGHUP", forward("SIGHUP")],
  ];
  for (const [signal, handler] of handlers) {
    process.on(signal, handler);
  }
  try {
    await child.exited;
  } finally {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  }
  const signalCode = (child as unknown as { signalCode?: string | null }).signalCode;
  if (signalCode) {
    const number = SIGNAL_NUMBERS[signalCode];
    return number ? 128 + number : 1;
  }
  return child.exitCode ?? 0;
}

function needsInjection(plan: Plan): boolean {
  if (plan.require_infisical) {
    // Never trust an ambient value for these routes: always let Infisical
    // provide (or fail to provide) the credential inside the wrapper.
    return true;
  }
  for (const [envName, secretName] of plan.require_cred) {
    if (process.env[envName] || process.env[secretName]) {
      continue;
    }
    return true;
  }
  return false;
}

async function startViaWithSecrets(plan: Plan, baseline: string[]): Promise<number> {
  const wrapper = withSecretsPath();
  if (IS_WINDOWS && wrapper.endsWith(".ps1")) {
    if (!existsSync(wrapper)) {
      throw new AgentError(`missing dotfiles wrapper: ${wrapper}`, EXIT_RUNTIME);
    }
  } else {
    try {
      accessSync(wrapper, fsConstants.X_OK);
    } catch {
      throw new AgentError(`missing dotfiles wrapper: ${wrapper}`, EXIT_RUNTIME);
    }
  }
  const payload = [process.execPath, realpathSync(import.meta.path), "__exec"];
  payload.push("--baseline", baseline.join(","));
  payload.push("--keep", [...plan.keep].sort().join(","));
  payload.push("--drop", [...new Set(plan.drop)].join(","));
  for (const name of plan.unset) {
    payload.push("--unset", name);
  }
  for (const [dst, src] of plan.copy) {
    payload.push("--copy", `${dst}=${src}`);
  }
  for (const [name, value] of plan.assign) {
    payload.push("--assign", `${name}=${value}`);
  }
  for (const [envName, secretName] of plan.require_cred) {
    payload.push("--cred", `${envName}=${secretName}`);
  }
  if (plan.omp_guard) {
    payload.push("--omp-guard-id", plan.omp_guard.providerId);
    payload.push("--omp-guard-env", plan.omp_guard.envName);
  }
  payload.push("--", ...plan.command);

  // require_infisical routes must not inherit an ambient credential: remove
  // the route's credential names from the wrapper's environment so only
  // Infisical can supply them. A missing Infisical secret then fails inside
  // the wrapper instead of silently reusing the shell value.
  let wrapperEnv: Record<string, string> | undefined;
  if (plan.require_infisical) {
    const strip = new Set<string>();
    for (const [envName, secretName] of plan.require_cred) {
      strip.add(envName);
      strip.add(secretName);
    }
    wrapperEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined || strip.has(name)) continue;
      wrapperEnv[name] = value;
    }
  }
  const childEnv = wrapperEnv ?? process.env;

  if (IS_WINDOWS && wrapper.endsWith(".ps1")) {
    const shell = which("pwsh") ? "pwsh" : "powershell";
    return runInherited(
      [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, ...payload],
      childEnv
    );
  }
  return runInherited([wrapper, ...payload], childEnv);
}

/**
 * Parse an existing inline-config env value into an object. A caller's
 * unusable value warns and yields an empty object (never a crash): the
 * launcher's own keys are then written into a fresh object.
 */
function readInlineConfig(env: Record<string, string>, name: string): Record<string, unknown> {
  const raw = env[name];
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`agent: warning: existing ${name} is not valid JSON; replacing it`);
    return {};
  }
  if (isPlainObject(parsed)) return parsed;
  console.error(`agent: warning: existing ${name} is not an object; replacing it`);
  return {};
}

async function finalize(plan: Plan): Promise<number> {
  const baseline = new Set(plan.baseline ?? Object.keys(process.env));
  const keep = plan.keep;
  const drop = new Set(plan.drop);

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (keep.has(name)) {
      env[name] = value;
    } else if (drop.has(name)) {
      continue;
    } else if (!baseline.has(name)) {
      // injected by script/with-secrets but not selected by this route
      continue;
    } else {
      env[name] = value;
    }
  }

  for (const name of plan.unset) {
    delete env[name];
  }

  for (const [dst, src] of plan.copy) {
    const value = env[dst] || env[src];
    if (value) {
      env[dst] = value;
    }
  }

  for (const [envName, secretName] of plan.require_cred) {
    if (!env[envName] && !env[secretName]) {
      throw new AgentError(
        `missing credential: set ${envName} or provide Infisical secret ${secretName} ` +
          "in environment `dev` (script/with-secrets)",
        EXIT_RUNTIME
      );
    }
  }

  for (const [name, value] of plan.assign) {
    if (value.startsWith(MODEL_MARKER)) {
      const modelId = value.slice(MODEL_MARKER.length);
      const content = readInlineConfig(env, name);
      content["model"] = modelId;
      env[name] = JSON.stringify(content);
    } else if (value.startsWith(PROVIDER_MARKER)) {
      // OpenCode custom-provider block: merge under `provider.<id>` into the
      // same inline config the model marker just touched (assign order is
      // preserved, so the model key is already present).
      const payload = value.slice(PROVIDER_MARKER.length);
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new AgentError(
          `internal: invalid provider payload for ${name}`,
          EXIT_RUNTIME
        );
      }
      if (!isPlainObject(parsed)) {
        throw new AgentError(
          `internal: provider payload for ${name} must be an object`,
          EXIT_RUNTIME
        );
      }
      const content = readInlineConfig(env, name);
      const existing = content["provider"];
      if (existing !== undefined && !isPlainObject(existing)) {
        console.error(`agent: warning: existing ${name} provider is not an object; replacing it`);
      }
      const providers: Record<string, unknown> = isPlainObject(existing) ? existing : {};
      Object.assign(providers, parsed);
      content["provider"] = providers;
      env[name] = JSON.stringify(content);
    } else if (value.startsWith(CRED_MARKER)) {
      const source = value.slice(CRED_MARKER.length);
      const resolved = env[source];
      if (!resolved) {
        throw new AgentError(`missing credential ${source} for ${name}`, EXIT_RUNTIME);
      }
      env[name] = resolved;
    } else {
      env[name] = value;
    }
  }

  const command = plan.command;
  const resolvedCmd = which(command[0], env["PATH"]);
  if (!resolvedCmd) {
    throw new AgentError(
      `harness not found: ${command[0]} (install it via pc-setup/mise)`,
      EXIT_RUNTIME
    );
  }
  return runInherited(launchArgv(resolvedCmd, command.slice(1), env), env);
}

interface ExecStagePlan {
  command: string[];
  keep: Set<string>;
  copy: Array<[string, string]>;
  unset: string[];
  assign: Array<[string, string]>;
  require_cred: Array<[string, string]>;
  drop: string[];
  baseline: string[];
}

function cmdExec(argv: string[]): Promise<number> {
  // Stage 2, running inside script/with-secrets: parse the plan tokens and
  // exec the harness with the filtered environment.
  let baseline: string[] | null = null;
  let keep = new Set<string>();
  let drop: string[] = [];
  let unset: string[] = [];
  let copy: Array<[string, string]> = [];
  let assign: Array<[string, string]> = [];
  let cred: Array<[string, string]> = [];
  let ompGuardId: string | null = null;
  let ompGuardEnv: string | null = null;
  let command: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      command = argv.slice(index + 1);
      break;
    }
    if (token === "--baseline") {
      baseline = argv[index + 1] ? argv[index + 1].split(",") : [];
    } else if (token === "--keep") {
      keep = new Set(argv[index + 1] ? argv[index + 1].split(",") : []);
    } else if (token === "--drop") {
      drop = argv[index + 1] ? argv[index + 1].split(",") : [];
    } else if (token === "--unset") {
      unset.push(argv[index + 1]);
    } else if (token === "--copy") {
      const [dst, src] = argv[index + 1].split("=", 2);
      copy.push([dst, src]);
    } else if (token === "--assign") {
      const raw = argv[index + 1];
      const eq = raw.indexOf("=");
      assign.push([raw.slice(0, eq), raw.slice(eq + 1)]);
    } else if (token === "--cred") {
      const raw = argv[index + 1];
      const eq = raw.indexOf("=");
      cred.push([raw.slice(0, eq), raw.slice(eq + 1)]);
    } else if (token === "--omp-guard-id") {
      ompGuardId = argv[index + 1];
    } else if (token === "--omp-guard-env") {
      ompGuardEnv = argv[index + 1];
    } else {
      throw new AgentError(`__exec: unexpected token '${token}'`);
    }
    index += 2;
  }
  if (command.length === 0) {
    throw new AgentError("__exec: no command given");
  }
  if (baseline === null) {
    throw new AgentError("__exec: --baseline is required");
  }
  if (ompGuardId !== null || ompGuardEnv !== null) {
    if (!ompGuardId || !ompGuardEnv) {
      throw new AgentError("__exec: --omp-guard-id and --omp-guard-env must be passed together");
    }
    // Re-check immediately before spawn: OMP config/dotenv/auth files may
    // have changed after the pre-fetch check (TOCTOU). Still not atomic with
    // OMP's own read, but the window is reduced to the final exec. The
    // omp_guard flags exist only on require_infisical routes, so the
    // implicit-switch recheck is too; other omp routes check at plan time.
    guardOmpImplicitSwitch(ompGuardId);
    guardOmpCredentialSource(ompGuardId, ompGuardEnv);
  }
  const stage: ExecStagePlan = { command, keep, copy, unset, assign, require_cred: cred, drop, baseline };
  return finalize(stage as unknown as Plan);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function usageText(): string {
  return USAGE.replace("{config_path}", configPath()).replace("{with_secrets}", withSecretsPath());
}

function requireHarness(config: Config, harnessKey: string): Harness {
  if (harnessKey === "pi") {
    throw new AgentError(
      "the Pi Worker slot moved to OMP; use 'agent omp <provider>' (native 'pi' " +
        "is still available outside the launcher)"
    );
  }
  const harness = config.harnesses[harnessKey];
  if (!harness) {
    const known = Object.keys(config.harnesses).sort().join(", ");
    throw new AgentError(`unknown harness '${harnessKey}'; known harnesses: ${known}`);
  }
  return harness;
}

function selectRoute(config: Config, harnessKey: string, providerKey: string): [Harness, Provider, Route] {
  const harness = requireHarness(config, harnessKey);
  const provider = config.providers[providerKey];
  if (!provider) {
    const known = Object.keys(config.providers).sort().join(", ");
    throw new AgentError(
      `unknown provider '${providerKey}'; known providers: ${known}; ` +
        "(harness arguments go after '--'; `agent <harness>` needs no provider)"
    );
  }
  const route = config.routes[`${harnessKey}.${providerKey}`];
  if (!route) {
    const available = Object.keys(config.routes)
      .filter((key) => key.startsWith(harnessKey + "."))
      .map((key) => splitRouteKey(key)[1])
      .sort()
      .join(", ");
    throw new AgentError(
      `no route for harness '${harnessKey}' with provider '${providerKey}'; ` +
        `available providers for '${harnessKey}': ${available || "(none)"}`
    );
  }
  return [harness, provider, route];
}

async function cmdRun(
  config: Config,
  harnessKey: string,
  providerKey: string,
  cliModel: string | null,
  passthru: string[]
): Promise<number> {
  const [harness, provider, route] = selectRoute(config, harnessKey, providerKey);
  let model: string | null;
  if (harness.adapter === "passthrough") {
    if (cliModel !== null) {
      throw new AgentError(
        `harness '${harnessKey}' (adapter passthrough) does not accept --model via ${PROGRAM}; ` +
          "select the model inside the harness"
      );
    }
    model = null;
  } else {
    model = resolveModel(route, provider, cliModel);
  }
  const plan = buildPlan(config, harness, provider, route, model, passthru);

  if (which(harness.command) === null) {
    throw new AgentError(
      `harness not found: ${harness.command} (install it via pc-setup/mise)`,
      EXIT_RUNTIME
    );
  }

  if (needsInjection(plan)) {
    return startViaWithSecrets(plan, Object.keys(process.env).sort());
  }
  return finalize(plan);
}

function cmdRunShortcut(config: Config, name: string, argv: string[]): Promise<number> {
  const [harnessKey, providerKey] = resolveShortcut(config, name);
  const { model, passthru } = parseShortcutArgs(argv);
  return cmdRun(config, harnessKey, providerKey, model, passthru);
}

function cmdRunNative(config: Config, harnessKey: string, passthru: string[]): Promise<number> {
  // Native mode: no provider, no route, no Plan — the environment is passed
  // through exactly as-is (nothing injected, filtered or unset), matching
  // the contract of running the harness directly (subscription login,
  // harness-owned auth/model), plus the launcher's resolution, argument
  // guard and exit-code/signal handling.
  const harness = requireHarness(config, harnessKey);
  checkPassthru(passthru, harness);
  console.error(
    `${PROGRAM}: no provider given — running native '${harnessKey}' ` +
      "(no endpoint/model/credential injection)"
  );
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  const resolvedCmd = which(harness.command, env["PATH"]);
  if (!resolvedCmd) {
    throw new AgentError(
      `harness not found: ${harness.command} (install it via pc-setup/mise)`,
      EXIT_RUNTIME
    );
  }
  return runInherited(launchArgv(resolvedCmd, passthru, env), env);
}

function cmdList(config: Config): number {
  const header = `${"ROUTE".padEnd(22)} ${"SHORTCUT".padEnd(22)} ${"DEFAULT MODEL".padEnd(26)} NOTES`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const key of Object.keys(config.routes).sort()) {
    const route = config.routes[key];
    const provider = config.providers[route.provider];
    const defaultModel = routeDefaultModel(route, provider);
    const cell = defaultModel ?? "--model required";
    let notes = route.note || "";
    if (defaultModel === null) {
      notes = `(explicit --model) ${notes}`.trimEnd();
    }
    console.log(
      `${key.padEnd(22)} ${shortcutName(route.harness, route.provider).padEnd(22)} ` +
        `${cell.padEnd(26)} ${notes}`.trimEnd()
    );
  }
  console.log("");
  console.log("models per route are validated against config/agents.toml; run");
  console.log("'agent models <provider>' for credential names and the full list.");
  console.log("'agent shortcuts' shows which shortcut commands are linked.");
  return 0;
}

function cmdModels(config: Config, providerKey: string): number {
  const provider = config.providers[providerKey];
  if (!provider) {
    const known = Object.keys(config.providers).sort().join(", ");
    throw new AgentError(`unknown provider '${providerKey}'; known providers: ${known}`);
  }
  console.log(`provider: ${provider.key} (${provider.label})`);
  if (provider.base_url) {
    console.log(
      provider.opencode_npm
        ? `opencode endpoint: ${provider.base_url} (OpenAI-compatible custom provider)`
        : `anthropic endpoint: ${provider.base_url}`
    );
  }
  if (provider.opencode_npm) {
    console.log(`opencode custom provider: ${provider.opencode_npm} (id ${provider.opencode_id})`);
  }
  if (provider.secret) {
    const note = provider.require_infisical
      ? " [require_infisical: always sourced from Infisical; ambient env and OMP-local overrides are rejected]"
      : "";
    console.log(`credential: Infisical secret ${provider.secret} -> env ${provider.env}${note}`);
  } else {
    console.log("credential: harness-native login (no Infisical secret)");
  }
  if (provider.models.length > 0) {
    console.log(`opencode model id example: ${provider.opencode_id}/${provider.models[0]}`);
  } else {
    console.log(`opencode model id format: ${provider.opencode_id}/<model>`);
  }
  console.log(`omp provider id: ${provider.omp_id}`);
  const routes = Object.values(config.routes)
    .filter((r) => r.provider === providerKey)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  console.log("routes:");
  for (const route of routes) {
    const harness = config.harnesses[route.harness];
    const defaultModel = routeDefaultModel(route, provider);
    const suffix = defaultModel ? ` (default ${defaultModel})` : " (--model required)";
    console.log(`  ${route.key.padEnd(22)} [${harness.adapter}]${suffix}`);
    if (route.note) {
      console.log(`    note: ${route.note}`);
    }
    if (route.models !== null && JSON.stringify(route.models) !== JSON.stringify(provider.models)) {
      console.log("    models (route overrides provider):");
      for (const model of route.models) {
        console.log(`      ${model}`);
      }
    }
  }
  console.log("models:");
  for (const model of provider.models) {
    const markers: string[] = [];
    if (model === provider.default_model) {
      markers.push("provider default");
    }
    for (const route of routes) {
      if (model === routeDefaultModel(route, provider)) {
        markers.push(`default for ${route.harness}`);
      }
      if (route.models !== null && !route.models.includes(model)) {
        const marker = `not for ${route.harness}`;
        if (!markers.includes(marker)) {
          markers.push(marker);
        }
      }
    }
    const suffix = markers.length > 0 ? `   [${markers.join("; ")}]` : "";
    console.log(`  ${model}${suffix}`);
  }
  if (provider.models.length === 0) {
    console.log("  (none declared; any id passes through unvalidated)");
  }
  return 0;
}

function cmdCheck(config: Config): number {
  console.log(
    `config OK: ${config.path} ` +
      `(${Object.keys(config.providers).length} providers, ` +
      `${Object.keys(config.harnesses).length} harnesses, ` +
      `${Object.keys(config.routes).length} routes)`
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  if (argv.length > 0 && argv[0] === "__exec") {
    return cmdExec(argv.slice(1));
  }

  // Shortcut form via direct invocation: `<harness>-<provider> [args...]`.
  // The invoked file name is recovered from the kernel-level argv (Bun
  // resolves symlinked argv[1]); native harness commands never come through
  // here (they are separate binaries).
  const invoked = invokedScriptPath();
  if (invoked) {
    const name = basename(invoked);
    if (
      name !== LAUNCHER_BASENAME &&
      name !== "agent" &&
      name !== "bun" &&
      name.includes("-")
    ) {
      const config = loadConfig();
      // exact match against the routes; anything else raises "unknown
      // shortcut" before a process starts
      return cmdRunShortcut(config, name, argv);
    }
  }

  if (argv.length === 0) {
    console.error(usageText());
    return EXIT_USAGE;
  }

  // Portable shortcut spelling: `agent opencode-zen [args...]`
  const config = loadConfig();
  const first = argv[0];
  if (
    !["help", "--help", "-h", "--version", "-V", "list", "check", "models", "shortcuts"].includes(first) &&
    !(first in config.harnesses) &&
    shortcutMap(config)[first]
  ) {
    return cmdRunShortcut(config, first, argv.slice(1));
  }

  const action = parseArgs(argv);
  if (action[0] === "help") {
    console.log(usageText());
    return 0;
  }
  if (action[0] === "version") {
    console.log(`${PROGRAM} (dotfiles launcher, config: ${configPath()})`);
    return 0;
  }
  if (action[0] === "list") {
    return cmdList(config);
  }
  if (action[0] === "check") {
    return cmdCheck(config);
  }
  if (action[0] === "models") {
    return cmdModels(config, action[1]);
  }
  if (action[0] === "shortcuts") {
    return cmdShortcuts(config, action[1]);
  }
  if (action[0] === "native") {
    const [, harnessKey, nativePassthru] = action;
    return cmdRunNative(config, harnessKey, nativePassthru);
  }
  const [, harnessKey, providerKey, model, passthru] = action;
  return cmdRun(config, harnessKey, providerKey, model, passthru);
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof AgentError) {
    console.error(`${PROGRAM}: ${error.message}`);
    process.exit(error.code);
  }
  throw error;
}
