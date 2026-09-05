# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Files

- `PROMPT.ja.md` — 日本語版の本体。通常はこちらを使用します。
- `PROMPT.en.md` — 英語版の本体。日本語版と同じoperational semanticsを定義します。
- `CODEX_ROLES.ja.md` — Codexの時点依存model-role運用方針（日本語版）。
- `CODEX_ROLES.en.md` — Codexの時点依存model-role運用方針（英語版）。
- `ADR-0001.md` — project-local / progressive disclosure / deterministic verification等の基本設計判断。
- `ADR-0002.md` — 低コストsafeguardとtime-sensitive role分離の判断。
- `ADR-0003.md` — isolated multi-agent execution / Supervisor / snapshot-result integrationの判断。
- `CONTRIBUTING.md` — ポリシー更新時のルール。
- `LICENSE` — MIT License。

## Purpose

このポリシーは、巨大な `AGENTS.md` を生成するためのものではありません。

初期化時に実際のリポジトリを調査し、次をproject-localに構成することを目的とします。

- concise root agent instructions
- Agent Skills
- 必要最小限のplugin / LSP / CLI / MCP / agent protocol
- isolated multi-agent execution environment
- Supervisor / subagent integration
- reproducible sandbox bootstrap
- deterministic quality gates
- test / coverage
- architecture / ADR workflow
- Git / GitHub / CI/CD / release rules
- environment configuration

基本思想は次です。

> Gitをcanonical source of truthとする + mutable execution stateをagentごとに隔離する + immutable snapshot/resultで委譲する + supervisor経由でagent lifecycleを管理する + deterministic verificationを最大化する + project-local reproducibility + progressive disclosure + 論理的に安全な最大並列化

## Multi-agent execution model

標準モデルは次です。

```text
Human / caller
    │
    ▼
Root Coordinator
    │
    ▼
Agent Supervisor
    ├─ Sandbox A -> Worker A
    ├─ Sandbox B -> Worker B
    ├─ Sandbox C -> Reviewer C
    └─ Sandbox D -> Child Worker D
```

重要な不変条件:

- 1 implementation worker = 1 isolated mutable runtime
- worktree単体をexecution isolationとみなさない
- 同じ内部portを各sandboxで使ってよい
- DB / Redis / queue / runtime stateをworker間で共有しない
- parent -> child はimmutable snapshot
- child -> parent はimmutable commit/ref/diff
- top-level taskは独立branch / PRへ統合
- 複数agentが同じworking tree / Git index / branchを同時更新しない
- Supervisorはworker sandboxの外側でlifecycleとcredentialを管理

Git worktree自体は禁止ではありません。既にisolatedなsandbox内部のGit実装詳細として利用できますが、worktreeだけでport/process/database等が分離されたとは扱いません。

## Usage

新規または既存projectで、通常の `/init` 相当処理と同時に `PROMPT.ja.md` または `PROMPT.en.md` を渡してください。

full promptを読むのは、初回初期化と、Agent Skills / adapter / runtime policyの再構成時だけです。通常タスクでは、初期化で生成されたproject-local `AGENTS.md` とAgent Skills / adaptersを使用してください。

初期化agentは全文をroot agent fileへコピーせず、projectを調査して:

- always-on invariants -> root agent file
- conditional workflows -> Agent Skills
- long-lived decisions -> ADR
- reproducible tools/runtime -> project-local configuration

へ分解します。

再実行はidempotent reconciliationとして扱い、正しい状態なら変更しないことも正常です。

## Important policy choices

- Global plugin/configurationは原則使用せずproject scope前提。
- Git remote / canonical refをSoTとし、local directoryをSoTにしない。
- implementation workerごとにisolated mutable runtimeを使用。
- worktree-only isolationは禁止。sandbox内部実装としてのworktreeは許可。
- subagent lifecycleはSupervisor/control plane経由で管理。
- nested delegationはimmutable snapshot/resultを使用。
- top-level taskはPR-oriented integration。
- source codeは英語、内部開発文書は日本語、Git/GitHub messageは英語。
- Bun / ripgrepを標準利用。
- 新規Python scriptは禁止。
- formatter / lint / type-check / static analysis / build / 全適用test / coverage等をcompletion gateにする。
- coverageは原則80%以上。
- explicit official recommended architectureが存在するplatformでは原則準拠。
- designが存在する場合はdesign-first。
- significant architecture/tooling/runtime decisionsはADRへ永続化。
- actual dotenvは `.env` / `.env.development` / `.env.production` のみ。
- temporary verification filesは `.tmp/`。
- external reference repositoriesは `.reference/`。
- new container definitionは `Containerfile`。
- CI/CDは原則GitHub Actions。

## Time-sensitive policy

Codexのmodel別role allocationは `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` をcanonical sourceとします。

model lineup、pricing、availability、subagent behavior、model routing、native sandbox capability等が変化した場合はrole文書pairを再評価し、長期decisionが変わる場合はADRも更新してください。

## Updating

ポリシーの変更は `CONTRIBUTING.md` に従ってください。

設計思想や互換性を変える変更は新しいADRを追加し、以前のADRとの前後参照を維持してください。
