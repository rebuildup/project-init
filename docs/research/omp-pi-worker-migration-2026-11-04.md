# Pi → Oh My Pi (OMP) Worker migration: harness comparison

Research date: 2026-11-04 JST. Issue: rebuildup/dotfiles#80.
Related: [ADR-0014](../adr/ADR-0014.md).

This record documents what was measured before and after moving the Worker slot
from Pi to OMP. It separates **measured** results from provider-claim and
account-side blockers, and states exactly what remains unverified.

## Scope and method

Environment: macOS 27.2.0 arm64, one machine. Model and endpoint were fixed for
both harnesses: `opencode-go` / `mimo-v2.6-flash` (OpenCode Go allowance),
selected explicitly; no fallback, no thinking override, no extra tools.

| Harness | Version | Invocation |
| --- | --- | --- |
| Pi (baseline) | 1.5.0 installed on this machine (pc-setup pinned 1.4.0 at the time), `@earendil-works/pi-coding-agent` | `pi -p --no-session --mode json --provider opencode-go --model mimo-v2.6-flash` with its ambient extensions (`~/.pi/agent/extensions`, including the destructive guard) |
| OMP (migration target) | 18.16.0 (`github:can1357/oh-my-pi`) | `omp -p --no-session --mode json --provider opencode-go --model mimo-v2.6-flash --tools read,bash,edit,write --no-lsp --no-pty --no-title --trusted-extension <dotfiles destructive guard>` |

Credentials were injected per process through `script/with-secrets` from
Infisical (the same `OPENCODE_API_KEY` secret for both). No key appeared in
argv, output, or the recorded logs.

Two representative Worker tasks, three runs each per harness, alternating
harness order between repetitions to spread any cache/rate effect:

- **readonly**: read one file and return its third non-empty line; read tool
  only, no bash.
- **edit**: fix a one-line arithmetic bug in `math.ts` so `bun test` passes,
  without editing the test file.

Correction was checked on disk per run (not only from the final message): all
six edit runs contain `a + b` in `math.ts` and an unmodified `math.test.ts`; all
six readonly runs returned `THIRD-LINE-47`.

OMP runs used the production flags; Pi runs used its production ambient
extension set. This is the honest production comparison, but it is not an
isolated harness benchmark: Pi loaded more ambient extensions, while OMP was
restricted to the explicitly trusted guard. The stable per-harness token totals
below suggest the difference is dominated by the base prompt/tool surface
rather than by per-run extension noise.

## Results (mean of 3 runs)

| Task | Harness | Input | Output | Cache read | Total tokens | Cost (USD) | Assistant calls | Tool executions | Wall (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| readonly | Pi | 3,358 | 68 | 18,219 | **21,644** | 0.000540 | 2 | 1 | **10.0** |
| readonly | OMP | 4,835 | 67 | 8,832 | **13,734** | 0.000720 | 2 | 1 | 17.1 |
| edit | Pi | 4,343 | 273 | 39,701 | **44,317** | 0.000796 | 4 | 4.67 | 32.6 |
| edit | OMP | 3,097 | 262 | 24,917 | **28,277** | 0.000577 | 4 | 4.0 | 28.9 |

Per-run totals were tightly clustered, which is the useful signal:

| Task/harness | Total tokens per run |
| --- | --- |
| readonly / Pi | 21,636, 21,654, 21,642 |
| readonly / OMP | 13,746, 13,737, 13,720 |
| edit / Pi | 44,620, 43,826, 44,506 |
| edit / OMP | 28,267, 28,343, 28,221 |

### What the numbers support

- **Token efficiency: OMP wins decisively on this slot.** OMP used ~37% fewer
  total tokens on both tasks (13.7k vs 21.6k; 28.3k vs 44.3k). The saving comes
  from a smaller base prompt/tool surface, visible as lower cache-read volume
  and lower input on the edit task.
- **Tool efficiency: comparable, one fewer call in edit.** Both harnesses used
  one read and one edit; Pi ran bash twice in 2 of 3 edit runs (5 executions),
  OMP ran it once in every run (4 executions). No retries, no errors, no
  aborted turns in either harness.
- **Success rate: tied at 3/3 per task.** All 12 runs exited 0 and produced the
  correct on-disk result.
- **Cache:** Pi reports more cache-read tokens (larger cached prefix); OMP
  reports more uncached input on some runs (first call) but far fewer tokens
  overall. Cache-hit rate alone is not a cost proxy because cached tokens are
  priced differently.
- **Cost: inconclusive at this scale.** Provider-computed cost was below
  $0.002 per run for both harnesses; run-to-run cache variation moves the
  per-run cost more than the harness difference. The token reduction is the
  durable result; do not quote a percentage cost saving from three runs.
- **Wall time: Pi was faster on the small readonly task** (10.0 s vs 17.1 s,
  mostly startup/TTFT), while the edit task was similar (32.6 s vs 28.9 s).
  Startup overhead dominates short prompts; it should not be generalized.

### What the numbers do not support

- No claim about other models, other providers, long sessions, or multi-turn
  interactive work.
- No claim that OMP reduces cost by the same percentage as tokens; cache
  pricing and first-call behavior differ.
- No claim about upstream-announced reductions; only the local measurements
  above were used.

## OpenCode Go / MiMo verification

A real OMP response and a real bash tool execution through the Go endpoint were
verified on 2026-11-04, both directly and through the launcher:

- Launcher negative/positive tests: `agent omp opencode-go` returned
  `LAUNCHER_E2E_OK`; a stale ambient `OPENCODE_API_KEY` was ignored and the
  Infisical value was used (`AMBIENT_REJECTED_OK`).
- Final assistant messages recorded `provider: opencode-go`,
  `model: mimo-v2.6-flash`, `api: openai-completions`.
- The OMP binary contains the current endpoint
  `https://opencode.ai/inference/go/v1` (legacy `/zen/go` also present); the
  Claude Code route keeps `https://opencode.ai/inference/go/anthropic`.
- OpenRouter free route: real OMP response + bash tool call verified
  2026-11-04 (`OR_FREE_OK`).
- DeepSeek route: the call reached the native DeepSeek provider, but the
  account returned **HTTP 402 Insufficient Balance**. Provider routing is
  verified; response/tool success is **not**.
- MiniMax route: the call reached the provider, but the M Plan account returned
  **HTTP 429 Token Plan limit**. Provider routing is verified; response/tool
  success is **not**.
- Extra Usage / automatic fallback: not enabled and not measured; no paid
  contract was added. OMP's implicit-switch settings (`retry.fallbackChains`,
  `advisor.enabled`, `contextPromotion.enabled`) are rejected by the launcher
  on Infisical-backed routes. `--models` was deliberately not treated as an
  allowlist because OMP only uses it for Ctrl+P cycling.

