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
agent pi opencode-go -- -p 'hello'        # Go plan, MiMo V2.6 Flash (fixed default)
agent claude minimax -- -p 'say ok'       # default MiniMax-M3.1-Flash; --model overrides
agent opencode zen                        # OpenCode on the free zen models
agent opencode zen -- run "explain this repo"
agent pi deepseek -- -p 'hello'
agent dsh deepseek -- web                 # dsh keeps its own native auth
agent claude -p 'say ok'                  # native mode: no provider at all —
                                           # subscription login, zero injection
agent opencode -- run "explain this repo"  # native opencode (own account)
opencode-zen -- run "explain this repo"   # shortcut form of the line above it
claude-minimax -p 'say ok'                # default MiniMax-M3.1-Flash; --agent-model overrides
agent models deepseek                     # provider details + models
agent check                               # validate the config (CI runs this)
agent shortcuts                           # shortcut names derived from the routes
claude                                    # plain claude: official native auth
```

Design contract:

- **Thin**: read `config/agents.toml` → build a filtered process-scoped
  environment → `exec` the native CLI. No daemon, proxy, router or new
  dependency; credentials come from the existing `script/with-secrets`
  (Infisical) wrapper.
- **Declarative**: model ids, endpoints, credential names and route
  availability live only in `config/agents.toml`. Adding or changing them
  is a TOML edit; the launcher source contains adapter logic only.
- **Fail closed**: unknown harness, unknown provider, no route, unknown
  model, missing credential, missing harness binary → non-zero exit with a
  message that lists the supported choices. No implicit provider switch,
  no silent model fallback, no quota failover, no billing surprise.
- **Native by default**: plain `claude` is never wrapped, aliased or
  overridden by this repository (no shell function, no PATH shim).

Non-goals: per-combination mise tasks (the draft approach this replaces),
an implicit `claude()` override, cross-provider auth migration, any
persistent write of a `--model` choice (`--model` affects one process),
runtime OpenRouter free-model selection (issue #76 reverted that direction),
and any new harness/daemon/proxy/router.

## Usage

```
agent <harness> <provider> [--model <id>] [-- <harness args>...]
agent <harness> [-- <harness args>...]     # native mode: provider omitted
<harness>-<provider> [<harness args>...]      # shortcut form
agent list | models <provider> | shortcuts [list|check|create|remove] | check | help
```

- **Native mode (provider omitted)**: `agent <harness>` runs the harness
  exactly as-is — the environment is passed through untouched: no endpoint,
  no model and no credential injection, no `script/with-secrets` stage
  (Claude Code uses its subscription login, opencode/pi their own account,
  dsh its own auth). Harness arguments follow a leading flag or `--`
  (`agent claude -p 'say ok'`, `agent opencode -- run …`); a non-flag
  second token is still parsed as a provider, so typos keep failing closed
  with exit 2. `--model`/`-m` still require a provider route (exit 2) —
  use plain `<harness>` for the harness's own model flags. Route mode never
  falls back to native mode on failure (and vice versa): both are explicit
  choices only.
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

## Short commands (`<harness>-<provider>`)

Every route additionally gets a short command name — `opencode-zen`,
`claude-minimax`, `pi-openrouter`, … — that behaves exactly like
`agent <harness> <provider>`:

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
- **Native commands are untouched**: plain `claude`, `opencode`, `pi` and
  `dsh` remain the official binaries with their own auth; short names only
  ever add new commands, never wrap an existing one.
- **MiniMax** uses the official `MiniMax-M3.1-Flash` model ID (2026-10-19).
  Reasoning is always enabled, with `max` as the default effort. Live M Plan
  verification for the formal ID is still pending. The `opencode.minimax`
  route continues to default to `MiniMax-M3`, since the formal ID has not
  yet been verified in OpenCode and an unsupported ID may silently fall back.
  On `claude.minimax` and `pi.minimax`, `MiniMax-M3` can still be selected
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
# secret_only = true           # credential only from <secret>; an ambient
#                              # value of <env> is ignored/overwritten
# opencode_id = "opencode"     # provider id when it differs from the key (zen)
# pi_id = "deepseek"           # pi --provider value (defaults to the key)

[harnesses.claude]
label = "Claude Code"
command = "claude"
adapter = "anthropic"          # anthropic | opencode | pi | passthrough
[harnesses.claude.env]         # adapter env names (names only, no values)
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"  # always cleared for third-party endpoints
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[routes."claude.deepseek"]     # explicit harness × provider combinations
models = ["deepseek-flash"]    # optional route-level model list override
note = "..."                   # optional, shown by `agent list`
# default_model / require_model also override the provider defaults
```

