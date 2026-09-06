# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent 環境構築用のポリシーです。

## Usage

新規または既存 project で通常の `/init` 相当処理と同時に、用途に応じて次の prompt を渡してください。

- [`PROMPT.ja.md`](./PROMPT.ja.md) — 日本語版。primary specification。
- [`PROMPT.en.md`](./PROMPT.en.md) — 英語版。同じ operational semantics を定義。

初期化時だけ包括的な prompt で repository を調査し、日常運用では短い root contract + project-local Agent Skills へ progressive disclosure することを目的とします。

## Repository layout

```text
.
├─ PROMPT.ja.md
├─ PROMPT.en.md
├─ README.md
├─ CONTRIBUTING.md
├─ LICENSE
├─ docs/
│  ├─ policy-overview.md
│  ├─ adr/
│  │  └─ ADR-0001.md ... ADR-0007.md
│  └─ roles/
│     ├─ CODEX_ROLES.ja.md
│     └─ CODEX_ROLES.en.md
└─ skills/
   ├─ agent-recovery/
   ├─ engineering-decisions/
   ├─ github-delivery/
   ├─ onboarding/
   ├─ parallel-orchestration/
   ├─ quality-gate/
   ├─ sandbox-runtime/
   └─ security-maintenance/
```

## Documentation

- [`docs/policy-overview.md`](./docs/policy-overview.md) — policy 全体の背景、実行モデル、GitHub delivery、quality/security/recovery 方針。
- [`docs/adr/`](./docs/adr/) — 長期的な architecture / workflow / quality / recovery decisions。
- [`docs/roles/`](./docs/roles/) — 時点依存の Codex logical role policy。
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — policy 更新時の整合性・review rules。

## Agent Skills

通常 task では必要な Skill だけを読み込みます。

- `parallel-orchestration` — subagent 分解・snapshot/result 統合
- `sandbox-runtime` — isolated runtime と cross-platform portability
- `github-delivery` — Issues / Projects / release sprint / Draft PR
- `quality-gate` — stack-aware quality profile と verification taxonomy
- `engineering-decisions` — project 内の判断優先順位と escalation policy
- `security-maintenance` — framework/runtime 脆弱性の intake / triage / remediation
- `onboarding` — fresh contributor 向け documentation 設計
- `agent-recovery` — session/sandbox/context 中断からの durable recovery

## Core principle

> Git を source state の canonical SoT、GitHub Issues / Projects を work state の canonical SoT とし、mutable execution state を agent ごとに隔離する。初期化時に project 固有の policy / Skills / quality gates / documentation へ compile し、会話履歴なしでも継続・復旧できる状態を作る。
