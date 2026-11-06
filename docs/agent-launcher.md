# Unified `agent` launcher (harness × provider routes from one TOML)

## Scope

`agent <harness> <provider>` starts exactly one installed AI harness with
exactly one API provider, chosen explicitly at launch:

```bash
agent list                                # configured routes
agent claude openrouter                   # Claude Code via OpenRouter
agent claude openrouter-free -- -p 'hi'   # Claude Code via the fixed OpenRouter free model
agent claude deepseek -- -p 'say ok'      # Claude Code via DeepSeek
agent claude opencode-go -- -p 'say ok'   # Go plan, DeepSeek V4.1 Flash (fixed default)
agent claude minimax -- -p 'say ok'       # default MiniMax-M3.1-Flash; --model overrides
agent opencode zen                        # OpenCode on the free zen models
agent opencode zen -- run "explain this repo"
agent opencode logfare -- run "say ok"    # Logfare (explicit; 5k req/day)
agent opencode mistral -- run "say ok"    # Mistral Education, GLM 5.3 Flash
agent omp opencode-go -- -p 'hello'       # Go plan, MiMo V2.6 Flash (fixed default)
agent omp openrouter-free -- -p 'hello'   # OMP Worker on the fixed OpenRouter free model
agent omp deepseek -- -p 'hello'
agent omp mistral -- -p 'hello'          # Mistral Education, GLM 5.3 Flash
agent vibe -- --version                 # Mistral Vibe CLI, native login
agent dsh deepseek -- web                 # dsh keeps its own native auth
agent claude -p 'say ok'                  # native mode: no provider at all —
                                           # subscription login, zero injection
agent opencode -- run "explain this repo"  # native opencode (own account)
agent omp -- -p 'hello'                   # native omp (own account)
opencode-zen -- run "explain this repo"   # shortcut form of the line above it
omp-opencode-go -p 'hello'                # shortcut form; default MiMo V2.6 Flash
claude-minimax -p 'say ok'                # default MiniMax-M3.1-Flash; --agent-model overrides
agent models deepseek                     # provider details + models
agent check                               # validate the config (CI runs this)
agent shortcuts                           # shortcut names derived from the routes
claude                                    # plain claude: official native auth
```

Design contract:

- **Thin**: read `config/agents.toml` → build a filtered process-scoped
  environment → spawn the native CLI as a single child process with inherited
  stdio. No daemon, proxy, router or new dependency; credentials come from the
  existing `script/with-secrets` (Infisical) wrapper.
- **Declarative**: model ids, endpoints, credential names and route
  availability live only in `config/agents.toml`. Adding or changing them
  is a TOML edit; the launcher source contains adapter logic only.
- **Fail closed**: unknown harness, unknown provider, no route, unknown
  model, missing credential, missing harness binary → non-zero exit with a
  message that lists the supported choices. No implicit provider switch,
  no silent model fallback, no quota failover, no billing surprise.
- **Native by default**: plain `claude` is never wrapped, aliased or
  overridden by this repository (no shell function, no PATH shim).

The Worker slot is `omp` (Oh My Pi). It replaces the former `pi` harness and
its `pi.*` routes; `omp` is not a fifth harness alongside a retained Pi
harness. Claude Code remains the Supervisor in its existing `claude.*` routes;
the OMP migration does not change the Supervisor contract. See
[ADR-0014](adr/ADR-0014.md).