Validation (`agent check`, run by CI) rejects: unknown adapter, route keys
that reference unknown harnesses/providers, missing defaults without
`require_model`, defaults that are not in the model list,
`require_model`-with-default contradictions, `anthropic` routes whose
provider has no `base_url`, `secret_only = true` with identical or missing
`secret`/`env` names, and route keys whose `harness-provider` shortcut names
would collide.

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
- **pi**: `pi --provider <id> --model <id> ...` with the provider credential
  in its native env var. pi accepts ids outside its built-in catalog with a
  warning and passes them through (its catalog is shown by
  `pi --list-models`).
- **passthrough (dsh)**: argv only, plus the provider credential env;
  `--model` is rejected (dsh selects its model natively). dsh is installed
  machine-wide through mise (`npm:@deepseek-ai/dsh`, pinned because every
  upstream version is a prerelease); the route is verified up to
  `agent dsh deepseek -- --version` (Infisical injection, exit 0). A live
  DeepSeek session stays unverified until the account balance allows it.

## Credential handling (no leakage, no argv secrets)

1. If the route's harness env already carries the credential, no secret is
   fetched at all (fast path, `script/with-secrets` is not invoked). This
   shortcut applies only to `env` == `secret` providers; see the
   `secret_only` rule below.
2. Otherwise the launcher re-executes itself *inside* the existing
   `script/with-secrets` (self-hosted Infisical project binding, environment
   `dev`), which injects the whole dev secret set.
3. The in-wrapper stage then filters the environment before `exec`:
   - variables injected by Infisical that the route did not select are
     dropped (baseline diff),
   - every credential name declared in the config (including legacy ones
     such as `MINIMAX_TOKEN_PLAN_KEY`) is dropped unless the route needs it,
   - `defaults.drop_env` names never reach the child,
   - only then are the adapter's `ANTHROPIC_*` values derived — secret
     values are referenced by *name* inside the child stage and are never
     placed in argv, files or logs.
4. Renames happen inside that stage too (e.g. Infisical
   `MINIMAX_M_PLAN_KEY` → harness `MINIMAX_API_KEY`).
5. `secret_only = true` providers (`opencode-go`) accept **only** their
   `secret` name. The harness `env` name is copied from it and never read
   from the ambient environment: a pre-existing Zen `OPENCODE_API_KEY` is
   ignored and overwritten, the fast path is skipped unless
   `OPENCODE_GO_API_KEY` itself is already set, and a missing
   `OPENCODE_GO_API_KEY` fails before the harness starts. There is no
   `env[dst] || env[src]` fallback for these providers.
6. A missing secret fails with its Infisical name before any harness starts.

The launcher's mock tests assert both directions: the selected credential
arrives, and every other provider's credential does not. For Go they
additionally assert that a shell Zen key cannot satisfy the Go route.

## OpenCode Go routes (fixed Go plan, issue #76)

Two explicit routes share one Go (`$10/month`) workspace key:

