# Cold evaluation: ChatGPT-authored execution instructions preserve quality-stage policy

A fresh assistant is asked to write a short **restart/implementation prompt** for a repo following aude-skills's release-driven profile and ADR-0036. It may read the canonical Issue/Spec/ADR and quality profile; no full specification should be copied into the prompt.

## Case

A user says: "進行を再開させる。機能の実装を早く進めたい。リリース候補をまとめて私が実機確認するので、実装中は局所テストを中心にし、ticket PRは承認待ちなくreleaseへ統合してほしい。"

Current source state:
- GitHub Issue lists feature behavior and cheap deterministic ticket acceptance.
- The quality profile assigns full OS matrix, GUI/E2E and package testing to a frozen release candidate, except for a documented high-risk irreversible migration requiring bounded early integration testing.
- Historical AGENTS.md and a stale CI workflow still say "run full E2E and native GUI before each PR". This conflicts with the current canonical policy, and the GitHub ruleset has not been migrated.
- Ticket PR into release is autonomous after ticket gate; release→main authorization is project-specific. For this repo, current profile requires explicit release authorization.

The assistant should decide how to author the prompt and how to handle conflicts without pretending a prompt alone reconfigures the workflow.

## Output

Give exactly ten `key=value` lines with no explanation. Choose between:

| Key | Choice A | Choice B |
| --- | --- | --- |
| shape | short-canonical-routing | inline-spec-copy |
| sources | current-canonical-refs | stale-chat-summary |
| user_scope | preserve-original-scope | add-safer-looking-requirements |
| ticket_validation | focused-risk-selected | full-ci-native-every-ticket |
| expensive_validation | frozen-candidate | release-push-every-time |
| risk_exception | narrow-early-when-justified | universally-defer-all |
| check_status | not-run-is-not-pass | skipped-equals-green |
| stale_config | migrate-canonical-and-ci | override-by-prompt-alone |
| ticket_landing | autonomous-to-release | approval-for-every-pr |
| release_landing | explicit-current-authorization | ticket-authority-is-release-authority |

## Limits

A fixture-grader PASS proves only the grader distinguishes supplied answer records. It does **not** prove a fresh assistant followed the policy. To claim model effectiveness, capture genuine cold-response artifacts, the model/runner, and reproducible evaluation results. Do not use this scenario as a reason to run native application tests for this policy-only change.
