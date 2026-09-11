# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent 環境構築用のポリシーです。

## Usage

### Initialization prompt

新規または既存 project で通常の `/init` 相当処理と同時に、用途に応じて次の prompt を渡してください。

- [`PROMPT.ja.md`](./PROMPT.ja.md) — 日本語版。primary specification。
- [`PROMPT.en.md`](./PROMPT.en.md) — 英語版。同じ operational semantics を定義。

初期化時だけ包括的な prompt で repository を調査し、日常運用では短い root contract + project-local Agent Skills へ progressive disclosure することを目的とします。

### Install Agent Skills with `bunx skills` / `npx skills`

`skills/` 配下の Agent Skills は [`skills` CLI](https://github.com/vercel-labs/skills) から直接導入できます。

Bun を利用している場合は `bunx skills` を推奨します。Node.js / npm 環境では同じ引数を `npx skills` で実行できます。

利用可能な Skill を確認:

```bash
bunx skills add rebuildup/project-init --list
# or
npx skills add rebuildup/project-init --list
```

対話的に選択して current project へ導入:

```bash
bunx skills add rebuildup/project-init
# or
npx skills add rebuildup/project-init
```

特定の Skill だけを導入:

```bash
bunx skills add rebuildup/project-init --skill quality-gate
# or
npx skills add rebuildup/project-init --skill quality-gate
```

Codex を明示して導入:

```bash
bunx skills add rebuildup/project-init --agent codex
# or
npx skills add rebuildup/project-init --agent codex
```

全 Skill を Codex に導入:

```bash
bunx skills add rebuildup/project-init --skill '*' --agent codex
# or
npx skills add rebuildup/project-init --skill '*' --agent codex
```

`-g` / `--global` を付けると project-local ではなく user scope に導入できます。

> [!IMPORTANT]
> `bunx skills add` / `npx skills add` が導入するのは `skills/` 配下の Agent Skills です。ルートの `PROMPT.ja.md` / `PROMPT.en.md` は初期化用の包括的 prompt であり、Skills CLI によって自動実行・適用されるものではありません。
>
> 新規 project の初期構築には `PROMPT.*.md` を使用し、その後の日常運用で必要な Skill を `bunx skills` または `npx skills` から導入する、という役割分担を想定しています。

## Delivery model

標準deliveryはGitHub Issues / Projects / Pull Requestsを中心とした **1週間のrelease sprint** です。

- `main` = released/integrated source state
- `release-x-y-z` = 1週間のsprint / target version integration branch
- 1 top-level Issue = 1 number-only ticket branch = 1 ticket PR
- Issue dependency graph = canonical dependency SoT
- independent ticket PRはtarget release branchへ向ける
- same-releaseのlinear hard dependencyはstacked PRとしてpredecessor branchへ向けられる
- durable branchはfirst meaningful commit直後にDraft PRを必ず作成し、worker/subagentも例外にしない
- PR作成時にIssue linkage、assignee、reviewer/CODEOWNERS、repository-established labels、target release、stack contextを適切に設定する
- stack predecessor変更後はcurrent SHAでaffected validationを再実行する
- release branchに最初のmeaningful integrated differenceが入った直後にDraft release PRを開く
- tag-triggered publishを使う場合はtag version / authoritative project version / release SHAの整合を検証する

詳細は [`skills/github-delivery/SKILL.md`](./skills/github-delivery/SKILL.md)、[`ADR-0008`](./docs/adr/ADR-0008.md)、[`CONTRIBUTING.md`](./CONTRIBUTING.md) を参照してください。

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
│  ├─ audits/
│  │  └─ 2026-09-09-lost-rule-audit.md
│  ├─ adr/
│  │  └─ ADR-0001.md ... ADR-0010.md
│  └─ roles/
│     ├─ CODEX_ROLES.ja.md
│     └─ CODEX_ROLES.en.md
├─ evals/
│  └─ policy-evaluation/
└─ skills/
   ├─ agent-recovery/
   ├─ engineering-decisions/
   ├─ github-delivery/
   ├─ onboarding/
   ├─ parallel-orchestration/
   ├─ policy-evaluation/
   ├─ quality-gate/
   ├─ sandbox-runtime/
   └─ security-maintenance/
```

## Documentation

- [`docs/policy-overview.md`](./docs/policy-overview.md) — policy 全体の背景、実行モデル、GitHub delivery、quality/security/recovery 方針。
- [`docs/audits/2026-09-09-lost-rule-audit.md`](./docs/audits/2026-09-09-lost-rule-audit.md) — 初期版から現行版へのsemantic audit。意図的revisionとsilent lossを分類し、復元対象を追跡します。
- [`docs/adr/`](./docs/adr/) — 長期的な architecture / workflow / quality / recovery decisions。
- [`ADR-0009`](./docs/adr/ADR-0009.md) — GitHub Actions の cost-aware CI resource efficiency policy。
- [`ADR-0010`](./docs/adr/ADR-0010.md) — Agent policyをdeterministic checks + cold eval + grader controlsで検証する実行contract。
- [`evals/`](./evals/) — policy behaviorのcold scenario、deterministic grader、positive/negative/regression controls。
- [`docs/roles/`](./docs/roles/) — 時点依存の Codex logical role policy。
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — policy 更新時の整合性・review rules。

## Agent Skills

通常 task では必要な Skill だけを読み込みます。

- `parallel-orchestration` — subagent 分解・snapshot/result・stack-ready dependency 統合
- `policy-evaluation` — execution profile、deterministic/latent policy eval、cold review、context budget
- `sandbox-runtime` — isolated runtime と cross-platform portability
- `github-delivery` — Issues / Projects / weekly release sprint / stacked PR / Draft PR lifecycle / release version consistency
- `quality-gate` — stack-aware quality profile、current-SHA revalidation、dependency/static analysis、UI/rendered/deliverable verification、GitHub Actions resource efficiency
- `engineering-decisions` — project 内の判断優先順位、naming/design/ADR/dependency adoption、compatibility、trust/escalation policy
- `security-maintenance` — framework/runtime 脆弱性の intake / triage / remediation
- `onboarding` — fresh contributor 向け documentation、`.tmp/` / `.reference/` / env / `.gitignore` hygiene、fresh-clone audit
- `agent-recovery` — session/sandbox/context 中断からの durable recovery

## Policy integrity

このrepositoryでは、文書の大規模な再構成でline countが増えていてもoperational ruleが失われ得ることを前提にします。

policy sectionを削除・統合・Skillへ移動する場合は、各normative ruleについて **new canonical location / explicit revision / intentional removal** のいずれかを追跡できるようにし、どれにも該当しないsilent semantic deletionを許容しません。

2026-09-09のbaseline監査は [`docs/audits/2026-09-09-lost-rule-audit.md`](./docs/audits/2026-09-09-lost-rule-audit.md) を参照してください。

## Core principle

> Git を source state の canonical SoT、GitHub Issues / Projects を work/dependency state の canonical SoT とし、mutable execution state を agent ごとに隔離する。初期化時に project 固有の policy / Skills / quality gates / documentation へ compile し、会話履歴なしでも継続・復旧できる状態を作る。