| route | harness | default model | endpoint | credential |
| --- | --- | --- | --- | --- |
| `claude.opencode-go` | Claude Code | `deepseek-v4.1-flash` | `https://opencode.ai/inference/go/anthropic` (`ANTHROPIC_BASE_URL`) | Go key as `ANTHROPIC_AUTH_TOKEN` |
| `pi.opencode-go` | Pi | `mimo-v2.6-flash` | Pi's native `opencode-go` provider (`https://opencode.ai/zen/go/v1`) | Go key as `OPENCODE_API_KEY` |

- Both are fixed defaults in `config/agents.toml`; `--model` only accepts the
  provider's declared Go ids. There is no runtime model selection, no
  availability/quality gate and no fallback to Zen, Console pay-as-you-go or
  another provider.
- **Credential separation.** Both harnesses normally read
  `OPENCODE_API_KEY`, which is also the Zen key. The Go key lives in
  Infisical as `OPENCODE_GO_API_KEY` and is the only accepted source
  (`secret_only = true`): an ambient Zen `OPENCODE_API_KEY` is overwritten
  for these routes, and `OPENCODE_GO_API_KEY` is dropped for every other
  route. A missing Go key stops the launch (exit 1) instead of borrowing Zen.
- **Not yet a real-API success.** As of 2026-11-01 the Infisical `dev`
  environment has `OPENCODE_API_KEY` but no `OPENCODE_GO_API_KEY`, so only
  the mock tier and the public model catalog are verified here. The two model
  ids are listed by the public `https://opencode.ai/inference/go/v1/models`
  endpoint (28 models, 2026-11-01). Actual inference, tool calls, Go quota
  accounting and Pi's `x-opencode-session` header are **unverified** until
  the secret is provisioned and the calls below are run.
- **Pi version.** Pi 0.73.1 ships provider `opencode-go` but its bundled
  catalog predates both ids; it warns `Using custom model id` and keeps the
  provider's base URL/API. Run `pi update --models` (or upgrade Pi) first.
  Pi's docs say current builds send the OpenCode session header; older builds
  may not, which can affect routing/caching quality but not the credential.
- **Pi auth precedence (fail closed).** Pi resolves credentials as
  CLI `--api-key` > `auth.json` > env > `models.json` provider keys, and
  `models.json` can override a provider's `baseUrl`/`api`. `agent pi
  opencode-go` therefore reads `$PI_CODING_AGENT_DIR` (or `~/.pi/agent`)
  before launch and **exits 1** if `auth.json` has an `opencode-go` entry or
  `models.json` defines an `opencode-go` provider. It never edits or deletes
  those files; other providers' entries are unaffected. An unreadable or
  invalid file also fails closed because the credential source cannot be
  proven. Only `secret_only` routes get this guard, so existing Pi routes
  keep their previous behaviour.
- **Claude Code existing login.** OpenCode's docs advise `/logout` first when
  Claude Code is signed in. In the tested version (2.1.314) the injected
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` took precedence: with a real
  claude.ai Pro login present, `agent claude openrouter-free` used the env
  endpoint/token and Claude printed that "another auth source ... takes
  precedence over your claude.ai login". The same mechanism applies to Go,
  but **Go-specific billing was not verified** (no Go key). Confirm with
  `/status` and the Go usage page on the first real run; if a future Claude
  version changes precedence, treat the route as blocked rather than logging
  the user out automatically.
- **Privacy prerequisite.** DeepSeek V4.1 Flash (and V4 Pro) require
  **Settings › Privacy › Regions = Global** in the Go workspace
  (owner/admin). Without it the request is rejected; the launcher must not
  silently switch to another model or provider. If Global cannot be enabled,
  `claude.opencode-go` stays blocked — use `--model mimo-v2.6-flash` only if
  that is an explicit accepted choice, or another route.
