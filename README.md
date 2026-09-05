# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Files

- `PROMPT.ja.md` — 日本語版の初期化prompt本体。
- `PROMPT.en.md` — 英語版。同じoperational semanticsを定義。
- `skills/parallel-orchestration/SKILL.md` — subagent分解・snapshot/result統合。
- `skills/sandbox-runtime/SKILL.md` — isolated runtimeとmacOS / WSL/Linux portability。
- `skills/github-delivery/SKILL.md` — Issues / Projects / Sprint / branch / Draft PR / merge運用。
- `skills/quality-gate/SKILL.md` — deterministic completion gate。
- `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` — 時点依存のCodex logical role policy。
- `ADR-0001.md` — project-local / progressive disclosure / deterministic verification等の基本判断。
- `ADR-0002.md` — 低コストsafeguardとtime-sensitive role分離。
- `ADR-0003.md` — isolated multi-agent execution / Supervisor / snapshot-result integration。
- `ADR-0004.md` — GitHub ticket-driven agile deliveryとcross-platform local runtime。
- `CONTRIBUTING.md` — policy更新ルール。

## Purpose

このpolicyは巨大な `AGENTS.md` を作るためのものではありません。

初期化時だけ包括的なpromptでprojectを調査し、日常運用では短いroot contract + Agent Skillsへcompileすることを目的とします。

構築対象:

- concise root agent instructions
- short Agent Skills
- isolated multi-agent execution
- Supervisor / subagent integration
- macOS / Windows+WSL / Linuxで再現可能なruntime
- GitHub Issues / Projects / Pull Requestsによるticket-driven agile workflow
- deterministic quality gates
- architecture / ADR / CI/CD / release rules

基本思想:

> Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork stateのcanonical SoTとする + mutable execution stateをagentごとに隔離する + immutable snapshot/resultで委譲する + Supervisor経由でagent lifecycleを管理する + Issue/PR単位で統合する + deterministic verification + progressive disclosure + 最大安全並列化

## Execution model

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

主要不変条件:

- 1 implementation worker = 1 isolated mutable runtime
- worktree単体をexecution isolationとみなさない
- 同じ内部portを各sandboxで使用可能
- DB / Redis / queue / runtime stateをworker間で共有しない
- parent -> child はimmutable snapshot
- child -> parent はimmutable commit/ref/diff
- 複数agentが同じworking tree / Git index / integration branchを同時更新しない
- Supervisorはworker sandbox外でlifecycle / budget / credentialを管理

## Local development targets

第一級target:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandbox

portable Web/backend taskはmacOSでもWindows/WSLでも可能な限り同じLinux sandbox definitionで実行し、CI/remoteとの差を減らします。

Apple Siliconでは`arm64`を第一級architectureとして扱い、x86_64 CI/remoteとの差を必要に応じて検証します。

WSL自体はworker isolationではありません。複数workerをWSL内で動かす場合も各workerにcontainer/VM/sandbox boundaryを設けます。

Docker Desktopは必須前提にしません。

## GitHub agile delivery

標準ライフサイクル:

```text
Sprint / Release Goal
        ↓
GitHub Issue
        ↓
Project: Ready
        ↓
issue/<number>-<slug>
        ↓
Draft PR
        ↓
Isolated parallel workers
        ↓
Integration + CI + Review
        ↓
Ready for review
        ↓
Merge
        ↓
Issue close + Project: Done
```

原則:

- durable planning unitはGitHub Issue
- short-lived nested subtaskはSupervisor taskでよい
- GitHub Project/Kanbanは `Backlog -> Ready -> In Progress -> In Review -> Done`
- 1 top-level Issue = 1 integration branch = 1 PRを基本とする
- canonical branch format: `issue/<issue-number>-<short-slug>`
- meaningfulな最初のcommit後、可能な限り早くDraft PRを開く
- Draft PRをCI / progress / reviewer context / discussionのdurable integration surfaceとして使う
- acceptance criteriaとintegration gateを満たしてからReady for reviewへ移す
- merge + Issue close + board updateをDone boundaryとする

## Progressive disclosure

full promptを読むのは初回初期化とpolicy再構成時だけです。

通常taskではroot `AGENTS.md` 等から必要なSkillだけを読みます。

標準Skill:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`

project固有のarchitecture / UI / release / debugging等は必要に応じて追加します。

## Important policy choices

- Global plugin/configurationは原則使用せずproject scope前提。
- local directoryではなくGit remote/refをsource SoTとする。
- GitHub Issues / Projectsをdurable work SoTとする。
- implementation workerごとにisolated mutable runtimeを使用。
- worktree-only isolationは禁止。sandbox内部実装としてのworktreeは許可。
- nested delegationはimmutable snapshot/resultを使用。
- source codeは英語、内部開発文書は日本語、Git/GitHub messageは英語。
- Bun / ripgrepを標準利用。
- 新規Python scriptは禁止。
- formatter / lint / type-check / static analysis / build / test / coverage等をcompletion gateにする。
- coverageは原則80%以上。
- significant architecture/tooling/runtime/workflow decisionsはADRへ永続化。
- temporary verification filesは `.tmp/`、external reference repositoriesは `.reference/`。
- new container definitionは `Containerfile`。
- CI/CDは原則GitHub Actions。

## Usage

新規または既存projectで通常の `/init` 相当処理と同時に `PROMPT.ja.md` または `PROMPT.en.md` を渡してください。

初期化agentは全文をroot agent fileへコピーせず:

- always-on invariants -> root agent file
- conditional workflows -> Agent Skills
- long-lived decisions -> ADR
- reproducible runtime/tools -> project-local configuration
- durable work workflow -> GitHub Issues / Projects / PR configuration

へ分解します。

再実行はidempotent reconciliationとして扱い、正しい状態なら変更しないことも正常です。
