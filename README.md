# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Files

- `PROMPT.ja.md` — 日本語版の本体。通常はこちらを使用します。
- `PROMPT.en.md` — 英語版の本体。日本語版と同じポリシーを英語で定義します。
- `ADR-0001.md` — このポリシー自体の設計判断と前提。
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

## Time-sensitive section

Codexの `Sol / Terra / Luna` 役割分担は **2026年8月時点の運用ポリシー**です。

2026年8月時点のOpenAIの公開上の位置づけでは:

- Sol: flagship / most capable
- Terra: balanced capability, speed, and cost
- Luna: fastest and lowest-cost

という性質があるため、本ポリシーではそれぞれ coordinator、reviewer、implementation worker として使い分ける方針を採用しています。

これはモデルの公式な職務定義ではありません。モデル構成・pricing・routingが変化した場合は見直してください。

## Updating

ポリシーの変更は `CONTRIBUTING.md` に従ってください。

設計思想や互換性を変える変更は、必要に応じて新しいADRを追加し、旧ADRとの前後参照を維持してください。