- **Billing.** Go usage is metered per model against a monthly allowance with
  5-hour (20%) and weekly (50%) sub-limits. **Extra Usage** (overflow to the
  Console pay-as-you-go balance) must be verified OFF in the Console on the
  Go page, except Go Teams which starts ON. The launcher cannot read or
  change that account setting and does not claim to.
  DeepSeek V4.1 Flash also has peak/off-peak pricing (peak: 01:00–04:00 and
  06:00–10:00 UTC, Mon–Fri); the flat-rate allowance is unaffected by the
  time of day, but usage counts differ.
- Claude Code 2.1.314 warns that it does not recognize the custom model id
  (200k assumed context) but sends `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_AUTH_TOKEN` unchanged; Go recognizes Claude Code's native
  session header.

Real verification (only after `OPENCODE_GO_API_KEY` exists in Infisical
`dev`; cheap prompts, no unattended loops):

```bash
agent claude opencode-go -- -p 'Use the Bash tool to run: echo GO_CLAUDE_OK'
agent pi opencode-go -- -p 'Use the bash tool to run: echo GO_PI_OK'
# /status inside the session shows the Go base URL; the Console shows the
# model, the Go allowance counters and whether Extra Usage was used.
```

## OpenRouter free: one fixed model (no automatic selection)

Policy (issue #76, superseding #72 / draft PR #73): the normal
`openrouter-free` routes are a **single declarative model id** in
`config/agents.toml`. There is no runtime catalog scan, availability or
quality gate, no `openrouter/free` meta-router, no cached selection and no
fallback to a different free or paid model. Changing the model is a TOML edit
plus review. The allowlist contains only that id, so any other id — free or
paid — exits 2 before a process starts.

Current id: `nvidia/nemotron-3-ultra-550b-a55b:free`.

Verified on 2026-11-01 (macOS, real calls through the launcher, Infisical
`OPENROUTER_API_KEY`):

- public `/api/v1/models`: `pricing.prompt = "0"`, `pricing.completion = "0"`,
  `tools` supported, no expiry;
- Claude Code 2.1.314: `-p` answer + Bash tool call (`ROUTE_OK`) succeeded;
- Pi 0.73.1: `-p` answer + bash tool call (`PI_ROUTE_OK`) succeeded;
- OpenCode 2.2.3: `run` answer + bash tool call (`OC_ROUTE_OK`) succeeded.

Not verified: Windows/WSL real calls, long sessions, rate-limit behaviour, and
whether those ids remain free (re-check before relying on them). Free-tier
limits are account-based (20 req/min; 1,000 req/day after ≥ $10 cumulative
purchase). A failure must be reported, not retried onto a paid route.

Draft PR #73's evaluator (`agent-eval.ts`, `agent-quality.ts`, catalog and
calibration machinery) is deliberately **not** merged. Its research record
was salvaged into `docs/research/openrouter-free-quality-2026-10-24.md` as
evidence for why automatic selection was stopped; that file is documentation,
not an active code path.

## Route matrix and verification status

