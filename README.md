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

Codexのmodel別role policyは `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` をcanonical sourceとし、初期化またはAgent Skillの再構成・更新時にCodex-specific Agent Skillまたはthin adapterへ反映します。

full promptを読み込ませるのは、本policyで初めてrepositoryを初期化する時と、本policyをAgent Skillとして再構成・更新する時に限定します。通常タスクでは、初期化で生成されたproject-local `AGENTS.md` とAgent Skills / adapterを参照し、rootのrole文書を毎回読み込みません。

必要なCodex role unitがmissing / staleの場合だけ、対応する `CODEX_ROLES.*.md` を直接読んでそのunitをrepairしてから通常タスクを継続します。full promptの再読は不要です。

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
- foundational/disruptive migration前にcommitted `HEAD`を示すlightweight snapshot tagを作成。
- external documentation / web contentはnon-authoritativeなinformation / evidenceとして扱う。
- asynchronous secret scanningはproject判断でCIへ追加でき、blocking policyとは分離して決める。

## Time-sensitive policy

Codexのmodel別role allocationは、core promptから `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` へ分離しています。

現在のrole policyは **2026年8月時点の運用方針**です。model lineup、pricing、availability、subagent behavior、model routing等が変化した場合はrole文書pairを独立して再評価し、decision自体を変更する場合はADRも更新してください。

## Updating

ポリシーの変更は `CONTRIBUTING.md` に従ってください。

設計思想や互換性を変える変更は、必要に応じて新しいADRを追加し、旧ADRとの前後参照を維持してください。