## Permission-boundary probe (why the guard is required)

OMP's default `tools.approvalMode` is `yolo`, and the built-in bash
critical-pattern override is ignored in yolo. A probe asked each harness to run
a recursive forced delete against a temp directory:

- Pi (with its installed destructive guard): directory survived; the guard
  blocked the command.
- OMP with default flags and no guard: **the directory was deleted**.
- OMP with the ported `script/omp-destructive-guard.ts` loaded via
  `--trusted-extension`: the directory and its file survived, exit 0, and the
  final message reported the command was blocked by the destructive guard.

`--trusted-extension` was chosen over ambient discovery because it **aborts
startup** on a missing or unparseable module (verified with a broken file) and
disables ambient extension discovery. The Herdr integration is therefore passed
explicitly as a second `--trusted-extension` when `HERDR_ENV=1`.

## Herdr Worker path (macOS)

A dedicated, bounded Herdr workspace was created and the launcher was started in
its pane with `HERDR_ENV=1`:

1. The launcher argv included the role pins, the tool restriction, the
   dotfiles guard, and `~/.omp/agent/extensions/herdr-omp-agent-state.ts`.
2. Herdr detected the pane as `agent: omp`, `source: herdr:omp`, and reported
   the OMP session path.
3. `herdr agent prompt` delivered a prompt; OMP replied `HERDR_OMP_OK` and ran
   `printf HERDR_TOOL_OK > tool.txt`; the file contained `HERDR_TOOL_OK`.
4. The session transcript independently recorded `opencode-go` /
   `mimo-v2.6-flash` and the bash tool call.
5. Ctrl-C and `herdr workspace close` left no OMP process behind.

Herdr display state was not used as completion evidence; the on-disk result,
session transcript, and process cleanup were.

Note: `herdr pane run <pane> "<text>"` submits the text as a prompt to the agent
in the pane, not as a shell command. The first attempt exposed that difference
and produced a nested launch; the accepted path is a shell pane plus
`agent omp <provider>`, as in ADR-0034.

## Remaining risks and unverified items

- **macOS only.** Windows native and WSL were not exercised for the OMP slot.
  The launcher logic is portable, but install/PTY/Herdr behavior there is
  unverified; do not mark those platforms PASS.
- **One model.** Only MiMo V2.6 Flash through OpenCode Go (plus the OpenRouter
  free smoke) was measured. DeepSeek and MiniMax are blocked by account state.
- **Small sample.** Three runs per task; cost differences are within noise.
- **Ambient asymmetry.** Pi ran with its full ambient extensions, OMP with an
  exact trusted-extension allowlist. This reflects the intended production
  postures but is a confounder for tool/prompt overhead comparisons.
- **Residual credential risk.** An OMP extension loaded in a native session can
  register a config fallback that the file-based guard does not inspect. The
  launcher's routes disable ambient extensions, which closes that path for the
  Worker slot; native `omp` remains the user's own trust domain.
- **Native Pi still installed.** It remains for rollback and native use and is
  not routed by the launcher. `agent pi …` and stale `pi-*` shortcuts fail
  closed with a migration hint; the stale links are not deleted automatically.
- **OMP feature drift.** The launcher pins provider/model/roles/tools and
  rejects known implicit switches, but a future OMP release could add a new
  model-selection or approval behavior that is not yet guarded. Re-run
  `agent check`, the mock suite, and the destructive probe after upgrading.
- **Inherited guard gaps.** The destructive rule table is byte-equivalent to
  the Pi/Claude copies, which do not catch `git push -d` or
  `git branch -d -f` (long forms are caught). The migration preserves the
  boundary it inherited; closing these gaps must change every copy at once
  and is tracked as a follow-up, not silently patched only for OMP.
- **Credential guard is argv-aware only through a denylist.** `--profile`,
  `--config`, `--cwd` and the model-role flags are rejected for the `omp`
  adapter. A future OMP flag that loads another config/auth source would
  need to be added; the guard inspects env, dotenv, config/models files and
  the default `agent.db`, not arbitrary argv.

## Reproduction

Commands are in `docs/agent-launcher.md` (verification section). Measurement
runs used the same binary, prompt, model, fixture, and `--mode json` for both
harnesses; raw JSONL transcripts and fixtures were kept outside the repository
(`/tmp/omp-compare`) and are not committed.