| harness \ provider | zen | opencode-go | openrouter | openrouter-free | deepseek | minimax |
| --- | --- | --- | --- | --- | --- | --- |
| claude | — (no Anthropic-compatible endpoint verified; zen free tier is client-bound: pi got `403 … only … within OpenCode`) | yes, default `deepseek-v4.1-flash` (Go endpoint; Go key only, `secret_only`; needs Privacy Regions = Global; real response **unverified** — no `OPENCODE_GO_API_KEY` in Infisical yet) | yes, default `z-ai/glm-5.3-flash` | ONE fixed model `nvidia/nemotron-3-ultra-550b-a55b:free` (pricing 0/0, tools, live E2E 2026-11-01; any other id exits 2; never a paid fallback) | yes, default `deepseek-flash` (route list: `deepseek-flash` only, because the endpoint silently remaps unknown names) | yes, default `MiniMax-M3.1-Flash` (official model ID; live M Plan verification pending; reasoning always on; effort defaults to `max`) |
| opencode | yes, default `mimo-v2.6-flash-free` (free models; `opencode_id = "opencode"`) | — (not configured; OpenCode's native id exists but this PR adds only the two required routes) | yes | ONE fixed model `nvidia/nemotron-3-ultra-550b-a55b:free` (`opencode_id = "openrouter"`; live E2E 2026-11-01) | yes | yes, route default `MiniMax-M3` (route model list `["MiniMax-M3"]` only; OpenCode v2 previously silently fell back to Zen for the Preview ID; formal ID not yet verified — keep M3 as the known route default; `--model MiniMax-M3.1-Flash` exits 2 here) |
| pi | — (free tier refused outside OpenCode) | yes, default `mimo-v2.6-flash` (native `opencode-go`; Go key only; Pi 0.73.1 warns "custom model id"; real response **unverified** — no `OPENCODE_GO_API_KEY` in Infisical yet) | yes | ONE fixed model `nvidia/nemotron-3-ultra-550b-a55b:free` (`pi_id = "openrouter"`; live E2E 2026-11-01) | yes | yes, default `MiniMax-M3.1-Flash` (official ID; verify real M Plan response and catalog behavior) |
| dsh | — | — | — | — | passthrough (native dsh auth; install + `--version` verified, live session pending DeepSeek balance) | — |

Not covered on purpose: `opencode.opencode-go` (possible follow-up; the two
required Go routes are the scope), `opencode`/`pi` on other providers, paid
zen models (add them to the TOML deliberately), any automatic fallback
between models or providers, and any second model on an `openrouter-free`
route (the free allowlist is a single id — an unlisted id fails closed).

**The static allowlist is not a price or availability guarantee.** It only
prevents the launcher from selecting a different id. If OpenRouter later
charges for `nvidia/nemotron-3-ultra-550b-a55b:free` or retires it, this
launcher will still attempt that exact id: a new price would be billed by
OpenRouter, and a retirement would fail at runtime. Neither is detected by
`agent check`. Re-check the live catalog/pricing before relying on the route,
and keep an account-side budget/alert as the hard stop. The launcher does not
claim "free forever".

Verification is reported in two tiers, matching issue #45's acceptance
criteria:

- **Mock/syntax**: `bun test script/agent.test.ts` (39 cases:
  help/list/models, unknown harness/provider/model, `--model` precedence,
  MiniMax default vs. `require_model` fail-closed, the single-model
  openrouter-free allowlist (paid and non-default free ids exit 2, same
  credential as the paid provider), OpenCode Go defaults/endpoint/auth-token
  mapping, `secret_only` separation in both directions (Zen shell key cannot
  satisfy Go, Go key is dropped on zen routes, fast path vs. Infisical),
  missing Go secret fail-closed, Pi `auth.json`/`models.json` override guard
  (`PI_CODING_AGENT_DIR` honored, unrelated providers allowed, invalid JSON
  fails closed), secret filtering both ways, forbidden passthrough flags,
  shortcut equivalence/args/`--agent-model`/unknown names/link management,
  native commands staying unwrapped, config validation failures) plus
  `agent check`, `agent shortcuts` and `bun script/agent.ts …` smoke runs
  in CI.
- **Real machine E2E**: recorded in the PR/issue after running a cheap
  prompt per combination (`agent <harness> <provider> -- -p '…'`); combos
  run only in the mock tier stay marked unverified here. OpenRouter-free was
  live-tested on 2026-11-01; OpenCode Go is mock-only until
  `OPENCODE_GO_API_KEY` is provisioned.

Verification status per platform (implementation is identical; what
differs is which entry-point layer was exercised on a real machine):

| platform | launcher + config + secrets | shortcut symlink form | interactive TUI start | PowerShell entry / `.cmd` |
| --- | --- | --- | --- | --- |
| macOS | verified (real routes) | verified (`ps` name recovery) | verified | n/a |
| WSL/Linux | unverified on a real machine yet (post-merge step) | unverified (`/proc/self/cmdline` path not yet exercised) | unverified | n/a |
| Windows native | CI-verified only (windows-latest job: batch-shim argv/injection/`%`+`"` rejection, `.cmd` shortcut create+exec, `with-secrets.ps1` workspaceId/API-URL pinning) | n/a (`.cmd` used instead) | unverified (no real machine) | CI-verified (PowerShell 7 on windows-latest); real machine (2026-10-17, PowerShell 7.6): `agent.ps1 list/check`, `with-secrets.ps1` injection and `bun test script/agent.windows.test.ts` verified; **shortcut creation and interactive harness start still unverified** |

The OpenCode Go routes add no new entry-point or injection layer, so they
inherit the platform status above; their credential mapping is mock-verified
on POSIX. Real Go calls are unverified on every platform (missing secret).

## Installation and migration (replaces the draft mise tasks)

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

On Windows (PowerShell, no Bash/WSL/Python): run
`& <checkout>\script\agent.ps1 check`, and `agent.ps1 shortcuts create`
generates the `.cmd` entry points into `~/.local/bin` (add it to `PATH`).

The bare `agent` command on Windows is `script\agent.cmd`, a thin wrapper over
`script/agent.ts` usable from cmd.exe and PowerShell. Register it with
`pwsh script\agent-entrypoint.ps1 install` (creates a managed `agent.cmd` shim in
`~/.local/bin`; `check` and `remove` also exist). The script never edits `PATH`
and never overwrites or removes another `agent` (for example Grok Build's
`~/.grok/bin/agent.exe`). It verifies that both `Get-Command agent` and
`where.exe agent` resolve to the shim, and exits 1 naming the shadowing path
otherwise, so a name collision is never reported as success. Resolve it by
placing `~/.local/bin` before the shadowing directory on `PATH` yourself.

- `AGENT_MODEL=… mise run agent:…` → `agent <harness> <provider> --model …`.
- `script/agent/mimo` and `script/agent/minimax` stay as explicit,
  provider-tuned wrappers (ADR-0008) and are not touched here.
- pc-setup's NixOS shell init no longer defines a `claude()` override
  (issue #104); project-init profiles describe the launcher instead of mise
  tasks (issue #100).

Rollback: the launcher itself keeps no state — native CLI config, provider
accounts, billing and shell rc files are never modified — so undoing it is a
repository-level operation. `script/link` only creates or updates links and
**never deletes them**, so the shim has to be removed explicitly:

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
- **`OPENCODE_GO_API_KEY` is required by the new Go routes but was not yet
  present** in `dev` at that date. Until it is added (value from the Go
  workspace, never committed), `agent claude opencode-go` and
  `agent pi opencode-go` exit 1 with a message naming it. This is
  intentional: the launcher will not borrow `OPENCODE_API_KEY` (Zen).
- Legacy/untouched names that are deliberately filtered out of every child:
  `MINIMAX_TOKEN_PLAN_KEY`, `MIMO_API_KEY`.

## Tests

```bash
bun script/agent.ts check   # config validation
bun test script/agent.test.ts          # mock harness + mock Infisical wrapper (POSIX)
bun test script/agent.windows.test.ts  # Windows layers (runs on windows CI only)
bun test script/agent.entrypoint.windows.test.ts  # native `agent` entry point (windows only)
./script/test && ./script/check-secrets
```

CI installs Bun (pinned `oven-sh/setup-bun`) and runs the config
validation plus the mock suite on every pull request; a second
`windows-latest` job runs the same launcher validation plus the
Windows-layer suite (batch shims, generated `.cmd` shortcuts, the
PowerShell wrapper with a stubbed `infisical`). Real prompt runs remain a
manual, per-combination step. The POSIX mock tests spawn bash stubs, so
they run on POSIX hosts (CI + macOS); Windows behavior is covered by the
windows-latest CI job and still awaits real-machine verification.
