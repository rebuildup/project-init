#!/usr/bin/env bun
/**
 * Mock tests for script/agent.ts (Bun port of script/test-agent).
 *
 * No network, no real secrets: the harness binaries are replaced by stubs
 * that dump their argv and environment, and script/with-secrets is replaced
 * by a stub that injects a fake Infisical `dev` secret set.
 *
 * Run: bun test script/agent.test.ts
 */

import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkCommand } from "./omp-destructive-guard";

const REPO = dirname(dirname(realpathSync(import.meta.path)));
const LAUNCHER = join(REPO, "script", "agent.ts");
const REAL_CONFIG = join(REPO, "config", "agents.toml");
const OMP_GUARD = realpathSync(join(REPO, "script", "omp-destructive-guard.ts"));
const OMP_WORKER_ARGV = [
  "--tools",
  "read,bash,edit,write",
  "--no-lsp",
  "--no-pty",
  "--no-title",
  "--trusted-extension",
  OMP_GUARD,
];

// shortcut names derived from the routes, exactly like the launcher does
const REAL_SHORTCUTS = Object.keys(
  (Bun.TOML.parse(readFileSync(REAL_CONFIG, "utf8")) as { routes: Record<string, unknown> })
    .routes,
)
  .map((key) => {
    const dot = key.indexOf(".");
    return `${key.slice(0, dot)}-${key.slice(dot + 1)}`;
  })
  .sort();

const HARNESSES = ["claude", "opencode", "omp", "dsh"];

const FAKE_HARNESS = `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'ARGV\\n'
  for arg in "$@"; do printf '%s\\n' "$arg"; done
  printf 'ARGV-END\\n'
  env | sort
} > "\${AGENT_TEST_OUT:?}"
`;

// Simulates `infisical run --env dev`: injects every secret of the project.
const FAKE_WITH_SECRETS = `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${AGENT_TEST_MARKER:-}" ]]; then
  : > "$AGENT_TEST_MARKER"
fi
if [[ -n "\${AGENT_TEST_WRAPPER_ARGV:-}" ]]; then
  printf '%s\\n' "$@" > "$AGENT_TEST_WRAPPER_ARGV"
fi
if [[ -n "\${AGENT_TEST_WRAPPER_ENV:-}" ]]; then
  env | sort > "$AGENT_TEST_WRAPPER_ENV"
fi
export FAKE_INFISICAL_INJECTED=yes
export DEEPSEEK_API_KEY=secret-deepseek
export OPENROUTER_API_KEY=secret-openrouter
export OPENCODE_API_KEY=secret-opencode
export MINIMAX_M_PLAN_KEY=secret-minimax-plan
export MINIMAX_TOKEN_PLAN_KEY=secret-minimax-legacy
export MIMO_API_KEY=secret-mimo
export ANTHROPIC_AUTH_TOKEN=secret-anthropic
export INFISICAL_TOKEN=secret-infisical
exec "$@"
`;

// Same, but the DeepSeek secret is absent (rotated/never provisioned).
const FAKE_WITH_SECRETS_NO_DEEPSEEK = FAKE_WITH_SECRETS.replace(
  "export DEEPSEEK_API_KEY=secret-deepseek\n",
  "",
);

// Same, but the OpenCode Go workspace key is absent. The Zen key is still
// injected: a Go route must fail instead of reusing it.
const FAKE_WITH_SECRETS_NO_OPENCODE = FAKE_WITH_SECRETS.replace(
  "export OPENCODE_API_KEY=secret-opencode\n",
  "",
);

// Injects the fake secrets AND writes an OMP override, simulating a concurrent
// writer between the pre-fetch guard and the final spawn.
const FAKE_WITH_SECRETS_MUTATES_OMP_DB = FAKE_WITH_SECRETS.replace(
  "export FAKE_INFISICAL_INJECTED=yes",
  'mkdir -p "${HOME}/.omp/agent"\ncp "${AGENT_TEST_RACE_DB:?}" "${HOME}/.omp/agent/agent.db"\nexport FAKE_INFISICAL_INJECTED=yes',
);

const FAKE_WITH_SECRETS_MUTATES_OMP_MODELS = FAKE_WITH_SECRETS.replace(
  "export FAKE_INFISICAL_INJECTED=yes",
  'mkdir -p "${HOME}/.omp/agent"\nprintf \'providers:\\n  opencode-go:\\n    apiKey: concurrent\\n\' > "${HOME}/.omp/agent/models.yml"\nexport FAKE_INFISICAL_INJECTED=yes',
);

// The schema OMP 18.16.0 creates for its auth store (bun:sqlite fixture).
const OMP_AUTH_SCHEMA = `
CREATE TABLE auth_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  data TEXT NOT NULL,
  disabled_cause TEXT DEFAULT NULL,
  identity_key TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
`;

const PRECEDENCE_CONFIG = `
[defaults]
drop_env = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]

[providers.p1]
label = "P1"
base_url = "https://p1.example/api"
secret = "DEEPSEEK_API_KEY"
env = "DEEPSEEK_API_KEY"
default_model = "provider-model"
models = ["provider-model", "route-model", "cli-model"]

[providers.p2]
label = "P2"
secret = "CUSTOMP_API_KEY"
env = "CUSTOMP_API_KEY"
default_model = "provider-model"
models = ["provider-model"]

[harnesses.h1]
label = "H1"
command = "claude"
adapter = "anthropic"

[harnesses.h1.env]
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[routes."h1.p1"]
default_model = "route-model"
`;

const GHOST_CONFIG = `
[providers.p1]
label = "P1"
secret = "DEEPSEEK_API_KEY"
env = "DEEPSEEK_API_KEY"
default_model = "provider-model"
models = ["provider-model"]

[harnesses.ghost]
label = "Ghost"
command = "definitely-not-installed-harness"
adapter = "passthrough"

[routes."ghost.p1"]
`;

const REQUIRE_CONFIG = `
[providers.p1]
label = "P1"
base_url = "https://p1.example/api"
secret = "DEEPSEEK_API_KEY"
env = "DEEPSEEK_API_KEY"
require_model = true
models = ["m1", "m2"]

[harnesses.h1]
label = "H1"
command = "claude"
adapter = "anthropic"
[harnesses.h1.env]
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[routes."h1.p1"]
`;

interface RunOptions {
  env?: Record<string, string>;
  config?: string;
}

class Fixture {
  tmp: string;
  bindir: string;
  out: string;
  marker: string;
  wrapper_argv: string;
  wrapper_env: string;
  wrapper: string;

  constructor() {
    this.tmp = mkdtempSync(join(tmpdir(), "agent-launcher-test-"));
    this.bindir = join(this.tmp, "bin");
    mkdirSync(this.bindir);
    this.out = join(this.tmp, "child.env");
    this.marker = join(this.tmp, "wrapper.ran");
    this.wrapper_argv = join(this.tmp, "wrapper.argv");
    this.wrapper_env = join(this.tmp, "wrapper.env");
    this.wrapper = join(this.tmp, "with-secrets");
    this.writeWrapper(FAKE_WITH_SECRETS);
    for (const harness of HARNESSES) {
      const path = join(this.bindir, harness);
      writeFileSync(path, FAKE_HARNESS);
      chmodSync(path, 0o755);
    }
  }

  writeWrapper(content: string): void {
    writeFileSync(this.wrapper, content);
    chmodSync(this.wrapper, 0o755);
  }

  /** Write an OMP agent-dir file (config/models/dotenv) in the test HOME. */
  writeOmpConfig(name: string, content: unknown, agentDir?: string): string {
    const dir = agentDir ?? join(this.tmp, ".omp", "agent");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    writeFileSync(path, text);
    return path;
  }

  /** Create an OMP agent.db with the auth_credentials schema and rows. */
  writeAgentDb(
    rows: Array<{ provider: string; disabled_cause?: string | null }>,
    dbPath?: string,
  ): string {
    const path = dbPath ?? join(this.tmp, ".omp", "agent", "agent.db");
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    try {
      db.run(OMP_AUTH_SCHEMA);
      const insert = db.prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause) VALUES (?, ?, ?, ?)",
      );
      for (const row of rows) {
        insert.run(row.provider, "api_key", "{}", row.disabled_cause ?? null);
      }
    } finally {
      db.close();
    }
    return path;
  }

  baseEnv(extra?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {
      // Fixed PATH: the suite must not see shortcuts or harnesses installed
      // in the developer's environment (a personal ~/.local/bin on PATH
      // would turn link-management expectations into conflicts).
      PATH: `${this.bindir}:/usr/bin:/bin`,
      // Isolate OMP/harness user config (the launcher reads ~/.omp/agent for
      // the require_infisical OMP guard) from the developer's real HOME.
      HOME: this.tmp,
      AGENT_WITH_SECRETS: this.wrapper,
      AGENT_TEST_OUT: this.out,
      AGENT_TEST_MARKER: this.marker,
      AGENT_TEST_WRAPPER_ARGV: this.wrapper_argv,
      AGENT_TEST_WRAPPER_ENV: this.wrapper_env,
    };
    if (extra) {
      Object.assign(env, extra);
    }
    return env;
  }

  private clearDumps(): void {
    for (const path of [this.out, this.marker, this.wrapper_argv, this.wrapper_env]) {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  }

  private spawn(cmd: string[], options: RunOptions) {
    this.clearDumps();
    const env = this.baseEnv(options.env);
    if (options.config !== undefined) {
      env["AGENT_CONFIG"] = options.config;
    }
    return Bun.spawnSync({ cmd, env, cwd: this.tmp, stdout: "pipe", stderr: "pipe" });
  }

  run(args: string[], options: RunOptions = {}) {
    return this.spawn([process.execPath, LAUNCHER, ...args], options);
  }

  /** Invoke the launcher through a `<harness>-<provider>` symlink. */
  runShortcut(name: string, args: string[], options: RunOptions = {}) {
    const link = join(this.bindir, name);
    let linkExists = false;
    try {
      lstatSync(link);
      linkExists = true;
    } catch {
      linkExists = false;
    }
    if (!linkExists) {
      symlinkSync(LAUNCHER, link);
    }
    // Bun resolves a symlinked argv[1], so the launcher is started through
    // the interpreter and recovers the invoked name from the kernel argv.
    return this.spawn([process.execPath, link, ...args], options);
  }

  /** Parse the stub harness dump: [argv, env]. */
  child(): [string[], Record<string, string>] {
    if (!existsSync(this.out)) {
      throw new Error("child harness never ran");
    }
    const lines = readFileSync(this.out, "utf8").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    if (lines.length === 0 || lines[0] !== "ARGV") {
      throw new Error(`unexpected dump header: ${JSON.stringify(lines.slice(0, 1))}`);
    }
    const end = lines.indexOf("ARGV-END");
    if (end === -1) {
      throw new Error("dump misses ARGV-END");
    }
    const argv = lines.slice(1, end);
    const env: Record<string, string> = {};
    for (const line of lines.slice(end + 1)) {
      const eq = line.indexOf("=");
      const name = eq === -1 ? line : line.slice(0, eq);
      const value = eq === -1 ? "" : line.slice(eq + 1);
      env[name] = value;
    }
    return [argv, env];
  }

  clean(): void {
    rmSync(this.tmp, { recursive: true, force: true });
  }
}

