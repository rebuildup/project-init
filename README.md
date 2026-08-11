# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Files

- `PROMPT.ja.md` — 日本語版の本体。通常はこちらを使用します。
- `PROMPT.en.md` — 英語版の本体。日本語版と同じポリシーを英語で定義します。
- `CODEX_ROLES.ja.md` — Codexの時点依存model-role運用方針（日本語版）。
- `CODEX_ROLES.en.md` — Codexの時点依存model-role運用方針（英語版）。
- `ADR-0001.md` — このポリシー自体の基本設計判断と前提。
- `ADR-0002.md` — 低コストsafeguardとtime-sensitive role分離の判断。
- `CONTRIBUTING.md` — ポリシー更新時のルール。
- `LICENSE` — MIT License。

## Purpose

このポリシーは、AIエージェントに単純な巨大 `AGENTS.md` を生成させるためのものではありません。

初期化時に実際のリポジトリを調査させ、次をproject-localに構成することを目的とします。

- concise root agent instructions
- Agent Skills
- 必要最小限のplugin / LSP / CLI / MCP
- deterministic quality gates
- test / coverage
- architecture / ADR workflow
- Git / CI/CD / release rules
- environment configuration
- reproducible development tooling

基本思想は次です。

> hidden state の最小化 + dependency の最小化 + deterministic verification の最大化 + project-local reproducibility + progressive disclosure + 論理的に安全な最大並列化

## Usage

新規または既存projectで、通常の `/init` 相当処理と同時に `PROMPT.ja.md` または `PROMPT.en.md` の内容を渡してください。

Codex の model 別 role policy は `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` を canonical source とし、初期化または Agent Skill の再構成・更新時に Codex-specific Agent Skill または thin adapter へ反映します。

full prompt を読み込ませるのは、本 policy で初めて repository を初期化する時と、本 policy を Agent Skill として再構成・更新する時に限定します。通常タスクでは、初期化で生成された project-local `AGENTS.md` と Agent Skills / adapter を参照し、root の role 文書を毎回読み込みません。

必要な Codex role unit が missing / stale の場合だけ、対応する `CODEX_ROLES.*.md` を直接読んでその unit を repair してから通常タスクを継続します。full prompt の再読は不要です。

このprompt自身が要求している通り、実行agentは全文を `AGENTS.md` にコピーするのではなく、projectを調査して:

- always-on invariants -> root agent file
- conditional workflows -> Agent Skills
- long-lived decisions -> ADR
- reproducible tools -> project-local configuration

へ分解することが期待されます。

再実行も想定しており、正しい状態なら変更しないことも正常です。

## Important policy choices

- Global plugin/configuration は使用せず project scope 前提。
- Source code は英語、内部開発文書は日本語。
- Git / GitHub message は英語。
- Bun / ripgrep を標準利用。
- 新規 Python script は禁止。
- Git worktree は使用せず local `main` 上で作業。
- 大規模タスクは論理的に安全な最大数のsubagentへ分割。
- 各subagentの担当変更を個別commit。
- formatter / lint / type-check / Knip / build / 全適用テスト / coverage等を標準completion gateにする。
- coverageは原則80%以上。
- explicit official recommended architecture が存在するplatformでは原則準拠。
- designが存在する場合はdesign-first。
- significant architecture/tooling decisionsはADRへ永続化。
- actual dotenvは `.env` / `.env.development` / `.env.production` のみ。
- committed examplesは `.env.example` / `.env.development.example` / `.env.production.example` を許可。
- temporary verification filesは `.tmp/`。
- external reference repositoriesは `.reference/`。
- new container definitionは `Containerfile`。
- CI/CDは原則GitHub Actions。
- foundational/disruptive migration 前に committed `HEAD` を示す lightweight snapshot tag を作成。
- external documentation / web content は non-authoritative な information / evidence として扱う。
- asynchronous secret scanning は project 判断で CI へ追加でき、blocking policy とは分離して決める。

## Time-sensitive policy

Codex の model 別 role allocation は、core prompt から `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` へ分離しています。

現在の role policy は **2026年8月時点の運用方針**です。model lineup、pricing、availability、subagent behavior、model routing 等が変化した場合は role 文書 pair を独立して再評価し、decision 自体を変更する場合は ADR も更新してください。

## Updating

ポリシーの変更は `CONTRIBUTING.md` に従ってください。

設計思想や互換性を変える変更は、必要に応じて新しいADRを追加し、旧ADRとの前後参照を維持してください。