Non-goals: per-combination mise tasks (the draft approach this replaces),
an implicit `claude()` override, cross-provider auth migration, any
persistent write of a `--model` choice (`--model` affects one process),
runtime OpenRouter free-model selection (issue #76 reverted that direction),
an `omp.zen` route (the Worker slot does not use OMP's `opencode-zen`
provider), dual Pi/OMP route maintenance, and any new harness/daemon/proxy/
router.

## Mistral Education (high-volume, no overage)

The Mistral Education plan's included monthly allowance is shared by Vibe
Code, Studio and API. More routes do not create more quota. For throughput,
use the low-priced `zai-glm-5-3-flash` default; explicitly select
`deepseek-v4-1-flash-1017`, `zai-glm-5-3`, or `mistral-medium-3-5` for
other workloads. No implicit fallback is permitted.

1. Confirm Education and turn off pay-as-you-go in
   https://admin.mistral.ai/ > Subscription. The launcher cannot control this.
2. Create a **plan key** in Mistral Studio > Code > Vibe CLI (not a separately
   billed API key). Put its value in the existing Infisical `dev` secret
   named `MISTRAL_API_KEY`. Never commit the secret.
3. Sync dotfiles, then use `agent check`, `agent models mistral`,
   `agent shortcuts create`, `agent opencode mistral -- run "hello"` or
   `agent omp mistral -- -p "hello"`.
4. Verify actual model availability with the plan key against
   `GET https://api.mistral.ai/v1/models` and test one real tool call on
   each harness before enabling Herdr workers. Account-level RPS, TPM and
   monthly quotas still apply. Reject 401/402/429; do not reroute to a
   different key, paid endpoint, provider or model.
5. For the native Mistral agent, install the official Vibe CLI and run
   `agent vibe -- --setup` to use browser login. The native route does not
   fetch Infisical credentials, and `/whoami` identifies the active plan.

See https://docs.mistral.ai/admin/billing-usage/subscriptions and
https://docs.mistral.ai/vibe/code/cli/install-setup for details.

## Usage

```
agent <harness> <provider> [--model <id>] [-- <harness args>...]
agent <harness> [-- <harness args>...]     # native mode: provider omitted
<harness>-<provider> [<harness args>...]      # shortcut form
agent list | models <provider> | shortcuts [list|check|create|remove] | check | guide [topic] | routes [--json] | help [--json]
```

- **Native mode (provider omitted)**: `agent <harness>` runs the harness
  exactly as-is — the environment is passed through untouched: no endpoint,
  no model and no credential injection, no `script/with-secrets` stage
  (Claude Code uses its subscription login, opencode/omp their own account,
  dsh its own auth). Harness arguments follow a leading flag or `--`
  (`agent claude -p 'say ok'`, `agent opencode -- run …`); a non-flag
  second token is still parsed as a provider, so typos keep failing closed
  with exit 2. `--model`/`-m` still require a provider route (exit 2) —
  use plain `<harness>` for the harness's own model flags. Route mode never
  falls back to native mode on failure (and vice versa): both are explicit
  choices only.
- **`agent pi` fails closed.** The Pi harness is retired from the launcher;
  both `agent pi <provider>` and `agent pi` exit 2 with a migration hint
  pointing at `agent omp <provider>`. This is launcher routing only: the
  native `pi` binary is untouched and remains usable directly (pc-setup keeps
  it installed for rollback and native use).
- Everything after `--` is passed to the harness verbatim
  (`agent claude openrouter -- --help` asks the harness for help;
  `agent claude openrouter --help` shows this launcher's help).
- Launcher-owned flags are rejected inside the passthrough: `--model`/`-m`,
  `--provider`, `--api-key`, `--fallback-model` (automatic model fallback is
  intentionally unsupported).
- Model resolution order: `--model` > route default > provider default >
  harness-native default. The last step only applies to passthrough
  harnesses (`dsh`), where model selection stays native; every other route
  must resolve a model before a process starts (config validation enforces
  this).
- `AGENT_MODEL` (the draft mise tasks' variable) is **not** read; a warning
  points at `--model`.

## Progressive disclosure: `agent guide` and `agent routes` (issue #88)

`agent help` stays the short entry point. Deeper facts are read on demand —
no giant always-on prompt — and the machine-readable forms are rendered from
the same data objects as the human text (`script/agent/help.ts`), so the JSON
cannot drift from the human output.

### `agent guide [topic] [--json]`

Topics (unknown topic → exit 2 naming the valid ones):

| Topic | Content |
|---|---|
| `routes` | route/shortcut/adapter model, OS support (macOS/WSL/Linux shim + symlinks, Windows `agent.ps1` + `.cmd`) |
| `status` | which command shows which fact; attestation status/provenance/evidence; unknown stays unknown |
| `limits` | quota scopes (`account:`/`plan:`/`api-key:`/`machine:`), documented rate limits, observed restrictions, 401/402/429 handling |
| `distributed` | Supervisor/Worker roles, Herdr/Worktrunk boundaries, mutable ownership |
| `recovery` | durable truth (Issues/PRs/Git), exit codes, no silent fallback |
| `quality` | AGENTS.md invariants, `./script/test` / `check-secrets`, SHA-bound evidence, authority boundaries |
| `misfire` | wrong harness started, launcher-vs-harness `--help`, fail-closed exit 2, retired `agent pi` |

### `agent routes [--json]`

`agent list` remains unchanged; `agent routes` adds the catalog facts from
the `[catalog.*]` tables (issue #89) per route: effective quota scope
(route-level override wins over the provider scope), billing/terms,
rate limits, concurrency, observed restrictions and per-route e2e
observations with their attestation metadata (status, provenance, evidence
timestamp/source/SHA). Absent facts are printed as `unknown` — never
inferred; a `restricted` attestation (e.g. an observed HTTP 402/403/429
block) is a fact in its own right and is never reported as unknown.

`--json` emits the same data as redacted canonical JSON
(`script/agent/contract.ts` `redactJson`: secret-shaped keys and values are
replaced by `[redacted]`; only credential env NAMES ever appear, never
values). A malformed `[catalog.*]` table fails closed with exit 1.

Fields owned by later issues are exposed only as explicit placeholders under
`not_yet_available` (always null, never guessed):

| Field | Issue | Task |
|---|---|---|
| `readiness` (configured/credential/reachable/tool-call probes) | #90 | T004 |
| `usage` (remaining/used quota) | #91 | T005 |
| `reset_at` (quota reset times) | #91 | T005 |
| `recommendation` (route recommendation) | #94 | T008 |

`agent help --json` quotes the exact usage text plus the subcommand list.
A configured harness named `guide` or `routes` always wins over the
subcommands, keeping its native launch path.

## Short commands (`<harness>-<provider>`)

Every route additionally gets a short command name — `opencode-zen`,
`claude-minimax`, `omp-openrouter`, `omp-opencode-go`, … — that behaves
exactly like `agent <harness> <provider>`:

- **Definition**: the routes in `config/agents.toml` remain the single
  source of truth. A short name exists only for a configured route; it is
  resolved by **exact match** against those routes, never by splitting a
  name on hyphens (`claude-zen` has no route → clear error, exit 2).
- **Form**: on macOS/WSL, a symlink to the launcher itself
  (`~/.local/bin/opencode-zen` → `script/agent.ts`); on Windows, a minimal
  `.cmd` entry point generated from the same TOML. No second launcher, no
  per-shortcut ENV-injection script, no duplicated config. The portable
  spelling `agent opencode-zen [args…]` resolves identically on every
  platform and needs no link at all.
- **Arguments**: harness arguments are passed straight through (no `--`
  needed; a leading `--` is tolerated). The launcher-owned model option in
  this form is `--agent-model <id>` (equals `--model <id>`, this process
  only); `--model`, `-m`, `--provider`, `--api-key` and `--fallback-model`
  stay rejected, so a shortcut can neither switch the provider nor inject
  credentials.
- **Native commands are untouched**: plain `claude`, `opencode`, `omp` and
  `dsh` remain the official binaries with their own auth; short names only
  ever add new commands, never wrap an existing one. The native `pi` binary
  is likewise untouched outside the launcher, but `agent pi` is retired.
- **Stale Pi shortcuts are not migrated automatically.** `agent shortcuts
  remove` only iterates the names derived from the *current* routes, so old
  `pi-*` symlinks that point at the launcher are not seen by it. If invoked,
  such a link fails closed (exit 2) with a retirement error naming the
  replacement and the exact removal command, for example:
  `'pi-deepseek' is a retired Pi Worker shortcut; the slot moved to OMP. Use 'omp-deepseek' after 'agent shortcuts create', and remove the stale link if present: rm ~/.local/bin/pi-deepseek`.
  Remove the former links manually after migration:
  `rm ~/.local/bin/pi-deepseek ~/.local/bin/pi-minimax ~/.local/bin/pi-opencode-go ~/.local/bin/pi-openrouter ~/.local/bin/pi-openrouter-free`
  (adjust for the actual paths; `AGENT_BIN_DIR` defaults to `~/.local/bin`).
- **MiniMax** uses the official `MiniMax-M3.1-Flash` model ID (2026-10-19).
  Reasoning is always enabled, with `max` as the default effort. Live M Plan
  verification for the formal ID is still pending. The `opencode.minimax`
  route continues to default to `MiniMax-M3`, since the formal ID has not
  yet been verified in OpenCode and an unsupported ID may silently fall back.
  On `claude.minimax` and `omp.minimax`, `MiniMax-M3` can still be selected
  explicitly with `--agent-model` or `--model`.
- **Runtime**: Bun executes `script/agent.ts`; the config is read with
  `Bun.TOML.parse()` — no dependencies, no Python anywhere in the
  launcher or its tests. `bun` itself is a machine baseline tool
  installed by pc-setup (mise), so macOS, WSL/Linux and Windows all have
  it.
- **Process model**: Bun has no `execve`, so the harness runs as a single
  child process with inherited stdio (interactive TUIs, exit codes and
  Ctrl+C forwarding work; a child killed by a signal reports 128+signal).
  The two-stage `script/with-secrets` protocol, the per-provider ENV
  filtering and the model marker are unchanged from the original design.
- **Windows batch shims**: npm-installed harnesses resolve to `opencode.cmd`
  etc. `which()` probes `PATHEXT` candidates **before** the bare name (the
  extensionless Cygwin-style shim npm also generates is not executable),
  and `.cmd`/`.bat` targets are started via `cmd.exe /d /c %AGENT_LAUNCH_CMD%`
  — the fully quoted command line travels in an env var because cmd.exe does
  not understand the backslash-escaped quotes of CreateProcess argv
  serialization (quotes in cmd's expansion toggle its quoting state, so
  `& | < > ( )` and spaces inside quoted args stay literal). Arguments
  containing `"` or `%` cannot be represented at all and are **rejected with
  exit 1** (fail closed — no silent corruption, no metacharacter injection).
- **Entry points**:
  - macOS/WSL: the `~/.local/bin/agent` shim (bash) runs `bun
    script/agent.ts`; shortcuts are symlinks to the same file. The invoked
    symlink name is recovered from the kernel-level argv
    (`/proc/self/cmdline` on Linux, `ps -o args=` on macOS) because Bun
    resolves the symlinked `argv[1]`.
  - Windows native: `script/agent.ps1` (PowerShell, no Bash/WSL/Python),
    `script/with-secrets.ps1` starts `infisical` natively, and
    `agent shortcuts create` generates minimal `.cmd` files
    (`bun "<launcher>" <name> %*`). PowerShell 7.3+ recommended for
    faithful argument passing (`$PSNativeCommandArgumentPassing =
    'Standard'`; also set by the entry scripts where supported).
  - Anywhere: `agent <harness>-<provider>` passes the route name
    explicitly, so it works in shells where no link exists.

## Config: `config/agents.toml`

```toml
[defaults]
drop_env = ["ANTHROPIC_API_KEY", "..."]   # names that must never reach a child

[providers.deepseek]
label = "DeepSeek"
base_url = "https://api.deepseek.com/anthropic"  # Anthropic-compatible endpoint
secret = "DEEPSEEK_API_KEY"    # Infisical secret name (environment `dev`)
env = "DEEPSEEK_API_KEY"       # env var the harness reads (may differ)
default_model = "deepseek-flash"
models = ["deepseek-flash", "deepseek-v4-pro"]
# require_model = true         # fail closed: --model mandatory when no default exists
# require_infisical = true     # always source <secret> from Infisical;
#                              # strip ambient values before the wrapper
# opencode_id = "opencode"     # OpenCode provider id when it differs from the key
# omp_id = "deepseek"          # OMP --provider value (defaults to the key)
# opencode_npm = "@ai-sdk/openai-compatible"
#                              # register base_url as a custom OpenCode
#                              # provider (opencode adapter routes only;
#                              # needs base_url, a credential name, a models
#                              # list, and one opencode_models entry per model)
# [providers.<key>.opencode_models."<model-id>"]   # only with opencode_npm:
# tool_call = true             #   tools support (chat_capabilities.tools)
# limit = { context = 1048576, output = 384000 }   #   enforced limits

[harnesses.claude]
label = "Claude Code"
command = "claude"
adapter = "anthropic"          # anthropic | opencode | omp | passthrough
[harnesses.claude.env]         # adapter env names (names only, no values)
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"  # always cleared for third-party endpoints
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[harnesses.omp]
label = "Oh My Pi"
command = "omp"
adapter = "omp"

[routes."claude.deepseek"]     # explicit harness × provider combinations
models = ["deepseek-flash"]    # optional route-level model list override
note = "..."                   # optional, shown by `agent list`
# default_model / require_model also override the provider defaults
```

`omp_id` is the provider id passed to `omp --provider`. It is separate from
the launcher route key and from `opencode_id`, so one provider can be
addressed correctly by each harness (`openrouter-free` maps to native
`openrouter` for both OpenCode and OMP; `opencode-go` is native for OMP).

Validation (`agent check`, run by CI) rejects: unknown adapter, route keys
that reference unknown harnesses/providers, missing defaults without
`require_model`, defaults that are not in the model list,
`require_model`-with-default contradictions, `anthropic` routes whose
provider has no `base_url`, `require_infisical = true` without a `secret`
name, route keys whose `harness-provider` shortcut names would collide,
and — for the OpenCode custom-provider registration — `opencode_npm`
without `base_url`/credential/models list, `opencode_models` entries that
are missing for a declared model, unknown to the model list, or malformed
(`tool_call` boolean, `limit.context`/`limit.output` positive integers;
unknown keys are rejected), and an `opencode_npm` provider used on a route
whose adapter is not `opencode` (the block would sit silently inert).

## Adapters (native CLI contracts)

- **anthropic (Claude Code)**: exports `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN` (derived from the provider credential),
  `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL` and all three
  `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` roles = the route model, and
  clears `ANTHROPIC_API_KEY`. Because every role maps to the single route
  model (subagents follow the haiku role), `CLAUDE_CODE_SUBAGENT_MODEL` is
  not needed and stays unset. Verified against claude 2.1.299.
- **opencode (OpenCode v2)**: model selection goes through the inline
  config override `OPENCODE_CONFIG_CONTENT={"model":"<provider>/<model>"}`
  (merged last over global/project config, so both `opencode` TUI and
  `opencode run` pick it up). The global `opencode --model` flag does not
  exist in v2 — it silently prints help — so it is never used.
  When a provider declares `opencode_npm`, the same inline config also
  carries a `provider.<opencode_id>` block (npm package, `options.baseURL`
  = the provider's `base_url`, `env: ["<credential env name>"]` and the
  `opencode_models` entries). OpenCode resolves the API key from that env
  var, so the credential arrives by name through the normal keep-set — no
  secret value ever enters `OPENCODE_CONFIG_CONTENT` or argv. Verified with
  a real OpenCode 2.2.5 run against a local OpenAI-compatible endpoint
  (2026-11-05): `Bearer` auth from the env var, model pinning, and a
  shell-tool round trip all observed on the wire.
- **omp (Oh My Pi)**: explicit provider/model selection with
  `omp --provider <omp_id> --model <id>`, a fixed Worker tool surface, and
  the destructive guard loaded as a trusted extension. The full contract is
  in [OMP Worker harness](#omp-worker-harness-replaces-the-pi-slot) below.
- **passthrough (dsh)**: argv only, plus the provider credential env;
  `--model` is rejected (dsh selects its model natively). dsh is installed
  machine-wide through mise (`npm:@deepseek-ai/dsh`, pinned because every
  upstream version is a prerelease); the route is verified up to
  `agent dsh deepseek -- --version` (Infisical injection, exit 0). A live
  DeepSeek session stays unverified until the account balance allows it.

## OMP Worker harness (replaces the Pi slot)

OMP (Oh My Pi) is the Worker harness. It is installed by pc-setup, not by
this repository: **OMP 18.16.0** from the `mise` tool `oh-my-pi`
(`github:can1357/oh-my-pi`, bins `["omp"]`), added by pc-setup PR #158. That
PR leaves the native Pi binary installed so rollback and native `pi` use do
not require a reinstall.

### Launch contract

Every `agent omp <provider>` route produces this shape (the launcher adds
the route's harness arguments after `--`):

```text
omp --provider <omp_id> --model <model>
    [--smol <omp_id>/<model> --slow <omp_id>/<model> --plan <omp_id>/<model>]
    --tools read,bash,edit,write
    --no-lsp --no-pty --no-title
    --trusted-extension <absolute path to script/omp-destructive-guard.ts>
    --config <absolute path to script/omp-worker-overlay.yml>
    [--trusted-extension ~/.omp/agent/extensions/herdr-omp-agent-state.ts]
```

- `--smol`, `--slow` and `--plan` are added only for `require_infisical`
  routes (currently `omp.opencode-go`). They pin the smol/slow/plan roles to
  the same route selector, so an ambient or stored role setting cannot
  redirect a Worker session.
- `--models` is **not** passed. OMP documents it as
  "comma-separated model patterns for Ctrl+P cycling"; it is not a
  allowlist and does not constrain which model can run. The explicit
  `--model` plus the TOML allowlist does that.
- The launcher never generates `--auto-approve`, `--approval-mode` or
  `--api-key`; `--api-key` is also rejected in the harness-argument
  passthrough. `--auto-approve`/`--approval-mode` are OMP's own flags and are
  not filtered from arguments an operator deliberately places after `--`; the
  trusted destructive-guard extension still runs on every `bash` tool call.
- For the `omp` adapter, the passthrough additionally rejects
  `--profile`, `--config`, `--cwd`, `--smol`, `--slow`, `--plan`, `--prewalk`,
  `--prewalk-into`, `--plan-yolo`, `--plan-yolo-into`, `--trusted-extension`,
  `--extension`, `-e`, `--hook`, `--advisor`, `--tools` and `--models`.
  The first three would move the auth/config source after the launcher's
  checks (a profile, an overlay, or a different cwd's `.omp` config and
  `.env`); the launcher's own `--config` is the tool-surface overlay, and a
  user overlay would apply after it and re-place its `disabledProviders`
  array; `--smol` … `--plan-yolo-into` would re-point or implicitly switch
  the pinned model roles; `--trusted-extension`/`--extension`/`-e`/`--hook`
  would load an extra module, and a module can register a credential/model
  fallback outside the guard (the launcher names every trusted module);
  `--advisor` would enable the advisor runtime even when config says
  `advisor.enabled: false`; a later `--tools` replaces the launcher's
  `--tools read,bash,edit,write` list (OMP keeps the last occurrence); and
  `--models` feeds unvalidated ids to Ctrl+P cycling. The list is
  adapter-scoped: other harnesses are unaffected.
- The guard path is resolved at plan time next to the launcher. A missing
  `script/omp-destructive-guard.ts` makes the launcher exit 1 before a
  harness starts; it never runs OMP without the guard.
- Every OMP route assigns `OMP_SKIP_SETUP=1` to the child environment. On a
  fresh machine, OMP's first interactive launch would otherwise block on its
  setup wizard before the Worker can accept a Herdr prompt. The launcher's
  flags already define the Worker slot, so onboarding choices must not be
  made implicitly. `omp setup` remains available explicitly outside the
  launcher for first-run configuration.

### Tool and approval boundary

The former Pi Worker slot exposed `read`, `bash`, `edit` and `write` only.
`--tools read,bash,edit,write` reproduces that surface and removes OMP's
`task` (sub-agents), `web`, `browser`, `python` and `todo` tools.
`--no-lsp --no-pty --no-title` remove further ambient capabilities.

`--tools` only filters OMP's **built-in** tools; MCP servers are mounted
independently in OMP 18.16.0 (no `--no-mcp` flag exists, and
`enableMCP`/`restrictToolNames` are SDK-only options). Observed on
2026-11-04: before the overlay, a launcher session listed **36 tools** —
the four built-ins plus 32 `chrome-devtools` MCP tools from the account's
Claude Code plugin `chrome-devtools-mcp@claude-plugins-official`. The
admitting path was OMP's `agent-plugins` discovery provider: it reads the
Claude plugin registry without the `enabledProviders` foreign-source opt-in
that gates `claude`/`claude-plugins`, and the plugin ships an
Agent-Plugins-standard root, which the legacy providers skip. The launcher
therefore resolves `script/omp-worker-overlay.yml` next to itself (exit 1
if missing, like the guard) and passes it with `--config`. The overlay sets
`disabledProviders: [agent-plugins, claude, claude-plugins]` —
`disabledProviders` wins over `enabledProviders`, so no user or project
settings layer can re-enable them for a launcher session — plus
`mcp.enableProjectConfig: false` for project-scoped MCP config. After the
overlay the same probe returns exactly `read`, `bash`, `edit`, `write`
(verified 2026-11-04). Residual: the overlay does not disable OMP's native
user MCP config (`~/.omp/agent/mcp.json`, the `builtin` discovery provider),
which is empty on this machine; OMP 18.16.0 has no per-run switch that
disables MCP mounting outright.

OMP's `tools.approvalMode` defaults to **`yolo`**, and its built-in bash
critical-pattern override is ignored in that mode. The ported
`omp-destructive-guard.ts` extension is therefore the permission boundary,
not a convenience check. It runs on OMP's `tool_call` hook for the `bash`
tool and blocks (returns `{ block: true, reason }`) when a command segment
matches:

- `rm` with recursive + force (`rm -rf`, `rm -fr`, `rm -r -f`, including
  after `sudo`, `&&`, `;`, `|`, or inside a subshell);
- `git push --force` / `--force-with-lease`, `git push -f`,
  `git push --delete`, and `+ref:dst` force refspecs;
- `git reset --hard`;
- `git clean` forced (`-f`) unless `-n` / `--dry-run` is also present;
- `git checkout -f`, `git checkout --`, `git checkout .` (and `./`/`../`
  paths);
- `git restore` unless `--staged` is present (`--worktree` always blocked);
- `git branch -D`, and `--delete` combined with `--force`;
- `git tag -d` / `--delete`;
- `git stash drop` / `clear`.

The rule list mirrors `~/.claude/hooks/destructive-guard.ts` and the native
Pi copy; it is intentionally narrow. Two short-form gaps are inherited from
that shared rule set and are **not** closed by this migration: `git push -d`
(remote ref deletion; the long `--delete` form is blocked) and
`git branch -d -f` (`-D` and long forms are blocked). They are recorded as a
follow-up so all copies change together rather than only the OMP port. The
guard is not an OS sandbox and does not cover every destructive command. It
is the boundary for the Worker slot
because OMP's own approval mode does not enforce one in `yolo`.

### `--trusted-extension` and Herdr

`--trusted-extension` is repeatable in OMP 18.16.0, hidden from `--help`,
and aborts startup if a module is missing or cannot be parsed. The launcher
relies on that fail-closed behavior, and additionally resolves the guard path
itself so a missing file is reported as a launcher error before spawn.

Loading a trusted extension **disables ambient extension discovery**. OMP
therefore loads exactly the modules the launcher names. When the launcher
runs inside Herdr, it requires and passes Herdr's integration explicitly.
"Inside Herdr" matches OMP's own detection: `HERDR_ENV=1` or any of
`HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`:

```text
~/.omp/agent/extensions/herdr-omp-agent-state.ts
```

Install it with `herdr integration install omp` (verified current
integration v10). Inside Herdr a missing integration exits 1 with that
instruction; outside Herdr only the destructive guard is trusted.

### Deterministic model selection

- The model comes from `--model`, the route default, or the provider default,
  and is validated against the route/provider model list before any process
  starts. An unlisted id exits 2.
- `--provider <omp_id>` and `--model <id>` are always explicit, so OMP does
  not choose from its own catalog.
- On `require_infisical` routes, `--smol/--slow/--plan` pin the same
  selector.
- No fallback is configured on **any** omp route: OMP
  `retry.modelFallback` may default to true, but a non-empty
  `retry.fallbackChains` is rejected, and `advisor.enabled: true` and
  `contextPromotion.enabled: true` are rejected too. This implicit-switch
  check runs at plan time for every `omp` route before a process starts and,
  on `require_infisical` routes, again immediately before spawn — it is a
  model-pinning boundary, run alongside (not as part of) the
  `require_infisical` credential check below.

### Credential-source guard (`require_infisical` only)

OMP's credential ladder is, highest first:

1. runtime `--api-key`;
2. `models.yml` `providers.<id>.apiKey`;
3. stored OAuth;
4. stored login API key;
5. extension config fallback;
6. environment / `.env`;
7. another stored key.

For an Infisical-backed route the launcher's process-scoped environment must
be authoritative, so `guardOmpCredentialSource()` rejects the local file/env
sources it can inspect that could outrank it. It runs **only** on routes with
`require_infisical = true` (today `omp.opencode-go`); the other OMP routes
keep the normal provider-credential behavior.

The guard fails closed (exit 1, before OMP starts) when any of the following
is true:

- **Profile or relocated directory**: any of `OMP_PROFILE`, `PI_PROFILE`,
  `PI_CONFIG_DIR`, `OMP_CONFIG_DIR`, `PI_CODING_AGENT_DIR`,
  `OMP_CODING_AGENT_DIR` is defined in the ambient environment (even as an
  empty value) or assigned in one of OMP's dotenv layers: project cwd
  `.env`, `~/.omp/agent/.env`, `~/.omp/.env`, `~/.env`. The guard always
  inspects `~/.omp/agent`; a relocated directory is rejected rather than
  followed. A dotenv assignment of `XDG_DATA_HOME` is rejected the same way:
  OMP would relocate `agent.db` there while the launcher follows only the
  ambient `XDG_DATA_HOME` (an ambient value is followed, not rejected).
- **Auth broker**: `OMP_AUTH_BROKER_URL` in the ambient environment or any
  dotenv layer, or a non-empty `auth.broker.url` (nested or the flat
  `auth.broker.url` key) in `~/.omp/agent/config.yml` or `config.yaml`.
- **Provider override**: a `providers.<route-provider>` entry in
  `~/.omp/agent/models.yml`, `models.yaml`, or the legacy `models.json`.
  Entries for other providers are allowed.
- **Stored credential**: an active row (`disabled_cause IS NULL`) for the
  route's provider in the `auth_credentials` table of
  `~/.omp/agent/agent.db`, or of `$XDG_DATA_HOME/omp/agent.db` when the
  `$XDG_DATA_HOME/omp` directory already exists. Disabled rows are ignored,
  matching OMP's behavior.

Only a missing file (`ENOENT`) proves "no override". A dotenv, YAML, JSON or
SQLite store that is unreadable, invalid, or not a mapping makes the guard
fail closed, because the credential source cannot be verified. Nothing is
edited, moved or deleted, and no secret value is printed.

The credential check runs **twice**: before secret fetch (fail fast) and
again inside the `script/with-secrets` child immediately before spawn
(`--omp-guard-id` / `--omp-guard-env`). This narrows the window where a
concurrent writer could add `agent.db` or `models.yml`, but it is not atomic
with OMP's own read. Do not edit `~/.omp` while an Infisical-backed OMP route
is launching. The implicit-switch check (previous section) runs at plan
time on every omp route, and on `require_infisical` routes it is re-checked
immediately before spawn alongside this credential check.

Known residual risks are stated in ADR-0014: an extension can register a
config fallback (`keys.setConfig(..., { fallback: true })`) that this
file-based guard does not inspect, and internal helper roles the user
configures (for example an advisor or subagent role with its own model) are
outside the guard. The explicit `--smol/--slow/--plan` pinning is the
defense-in-depth stop for the latter.

## Credential handling (no leakage, no argv secrets)

1. **Fast path**: for a normal route, if the harness `env` name or the
   Infisical `secret` name is already present, no secret is fetched
   (`script/with-secrets` is not invoked). The OMP credential-source guard
   does not run on these routes; it is scoped to `require_infisical`.
2. **`require_infisical` routes** (`opencode-go`, including
   `omp.opencode-go`) never take the fast path. The launcher always runs the
   with-secrets stage, and **removes the route's credential names from the
   wrapper's environment first**. Only Infisical can supply them; a missing
   Infisical value fails instead of reusing a stale shell value. This is
   stronger than "prefer Infisical over env".
3. Otherwise the launcher re-executes itself *inside* the existing
   `script/with-secrets` (self-hosted Infisical project binding, environment
   `dev`), which injects the whole dev secret set.
4. The in-wrapper stage then filters the environment before spawn:
   - variables injected by Infisical that the route did not select are
     dropped (baseline diff),
   - every credential name declared in the config (including legacy ones
     such as `MINIMAX_TOKEN_PLAN_KEY`) is dropped unless the route needs it,
   - `defaults.drop_env` names never reach the child; this includes the
     OMP model-role selectors `PI_SMOL_MODEL`, `PI_SLOW_MODEL` and
     `PI_PLAN_MODEL`; on the Infisical-backed OMP route, profile/relocation
     variables are rejected by the OMP guard rather than silently dropped,
   - only then are the adapter's `ANTHROPIC_*` values derived — secret
     values are referenced by *name* inside the child stage and are never
     placed in argv, files or logs.
5. Renames happen inside that stage too (e.g. Infisical
   `MINIMAX_M_PLAN_KEY` → harness `MINIMAX_API_KEY`).
6. A missing secret fails with its Infisical name before any harness starts.

The launcher's mock tests assert both directions: the selected credential
arrives, and every other provider's credential does not. For Go they also
assert that an ambient key is stripped before the wrapper and that a missing
Infisical value fails instead of using it.

## OpenCode Go routes (single key, Go endpoint)

| route | harness | default model | endpoint | credential |
| --- | --- | --- | --- | --- |
| `claude.opencode-go` | Claude Code | `deepseek-v4.1-flash` | `https://opencode.ai/inference/go/anthropic` (`ANTHROPIC_BASE_URL`) | Infisical `OPENCODE_API_KEY` as `ANTHROPIC_AUTH_TOKEN` |
| `omp.opencode-go` | OMP | `mimo-v2.6-flash` | OMP's native `opencode-go` provider (`https://opencode.ai/inference/go/v1`; legacy `/zen/go`) | Infisical `OPENCODE_API_KEY` as `OPENCODE_API_KEY` |

The `omp.opencode-go` model list also contains `deepseek-v4.1-flash`, so
`--model deepseek-v4.1-flash` is valid; the pinned `--smol/--slow/--plan`
selectors follow whichever model is resolved.

- **There are no per-product keys.** The same account/workspace key
  (`OPENCODE_API_KEY`) serves Zen and Go. The **endpoint** and the workspace's
  Go subscription decide which allowance a request consumes; the key name does
  not. Earlier drafts assumed a separate `OPENCODE_GO_API_KEY`; that key does
  not exist and has been removed from the config and docs.
- **What the launcher does guarantee** (`require_infisical = true`): the
  credential always comes from Infisical. The ambient `OPENCODE_API_KEY` is
  removed from the wrapper's environment before Infisical runs, so a stale
  shell value cannot be used; a missing Infisical value exits 1. OMP's local
  `models.yml`/`models.yaml`/`models.json` and stored credential cannot
  override the credential, endpoint or provider (see the credential-source
  guard above). No runtime model selection and no fallback to Zen,
  pay-as-you-go or another model/provider.
- **Claude Code: verified.** On 2026-11-01, with an ambient bogus
  `OPENCODE_API_KEY` set, `agent claude opencode-go` ignored it, used the
  Infisical key, and returned `GO_CLAUDE_OK` from a Bash tool call with
  `deepseek-v4.1-flash`. Claude Code 2.1.314 warns that it does not recognize
  the custom model id (200k assumed context) but sends `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_AUTH_TOKEN` unchanged. Go recognizes Claude Code's native session
  header.
- **OMP: verified 2026-11-04.** `agent omp opencode-go` returned a real
  response and completed a bash tool call with `mimo-v2.6-flash` on OMP
  18.16.0. This route uses OMP's native provider endpoint
  (`https://opencode.ai/inference/go/v1`), not the Anthropic-compatible
  endpoint used by Claude Code. The former Pi Worker route (Pi 1.4.0,
  `@earendil-works/pi-coding-agent`, verified 2026-11-01) is no longer
  configured; ADR-0014 records the migration.
- **Go billing proof (2026-11-01).** Direct probes with the Infisical key
  (never in argv) returned `usage.cost = 0` and
  `opencode.billing_source = "go"` on both endpoints:
  `mimo-v2.6-flash` via the OpenAI-compatible endpoint
  (`allowance` 3.64e-06) and `deepseek-v4.1-flash` via the Anthropic endpoint
  (`allowance` 5.85e-06). This confirms the Go allowance, not pay-as-you-go,
  for both. Extra Usage OFF should still be confirmed in the Console because
  the launcher cannot read that setting.
- **Claude Code existing login.** OpenCode's docs advise `/logout` first when
  Claude Code is signed in. In the tested version (2.1.314) the injected
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` took precedence: with a real
  claude.ai Pro login present, the env endpoint/token were used and Claude
  printed that "another auth source ... takes precedence over your claude.ai
  login". This was re-confirmed on the Go route (Claude Code succeeded with
  the same login present). If a future version changes precedence, treat the
  route as blocked rather than logging the user out automatically. This is
  a Claude Code adapter property and is unaffected by the Pi→OMP migration.
- **Privacy prerequisite.** DeepSeek V4.1 Flash (and V4 Pro) require
  **Settings › Privacy › Regions = Global** in the Go workspace
  (owner/admin). Without it the request is rejected; the launcher must not
  silently switch to another model or provider.
- **Billing.** Go usage is metered per model against a monthly allowance with
  5-hour (20%) and weekly (50%) sub-limits. **Extra Usage** (overflow to the
  Console pay-as-you-go balance) must be verified OFF in the Console on the
  Go page, except Go Teams which starts ON. The launcher cannot read or
  change that account setting and does not claim to. DeepSeek V4.1 Flash also
  has peak/off-peak pricing (peak: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri);
  the flat-rate allowance is unaffected by the time of day, but usage counts
  differ. A successful response proves routing, not which allowance was
  charged — check the Go usage page.

Real verification (cheap prompts, no unattended loops):

```bash
# Claude Code: verified 2026-11-01
agent claude opencode-go -- -p 'Use the Bash tool to run: echo GO_CLAUDE_OK'

# OMP Worker: verified 2026-11-04 (OMP 18.16.0)
agent omp opencode-go -- -p 'Use the bash tool to run: echo OMP_GO_OK'
```

For Claude, `/status` inside a session shows the base URL; the Console shows
the model and allowance counters. The OMP route uses the native OMP provider
catalog; do not add a manual `models.yml` endpoint override — the credential
guard rejects it before launch.

## OpenRouter free: one fixed model (no automatic selection)

Policy (issue #76, superseding #72 / draft PR #73): the normal
`openrouter-free` routes are a **single declarative model id** in
`config/agents.toml`. There is no runtime catalog scan, availability or
quality gate, no `openrouter/free` meta-router, no cached selection and no
fallback to a different free or paid model. Changing the model is a TOML edit
plus review. The allowlist contains only that id, so any other id — free or
paid — exits 2 before a process starts.

Current id: `nvidia/nemotron-3-ultra-550b-a55b:free`.

The OMP route addresses OpenRouter through its native provider id
`openrouter` (`omp_id = "openrouter"`); the `openrouter-free` launcher route
key is routing only and never reaches OMP. `agent omp openrouter-free` starts
OMP with `--provider openrouter --model nvidia/nemotron-3-ultra-550b-a55b:free`.

Verified on 2026-11-01 and 2026-11-04 (macOS, real calls through the
launcher, Infisical `OPENROUTER_API_KEY`):

- public `/api/v1/models`: `pricing.prompt = "0"`, `pricing.completion = "0"`,
  `tools` supported, no expiry;
- Claude Code 2.1.314: `-p` answer + Bash tool call (`ROUTE_OK`) succeeded;
- OpenCode 2.2.3: `run` answer + bash tool call (`OC_ROUTE_OK`) succeeded;
- OMP 18.16.0: `-p` answer + bash tool call (`OMP_FREE_OK`) succeeded on
  2026-11-04. (The former Pi worker had also passed on 2026-11-01; that route
  is retired.)

Not verified: Windows/WSL real calls, long sessions, rate-limit behaviour, and
whether those ids remain free (re-check before relying on them). Free-tier
limits are account-based (20 req/min; 1,000 req/day after ≥ $10 cumulative
purchase). A failure must be reported, not retried onto a paid route.

Draft PR #73's evaluator (`agent-eval.ts`, `agent-quality.ts`, catalog and
calibration machinery) is deliberately **not** merged. Its research record
was salvaged into `docs/research/openrouter-free-quality-2026-10-24.md` as
evidence for why automatic selection was stopped; that file is documentation,
not an active code path.

## Logfare: explicit route only (no automatic routing, no fallback)

`opencode.logfare` points OpenCode at Logfare's OpenAI-compatible API
(`https://logfare.ai/v1`) as a custom provider (`opencode_npm =
"@ai-sdk/openai-compatible"`). It is the first route here whose endpoint
is OpenAI-compatible rather than Anthropic-compatible, so it exists on the
`opencode` adapter only: there is no `claude.logfare` route (the Anthropic
adapter cannot consume it) and no `omp.logfare` route (OMP would need a
non-declarative local `models.yml` endpoint override, which this design
does not allow).

| route | harness | default model | endpoint | credential |
| --- | --- | --- | --- | --- |
| `opencode.logfare` | OpenCode | `deepseek-v4.1-flash-1017` | `https://logfare.ai/v1` (OpenAI-compatible; custom provider block) | Infisical `LOGFARE_API_KEY` (normal route: ambient value is accepted, otherwise the with-secrets stage) |

- **Models — exactly two, allowlisted**: `deepseek-v4.1-flash-1017`
  (default) and `glm-5.3`; any other id exits 2 before a process starts.
- **Catalog contract** (from the public `GET https://logfare.ai/v1/models`,
  no key needed, checked 2026-11-05): both ids serve `chat/completions`
  and report `chat_capabilities.tools = true`; the enforced
  `context_length` is 1048576 (deepseek) and 262144 (glm-5.3 — Logfare
  rejects larger input with 413 regardless of the 1M figure in its own
  `upstream_metadata`); no output cap is enforced (`max_output_tokens`
  null; oversized `max_tokens` are lowered by Logfare). These values are
  the route's `opencode_models` entries (`tool_call`, `limit.context`,
  `limit.output` — output from the published upstream cap in the models.dev
  opencode catalog), so OpenCode's context budgeting, `max_completion_tokens`
  and tool surface match what the endpoint actually serves.
- **Premium models — training opt-in required**: both ids are
  `requires_training_optin`. Without accepting at
  `https://logfare.ai/consent` every request returns 403
  `training_optin_required`; the account's Discord must also stay in the
  Logfare server (403 otherwise).
- **Account limits** (docs, 2026-11-05): regular account 40 req/min,
  1,000 req/hour, **5,000 req/day, 6 concurrent**; a new account gets
  10/min, 200/hour, 500/day, 2 concurrent for its first 24 hours. 429s
  carry `Retry-After`. The launcher does not observe these budgets. This
  repository has no automatic routing or fallback anywhere, and Logfare
  must not become a target of one while these budgets apply: a
  rate-limited request fails on this route and is never retried onto
  another model or provider.
- **Explicit selection only**: `agent opencode logfare …`, the
  `opencode-logfare` shortcut, or `--model glm-5.3` on that route. No
  default route, no pi/claude route, and no other route changed.

### Provisioning `LOGFARE_API_KEY` (done 2026-11-05)

Before the key existed, the route failed closed — verified with the real
wrapper: `agent: missing credential: set LOGFARE_API_KEY or provide
Infisical secret LOGFARE_API_KEY in environment `dev`
(script/with-secrets)`, exit 1, no harness started. The key has since been
added to Infisical `dev`. The same procedure applies to rotation or
another machine:

1. Register at `https://logfare.ai/register`; keep the account's Discord
   in the Logfare server (403 otherwise).
2. Accept the model-training opt-in at `https://logfare.ai/consent`
   (both route models are premium; without it Logfare answers 403
   `training_optin_required` — observed on 2026-11-05 before opt-in).
3. Copy the API key from the dashboard.
4. Store it through the existing convention (repo tracks names only; the
   value lives only in the self-hosted Infisical `dev` environment). Put
   the value in a mode-600 file so it never appears in argv or shell
   history, then:

   ```bash
   cd ~/.dotfiles && source config/infisical.sh
   infisical secrets set "LOGFARE_API_KEY=@$HOME/.cache/logfare-key" \
     --domain="$INFISICAL_API_URL" \
     --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENVIRONMENT"
   rm -f "$HOME/.cache/logfare-key"
   ```

   The launcher never creates or rotates API keys;
   `./script/secrets-doctor` validates the instance/project binding.
5. Verify cheaply: `agent opencode logfare -- run "say ok"`.

### Verification status (2026-11-05)

- **Mock suite**: `bun test script/agent.test.ts` covers the route —
  default and `--model glm-5.3` selection, an unknown id exits 2 before
  any credential is fetched, the custom-provider block (npm package,
  base URL, credential-by-name, both model contracts), secret isolation in
  both directions, merge with a caller's existing inline config, the
  absence of a `claude.logfare` route, and the `opencode_npm`
  config-validation failures (missing base_url/credential/model entry,
  malformed spec, wrong adapter).
- **Real harness E2E against a local OpenAI-compatible endpoint (mock)**:
  real OpenCode 2.2.5 through the launcher *and* through the
  `opencode-logfare` shortcut: `Bearer` auth resolved from
  `LOGFARE_API_KEY` (never present in config content), both model ids on
  the wire, and a shell-tool call executed with its output returned to the
  model — the exact plumbing `https://logfare.ai/v1/chat/completions`
  will use.
- **Live Logfare: VERIFIED 2026-11-05** (after the account accepted
  `/consent`; the pre-consent attempt was rejected with HTTP 403
  `training_optin_required`): through the launcher and real OpenCode —
  default `deepseek-v4.1-flash-1017` answered
  (`Reply with exactly: LOGFARE_LIVE_OK` → `LOGFARE_LIVE_OK`), a shell-tool
  call executed with its output returned to the model
  (`$ echo LOGFARE_TOOL_OK` → `LOGFARE_TOOL_OK`), and `--model glm-5.3`
  answered (`LOGFARE_GLM_OK`). All via the Infisical key (ambient key
  unset), exit 0 each. Also verified live: `GET /v1/models` → 200 without a
  key, `POST /v1/chat/completions` → 401 without one (auth enforced).

## Route matrix and verification status

| harness \ provider | zen | opencode-go | openrouter | openrouter-free | deepseek | minimax | logfare |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | — (no Anthropic-compatible endpoint verified; zen free tier is client-bound) | yes, default `deepseek-v4.1-flash` (Go endpoint; Infisical `OPENCODE_API_KEY` with `require_infisical`; needs Privacy Regions = Global; **real response + tool call verified 2026-11-01**) | yes, default `z-ai/glm-5.3-flash` | ONE fixed model `nvidia/nemotron-3-ultra-550b-a55b:free` (pricing 0/0, tools, live E2E 2026-11-01; any other id exits 2; never a paid fallback) | yes, default `deepseek-flash` (route list: `deepseek-flash` only, because the endpoint silently remaps unknown names) | yes, default `MiniMax-M3.1-Flash` (official model ID; live M Plan verification pending; reasoning always on; effort defaults to `max`) | — (no route: the Anthropic adapter cannot use the OpenAI-compatible endpoint) |
| opencode | yes, default `mimo-v2.6-flash-free` (free models; `opencode_id = "opencode"`) | — (not configured; OpenCode's native id exists but this launcher does not add the route) | yes | ONE fixed model `nvidia/nemotron-3-ultra-550b-a55b:free` (`opencode_id = "openrouter"`; live E2E 2026-11-01) | yes | yes, route default `MiniMax-M3` (route model list `["MiniMax-M3"]` only; OpenCode v2 previously silently fell back to Zen for the Preview ID; formal ID not yet verified — keep M3 as the known route default; `--model MiniMax-M3.1-Flash` exits 2 here) | yes, default `deepseek-v4.1-flash-1017` (two-model allowlist with `glm-5.3`; OpenAI-compatible `https://logfare.ai/v1` via the `opencode_npm` custom provider; Infisical `LOGFARE_API_KEY` + `/consent` required; **real response + shell-tool call + both models verified 2026-11-05**) |
| omp | — (`omp.zen` is not configured; OMP knows `opencode-zen` natively, but the Worker slot does not use it) | yes, default `mimo-v2.6-flash` (native `opencode-go`; Infisical `OPENCODE_API_KEY`; `require_infisical` + credential-source guard; **real response + tool call verified 2026-11-04**) | yes, default `z-ai/glm-5.3-flash` (**no live E2E recorded in this migration**) | ONE fixed model `nvidia/nemotron-3-ultra-550b-a55b:free` (`omp_id = "openrouter"`; live E2E 2026-11-04) | yes, default `deepseek-flash`; `--model deepseek-v4-pro` is also accepted by the configured provider list. Live call reached the provider but the account returned **HTTP 402 Insufficient Balance** on 2026-11-04, so response/tool success is **unverified**; no fallback | yes, default `MiniMax-M3.1-Flash`; other configured ids including `MiniMax-M3` are selectable. Live call reached the provider but the M Plan account returned **HTTP 429 Token Plan limit** on 2026-11-04, so response/tool success is **unverified**; no fallback | — (would need a non-declarative local `models.yml` endpoint override) |
| dsh | — | — | — | — | passthrough (native dsh auth; install + `--version` verified, live session pending DeepSeek balance) | — | — |

Not covered on purpose: `omp.zen` (the Worker slot uses OMP's native
`opencode-go`, `openrouter`, `deepseek` and `minimax` providers only),
`opencode.opencode-go` (possible follow-up), paid zen models (add them to the
TOML deliberately), any automatic fallback between models or providers, any
second model on an `openrouter-free` route (the free allowlist is a
single id — an unlisted id fails closed), and `claude.logfare`/`omp.logfare`
(the OpenAI-compatible endpoint is only wired to the opencode adapter; see
the Logfare section).

**The static allowlist is not a price or availability guarantee.** It only
prevents the launcher from selecting a different id. If OpenRouter later
charges for `nvidia/nemotron-3-ultra-550b-a55b:free` or retires it, this
launcher will still attempt that exact id: a new price would be billed by
OpenRouter, and a retirement would fail at runtime. Neither is detected by
`agent check`. Re-check the live catalog/pricing before relying on the route,
and keep an account-side **spend limit** (a hard cap that rejects requests at
the limit) as the hard stop. An alert only notifies; it does not stop requests.
The launcher does not claim "free forever".

OpenRouter also supports key-level spend limits, but `openrouter-free` reuses
the paid provider's `OPENROUTER_API_KEY`, so a `$0` key cap would also block
the paid `openrouter` route. Pick one explicitly: (a) configure an account
spend limit (hard cap; an alert alone does not stop usage), or (b) add a
separate free-only Infisical key and point
`providers.openrouter-free.secret`/`env` at it before enforcing a `$0` cap.
Verify that the `$0` cap still allows free requests before adopting it. The
launcher never creates or rotates API keys.

Verification is reported in two tiers, matching issue #45's acceptance
criteria:

- **Mock/syntax**: `bun test script/agent.test.ts` (55 cases:
  help/list/models, unknown harness/provider/model, `--model` precedence,
  MiniMax default vs. `require_model` fail-closed, the single-model
  openrouter-free allowlist (paid and non-default free ids exit 2, same
  credential as the paid provider), the Logfare route (default/`glm-5.3`
  selection, two-model allowlist fail-closed before credential fetch,
  custom-provider block contents with the credential by env name only,
  secret isolation both ways, inline-config merge, no claude route,
  `opencode_npm` config-validation failures), OpenCode Go
  defaults/endpoint/auth-token
  mapping, `require_infisical` behavior (ambient key stripped before the
  wrapper, missing Infisical value fails even with an ambient key, zen keeps
  its fast path), OMP route argv/tool surface (`--tools read,bash,edit,write`,
  `--no-lsp`, `--no-pty`, `--no-title`, guard path under
  `--trusted-extension`, `--config script/omp-worker-overlay.yml` with its
  `disabledProviders`/`mcp.enableProjectConfig` content, `OMP_SKIP_SETUP=1`, no
  `--models`/approval/credential flags), OMP
  credential-source guard (profile/relocation, four dotenv layers incl.
  the rejected dotenv `XDG_DATA_HOME`, auth broker,
  models.yml/yaml/json, stored
  auth_credentials rows, disabled rows, corrupt store), implicit-switch
  guard on every omp route (fallback chain/advisor/context promotion,
  including `omp.openrouter-free`), pre-spawn re-check
  (concurrent agent.db/models.yml/fallback-chain creation stops before
  spawn), Herdr
  extension allowlist and fail-closed behavior, destructive-guard rule
  table, `agent pi` migration hint and stale `pi-*` shortcut retirement
  hint, secret filtering both ways, forbidden
  passthrough flags, shortcut equivalence/args/`--agent-model`/unknown
  names/link management, native commands staying unwrapped, config
  validation failures) plus `agent check`, `agent shortcuts` and
  `bun script/agent.ts …` smoke runs in CI.
- **Real machine E2E**: recorded in the PR/issue after running a cheap
  prompt per combination (`agent <harness> <provider> -- -p '…'`); combos
  run only in the mock tier stay marked unverified here. OpenRouter-free was
  live-tested on 2026-11-01 and again with OMP on 2026-11-04. OpenCode Go/
  Claude Code was live-tested on 2026-11-01; OpenCode Go/OMP was live-tested
  on 2026-11-04 (response + tool call). The tool-surface probe
  (`… -- -p --no-session --mode json 'List the exact names of every tool …'`)
  listed 36 tools before the overlay and exactly `read`, `bash`, `edit`,
  `write` after it, both on 2026-11-04. DeepSeek and MiniMax OMP calls
  reached the provider but were rejected by the account (402/429); success
  remains unverified. The destructive probe was blocked by the guard, and no
  deletion occurred.

Verification status per platform (implementation is identical; what
differs is which entry-point layer was exercised on a real machine):

| platform | launcher + config + secrets | shortcut symlink form | interactive TUI start | PowerShell entry / `.cmd` |
| --- | --- | --- | --- | --- |
| macOS | verified (real routes; OMP Go/free E2E 2026-11-04) | verified (`ps` name recovery) | verified | n/a |
| WSL/Linux | unverified on a real machine yet (post-merge step) | unverified (`/proc/self/cmdline` path not yet exercised) | unverified | n/a |
| Windows native | CI-verified only (windows-latest job: batch-shim argv/injection/`%`+`"` rejection, `.cmd` shortcut create+exec, `with-secrets.ps1` workspaceId/API-URL pinning) | n/a (`.cmd` used instead) | unverified (no real machine) | CI-verified (PowerShell 7 on windows-latest); real machine (2026-10-17, PowerShell 7.6): `agent.ps1 list/check`, `with-secrets.ps1` injection and `bun test script/agent.windows.test.ts` verified; **shortcut creation and interactive harness start still unverified** |

The OMP Worker migration was exercised on macOS only. Windows native and
WSL/Linux real OMP route calls, `--trusted-extension` loading, Herdr
integration and the destructive guard remain **unverified on those
platforms**. The launcher code path is shared, but platform-specific loading,
path resolution and batch/PowerShell behavior are not proven by the macOS
runs.

## Installation and migration

### Install/update the launcher

The draft PR #46 approach — ten per-combination global mise tasks in
`~/.config/mise/conf.d/agent-routes.toml` — is replaced by this launcher.
After review/merge:

```bash
cd ~/.dotfiles
git pull --ff-only
command -v bun >/dev/null || echo 'bun required (installed by pc-setup / mise)'
./script/link && ./script/check   # links home/.local/bin/agent
agent check && agent list
agent shortcuts create            # optional: <harness>-<provider> commands
agent shortcuts check             # verify (also useful in script/check runs)
# if you used the draft tasks in a checkout: remove the old task file link
# (it is gone from home/) and re-run script/link / script/check
```

OMP itself is a pc-setup responsibility, not a dotfiles link. Verify the
installed tool before relying on the Worker routes:

```bash
mise ls | grep oh-my-pi          # expect github:can1357/oh-my-pi 18.16.0
omp --version                    # expect 18.16.0 (after a global version is set)
# or, without a global shim version:
mise exec github:can1357/oh-my-pi@18.16.0 -- omp --version
test -f script/omp-destructive-guard.ts   # launcher fails closed if missing
```

`omp` must be on `PATH` when a route runs; the launcher reports
`harness not found: omp` otherwise. pc-setup PR #158 adds the mise tool and
leaves native Pi installed. Managed OMP routes set `OMP_SKIP_SETUP=1`, so a
fresh machine's first interactive launch does not block on OMP's setup
wizard; run `omp setup` directly if you want that onboarding outside the
launcher.

On Windows (PowerShell, no Bash/WSL/Python): run
`& <checkout>\script\agent.ps1 check`, and `agent.ps1 shortcuts create`
generates the `.cmd` entry points into `~/.local/bin` (add it to `PATH`).

The bare `agent` command on Windows is `script\agent.cmd`, a thin wrapper over
`script\agent.ts` usable from cmd.exe and PowerShell. Register it with
`pwsh script\agent-entrypoint.ps1 install` (creates a managed `agent.cmd` shim
in `~/.local/bin`; `check` and `remove` also exist). The script never edits
`PATH` and never overwrites or removes another `agent` (for example Grok
Build's `~/.grok/bin/agent.exe`). It verifies that both `Get-Command agent`
and `where.exe agent` resolve to the shim, and exits 1 naming the shadowing
path otherwise, so a name collision is never reported as success. Resolve it
by placing `~/.local/bin` before the shadowing directory on `PATH` yourself.

### Migrating from the Pi Worker slot

The migration changes the harness key (`pi` → `omp`), the route keys
(`pi.*` → `omp.*`) and the shortcut names (`pi-*` → `omp-*`). Do not keep
both sets of routes alive: `omp` owns the Worker slot, and ADR-0014 records
that rollback is a revert rather than dual maintenance.

```bash
cd ~/.dotfiles
git pull --ff-only
./script/link && ./script/check
agent check
agent list                       # omp.* routes; no pi.* routes
agent shortcuts create
agent shortcuts check

# Remove the retired Pi short commands. `agent shortcuts remove` only sees
# current route names, so these stale links must be removed by hand.
rm ~/.local/bin/pi-deepseek ~/.local/bin/pi-minimax \
   ~/.local/bin/pi-opencode-go ~/.local/bin/pi-openrouter \
   ~/.local/bin/pi-openrouter-free
```

On Windows the shortcuts are `.cmd` entry points instead; remove the same
five files from `$HOME\.local\bin` (already-removed files are skipped):

```powershell
Remove-Item "$HOME\.local\bin\pi-deepseek.cmd", "$HOME\.local\bin\pi-minimax.cmd", `
  "$HOME\.local\bin\pi-opencode-go.cmd", "$HOME\.local\bin\pi-openrouter.cmd", `
  "$HOME\.local\bin\pi-openrouter-free.cmd" -ErrorAction SilentlyContinue
```

If a stale `pi-*` link is invoked before removal, it fails closed (exit 2)
with the retirement error above, names the corresponding `omp-*` command,
and never starts a harness or fetches a credential. `agent pi …` itself also
exits 2 with the explicit `the Pi Worker slot moved to OMP` hint. The native
`pi` binary remains available directly (outside `agent`) for rollback and
native use.

If you use Herdr, install its OMP integration once:
`herdr integration install omp`. Inside a Herdr pane (`HERDR_ENV=1` or a
`HERDR_PANE_ID`/`HERDR_TAB_ID`/`HERDR_WORKSPACE_ID` variable) the launcher
requires the extension at
`~/.omp/agent/extensions/herdr-omp-agent-state.ts` and exits 1 with that
instruction if it is absent.

### Rollback to the Pi route

Rollback is a repository revert; there is no OMP/Pi dual configuration to
maintain. Run `agent shortcuts remove` **before** reverting so the current
launcher removes the shortcut links it owns (including `omp-*`):

```bash
cd ~/.dotfiles
agent shortcuts remove            # current launcher: removes omp-* links
git revert <the Pi→OMP migration commit(s)>
# if remove was not run first, delete leftover omp-* links manually:
# rm ~/.local/bin/omp-deepseek ~/.local/bin/omp-minimax \
#    ~/.local/bin/omp-opencode-go ~/.local/bin/omp-openrouter \
#    ~/.local/bin/omp-openrouter-free
./script/link && ./script/check
agent check
agent list                        # pi.* routes restored
agent shortcuts create
agent shortcuts check
```

Native Pi was never removed by this migration, so rollback needs no
reinstall. The revert restores ADR-0012's Pi route behavior, including the
Pi-local `auth.json`/`models.json` guard; OMP's guard and Herdr allowlist
disappear with the reverted launcher. A leftover `omp-*` symlink after the
revert fails closed as an unknown shortcut and must be removed manually.

- `AGENT_MODEL=… mise run agent:…` → `agent <harness> <provider> --model …`.
- `script/agent/mimo` and `script/agent/minimax` stay as explicit,
  provider-tuned wrappers (ADR-0008) and are not touched here.
- pc-setup's NixOS shell init no longer defines a `claude()` override
  (issue #104); project-init profiles describe the launcher instead of mise
  tasks (issue #100).

Rollback of the launcher itself (without specifically restoring Pi) keeps no
state — native CLI config, provider accounts, billing and shell rc files are
never modified. `script/link` only creates or updates links and **never
deletes them**, so the shim has to be removed explicitly:

```bash
cd ~/.dotfiles
agent shortcuts remove                  # first: drop our own short-command links
git revert <the merge commits of PR #46>   # or reset to the pre-merge ref
rm -f ~/.local/bin/agent                   # dangling after the revert: script/link won't
./script/link && ./script/check            # re-sync the remaining managed links
```

(`agent shortcuts remove` must run while the launcher still exists — it
removes exactly the symlinks that point at the launcher and nothing else;
`script/link` itself never deletes links.)

`config/agent-init.bash` only carries comments, so rollback needs no shell
surgery beyond what that file documents.

## Secrets

Names only. Secret **values** are never committed, logged, passed in argv or
written to harness config. The tracked set in the Infisical `dev`
environment of project `d4c2fc09-a923-4a38-9cf4-b51769aadb76` on 2026-11-01
was: `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`,
`MINIMAX_M_PLAN_KEY` (harness env `MINIMAX_API_KEY`), `MIMO_API_KEY`,
`MINIMAX_TOKEN_PLAN_KEY`, `ANTHROPIC_AUTH_TOKEN`.

- The `openrouter-free` provider reuses `OPENROUTER_API_KEY` — no free-tier
  credential exists or is needed.
- `LOGFARE_API_KEY` was added to the Infisical `dev` environment on
  2026-11-05; live response + shell-tool call + both route models were
  verified through it the same day (after the account's `/consent`
  opt-in — the pre-consent attempt was rejected with 403).
- There is **no separate Go key**. Both Go routes use the existing
  `OPENCODE_API_KEY`; the Go endpoint and the workspace subscription select
  the allowance. The launcher still forces the value to come from Infisical
  (`require_infisical`) so a stale ambient key cannot be used.
- The OMP credential-source guard reads local OMP config/dotenv/auth files to
  reject overrides. It never edits, moves or deletes them, and it never prints
  a secret value.
- Legacy/untouched names that are deliberately filtered out of every child:
  `MINIMAX_TOKEN_PLAN_KEY`, `MIMO_API_KEY`.

## Tests

```bash
bun script/agent.ts check   # config validation
bun test script/agent.test.ts          # mock harness + mock Infisical wrapper (POSIX)
bun test script/agent.windows.test.ts  # Windows layers (runs on windows CI only)
bun test script/agent.entrypoint.windows.test.ts  # native `agent` entry point (windows only)
./script/test && ./script/check-secrets
./script/test-workflow
```

The POSIX suite includes the OMP-specific cases: route argv and tool surface,
the launcher-owned `--config` tool-surface overlay (argv and
`disabledProviders` content), credential-source guard (profile, dotenv,
broker, models
overrides, stored credentials, corrupt store), the implicit-switch guard on
every omp route (free route included), pre-spawn re-check, Herdr
extension allowlist, destructive-guard rules, and the `agent pi` migration
hint. It also asserts that no `pi.*` route and no `omp.zen` route exists,
and covers the `opencode.logfare` route end to end at the plan/env level
(custom-provider block, two-model allowlist, credential by env name only,
secret isolation, config-validation failures).

CI installs Bun (pinned `oven-sh/setup-bun`) and runs the config
validation plus the mock suite on every pull request; a second
`windows-latest` job runs the same launcher validation plus the
Windows-layer suite (batch shims, generated `.cmd` shortcuts, the
PowerShell wrapper with a stubbed `infisical`). Real prompt runs remain a
manual, per-combination step. The POSIX mock tests spawn bash stubs, so
they run on POSIX hosts (CI + macOS); Windows behavior is covered by the
windows-latest CI job and still awaits real-machine verification.