function check(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Run one test body with a fresh fixture, cleaning up afterwards. */
function withFixture(body: (fixture: Fixture) => void): () => void {
  return () => {
    const fixture = new Fixture();
    try {
      body(fixture);
    } finally {
      fixture.clean();
    }
  };
}

// The mock suite drives bash stubs and POSIX symlinks; on Windows the same
// behaviors are covered by script/agent.windows.test.ts, so skip here.
const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("agent launcher mock suite (POSIX stubs)", () => {
test(
  "test_config_valid",
  withFixture((fixture) => {
    const result = fixture.run(["check"], { config: REAL_CONFIG });
    check(result.exitCode === 0, `check failed: ${result.stderr.toString()}`);
    check(result.stdout.toString().includes("config OK"), result.stdout.toString());
    check(
      result.stdout.toString().includes(REAL_CONFIG) ||
        result.stdout.toString().includes("config OK"),
      result.stdout.toString(),
    );
  }),
);

test(
  "test_help",
  withFixture((fixture) => {
    for (const args of [["help"], ["--help"], ["-h"], ["claude", "openrouter", "--help"]]) {
      const result = fixture.run(args, { config: REAL_CONFIG });
      check(
        result.exitCode === 0,
        `${args.join(" ")} -> ${result.exitCode}: ${result.stderr.toString()}`,
      );
      check(result.stdout.toString().includes("usage:"), `${args.join(" ")}: no usage in stdout`);
    }
    const result = fixture.run([], { config: REAL_CONFIG });
    check(result.exitCode === 2, "bare `agent` must exit 2");
    check(result.stderr.toString().includes("usage:"), "bare `agent` must print usage on stderr");
  }),
);

test(
  "test_list",
  withFixture((fixture) => {
    const result = fixture.run(["list"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const stdout = result.stdout.toString();
    for (const route of [
      "claude.openrouter",
      "claude.deepseek",
      "claude.minimax",
      "claude.opencode-go",
      "opencode.zen",
      "omp.deepseek",
      "omp.opencode-go",
      "omp.openrouter",
      "omp.openrouter-free",
      "omp.minimax",
      "dsh.deepseek",
    ]) {
      check(stdout.includes(route), `list misses ${route}: ${stdout}`);
    }
    check(!stdout.includes("pi."), `the Pi routes must be gone: ${stdout}`);
    check(!stdout.includes("omp.zen"), `omp.zen is out of scope: ${stdout}`);
    check(
      !stdout.includes("--model required"),
      "every configured route must resolve a default model",
    );
    check(stdout.includes("MiniMax-M3.1-Flash"), "minimax default missing");
    check(stdout.includes("mimo-v2.6-flash-free"), "zen default missing");
    check(stdout.includes("deepseek-v4.1-flash"), "Go claude default missing");
    check(stdout.includes("mimo-v2.6-flash"), "Go omp default missing");
    check(stdout.includes("opencode-zen"), "shortcut names must be listed");
    check(stdout.includes("claude-opencode-go"), "Go shortcut name missing");
    check(stdout.includes("omp-opencode-go"), "Go omp shortcut name missing");
  }),
);

test(
  "test_models",
  withFixture((fixture) => {
    let result = fixture.run(["models", "deepseek"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    let stdout = result.stdout.toString();
    check(stdout.includes("DEEPSEEK_API_KEY"), stdout);
    check(stdout.includes("deepseek-flash"), stdout);
    check(stdout.includes("https://api.deepseek.com/anthropic"), stdout);
    check(stdout.includes("routes:"), stdout);

    result = fixture.run(["models", "zen"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    check(result.stdout.toString().includes("opencode/mimo-v2.6-flash-free"), result.stdout.toString());

    result = fixture.run(["models", "opencode-go"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const goStdout = result.stdout.toString();
    check(goStdout.includes("OPENCODE_API_KEY"), goStdout);
    check(goStdout.includes("require_infisical"), goStdout);
    check(goStdout.includes("https://opencode.ai/inference/go/anthropic"), goStdout);
    check(goStdout.includes("omp provider id: opencode-go"), goStdout);
    check(
      goStdout.includes("ambient env and OMP-local overrides are rejected"),
      goStdout,
    );
    check(goStdout.includes("deepseek-v4.1-flash"), goStdout);
    check(goStdout.includes("mimo-v2.6-flash"), goStdout);

    result = fixture.run(["models", "nope"], { config: REAL_CONFIG });
    check(result.exitCode === 2, "unknown provider must exit 2");
    check(result.stderr.toString().includes("unknown provider"), result.stderr.toString());
  }),
);

test(
  "test_unknown_selection",
  withFixture((fixture) => {
    const cases: Array<[string[], string]> = [
      [["bogus", "zen"], "unknown harness"],
      [["claude", "bogus"], "unknown provider"],
      [["dsh", "openrouter"], "available providers for 'dsh'"],
      [["claude", "--model", "sonnet"], "requires a provider"],
      [["claude", "openrouter", "stray"], "unexpected argument"],
      [["claude", "openrouter", "--model"], "requires a value"],
    ];
    for (const [args, needle] of cases) {
      const result = fixture.run(args, { config: REAL_CONFIG });
      check(
        result.exitCode === 2,
        `${args.join(" ")} -> ${result.exitCode}: ${result.stderr.toString()}`,
      );
      check(
        result.stderr.toString().includes(needle),
        `${args.join(" ")}: expected '${needle}' in '${result.stderr.toString()}'`,
      );
    }
  }),
);

test(
  "test_unknown_model",
  withFixture((fixture) => {
    const result = fixture.run(["claude", "openrouter", "--model", "gpt-expensive"], {
      config: REAL_CONFIG,
    });
    check(result.exitCode === 2, result.stderr.toString());
    check(
      (result.stdout.toString() + result.stderr.toString()).includes("unknown model"),
      result.stderr.toString(),
    );
    // route-level model list overrides the provider list (claude.deepseek)
    const result2 = fixture.run(["claude", "deepseek", "--model", "deepseek-v4-pro"], {
      config: REAL_CONFIG,
    });
    check(result2.exitCode === 2, "route model list must be enforced");
    check(result2.stderr.toString().includes("unknown model"), result2.stderr.toString());
  }),
);

test(
  "test_minimax_default_model",
  withFixture((fixture) => {
    // no --model: the configured default applies (fail closed is kept by the
    // models list — unknown ids are rejected before a process starts).
    // claude.minimax inherits the provider default (M3.1-Flash);
    // opencode.minimax keeps MiniMax-M3 as a route-level override because
    // Formal M3.1 ID has not yet been verified with this OpenCode route.
    const result = fixture.run(["claude", "minimax"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    check(argv.length === 0, `argv ${JSON.stringify(argv)}`);
    check(env["ANTHROPIC_BASE_URL"] === "https://api.minimax.io/anthropic", JSON.stringify(env));
    check(env["ANTHROPIC_MODEL"] === "MiniMax-M3.1-Flash", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_OPUS_MODEL"] === "MiniMax-M3.1-Flash", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] === "MiniMax-M3.1-Flash", JSON.stringify(env));
    check(env["ANTHROPIC_SMALL_FAST_MODEL"] === "MiniMax-M3.1-Flash", JSON.stringify(env));
    // secret rename: Infisical MINIMAX_M_PLAN_KEY -> harness MINIMAX_API_KEY
    check(env["MINIMAX_API_KEY"] === "secret-minimax-plan", env["MINIMAX_API_KEY"]);
    check(
      env["ANTHROPIC_AUTH_TOKEN"] === "secret-minimax-plan",
      `auth token was '${env["ANTHROPIC_AUTH_TOKEN"]}'`,
    );
    // ... but no other provider's secret reaches the child
    for (const leak of [
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
      "OPENCODE_API_KEY",
      "MIMO_API_KEY",
      "INFISICAL_TOKEN",
      "FAKE_INFISICAL_INJECTED",
      "MINIMAX_TOKEN_PLAN_KEY",
    ]) {
      check(!(leak in env), `secret leaked to child: ${leak}`);
    }
    check(existsSync(fixture.marker), "with-secrets wrapper was not used");

    // --model still overrides the default for one process (MiniMax-M3 stays
    // explicitly selectable on every minimax route, even where it is no
    // longer the default)
    const result2 = fixture.run(["claude", "minimax", "--model", "MiniMax-M3"], {
      config: REAL_CONFIG,
    });
    check(result2.exitCode === 0, result2.stderr.toString());
    const [, env2] = fixture.child();
    check(env2["ANTHROPIC_MODEL"] === "MiniMax-M3", JSON.stringify(env2));

    // ids outside the model list still fail closed
    const result3 = fixture.run(["claude", "minimax", "--model", "MiniMax-not-a-model"], {
      config: REAL_CONFIG,
    });
    check(result3.exitCode === 2, "unknown minimax model must exit 2");
    check(result3.stderr.toString().includes("unknown model"), result3.stderr.toString());

    // opencode.minimax keeps MiniMax-M3 as a route-level default because
    // The formal MiniMax-M3.1-Flash id is not yet validated on this OpenCode route
    const oc = fixture.run(["opencode", "minimax"], { config: REAL_CONFIG });
    check(oc.exitCode === 0, oc.stderr.toString());
    const [, envOc] = fixture.child();
    const content = envOc["OPENCODE_CONFIG_CONTENT"];
    check(typeof content === "string", `OPENCODE_CONFIG_CONTENT missing: ${JSON.stringify(envOc)}`);
    const parsed = JSON.parse(content as string);
    check(parsed.model === "minimax/MiniMax-M3", JSON.stringify(parsed));

    // opencode.minimax rejects MiniMax-M3.1-Flash explicitly with
    // exit 2 — the route's model list only contains ids the opencode client
    // recognizes, so the launcher enforces fail-closed before any process
    // starts (this is a regression test: the route used to advertise M3.1
    // as selectable while silently falling back to zen).
    const ocReject = fixture.run(
      ["opencode", "minimax", "--model", "MiniMax-M3.1-Flash"],
      { config: REAL_CONFIG },
    );
    check(ocReject.exitCode === 2, `M3.1 must exit 2 on opencode.minimax, got ${ocReject.exitCode}`);
    check(
      ocReject.stderr.toString().includes("unknown model"),
      `expected 'unknown model' in stderr, got: ${ocReject.stderr.toString()}`,
    );
    check(
      ocReject.stderr.toString().includes("MiniMax-M3.1-Flash"),
      `expected the rejected id in stderr, got: ${ocReject.stderr.toString()}`,
    );

    // opencode.minimax still accepts explicit MiniMax-M3 (the verified id)
    const ocM3 = fixture.run(["opencode", "minimax", "--model", "MiniMax-M3"], {
      config: REAL_CONFIG,
    });
    check(ocM3.exitCode === 0, ocM3.stderr.toString());
    const [, envOcM3] = fixture.child();
    const parsedM3 = JSON.parse(envOcM3["OPENCODE_CONFIG_CONTENT"] as string);
    check(parsedM3.model === "minimax/MiniMax-M3", JSON.stringify(parsedM3));

    // omp.minimax inherits the provider default (M3.1-Flash)
    const omp = fixture.run(["omp", "minimax"], { config: REAL_CONFIG });
    check(omp.exitCode === 0, omp.stderr.toString());
    const [argvOmp, envOmp] = fixture.child();
    expect(argvOmp, JSON.stringify(argvOmp)).toEqual([
      "--provider",
      "minimax",
      "--model",
      "MiniMax-M3.1-Flash",
      ...OMP_WORKER_ARGV,
    ]);
    check(envOmp["MINIMAX_API_KEY"] === "secret-minimax-plan", envOmp["MINIMAX_API_KEY"]);
  }),
);

test(
  "test_openrouter_free_routes",
  withFixture((fixture) => {
    // claude.openrouter-free: the provider default applies and every model
    // role maps to it. The credential is the SAME OpenRouter secret as the
    // paid provider (no new Infisical secret was created for the free slice).
    const result = fixture.run(["claude", "openrouter-free"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    check(argv.length === 0, `argv ${JSON.stringify(argv)}`);
    check(env["ANTHROPIC_BASE_URL"] === "https://openrouter.ai/api", JSON.stringify(env));
    check(env["ANTHROPIC_MODEL"] === "nvidia/nemotron-3-ultra-550b-a55b:free", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_SONNET_MODEL"] === "nvidia/nemotron-3-ultra-550b-a55b:free", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] === "nvidia/nemotron-3-ultra-550b-a55b:free", JSON.stringify(env));
    check(env["ANTHROPIC_AUTH_TOKEN"] === "secret-openrouter", env["ANTHROPIC_AUTH_TOKEN"]);
    check(env["OPENROUTER_API_KEY"] === "secret-openrouter", env["OPENROUTER_API_KEY"]);
    // ... but no other provider's secret reaches the child
    for (const leak of [
      "DEEPSEEK_API_KEY",
      "OPENCODE_API_KEY",
      "MIMO_API_KEY",
      "INFISICAL_TOKEN",
      "FAKE_INFISICAL_INJECTED",
      "MINIMAX_M_PLAN_KEY",
    ]) {
      check(!(leak in env), `secret leaked to child: ${leak}`);
    }
    check(existsSync(fixture.marker), "with-secrets wrapper was not used");

    // The paid default model id is NOT in the free allowlist: selecting it on
    // the free route must fail closed before any process starts. This is the
    // regression test for "no implicit fallback to the paid openrouter route".
    const paid = fixture.run(["claude", "openrouter-free", "--model", "z-ai/glm-5.3-flash"], {
      config: REAL_CONFIG,
    });
    check(paid.exitCode === 2, `paid model on free route must exit 2, got ${paid.exitCode}`);
    check(
      paid.stderr.toString().includes("unknown model"),
      `expected 'unknown model' in stderr, got: ${paid.stderr.toString()}`,
    );
    check(!existsSync(fixture.marker), "credentials must not be fetched for a rejected model");

    // opencode.openrouter-free: OpenCode addresses OpenRouter natively as
    // provider id `openrouter`, so the model id keeps that prefix.
    const oc = fixture.run(["opencode", "openrouter-free"], { config: REAL_CONFIG });
    check(oc.exitCode === 0, oc.stderr.toString());
    const [, envOc] = fixture.child();
    const parsed = JSON.parse(envOc["OPENCODE_CONFIG_CONTENT"] as string);
    check(
      parsed.model === "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      `opencode model id wrong: ${JSON.stringify(parsed)}`,
    );
    check(envOc["OPENROUTER_API_KEY"] === "secret-openrouter", envOc["OPENROUTER_API_KEY"]);

    // omp.openrouter-free: OMP knows OpenRouter as provider id `openrouter`
    // (route key `openrouter-free` is launcher-side routing only).
    const omp = fixture.run(["omp", "openrouter-free"], { config: REAL_CONFIG });
    check(omp.exitCode === 0, omp.stderr.toString());
    const [argvOmp, envOmp] = fixture.child();
    expect(argvOmp, JSON.stringify(argvOmp)).toEqual([
      "--provider",
      "openrouter",
      "--model",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      ...OMP_WORKER_ARGV,
    ]);
    check(envOmp["OPENROUTER_API_KEY"] === "secret-openrouter", envOmp["OPENROUTER_API_KEY"]);

    // an unverified paid-ish id fails closed on every free route
    for (const [harness, provider] of [
      ["claude", "openrouter-free"],
      ["opencode", "openrouter-free"],
      ["omp", "openrouter-free"],
    ] as Array<[string, string]>) {
      const rejected = fixture.run([harness, provider, "--model", "z-ai/glm-5.3"], {
        config: REAL_CONFIG,
      });
      check(rejected.exitCode === 2, `${harness} free route must reject z-ai/glm-5.3 (paid)`);
    }

    // The normal free route is a SINGLE fixed model (issue #76): another
    // free-tier id must fail closed too, so no runtime catalog/quality
    // selection (or a later monetized id) can sneak in.
    for (const harness of ["claude", "opencode", "omp"]) {
      const rejected = fixture.run(
        [harness, "openrouter-free", "--model", "nvidia/nemotron-3.5-super-vl:free"],
        { config: REAL_CONFIG },
      );
      check(
        rejected.exitCode === 2,
        `${harness} free route must reject the non-default free id, got ${rejected.exitCode}`,
      );
      check(
        rejected.stderr.toString().includes("unknown model"),
        `${harness}: ${rejected.stderr.toString()}`,
      );
      check(!existsSync(fixture.marker), "credentials must not be fetched for a rejected model");
    }

    // ... and the configured default is the same id on all three harnesses.
    for (const [harness, expected] of [
      ["claude", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["opencode", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["omp", "nvidia/nemotron-3-ultra-550b-a55b:free"],
    ] as Array<[string, string]>) {
      const run = fixture.run([harness, "openrouter-free"], { config: REAL_CONFIG });
      check(run.exitCode === 0, run.stderr.toString());
      const [runArgv, runEnv] = fixture.child();
      const selected =
        harness === "claude"
          ? runEnv["ANTHROPIC_MODEL"]
          : harness === "omp"
            ? runArgv[runArgv.indexOf("--model") + 1]
            : (JSON.parse(runEnv["OPENCODE_CONFIG_CONTENT"]) as Record<string, unknown>).model;
      check(
        selected === (harness === "opencode" ? `openrouter/${expected}` : expected),
        `${harness} selected ${JSON.stringify(selected)}`,
      );
    }
  }),
);

test(
  "test_opencode_go_routes",
  withFixture((fixture) => {
    // claude.opencode-go: Anthropic-compatible Go endpoint, the GO key as
    // ANTHROPIC_AUTH_TOKEN, every model role = DeepSeek V4.1 Flash, and no
    // ANTHROPIC_API_KEY.
    const result = fixture.run(["claude", "opencode-go"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    check(argv.length === 0, `argv ${JSON.stringify(argv)}`);
    check(
      env["ANTHROPIC_BASE_URL"] === "https://opencode.ai/inference/go/anthropic",
      JSON.stringify(env),
    );
    check(env["ANTHROPIC_MODEL"] === "deepseek-v4.1-flash", JSON.stringify(env));
    check(env["ANTHROPIC_SMALL_FAST_MODEL"] === "deepseek-v4.1-flash", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_OPUS_MODEL"] === "deepseek-v4.1-flash", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_SONNET_MODEL"] === "deepseek-v4.1-flash", JSON.stringify(env));
    check(env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] === "deepseek-v4.1-flash", JSON.stringify(env));
    check(
      env["ANTHROPIC_AUTH_TOKEN"] === "secret-opencode",
      `auth token was '${env["ANTHROPIC_AUTH_TOKEN"]}'`,
    );
    check(!("ANTHROPIC_API_KEY" in env), "ANTHROPIC_API_KEY must be cleared");
    // GO key arrives under the harness env name; nothing else leaks.
    check(env["OPENCODE_API_KEY"] === "secret-opencode", env["OPENCODE_API_KEY"]);
    for (const leak of [
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
      "MIMO_API_KEY",
      "MINIMAX_M_PLAN_KEY",
      "MINIMAX_TOKEN_PLAN_KEY",
      "INFISICAL_TOKEN",
      "FAKE_INFISICAL_INJECTED",
    ]) {
      check(!(leak in env), `secret leaked to child: ${leak}`);
    }
    check(existsSync(fixture.marker), "with-secrets wrapper was not used");

    // omp.opencode-go: native provider id, MiMo V2.6 Flash, same Go key, and
    // every model role + the cycling set pinned to the one Go selector.
    const omp = fixture.run(["omp", "opencode-go", "--", "-p", "hi"], { config: REAL_CONFIG });
    check(omp.exitCode === 0, omp.stderr.toString());
    const [ompArgv, ompEnv] = fixture.child();
    expect(ompArgv, JSON.stringify(ompArgv)).toEqual([
      "--provider",
      "opencode-go",
      "--model",
      "mimo-v2.6-flash",
      "--smol",
      "opencode-go/mimo-v2.6-flash",
      "--slow",
      "opencode-go/mimo-v2.6-flash",
      "--plan",
      "opencode-go/mimo-v2.6-flash",
      ...OMP_WORKER_ARGV,
      "-p",
      "hi",
    ]);
    check(ompEnv["OPENCODE_API_KEY"] === "secret-opencode", ompEnv["OPENCODE_API_KEY"]);
    check(!("OPENROUTER_API_KEY" in ompEnv), "leak");
    check(!("DEEPSEEK_API_KEY" in ompEnv), "leak");

    // explicit --model is still limited to the declared Go catalog, and the
    // pinned role selectors follow it.
    const explicit = fixture.run(["claude", "opencode-go", "--model", "mimo-v2.6-flash"], {
      config: REAL_CONFIG,
    });
    check(explicit.exitCode === 0, explicit.stderr.toString());
    const [, explicitEnv] = fixture.child();
    check(explicitEnv["ANTHROPIC_MODEL"] === "mimo-v2.6-flash", JSON.stringify(explicitEnv));

    const ompExplicit = fixture.run([
      "omp",
      "opencode-go",
      "--model",
      "deepseek-v4.1-flash",
      "--",
      "-p",
      "hi",
    ], { config: REAL_CONFIG });
    check(ompExplicit.exitCode === 0, ompExplicit.stderr.toString());
    const [ompExplicitArgv] = fixture.child();
    check(
      ompExplicitArgv.includes("--plan") &&
        ompExplicitArgv.includes("opencode-go/deepseek-v4.1-flash") &&
        !ompExplicitArgv.includes("--models"),
      JSON.stringify(ompExplicitArgv),
    );

    for (const [args, needle] of [
      [["claude", "opencode-go", "--model", "gpt-6.1-sol"], "unknown model"],
      [["omp", "opencode-go", "--model", "deepseek-v4-pro"], "unknown model"],
    ] as Array<[string[], string]>) {
      const rejected = fixture.run(args, { config: REAL_CONFIG });
      check(rejected.exitCode === 2, `${args.join(" ")} -> ${rejected.exitCode}`);
      check(rejected.stderr.toString().includes(needle), rejected.stderr.toString());
      check(!existsSync(fixture.marker), "credentials must not be fetched for a rejected model");
    }

    // shortcuts resolve to the same routes
    const shortcut = fixture.runShortcut("omp-opencode-go", ["--agent-model", "deepseek-v4.1-flash"], {
      config: REAL_CONFIG,
    });
    check(shortcut.exitCode === 0, shortcut.stderr.toString());
    const [shortcutArgv] = fixture.child();
    check(
      shortcutArgv.includes("deepseek-v4.1-flash") &&
        shortcutArgv.includes("opencode-go"),
      JSON.stringify(shortcutArgv),
    );
  }),
);

test(
  "test_opencode_go_uses_infisical_key",
  withFixture((fixture) => {
    // require_infisical: an ambient key is never trusted. The wrapper always
    // runs, the ambient credential is stripped from its environment, and the
    // Infisical value reaches the child.
    const injected = fixture.run(["claude", "opencode-go"], {
      env: { OPENCODE_API_KEY: "stale-shell-key" },
      config: REAL_CONFIG,
    });
    check(injected.exitCode === 0, injected.stderr.toString());
    const [, env] = fixture.child();
    check(env["OPENCODE_API_KEY"] === "secret-opencode", env["OPENCODE_API_KEY"]);
    check(env["ANTHROPIC_AUTH_TOKEN"] === "secret-opencode", env["ANTHROPIC_AUTH_TOKEN"]);
    check(existsSync(fixture.marker), "require_infisical must not short-circuit on an ambient value");
    const wrapperEnv = readFileSync(fixture.wrapper_env, "utf8");
    check(
      !wrapperEnv.split("\n").some((line) => line.startsWith("OPENCODE_API_KEY=")),
      "the ambient credential must be stripped before the with-secrets stage",
    );

    // Zen still uses the fast path (same key name, no require_infisical).
    const zen = fixture.run(["opencode", "zen"], {
      env: { OPENCODE_API_KEY: "zen-shell-key" },
      config: REAL_CONFIG,
    });
    check(zen.exitCode === 0, zen.stderr.toString());
    const [, zenEnv] = fixture.child();
    check(zenEnv["OPENCODE_API_KEY"] === "zen-shell-key", zenEnv["OPENCODE_API_KEY"]);
    check(!existsSync(fixture.marker), "zen keeps the ambient fast path");
  }),
);

test(
  "test_opencode_go_missing_key_fails_closed",
  withFixture((fixture) => {
    // Infisical has no OPENCODE_API_KEY: even with an ambient value, the route
    // must stop instead of silently using the shell credential.
    fixture.writeWrapper(FAKE_WITH_SECRETS_NO_OPENCODE);
    const result = fixture.run(["claude", "opencode-go"], {
      env: { OPENCODE_API_KEY: "stale-shell-key" },
      config: REAL_CONFIG,
    });
    check(result.exitCode === 1, `expected exit 1, got ${result.exitCode}`);
    check(result.stderr.toString().includes("OPENCODE_API_KEY"), result.stderr.toString());
    check(!existsSync(fixture.out), "harness must not start without the Infisical credential");

    const omp = fixture.run(["omp", "opencode-go"], {
      env: { OPENCODE_API_KEY: "stale-shell-key" },
      config: REAL_CONFIG,
    });
    check(omp.exitCode === 1, `expected exit 1, got ${omp.exitCode}`);
    check(omp.stderr.toString().includes("OPENCODE_API_KEY"), omp.stderr.toString());
    check(!existsSync(fixture.out), "omp must not start without the Infisical credential");
  }),
);

test(
  "test_omp_opencode_go_stored_credential_guard",
  withFixture((fixture) => {
    // OMP's credential ladder puts a stored OAuth/login/API key ahead of the
    // injected env, so an active row for the route provider fails closed.
    const dbPath = fixture.writeAgentDb([{ provider: "opencode-go" }]);
    const blocked = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(blocked.exitCode === 1, `expected exit 1, got ${blocked.exitCode}`);
    check(blocked.stderr.toString().includes(dbPath), blocked.stderr.toString());
    check(blocked.stderr.toString().includes("opencode-go"), blocked.stderr.toString());
    check(!existsSync(fixture.out), "omp must not start with a stored credential");
    check(!existsSync(fixture.marker), "credentials must not be fetched first");

    // A stored credential for an unrelated provider is fine (nothing deleted).
    unlinkSync(dbPath);
    fixture.writeAgentDb([{ provider: "openrouter" }]);
    const ok = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(ok.exitCode === 0, ok.stderr.toString());
    const [, env] = fixture.child();
    check(env["OPENCODE_API_KEY"] === "secret-opencode", env["OPENCODE_API_KEY"]);

    // Disabled rows are ignored by OMP, and the guard query matches that
    // (`disabled_cause IS NULL`): they must not block the route.
    unlinkSync(dbPath);
    fixture.writeAgentDb([{ provider: "opencode-go", disabled_cause: "expired" }]);
    const disabled = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(disabled.exitCode === 0, disabled.stderr.toString());
  }),
);

test(
  "test_omp_opencode_go_models_guard",
  withFixture((fixture) => {
    // models.yml can override a provider's baseUrl/apiKey ahead of env.
    const ymlPath = fixture.writeOmpConfig(
      "models.yml",
      "providers:\n  opencode-go:\n    baseUrl: https://example.invalid/v1\n    apiKey: other\n",
    );
    const blocked = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(blocked.exitCode === 1, `expected exit 1, got ${blocked.exitCode}`);
    check(blocked.stderr.toString().includes(ymlPath), blocked.stderr.toString());
    check(blocked.stderr.toString().includes("opencode-go"), blocked.stderr.toString());
    check(!existsSync(fixture.out), "omp must not start with a models.yml override");
    check(!existsSync(fixture.marker), "credentials must not be fetched first");

    // Another provider's entry is unrelated and stays allowed.
    unlinkSync(ymlPath);
    fixture.writeOmpConfig(
      "models.yml",
      "providers:\n  openrouter:\n    apiKey: other\n",
    );
    const ok = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(ok.exitCode === 0, ok.stderr.toString());

    // The .yaml spelling is checked too.
    unlinkSync(ymlPath);
    const yamlPath = fixture.writeOmpConfig(
      "models.yaml",
      "providers:\n  opencode-go:\n    apiKey: other\n",
    );
    const yamlBlocked = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(yamlBlocked.exitCode === 1, `expected exit 1, got ${yamlBlocked.exitCode}`);
    check(yamlBlocked.stderr.toString().includes(yamlPath), yamlBlocked.stderr.toString());
    unlinkSync(yamlPath);

    // The legacy models.json is migrated by OMP only when no YAML exists,
    // but it is checked whenever present.
    const jsonPath = fixture.writeOmpConfig("models.json", {
      providers: {
        "opencode-go": {
          models: [{ id: "mimo-v2.6-flash", baseUrl: "https://example.invalid/v1" }],
        },
      },
    });
    const legacyBlocked = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(legacyBlocked.exitCode === 1, `expected exit 1, got ${legacyBlocked.exitCode}`);
    check(legacyBlocked.stderr.toString().includes(jsonPath), legacyBlocked.stderr.toString());
    check(!existsSync(fixture.out), "omp must not start with a models.json override");

    // Unrelated legacy provider entry: allowed.
    unlinkSync(jsonPath);
    fixture.writeOmpConfig("models.json", { providers: { openrouter: { models: [] } } });
    const legacyOk = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(legacyOk.exitCode === 0, legacyOk.stderr.toString());
  }),
);

test(
  "test_omp_opencode_go_profile_guard",
  withFixture((fixture) => {
    // A profile/relocated config dir is rejected explicitly (never silently
    // ignored): the guard must inspect the directory OMP actually reads.
    const alt = join(fixture.tmp, "alt-agent");
    const cases: Array<[Record<string, string>, string]> = [
      [{ OMP_PROFILE: "work" }, "OMP_PROFILE"],
      [{ OMP_PROFILE: "" }, "OMP_PROFILE"],
      [{ PI_PROFILE: "work" }, "PI_PROFILE"],
      [{ PI_CONFIG_DIR: "cfg" }, "PI_CONFIG_DIR"],
      [{ OMP_CONFIG_DIR: "cfg" }, "OMP_CONFIG_DIR"],
      [{ PI_CODING_AGENT_DIR: alt }, "PI_CODING_AGENT_DIR"],
      [{ OMP_CODING_AGENT_DIR: alt }, "OMP_CODING_AGENT_DIR"],
    ];
    for (const [env, key] of cases) {
      const result = fixture.run(["omp", "opencode-go"], { env, config: REAL_CONFIG });
      check(
        result.exitCode === 1,
        `${key}=${JSON.stringify(env[key])} -> ${result.exitCode}: ${result.stderr.toString()}`,
      );
      check(result.stderr.toString().includes(key), result.stderr.toString());
      check(
        result.stderr.toString().includes("default OMP profile/agent directory"),
        result.stderr.toString(),
      );
      check(!existsSync(fixture.out), `${key} must not start the harness`);
      check(!existsSync(fixture.marker), `${key} must be rejected before the credential fetch`);
    }
  }),
);

test(
  "test_omp_opencode_go_dotenv_guard",
  withFixture((fixture) => {
    // Project cwd `.env` (OMP's first dotenv layer).
    const projectEnv = join(fixture.tmp, ".env");
    writeFileSync(projectEnv, "# comment\n\nexport OMP_PROFILE=work\n");
    const project = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(project.exitCode === 1, `expected exit 1, got ${project.exitCode}`);
    check(project.stderr.toString().includes("OMP_PROFILE"), project.stderr.toString());
    check(!existsSync(fixture.out), "project .env profile must not start the harness");
    unlinkSync(projectEnv);

    // Config-root `.env` (`$HOME/.omp/.env`), including the PI_* spelling.
    const rootEnv = join(fixture.tmp, ".omp", ".env");
    mkdirSync(dirname(rootEnv), { recursive: true });
    writeFileSync(rootEnv, "PI_PROFILE=work\n");
    const root = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(root.exitCode === 1, `expected exit 1, got ${root.exitCode}`);
    check(root.stderr.toString().includes("PI_PROFILE"), root.stderr.toString());
    check(root.stderr.toString().includes(rootEnv), root.stderr.toString());
    unlinkSync(rootEnv);

    // Active agent `.env` (`$HOME/.omp/agent/.env`).
    const agentEnv = fixture.writeOmpConfig(".env", "PI_CODING_AGENT_DIR=/tmp/elsewhere\n");
    const agent = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(agent.exitCode === 1, `expected exit 1, got ${agent.exitCode}`);
    check(agent.stderr.toString().includes("PI_CODING_AGENT_DIR"), agent.stderr.toString());
    check(agent.stderr.toString().includes(agentEnv), agent.stderr.toString());
    unlinkSync(agentEnv);

    // A UTF-8 BOM must not hide the assignment (editors add one silently).
    const bomEnv = fixture.writeOmpConfig(".env", "﻿OMP_PROFILE=work\n");
    const bom = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(bom.exitCode === 1, `expected exit 1, got ${bom.exitCode}`);
    check(bom.stderr.toString().includes("OMP_PROFILE"), bom.stderr.toString());
    unlinkSync(bomEnv);

    // Home `.env` (`$HOME/.env`).
    const homeEnv = join(fixture.tmp, ".env");
    writeFileSync(homeEnv, "OMP_CONFIG_DIR=cfg\n");
    const home = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(home.exitCode === 1, `expected exit 1, got ${home.exitCode}`);
    check(home.stderr.toString().includes("OMP_CONFIG_DIR"), home.stderr.toString());
    unlinkSync(homeEnv);

    // A dotenv XDG_DATA_HOME relocates `agent.db` for OMP, but the
    // launcher's ompAuthDbPaths() follows only the ambient process.env
    // value, so the stored-credential check would inspect the wrong store.
    // The assignment must be rejected (F5).
    writeFileSync(homeEnv, "XDG_DATA_HOME=/tmp/elsewhere-data\n");
    const xdg = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(xdg.exitCode === 1, `expected exit 1, got ${xdg.exitCode}`);
    check(xdg.stderr.toString().includes("XDG_DATA_HOME"), xdg.stderr.toString());
    check(xdg.stderr.toString().includes(homeEnv), xdg.stderr.toString());
    check(!existsSync(fixture.out), "dotenv XDG_DATA_HOME must not start the harness");
    check(!existsSync(fixture.marker), "credentials must not be fetched first");
    unlinkSync(homeEnv);

    // An ambient XDG_DATA_HOME is already followed by ompAuthDbPaths and
    // stays allowed (the relocated store does not exist in the fixture).
    const ambient = fixture.run(["omp", "opencode-go"], {
      env: { XDG_DATA_HOME: join(fixture.tmp, "xdg-data") },
      config: REAL_CONFIG,
    });
    check(ambient.exitCode === 0, ambient.stderr.toString());
  }),
);

test(
  "test_omp_opencode_go_broker_guard",
  withFixture((fixture) => {
    // An auth broker replaces the local credential store.
    const ambient = fixture.run(["omp", "opencode-go"], {
      env: { OMP_AUTH_BROKER_URL: "https://broker.invalid" },
      config: REAL_CONFIG,
    });
    check(ambient.exitCode === 1, `expected exit 1, got ${ambient.exitCode}`);
    check(ambient.stderr.toString().includes("OMP_AUTH_BROKER_URL"), ambient.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");

    const configPath = fixture.writeOmpConfig(
      "config.yml",
      "auth:\n  broker:\n    url: https://broker.invalid\n",
    );
    const nested = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(nested.exitCode === 1, `expected exit 1, got ${nested.exitCode}`);
    check(nested.stderr.toString().includes(configPath), nested.stderr.toString());
    check(nested.stderr.toString().includes("auth.broker.url"), nested.stderr.toString());
    check(!existsSync(fixture.out), "omp must not start with a broker");

    // Flat literal key form.
    writeFileSync(configPath, "auth.broker.url: https://broker.invalid\n");
    const flat = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(flat.exitCode === 1, `expected exit 1, got ${flat.exitCode}`);
    check(flat.stderr.toString().includes("auth.broker.url"), flat.stderr.toString());

    // An empty URL is not a configured broker.
    writeFileSync(configPath, 'auth:\n  broker:\n    url: ""\n');
    const empty = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(empty.exitCode === 0, empty.stderr.toString());
    unlinkSync(configPath);
  }),
);

test(
  "test_omp_opencode_go_implicit_switch_guard",
  withFixture((fixture) => {
    // A fallback chain can move the session to another provider/model on
    // 429/quota outages, defeating the pinned Go selector.
    const configPath = fixture.writeOmpConfig(
      "config.yml",
      "retry:\n  modelFallback: true\n  fallbackChains:\n    default:\n      - openrouter/z-ai/glm-5.3\n",
    );
    const globalChain = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(globalChain.exitCode === 1, `expected exit 1, got ${globalChain.exitCode}`);
    check(globalChain.stderr.toString().includes(configPath), globalChain.stderr.toString());
    check(globalChain.stderr.toString().includes("retry.fallbackChains"), globalChain.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");

    // Project config is checked too.
    unlinkSync(configPath);
    const projectDir = join(fixture.tmp, ".omp");
    const projectPath = join(projectDir, "config.yml");
    writeFileSync(projectPath, 'retry:\n  fallbackChains:\n    "provider/*":\n      - openrouter/z-ai/glm-5.3\n');
    const projectChain = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(projectChain.exitCode === 1, `expected exit 1, got ${projectChain.exitCode}`);
    check(projectChain.stderr.toString().includes(projectPath), projectChain.stderr.toString());
    check(projectChain.stderr.toString().includes("retry.fallbackChains"), projectChain.stderr.toString());

    // Project legacy settings.json: the Advisor can run a second model.
    unlinkSync(projectPath);
    const settingsPath = join(projectDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ advisor: { enabled: true } }));
    const advisor = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(advisor.exitCode === 1, `expected exit 1, got ${advisor.exitCode}`);
    check(advisor.stderr.toString().includes(settingsPath), advisor.stderr.toString());
    check(advisor.stderr.toString().includes("advisor.enabled"), advisor.stderr.toString());

    // Legacy global settings.json is migrated by OMP at startup, after this
    // guard runs: a fallback chain there must be rejected up front.
    unlinkSync(settingsPath);
    const legacySettings = fixture.writeOmpConfig(
      "settings.json",
      JSON.stringify({
        retry: { modelFallback: true, fallbackChains: { default: ["openrouter/z-ai/glm-5.3"] } },
      }),
    );
    const legacyChain = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(legacyChain.exitCode === 1, `expected exit 1, got ${legacyChain.exitCode}`);
    check(legacyChain.stderr.toString().includes(legacySettings), legacyChain.stderr.toString());
    check(
      legacyChain.stderr.toString().includes("retry.fallbackChains"),
      legacyChain.stderr.toString(),
    );
    unlinkSync(legacySettings);

    // Context promotion can switch to a model's promotion target.
    writeFileSync(configPath, "contextPromotion:\n  enabled: true\n");
    const promotion = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(promotion.exitCode === 1, `expected exit 1, got ${promotion.exitCode}`);
    check(promotion.stderr.toString().includes("contextPromotion.enabled"), promotion.stderr.toString());

    // Absent/default retry, empty chains, explicit false switches, and
    // modelRoles alone are allowed: modelFallback defaults to true and is
    // harmless while no chain exists.
    writeFileSync(
      configPath,
      "retry:\n  modelFallback: true\n  fallbackChains: {}\n" +
        "advisor:\n  enabled: false\ncontextPromotion:\n  enabled: false\n" +
        "modelRoles:\n  smol: opencode-go/mimo-v2.6-flash\n",
    );
    const allowed = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(allowed.exitCode === 0, allowed.stderr.toString());
    unlinkSync(configPath);

    // No config at all is the default and stays allowed (other tests).
    const plain = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(plain.exitCode === 0, plain.stderr.toString());
  }),
);

test(
  "test_omp_openrouter_free_implicit_switch_guard",
  withFixture((fixture) => {
    // The implicit-switch check is a model-pinning boundary for EVERY omp
    // route, not only require_infisical: agents.toml forbids implicit model
    // fallback on all routes, so a user fallback chain on the free route
    // must fail closed before it can move a rate-limited free request to a
    // paid model.
    const configPath = fixture.writeOmpConfig(
      "config.yml",
      "retry:\n  modelFallback: true\n  fallbackChains:\n    default:\n      - openrouter/anthropic/claude-x\n",
    );
    const blocked = fixture.run(["omp", "openrouter-free"], { config: REAL_CONFIG });
    check(
      blocked.exitCode === 1,
      `expected exit 1, got ${blocked.exitCode}: ${blocked.stderr.toString()}`,
    );
    check(blocked.stderr.toString().includes(configPath), blocked.stderr.toString());
    check(blocked.stderr.toString().includes("retry.fallbackChains"), blocked.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");
    check(!existsSync(fixture.out), "free route must not start with a fallback chain");

    // The advisor override is rejected on the free route too.
    writeFileSync(configPath, "advisor:\n  enabled: true\n");
    const advisor = fixture.run(["omp", "openrouter-free"], { config: REAL_CONFIG });
    check(
      advisor.exitCode === 1,
      `expected exit 1, got ${advisor.exitCode}: ${advisor.stderr.toString()}`,
    );
    check(advisor.stderr.toString().includes("advisor.enabled"), advisor.stderr.toString());

    // Without a chain the free route still passes.
    unlinkSync(configPath);
    const ok = fixture.run(["omp", "openrouter-free"], { config: REAL_CONFIG });
    check(ok.exitCode === 0, ok.stderr.toString());
  }),
);

test(
  "test_omp_opencode_go_corrupt_db_guard",
  withFixture((fixture) => {
    const dbPath = join(fixture.tmp, ".omp", "agent", "agent.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, Buffer.from("this is not a sqlite database"));
    const result = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(result.exitCode === 1, `expected exit 1, got ${result.exitCode}`);
    check(
      result.stderr.toString().includes("cannot verify the OMP credential store"),
      result.stderr.toString(),
    );
    check(result.stderr.toString().includes(dbPath), result.stderr.toString());
    check(!existsSync(fixture.out), "omp must not start with an unverifiable store");
  }),
);

test(
  "test_omp_opencode_go_rechecks_before_spawn",
  withFixture((fixture) => {
    // Simulate a concurrent writer: agent.db is absent for the pre-fetch
    // check, then the with-secrets wrapper creates it before stage 2. The
    // wrapper-internal re-check must stop OMP before spawn.
    const staging = join(fixture.tmp, "race-agent.db");
    fixture.writeAgentDb([{ provider: "opencode-go" }], staging);
    fixture.writeWrapper(FAKE_WITH_SECRETS_MUTATES_OMP_DB);
    const dbRace = fixture.run(["omp", "opencode-go"], {
      env: { AGENT_TEST_RACE_DB: staging },
      config: REAL_CONFIG,
    });
    check(dbRace.exitCode === 1, `expected exit 1, got ${dbRace.exitCode}`);
    check(dbRace.stderr.toString().includes("opencode-go"), dbRace.stderr.toString());
    check(
      !existsSync(fixture.out),
      "omp must not start when agent.db appears after the first check",
    );

    // Same race for a models.yml provider override.
    unlinkSync(join(fixture.tmp, ".omp", "agent", "agent.db"));
    fixture.writeWrapper(FAKE_WITH_SECRETS_MUTATES_OMP_MODELS);
    const modelsRace = fixture.run(["omp", "opencode-go"], { config: REAL_CONFIG });
    check(modelsRace.exitCode === 1, `expected exit 1, got ${modelsRace.exitCode}`);
    check(modelsRace.stderr.toString().includes("models.yml"), modelsRace.stderr.toString());
    check(
      !existsSync(fixture.out),
      "omp must not start when models.yml appears after the first check",
    );
  }),
);

test(
  "test_omp_opencode_go_no_secret_in_argv_or_logs",
  withFixture((fixture) => {
    const result = fixture.run(["omp", "opencode-go", "--", "-p", "hi"], {
      config: REAL_CONFIG,
    });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    check(!argv.includes("--api-key"), `argv ${JSON.stringify(argv)}`);
    check(
      !argv.some((arg) => arg.includes("secret-opencode")),
      `secret leaked into argv: ${JSON.stringify(argv)}`,
    );
    check(env["OPENCODE_API_KEY"] === "secret-opencode", env["OPENCODE_API_KEY"]);
    for (const leaked of [
      "ANTHROPIC_AUTH_TOKEN",
      "MINIMAX_M_PLAN_KEY",
      "MINIMAX_TOKEN_PLAN_KEY",
      "MIMO_API_KEY",
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
      "INFISICAL_TOKEN",
      "FAKE_INFISICAL_INJECTED",
    ]) {
      check(!(leaked in env), `secret leaked to child: ${leaked}`);
    }
    // The only dump line carrying the injected value is the route's own env.
    const secretLines = readFileSync(fixture.out, "utf8")
      .split("\n")
      .filter((line) => line.includes("secret-opencode"));
    expect(secretLines, JSON.stringify(secretLines)).toEqual(["OPENCODE_API_KEY=secret-opencode"]);
    check(!result.stderr.toString().includes("secret-opencode"), result.stderr.toString());
  }),
);

test(
  "test_omp_opencode_go_argv_hardening",
  withFixture((fixture) => {
    // Every OMP route carries the Worker permission boundary: the former Pi
    // slot's tool set, no OMP extras, and the destructive guard loaded as a
    // trusted extension. --models is only Ctrl+P cycling, not an allowlist,
    // so it must be gone; approval/credential flags never appear.
    for (const provider of ["opencode-go", "openrouter-free"]) {
      const result = fixture.run(["omp", provider], { config: REAL_CONFIG });
      check(result.exitCode === 0, `${provider}: ${result.stderr.toString()}`);
      const [argv] = fixture.child();
      check(
        argv[argv.indexOf("--tools") + 1] === "read,bash,edit,write",
        `${provider}: --tools missing: ${JSON.stringify(argv)}`,
      );
      for (const flag of ["--no-lsp", "--no-pty", "--no-title"]) {
        check(argv.includes(flag), `${provider}: ${flag} missing: ${JSON.stringify(argv)}`);
      }
      const trusted = argv.indexOf("--trusted-extension");
      check(trusted !== -1, `${provider}: --trusted-extension missing: ${JSON.stringify(argv)}`);
      check(
        argv[trusted + 1] === OMP_GUARD && argv[trusted + 1].startsWith("/"),
        `${provider}: guard path is not the absolute launcher-adjacent file: ` +
          JSON.stringify(argv[trusted + 1]),
      );
      for (const forbidden of ["--models", "--auto-approve", "--approval-mode", "--api-key"]) {
        check(
          !argv.includes(forbidden),
          `${provider}: '${forbidden}' must not be passed: ${JSON.stringify(argv)}`,
        );
      }
      const [, env] = fixture.child();
      check(
        env["OMP_SKIP_SETUP"] === "1",
        `${provider}: first-run setup must be skipped: ${JSON.stringify(env)}`,
      );
    }
  }),
);

test(
  "test_omp_herdr_extension_allowlist",
  withFixture((fixture) => {
    // --trusted-extension disables ambient discovery, so inside Herdr the
    // Herdr extension must be passed explicitly (and only then).
    const herdr = join(fixture.tmp, ".omp", "agent", "extensions", "herdr-omp-agent-state.ts");
    mkdirSync(dirname(herdr), { recursive: true });
    writeFileSync(herdr, "// fake herdr extension\n");

    const inside = fixture.run(["omp", "deepseek"], {
      env: { HERDR_ENV: "1" },
      config: REAL_CONFIG,
    });
    check(inside.exitCode === 0, inside.stderr.toString());
    const [insideArgv] = fixture.child();
    const trusted = insideArgv
      .map((arg, index) => (arg === "--trusted-extension" ? insideArgv[index + 1] : null))
      .filter((value): value is string => value !== null);
    expect(trusted, JSON.stringify(insideArgv)).toEqual([
      OMP_GUARD,
      realpathSync(herdr),
    ]);

    // OMP treats its pane/tab/workspace variables as inside Herdr too, so a
    // pane that exports only those must still load the integration.
    const insidePane = fixture.run(["omp", "deepseek"], {
      env: { HERDR_PANE_ID: "w1:p1" },
      config: REAL_CONFIG,
    });
    check(insidePane.exitCode === 0, insidePane.stderr.toString());
    const [paneArgv] = fixture.child();
    check(
      paneArgv.includes(realpathSync(herdr)),
      `HERDR_PANE_ID must load the Herdr extension: ${JSON.stringify(paneArgv)}`,
    );

    const outside = fixture.run(["omp", "deepseek"], { config: REAL_CONFIG });
    check(outside.exitCode === 0, outside.stderr.toString());
    const [outsideArgv] = fixture.child();
    check(
      !outsideArgv.includes(realpathSync(herdr)) &&
        outsideArgv.filter((arg) => arg === "--trusted-extension").length === 1,
      `outside Herdr only the guard may be trusted: ${JSON.stringify(outsideArgv)}`,
    );

    // Fail closed with an actionable message when the integration is absent.
    unlinkSync(herdr);
    const missing = fixture.run(["omp", "deepseek"], {
      env: { HERDR_ENV: "1" },
      config: REAL_CONFIG,
    });
    check(missing.exitCode === 1, `expected exit 1, got ${missing.exitCode}`);
    check(
      missing.stderr.toString().includes("herdr integration install omp"),
      missing.stderr.toString(),
    );
    check(!existsSync(fixture.out), "omp must not start without the Herdr extension");
  }),
);

test(
  "test_omp_destructive_guard_rules",
  () => {
    const blocked = [
      "rm -rf x",
      "rm -fr x",
      "rm -rf /tmp/x",
      "rm -fr /tmp/x",
      "rm -r -f x",
      "sudo rm -rf x",
      "echo hi && rm -rf x",
      "git push --force",
      "git push -f",
      "git push --force-with-lease",
      "git push origin +main:main",
      "git reset --hard",
      "git clean -fd",
      "git clean -f",
      // `--exclude=vendor` contains an `n`: substring matching counted it as
      // dry-run and let the forced clean through (F7 bypass).
      "git clean -fd --exclude=vendor",
      "git checkout -- .",
      "git checkout -f",
      "git restore file",
      "git branch -D topic",
      "git tag -d v1",
      "git stash drop",
      "git stash clear",
    ];
    for (const command of blocked) {
      check(checkCommand(command) !== undefined, `must block: ${command}`);
    }
    const allowed = [
      "rm file",
      "rm -r dir",
      "rm -f file",
      // Substring matching lowercased `--preserve-root` as recursive+force
      // and blocked this safe command (F6 false block).
      "rm --preserve-root -f file",
      "ls",
      "git clean -n",
      "git clean -fdn",
      "git clean --dry-run -f",
      "git restore --staged file",
      "git status",
      "git push origin main",
    ];
    for (const command of allowed) {
      check(checkCommand(command) === undefined, `must allow: ${command}`);
    }
  },
);

test(
  "test_pi_harness_migration_hint",
  withFixture((fixture) => {
    const result = fixture.run(["pi", "opencode-go"], { config: REAL_CONFIG });
    check(result.exitCode !== 0, `agent pi must fail, got ${result.exitCode}`);
    check(result.stderr.toString().includes("moved to OMP"), result.stderr.toString());
    check(result.stderr.toString().includes("agent omp"), result.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");

    const native = fixture.run(["pi"], { config: REAL_CONFIG });
    check(native.exitCode !== 0, `agent pi (native) must fail, got ${native.exitCode}`);
    check(native.stderr.toString().includes("moved to OMP"), native.stderr.toString());
  }),
);

test(
  "test_pi_shortcut_migration_hint",
  withFixture((fixture) => {
    // Stale pi-* links still point at this launcher after the slot moved.
    const result = fixture.runShortcut("pi-opencode-go", [], { config: REAL_CONFIG });
    check(result.exitCode !== 0, `pi-opencode-go must fail, got ${result.exitCode}`);
    check(result.stderr.toString().includes("retired Pi Worker shortcut"), result.stderr.toString());
    check(result.stderr.toString().includes("omp-opencode-go"), result.stderr.toString());
    check(result.stderr.toString().includes("pi-opencode-go"), result.stderr.toString());
    check(result.stderr.toString().includes("rm "), result.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");
  }),
);

test(
  "test_require_model_fail_closed",
  withFixture((fixture) => {
    const config = join(fixture.tmp, "require.toml");
    writeFileSync(config, REQUIRE_CONFIG);
    const result = fixture.run(["h1", "p1"], { config });
    check(result.exitCode === 2, `expected 2, got ${result.exitCode}: ${result.stderr.toString()}`);
    check(result.stderr.toString().includes("requires an explicit model"), result.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");

    const result2 = fixture.run(["h1", "p1", "--model", "m2"], { config });
    check(result2.exitCode === 0, result2.stderr.toString());
    const [, env] = fixture.child();
    check(env["ANTHROPIC_MODEL"] === "m2", JSON.stringify(env));
  }),
);

test(
  "test_shortcut_equivalence",
  withFixture((fixture) => {
    // `opencode-zen` must start exactly what `agent opencode zen` starts.
    const result = fixture.run(["opencode", "zen"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [refArgv, refEnv] = fixture.child();

    const result2 = fixture.runShortcut("opencode-zen", [], { config: REAL_CONFIG });
    check(result2.exitCode === 0, result2.stderr.toString());
    const [argv, env] = fixture.child();
    expect(argv, `argv ${JSON.stringify(argv)} != ${JSON.stringify(refArgv)}`).toEqual(refArgv);
    expect(env, "shortcut child env must equal the agent-form env").toEqual(refEnv);
    check(
      (env["OPENCODE_CONFIG_CONTENT"] ?? "").endsWith('"opencode/mimo-v2.6-flash-free"}'),
      `model selection differs: ${env["OPENCODE_CONFIG_CONTENT"]}`,
    );
  }),
);

test(
  "test_shortcut_args_and_agent_model",
  withFixture((fixture) => {
    const result = fixture.runShortcut("claude-deepseek", ["-p", "hi"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    let [argv, env] = fixture.child();
    expect(argv, `argv ${JSON.stringify(argv)}`).toEqual(["-p", "hi"]);
    check(env["ANTHROPIC_MODEL"] === "deepseek-flash", JSON.stringify(env));

    for (const modelArgs of [
      ["--agent-model", "deepseek-v4-pro", "-p", "hi"],
      ["--agent-model=deepseek-v4-pro", "-p", "hi"],
    ]) {
      const result2 = fixture.runShortcut("opencode-deepseek", modelArgs, {
        config: REAL_CONFIG,
      });
      check(result2.exitCode === 0, result2.stderr.toString());
      [argv, env] = fixture.child();
      expect(argv, `launcher flag leaked into argv: ${JSON.stringify(argv)}`).toEqual([
        "--standalone",
        "-p",
        "hi",
      ]);
      check(
        (env["OPENCODE_CONFIG_CONTENT"] ?? "").includes("deepseek/deepseek-v4-pro"),
        env["OPENCODE_CONFIG_CONTENT"],
      );
    }

    const result3 = fixture.runShortcut("claude-deepseek", ["--agent-model"], {
      config: REAL_CONFIG,
    });
    check(result3.exitCode === 2, "missing value must fail");
    check(result3.stderr.toString().includes("requires a value"), result3.stderr.toString());

    // a leading '--' is tolerated (habit from the agent form)
    const result4 = fixture.runShortcut("claude-deepseek", ["--", "-p", "hi"], {
      config: REAL_CONFIG,
    });
    check(result4.exitCode === 0, result4.stderr.toString());
    const [argv4] = fixture.child();
    expect(argv4, `argv ${JSON.stringify(argv4)}`).toEqual(["-p", "hi"]);
  }),
);

test(
  "test_shortcut_forbidden_args",
  withFixture((fixture) => {
    const cases = [
      ["--model", "deepseek-v4-pro"],
      ["-m", "deepseek-v4-pro"],
      ["--provider", "openrouter"],
      ["--api-key=sk-x"],
      ["--fallback-model=x"],
    ];
    for (const args of cases) {
      const result = fixture.runShortcut("opencode-zen", args, { config: REAL_CONFIG });
      check(
        result.exitCode === 2,
        `${args.join(" ")} -> ${result.exitCode}: ${result.stderr.toString()}`,
      );
      check(
        result.stderr.toString().includes("not allowed"),
        `${args.join(" ")}: ${result.stderr.toString()}`,
      );
    }
    check(!existsSync(fixture.marker), "credentials must not be fetched");

    // passthrough harnesses keep rejecting launcher-owned model selection
    const result = fixture.runShortcut("dsh-deepseek", ["--agent-model", "x"], {
      config: REAL_CONFIG,
    });
    check(result.exitCode === 2, result.stderr.toString());
    check(result.stderr.toString().includes("does not accept"), result.stderr.toString());
  }),
);

test(
  "test_shortcut_unknown_name",
  withFixture((fixture) => {
    const result = fixture.runShortcut("claude-zen", [], { config: REAL_CONFIG });
    check(result.exitCode === 2, `${result.exitCode}: ${result.stderr.toString()}`);
    check(result.stderr.toString().includes("unknown shortcut"), result.stderr.toString());
    check(result.stderr.toString().includes("opencode-zen"), "known shortcuts must be listed");
    check(!existsSync(fixture.marker), "credentials must not be fetched");

    const result2 = fixture.runShortcut("totally-bogus", [], { config: REAL_CONFIG });
    check(result2.exitCode === 2, result2.stderr.toString());

    // subcommand names are not shortcuts
    const result3 = fixture.runShortcut("list", [], { config: REAL_CONFIG });
    check(result3.exitCode === 2, "agent subcommands must not be shortcuts");
  }),
);

test(
  "test_shortcuts_link_management",
  withFixture((fixture) => {
    const links = join(fixture.tmp, "links");
    const env = { AGENT_BIN_DIR: links };

    const listed = fixture.run(["shortcuts"], { env, config: REAL_CONFIG });
    check(listed.exitCode === 0, listed.stderr.toString());
    const listedOut = listed.stdout.toString();
    for (const name of REAL_SHORTCUTS) {
      check(listedOut.includes(name), `shortcuts list misses ${name}`);
    }
    check(!listedOut.includes("claude-zen"), "non-route must not be listed");
    check(listedOut.includes("missing"), listedOut);

    const checked = fixture.run(["shortcuts", "check"], { env, config: REAL_CONFIG });
    check(checked.exitCode === 1, "check must fail before create");

    // a native harness entry in the same directory is never touched
    mkdirSync(links);
    const native = join(links, "claude");
    symlinkSync("/bin/ls", native);

    const created = fixture.run(["shortcuts", "create"], { env, config: REAL_CONFIG });
    check(created.exitCode === 0, created.stderr.toString());
    check(
      lstatSync(native).isSymbolicLink() && realpathSync(native) === realpathSync("/bin/ls"),
      "native claude entry must be untouched",
    );
    for (const name of REAL_SHORTCUTS) {
      const path = join(links, name);
      check(lstatSync(path).isSymbolicLink(), `${name} was not created`);
      check(realpathSync(path) === realpathSync(LAUNCHER), `${name} points elsewhere`);
    }
    check(!existsSync(join(links, "claude-zen")), "non-route shortcut must not be created");

    // re-running is safe (idempotent)
    const createdAgain = fixture.run(["shortcuts", "create"], { env, config: REAL_CONFIG });
    check(createdAgain.exitCode === 0, createdAgain.stderr.toString());
    check(createdAgain.stdout.toString().includes("0 created"), createdAgain.stdout.toString());
    const checkedAgain = fixture.run(["shortcuts", "check"], { env, config: REAL_CONFIG });
    check(checkedAgain.exitCode === 0, checkedAgain.stderr.toString());

    // an unmanaged file is never overwritten
    const victim = join(links, "omp-openrouter");
    unlinkSync(victim);
    writeFileSync(victim, "not ours\n");
    const conflicting = fixture.run(["shortcuts", "create"], { env, config: REAL_CONFIG });
    check(conflicting.exitCode === 1, conflicting.stderr.toString());
    check(
      conflicting.stderr.toString().includes("refusing to overwrite"),
      conflicting.stderr.toString(),
    );
    check(readFileSync(victim, "utf8") === "not ours\n", "conflicting file must be untouched");
    const checkedConflict = fixture.run(["shortcuts", "check"], { env, config: REAL_CONFIG });
    check(checkedConflict.exitCode === 1, "check must fail on a conflict");

    // remove takes back only what the launcher owns
    unlinkSync(victim);
    const foreign = join(links, "opencode-deepseek");
    unlinkSync(foreign);
    symlinkSync("/bin/ls", foreign);
    const removed = fixture.run(["shortcuts", "remove"], { env, config: REAL_CONFIG });
    check(removed.exitCode === 0, removed.stderr.toString());
    check(
      lstatSync(foreign).isSymbolicLink() && realpathSync(foreign) === realpathSync("/bin/ls"),
      "foreign symlink must survive remove",
    );
    check(lstatSync(native).isSymbolicLink(), "native entry must survive remove");
    for (const name of REAL_SHORTCUTS) {
      if (name === "opencode-deepseek") {
        continue;
      }
      check(!existsSync(join(links, name)), `${name} must be removed`);
    }
    const checkedAfterRemove = fixture.run(["shortcuts", "check"], { env, config: REAL_CONFIG });
    check(checkedAfterRemove.exitCode === 1, "check must fail after remove");

    const frobnicated = fixture.run(["shortcuts", "frobnicate"], { env, config: REAL_CONFIG });
    check(frobnicated.exitCode === 2, frobnicated.stderr.toString());
  }),
);

test(
  "test_native_harness_not_wrapped",
  withFixture((fixture) => {
    // Plain `claude`/`opencode` never go through the launcher.
    const env = fixture.baseEnv();
    const result = Bun.spawnSync({
      cmd: [join(fixture.bindir, "claude"), "--version"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    check(result.exitCode === 0, result.stderr.toString());
    const [, childEnv] = fixture.child();
    check(
      !("ANTHROPIC_MODEL" in childEnv),
      "native claude must not receive route env",
    );
    check(
      !("ANTHROPIC_BASE_URL" in childEnv),
      "native claude must not be redirected",
    );
    check(!existsSync(fixture.marker), "with-secrets must not run for a native command");
  }),
);

test(
  "test_claude_deepseek_filters_preset_secrets",
  withFixture((fixture) => {
    const result = fixture.run(["claude", "deepseek"], {
      env: { OPENROUTER_API_KEY: "preset-openrouter" },
      config: REAL_CONFIG,
    });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    expect(argv, JSON.stringify(argv)).toEqual([]);
    check(env["ANTHROPIC_BASE_URL"] === "https://api.deepseek.com/anthropic", JSON.stringify(env));
    check(env["ANTHROPIC_MODEL"] === "deepseek-flash", JSON.stringify(env));
    check(
      env["ANTHROPIC_AUTH_TOKEN"] === "secret-deepseek",
      `auth token was '${env["ANTHROPIC_AUTH_TOKEN"]}'`,
    );
    check(!("ANTHROPIC_API_KEY" in env), "ANTHROPIC_API_KEY must be cleared");
    check(env["DEEPSEEK_API_KEY"] === "secret-deepseek", JSON.stringify(env));
    check(
      !("OPENROUTER_API_KEY" in env),
      "pre-existing other-provider secret must be dropped",
    );
    check(!("OPENCODE_API_KEY" in env), "injected zen secret must be dropped");
    check(existsSync(fixture.marker), "with-secrets wrapper was not used");
  }),
);

test(
  "test_env_short_circuits_injection",
  withFixture((fixture) => {
    const result = fixture.run(["claude", "deepseek"], {
      env: { DEEPSEEK_API_KEY: "already-here" },
      config: REAL_CONFIG,
    });
    check(result.exitCode === 0, result.stderr.toString());
    const [, env] = fixture.child();
    check(env["ANTHROPIC_AUTH_TOKEN"] === "already-here", JSON.stringify(env));
    check(
      !existsSync(fixture.marker),
      "with-secrets must be skipped when the credential is already set",
    );
  }),
);

test(
  "test_missing_secret_fails",
  withFixture((fixture) => {
    fixture.writeWrapper(FAKE_WITH_SECRETS_NO_DEEPSEEK);
    const result = fixture.run(["claude", "deepseek"], { config: REAL_CONFIG });
    check(result.exitCode === 1, `expected exit 1, got ${result.exitCode}`);
    check(result.stderr.toString().includes("DEEPSEEK_API_KEY"), result.stderr.toString());
    check(result.stderr.toString().includes("Infisical"), result.stderr.toString());
    check(!existsSync(fixture.out), "harness must not start without credentials");
  }),
);

test(
  "test_opencode_zen",
  withFixture((fixture) => {
    const result = fixture.run(["opencode", "zen"], {
      env: { OPENCODE_CONFIG_CONTENT: '{"permission":"allow"}' },
      config: REAL_CONFIG,
    });
    check(result.exitCode === 0, result.stderr.toString());
    let [argv, env] = fixture.child();
    expect(argv, JSON.stringify(argv)).toEqual(["--standalone"]);
    check(env["OPENCODE_API_KEY"] === "secret-opencode", JSON.stringify(env));
    const content = JSON.parse(env["OPENCODE_CONFIG_CONTENT"]) as Record<string, unknown>;
    check(content["model"] === "opencode/mimo-v2.6-flash-free", JSON.stringify(content));
    check(content["permission"] === "allow", "existing inline config must merge");
    // the wrapper stage must never see the caller's inline config (it may
    // contain provider apiKey values): only the model id crosses argv
    check(existsSync(fixture.marker), "with-secrets wrapper was not used");
    const wrapperText = existsSync(fixture.wrapper_argv)
      ? readFileSync(fixture.wrapper_argv, "utf8")
      : "";
    check(
      !wrapperText.includes('"permission"'),
      `caller inline config leaked into wrapper argv: ${wrapperText.slice(0, 200)}`,
    );

    const result2 = fixture.run(["opencode", "zen", "--", "run", "hello world"], {
      config: REAL_CONFIG,
    });
    check(result2.exitCode === 0, result2.stderr.toString());
    const [argv2, env2] = fixture.child();
    expect(argv2, JSON.stringify(argv2)).toEqual(["run", "--standalone", "hello world"]);
    check(
      (JSON.parse(env2["OPENCODE_CONFIG_CONTENT"]) as Record<string, unknown>)["model"] ===
        "opencode/mimo-v2.6-flash-free",
      JSON.stringify(env2),
    );

    // TUI flags keep the root position, session subcommands are untouched,
    // and an explicit --standalone/--server is never duplicated.
    for (const [passthru, expected] of [
      [["--continue"], ["--standalone", "--continue"]],
      [["models"], ["models"]],
      [["--standalone", "run", "x"], ["--standalone", "run", "x"]],
    ] as Array<[string[], string[]]>) {
      const result3 = fixture.run(["opencode", "zen", "--", ...passthru], { config: REAL_CONFIG });
      check(result3.exitCode === 0, `${passthru.join(" ")}: ${result3.stderr.toString()}`);
      const [argv3] = fixture.child();
      expect(argv3, `${passthru.join(" ")} -> ${JSON.stringify(argv3)}`).toEqual(expected);
    }

    // explicit --model wins over the provider default
    const result4 = fixture.run(["opencode", "zen", "--model", "big-pickle"], {
      config: REAL_CONFIG,
    });
    check(result4.exitCode === 0, result4.stderr.toString());
    const [, env4] = fixture.child();
    check(
      (JSON.parse(env4["OPENCODE_CONFIG_CONTENT"]) as Record<string, unknown>)["model"] ===
        "opencode/big-pickle",
      JSON.stringify(env4),
    );
  }),
);

test(
  "test_opencode_deepseek",
  withFixture((fixture) => {
    const result = fixture.run(["opencode", "deepseek"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    expect(argv, JSON.stringify(argv)).toEqual(["--standalone"]);
    check(env["DEEPSEEK_API_KEY"] === "secret-deepseek", JSON.stringify(env));
    check(
      (JSON.parse(env["OPENCODE_CONFIG_CONTENT"]) as Record<string, unknown>)["model"] ===
        "deepseek/deepseek-flash",
      JSON.stringify(env),
    );
    check(
      !("OPENROUTER_API_KEY" in env) &&
        !("OPENCODE_API_KEY" in env),
      "other secrets must not leak",
    );
  }),
);

test(
  "test_omp_deepseek",
  withFixture((fixture) => {
    const result = fixture.run(["omp", "deepseek", "--", "-p", "hi"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    expect(argv, JSON.stringify(argv)).toEqual([
      "--provider",
      "deepseek",
      "--model",
      "deepseek-flash",
      ...OMP_WORKER_ARGV,
      "-p",
      "hi",
    ]);
    check(env["DEEPSEEK_API_KEY"] === "secret-deepseek", JSON.stringify(env));
    check(!("OPENROUTER_API_KEY" in env), "leak");

    const result2 = fixture.run(
      ["omp", "deepseek", "--model", "deepseek-v4-pro", "--", "-p", "hi"],
      { config: REAL_CONFIG },
    );
    check(result2.exitCode === 0, result2.stderr.toString());
    const [argv2] = fixture.child();
    check(argv2.includes("--model") && argv2.includes("deepseek-v4-pro"), JSON.stringify(argv2));
  }),
);

test(
  "test_dsh_passthrough",
  withFixture((fixture) => {
    const result = fixture.run(["dsh", "deepseek", "--", "web"], { config: REAL_CONFIG });
    check(result.exitCode === 0, result.stderr.toString());
    const [argv, env] = fixture.child();
    expect(argv, JSON.stringify(argv)).toEqual(["web"]);
    check(env["DEEPSEEK_API_KEY"] === "secret-deepseek", JSON.stringify(env));

    const result2 = fixture.run(["dsh", "deepseek", "--model", "x"], { config: REAL_CONFIG });
    check(result2.exitCode === 2, "dsh must reject --model");
    check(result2.stderr.toString().includes("does not accept --model"), result2.stderr.toString());
  }),
);

test(
  "test_forbidden_passthru_flags",
  withFixture((fixture) => {
    const cases: Array<[string[], string]> = [
      [["omp", "openrouter", "--", "--model", "x"], "--model"],
      [["claude", "deepseek", "--", "--model=deepseek-v4-pro"], "--model"],
      [["claude", "openrouter", "--", "--fallback-model", "x"], "--fallback-model"],
      [["claude", "openrouter", "--", "--fallback-model=x"], "--fallback-model"],
      [["omp", "openrouter", "--", "--api-key", "x"], "--api-key"],
      [["omp", "deepseek", "--", "--provider", "openrouter"], "--provider"],
      // OMP-only flags that would move the credential/config source or model
      // roles after the launcher's checks.
      [["omp", "openrouter", "--", "--profile=work"], "--profile"],
      [["omp", "openrouter", "--", "--config", "overlay.yml"], "--config"],
      [["omp", "openrouter", "--", "--cwd", "/tmp"], "--cwd"],
      [["omp", "openrouter", "--", "--smol", "openrouter/x"], "--smol"],
      [["omp", "opencode-go", "--", "--prewalk"], "--prewalk"],
      // Extra extension loading: a module can register a credential/model
      // fallback outside the guard (F3/A2), and the launcher names every
      // trusted module itself.
      [["omp", "openrouter", "--", "--trusted-extension", "/tmp/x.ts"], "--trusted-extension"],
      [["omp", "openrouter", "--", "--extension", "/tmp/x.ts"], "--extension"],
      [["omp", "openrouter", "--", "-e", "/tmp/x.ts"], "-e"],
      [["omp", "openrouter", "--", "--hook", "/tmp/x.ts"], "--hook"],
      // The CLI flag enables the advisor runtime even when config says
      // advisor.enabled: false (A4).
      [["omp", "openrouter", "--", "--advisor"], "--advisor"],
      // A later --tools replaces the launcher's Worker list (last-wins), so
      // it must not reach OMP (A1).
      [["omp", "openrouter", "--", "--tools", "read,bash,edit,write,web"], "--tools"],
      // Unvalidated model ids for Ctrl+P cycling bypass the route allowlist
      // (A5).
      [["omp", "openrouter-free", "--", "--models", "openrouter/anthropic/claude"], "--models"],
    ];
    for (const [args, needle] of cases) {
      const result = fixture.run(args, { config: REAL_CONFIG });
      check(result.exitCode === 2, `${args.join(" ")} -> ${result.exitCode}`);
      check(
        result.stderr.toString().includes(needle),
        `${args.join(" ")}: ${result.stderr.toString()}`,
      );
    }

    // The OMP-only list must not reject flags another adapter may use.
    const claude = fixture.run(["claude", "deepseek", "--", "--config", "x"], {
      config: REAL_CONFIG,
    });
    check(claude.exitCode === 0, claude.stderr.toString());
  }),
);

test(
  "test_model_precedence",
  withFixture((fixture) => {
    const config = join(fixture.tmp, "precedence.toml");
    writeFileSync(config, PRECEDENCE_CONFIG);

    const result = fixture.run(["h1", "p1"], { config });
    check(result.exitCode === 0, result.stderr.toString());
    const [, env] = fixture.child();
    check(
      env["ANTHROPIC_MODEL"] === "route-model",
      `route default must win: ${env["ANTHROPIC_MODEL"]}`,
    );

    const result2 = fixture.run(["h1", "p1", "--model", "cli-model"], { config });
    check(result2.exitCode === 0, result2.stderr.toString());
    const [, env2] = fixture.child();
    check(env2["ANTHROPIC_MODEL"] === "cli-model", "CLI --model must win");
    check(env2["ANTHROPIC_DEFAULT_SONNET_MODEL"] === "cli-model", JSON.stringify(env2));

    const result3 = fixture.run(["h1", "p1", "-m", "cli-model"], { config });
    check(result3.exitCode === 0, result3.stderr.toString());
    const [, env3] = fixture.child();
    check(env3["ANTHROPIC_MODEL"] === "cli-model", "-m must work");
  }),
);

test(
  "test_fast_path_drops_declared_provider_creds",
  withFixture((fixture) => {
    // All secrets preset: no wrapper, but other providers' creds still drop.
    const config = join(fixture.tmp, "precedence.toml");
    writeFileSync(config, PRECEDENCE_CONFIG);
    const result = fixture.run(["h1", "p1"], {
      env: {
        DEEPSEEK_API_KEY: "preset-p1",
        CUSTOMP_API_KEY: "preset-p2",
      },
      config,
    });
    check(result.exitCode === 0, result.stderr.toString());
    const [, env] = fixture.child();
    check(env["DEEPSEEK_API_KEY"] === "preset-p1", "selected provider secret must survive");
    check(!("CUSTOMP_API_KEY" in env), "declared provider secret must be dropped on the fast path");
    check(!existsSync(fixture.marker), "fast path must not invoke with-secrets");
  }),
);

test(
  "test_agent_model_env_warns",
  withFixture((fixture) => {
    const result = fixture.run(["claude", "openrouter"], {
      env: { AGENT_MODEL: "legacy-model" },
      config: REAL_CONFIG,
    });
    check(result.exitCode === 0, result.stderr.toString());
    check(result.stderr.toString().includes("AGENT_MODEL is no longer read"), result.stderr.toString());
    const [, env] = fixture.child();
    check(
      env["ANTHROPIC_MODEL"] === "z-ai/glm-5.3-flash",
      `legacy env must not select the model: ${env["ANTHROPIC_MODEL"]}`,
    );
  }),
);

test(
  "test_missing_harness",
  withFixture((fixture) => {
    const config = join(fixture.tmp, "ghost.toml");
    writeFileSync(config, GHOST_CONFIG);
    const result = fixture.run(["ghost", "p1"], { config });
    check(
      result.exitCode === 1,
      `expected 1, got ${result.exitCode}: ${result.stderr.toString()}`,
    );
    check(result.stderr.toString().includes("harness not found"), result.stderr.toString());
    check(!existsSync(fixture.marker), "credentials must not be fetched first");
  }),
);

test(
  "test_invalid_configs",
  withFixture((fixture) => {
    const cases: Array<[string, string]> = [
      // provider without default and route without require_model
      [
        `
[providers.p1]
label = "P"
models = ["m"]

[harnesses.h1]
label = "H"
command = "claude"
adapter = "anthropic"
[harnesses.h1.env]
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[routes."h1.p1"]
`,
        "no default model",
      ],
      [
        `
[providers.p1]
label = "P"
default_model = "m"
models = ["m"]

[harnesses.h1]
label = "H"
command = "claude"
adapter = "telepathy"
`,
        "unknown adapter",
      ],
      [
        `
[providers.p1]
label = "P"
default_model = "not-listed"
models = ["m"]
`,
        "is not in models",
      ],
      [
        `
[providers.p1]
label = "P"
default_model = "m"
require_model = true
models = ["m"]
`,
        "contradicts",
      ],
      [
        `
[providers.p1]
label = "P"
default_model = "m"

[harnesses.h1]
label = "H"
command = "claude"
adapter = "anthropic"
[harnesses.h1.env]
base_url = "ANTHROPIC_BASE_URL"
auth_token = "ANTHROPIC_AUTH_TOKEN"
api_key = "ANTHROPIC_API_KEY"
model = "ANTHROPIC_MODEL"
small_fast_model = "ANTHROPIC_SMALL_FAST_MODEL"
default_opus = "ANTHROPIC_DEFAULT_OPUS_MODEL"
default_sonnet = "ANTHROPIC_DEFAULT_SONNET_MODEL"
default_haiku = "ANTHROPIC_DEFAULT_HAIKU_MODEL"

[routes."h1.p1"]
`,
        "needs provider",
      ],
      [
        `
[providers.p1]
label = "P"
default_model = "m"
models = ["m"]

[harnesses.h1]
label = "H"
command = "true"
adapter = "passthrough"

[routes."nope.p1"]
`,
        "unknown harness",
      ],
      // require_infisical needs an Infisical secret name; there is nothing
      // to source authoritatively otherwise.
      [
        `
[providers.p1]
label = "P"
env = "SOME_KEY"
require_infisical = true
default_model = "m"
models = ["m"]
`,
        "require_infisical = true requires an Infisical 'secret' name",
      ],
    ];
    for (const [index, [content, needle]] of cases.entries()) {
      const config = join(fixture.tmp, `invalid-${index}.toml`);
      writeFileSync(config, content);
      const result = fixture.run(["check"], { config });
      check(
        result.exitCode === 2,
        `invalid config ${index} must fail, got ${result.exitCode}: ${result.stdout.toString()}`,
      );
      check(
        result.stderr.toString().includes(needle),
        `invalid config ${index}: expected '${needle}', got '${result.stderr.toString()}'`,
      );
    }
  }),
);

test(
  "test_signal_exit_code_128_plus",
  withFixture((fixture) => {
    const killer = join(fixture.bindir, "killer");
    writeFileSync(killer, "#!/usr/bin/env bash\nset -eu\nkill -KILL $$\n");
    chmodSync(killer, 0o755);
    const config = join(fixture.tmp, "killer.toml");
    writeFileSync(
      config,
      `
[providers.p1]
label = "P1"
default_model = "m1"

[harnesses.killer]
label = "Killer"
command = "killer"
adapter = "passthrough"

[routes."killer.p1"]
default_model = "m1"
`,
    );
    // A harness killed by SIGKILL must surface as 128+9, as documented —
    // os.constants.signals covers every signal, not just INT/TERM/HUP.
    const result = fixture.run(["killer", "p1"], { config });
    check(result.exitCode === 137, `expected exit 137 (128+SIGKILL), got ${result.exitCode}`);
  }),
);

test(
  "test_dangling_shortcut_symlink",
  withFixture((fixture) => {
    const links = join(fixture.tmp, "links");
    mkdirSync(links, { recursive: true });
    symlinkSync(join(fixture.tmp, "gone-target"), join(links, "claude-minimax"));

    const create = fixture.run(["shortcuts", "create"], {
      config: REAL_CONFIG,
      env: { AGENT_BIN_DIR: links },
    });
    check(
      create.exitCode === 1,
      `dangling link must be a conflict, got exit ${create.exitCode}: ${create.stderr.toString()}`,
    );
    check(
      create.stderr.toString().includes("dangling"),
      `expected a dangling-symlink message, got: ${create.stderr.toString()}`,
    );

    const remove = fixture.run(["shortcuts", "remove"], {
      config: REAL_CONFIG,
      env: { AGENT_BIN_DIR: links },
    });
    check(remove.exitCode === 0, `remove failed: ${remove.stderr.toString()}`);
    check(
      remove.stdout.toString().includes("left untouched (dangling symlink)"),
      `remove must report the dangling link, got: ${remove.stdout.toString()}`,
    );
    check(
      lstatSync(join(links, "claude-minimax")).isSymbolicLink(),
      "a dangling symlink cannot be proven ours; remove must keep it",
    );
  }),
);

test(
  "test_at_prefixed_model_id_is_literal",
  withFixture((fixture) => {
    const config = join(fixture.tmp, "at-model.toml");
    writeFileSync(
      config,
      `
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

[providers.cloudflare]
label = "Cloudflare"
base_url = "https://api.cloudflare.example"
secret = "CLOUDFLARE_API_KEY"
env = "CLOUDFLARE_API_KEY"
default_model = "@cf/meta/llama"
models = ["@cf/meta/llama"]

[routes."claude.cloudflare"]
`,
    );
    // Model ids may legitimately start with `@` (Cloudflare's `@cf/...`);
    // only the explicit @@cred: marker may trigger credential resolution.
    const result = fixture.run(["claude", "cloudflare"], {
      config,
      env: { CLOUDFLARE_API_KEY: "cf-secret-value" },
    });
    check(result.exitCode === 0, `run failed: ${result.stderr.toString()}`);
    const [, env] = fixture.child();
    check(
      env["ANTHROPIC_MODEL"] === "@cf/meta/llama",
      `model id must stay literal, got '${env["ANTHROPIC_MODEL"]}'`,
    );
    check(
      env["ANTHROPIC_AUTH_TOKEN"] === "cf-secret-value",
      `@@cred: marker must still resolve, got '${env["ANTHROPIC_AUTH_TOKEN"]}'`,
    );
    check(!("ANTHROPIC_API_KEY" in env), "ANTHROPIC_API_KEY must be unset");
  }),
);

test(
  "test_native_provider_omitted_no_injection",
  withFixture((fixture) => {
    // `agent claude` = native mode: spawn the harness untouched.
    const result = fixture.run(["claude"], { config: REAL_CONFIG });
    check(result.exitCode === 0, `native run failed: ${result.stderr.toString()}`);
    const [argv, env] = fixture.child();
    // FAKE_HARNESS dumps its arguments only (no $0): bare `agent claude`
    // passes nothing
    check(argv.length === 0, `expected empty native argv, got: ${JSON.stringify(argv)}`);
    check(!("ANTHROPIC_BASE_URL" in env), "native mode must not inject an endpoint");
    check(!("ANTHROPIC_AUTH_TOKEN" in env), "native mode must not inject a credential");
    check(!("ANTHROPIC_MODEL" in env), "native mode must not inject a model");
    // no script/with-secrets stage either (no Infisical involvement)
    check(!existsSync(fixture.marker), "native mode must not invoke with-secrets");
  }),
);

test(
  "test_native_passthrough_args",
  withFixture((fixture) => {
    // flag-first tail needs no '--'; '--' also works; both reach the harness
    for (const args of [
      ["claude", "-p", "hello world"],
      ["claude", "--", "-p", "hello world"],
    ]) {
      const result = fixture.run(args, { config: REAL_CONFIG });
      check(result.exitCode === 0, `${args.join(" ")}: ${result.stderr.toString()}`);
      const [argv] = fixture.child();
      // dump excludes $0: [-p, "hello world"]
      check(
        argv.length === 2 && argv[0] === "-p" && argv[1] === "hello world",
        `${args.join(" ")}: argv mismatch: ${JSON.stringify(argv)}`,
      );
    }
    // a later '--' is forwarded with the tail, not used as the separator
    const laterDashes = fixture.run(["claude", "-p", "x", "--", "--weird"], { config: REAL_CONFIG });
    check(laterDashes.exitCode === 0, `later '--' run failed: ${laterDashes.stderr.toString()}`);
    const [laterArgv] = fixture.child();
    check(
      JSON.stringify(laterArgv) === JSON.stringify(["-p", "x", "--", "--weird"]),
      `later '--' must not drop earlier args: ${JSON.stringify(laterArgv)}`,
    );
    // a non-flag second token stays a provider (typo fail-closed), not an arg
    const typo = fixture.run(["claude", "run"], { config: REAL_CONFIG });
    check(typo.exitCode === 2, `non-flag second token must stay a provider, got ${typo.exitCode}`);
    check(typo.stderr.toString().includes("unknown provider"), typo.stderr.toString());
  }),
);

test(
  "test_native_forbidden_and_missing_harness",
  withFixture((fixture) => {
    // model flags still require a provider route, in either spelling
    for (const args of [
      ["claude", "--model", "sonnet"],
      ["claude", "-m", "sonnet"],
      ["claude", "--", "--model=sonnet"],
      ["claude", "--", "--fallback-model=x"],
    ]) {
      const result = fixture.run(args, { config: REAL_CONFIG });
      check(
        result.exitCode === 2,
        `${args.join(" ")} must exit 2, got ${result.exitCode}: ${result.stderr.toString()}`,
      );
      check(!existsSync(fixture.out), `${args.join(" ")}: harness must not start`);
    }
    // unknown harness in native mode is still exit 2 with the known list
    const unknown = fixture.run(["bogus"], { config: REAL_CONFIG });
    check(unknown.exitCode === 2, `native unknown harness must exit 2, got ${unknown.exitCode}`);
    check(unknown.stderr.toString().includes("unknown harness"), unknown.stderr.toString());
    // missing binary → exit 1 (runtime), same contract as route mode
    const ghost = join(fixture.tmp, "ghost.toml");
    writeFileSync(
      ghost,
      `
[providers.p1]
label = "P1"
default_model = "m1"

[harnesses.ghost]
label = "Ghost"
command = "no-such-harness-binary-xyz"
adapter = "passthrough"

[routes."ghost.p1"]
default_model = "m1"
`,
    );
    const missing = fixture.run(["ghost"], { config: ghost });
    check(
      missing.exitCode === 1,
      `missing harness must exit 1, got ${missing.exitCode}: ${missing.stderr.toString()}`,
    );
    check(missing.stderr.toString().includes("harness not found"), missing.stderr.toString());
  }),
);
});
