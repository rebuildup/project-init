# OpenRouter free model quality evidence (salvaged research record)

Research date: 2026-10-24 JST. This file preserves the findings of the
automatic-selection experiment (issue #72 / draft PR #73) after that direction
was stopped in issue #76. The evaluator, catalog cache, quality gate and
calibration code from PR #73 are **not** part of this repository's launcher;
only this record is kept, as evidence for the decision.

Primary sources used by the original research: the public
[OpenRouter models API](https://openrouter.ai/api/v1/models), the
[current-key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key),
[OpenRouter pricing](https://openrouter.ai/pricing),
[OpenRouter limits](https://openrouter.ai/docs/api_reference/limits), and each
model's vendor report/model card. None of the public scores validates a local
harness/fixture pair.

## Catalog snapshot (2026-10-23)

17 ids ending in `:free` had `pricing.prompt = "0"` and
`pricing.completion = "0"` with no other pricing entries. Catalog presence is
not an inference-availability guarantee; re-fetch before use.

Relevant entries:

| Model ID | Context | Tools | Expiry (then) |
| --- | ---: | --- | --- |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 | yes | none |
| `nvidia/nemotron-3.5-super-vl:free` | 1,000,000 | yes | none |
| `cohere/north-mini-code:free` | 256,000 | yes | none |
| `poolside/laguna-s-2.1:free` | 262,144 | yes | 2026-10-31 |
| `nvidia/nemotron-3-super-120b-a12b:free` | 262,144 | yes | none |

Excluded candidates: `openrouter/free` (meta-router, the answering model is
non-deterministic), `nvidia/nemotron-3.5-content-safety:free` (tools = false),
audio-output `google/lyria-3-*` (tools = false), `liquid/lfm-2.5-2.6b:free`
(context below the 128k floor).

Public benchmark numbers (vendor-reported; not local measurements) must not be
averaged across benchmarks or substituted for E2E. Examples recorded at the
time: Nemotron 3 Ultra BF16 70.7 SWE-bench Verified / 56.4 Terminal-Bench 2.1;
Laguna S 2.1 70.2 Terminal-Bench 2.1 (pool harness); Nemotron 3 Super 60.47
SWE-bench Verified (OpenHands) and 59.20 (OpenCode); North Mini Code 33.4
Artificial Analysis Coding Index (composite index). Revision, harness and trial
counts differ, so none of these selected a model by itself.

## Bounded local screening with Pi 0.73.1

Fixture digest `5c4dbd1cf076d6bc8a554b358aa0cdd9c13bd3d41d61395d29416e1f9a515b76`,
one trial, 12 forwarded inference requests, 180 s timeout, serial runs. Exact
`:free` ids only. Raw sanitized logs stayed machine-local under
`~/.cache/dotfiles-agent/` and were not committed.

| Model | Pi result | Requests | Duration |
| --- | --- | ---: | ---: |
| `poolside/laguna-s-2.1:free` | 13 tool calls, 2 failures, no passing grade | 9 | 180.060 s |
| `cohere/north-mini-code:free` | 11 tool calls, 1 failure, public regression failed | 9 | 49.323 s |
| `nvidia/nemotron-3-super-120b-a12b:free` | no response (HTTP 404 provider error) | 1 | 3.146 s |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 15 tool calls, 2 failures, no passing grade | 12 | 149.767 s |

A separate Ultra diagnostic with a 24-request/240 s profile observed the exact
model and three tool calls before an HTTP 200 SSE stream carried provider code
503 (`Upstream error from Nvidia: Service temporarily overloaded`). Recorded as
an infrastructure failure, not retried on another model.

North Mini Code was also screened once per other harness: Claude Code 2.1.306
exhausted the 12-request budget with 4 tool failures; OpenCode 2.1.2 exhausted
it with 14 tool calls and no passing grade. No model qualified.

## Updated evaluation (v8, 2026-10-24 JST)

32 requests/trial, 600 s, serial, same fixture family. `nvidia/nemotron-3.5-super-vl:free`:

| Harness | Trials | Passing grader | Observed model | Tool failures |
| --- | ---: | ---: | --- | ---: |
| Claude Code 2.1.306 | 3 | 3/3 | exact id on every response | 13/53 |
| OpenCode 2.1.2 | 3 | 2/3 | exact id | 0/42 |
| Pi 0.73.1 | 2 | 1/2 | exact id | 1/23 |

OpenCode 2.1.2 did not list `poolside/laguna-s-2.1:free` in `opencode models`
even though the catalog did; selecting the exact id produced
`Model unavailable` before any inference request. Catalog eligibility therefore
does not prove harness execution.

## Quota and failure behaviour

Free-tier limits are account-based: 20 req/min, 1,000 req/day after at least
$10 cumulative credit purchases. Failed attempts count toward the daily
allowance. The current-key endpoint exposes `free_model_daily_requests`
(`used`, `limit`, `remaining`); credit fields are unrelated. In one observation
the guarded attempt count and the provider counter differed by three, so the
counter is not an exact per-call ledger. Platform 429s carry rate-limit headers;
provider errors may carry `metadata.provider_code`; a rate-limit error can
arrive inside a 200 SSE stream. These must be separated from capability results
and never trigger a cross-model retry loop.

## Disposition (issue #76)

- Automatic availability/quality selection, the `openrouter/free` meta-router,
  cached selection and paid fallback are **rejected** for the normal launch
  path. The launcher uses one fixed model id in `config/agents.toml`.
- The fixed id kept on `main` is `nvidia/nemotron-3-ultra-550b-a55b:free`. On
  2026-11-01 it passed a short response + Bash tool call on Claude Code
  2.1.314, Pi 0.73.1 and OpenCode 2.2.3. That does **not** erase the results
  above: on the longer Pi fixture it exhausted a 12-request budget without a
  passing grade, and it hit a provider 503 once. It is a cheap/mass-worker
  option, not a proven replacement for a stronger paid route.
- PR #73's code was not merged. Issue #72 / PR #73 are closed as superseded by
  the policy in issue #76.
