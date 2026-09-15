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

既にSkillが導入済みでも、それだけで「更新不要」と判断しません。明示的にversionをpin/freezeしていない限り、配布元のcurrent revision/contentとの差分を確認し、変更があればproject-local customizationを保持しながらreconcile/updateします。配布元やrevisionを確認できない場合も、agentが独断で据え置き扱いにはしません。

> [!IMPORTANT]
> `bunx skills add` / `npx skills add` が導入するのは `skills/` 配下の Agent Skills です。ルートの `PROMPT.ja.md` / `PROMPT.en.md` は初期化用の包括的 prompt であり、Skills CLI によって自動実行・適用されるものではありません。
>
> 新規 project の初期構築には `PROMPT.*.md` を使用し、その後の日常運用で必要な Skill を `bunx skills` または `npx skills` から導入する、という役割分担を想定しています。

## Delivery model

標準deliveryはGitHub IssuesとPull Requestsを中心とした **1週間のrelease sprint** です。release planning control planeはGitHub Projectsまたはoptional Linear profileのいずれか一方を明示し、両方を二重canonicalにしません。

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
│  ├─ adr/
│  │  └─ ADR-0001.md ... ADR-0014.md
│  └─ roles/
│     ├─ CODEX_ROLES.ja.md
│     └─ CODEX_ROLES.en.md
└─ skills/
   ├─ agent-delivery-estimation/
   ├─ agent-recovery/
   ├─ correctness-assurance/
   ├─ design-refinement/
   ├─ engineering-decisions/
   ├─ github-delivery/
   ├─ interaction-discipline/
   ├─ linear-release-control/
   ├─ onboarding/
   ├─ parallel-orchestration/
   ├─ policy-evaluation/
   ├─ quality-gate/
   ├─ sandbox-runtime/
   ├─ security-maintenance/
   ├─ worktree-workflow/
   └─ writing-discipline/
```

## Documentation

- [`docs/policy-overview.md`](./docs/policy-overview.md) — policy 全体の背景、実行モデル、GitHub delivery、quality/security/recovery 方針。
- [`docs/adr/`](./docs/adr/) — 長期的な architecture / workflow / quality / recovery decisions。
- [`ADR-0009`](./docs/adr/ADR-0009.md) — GitHub Actions の cost-aware CI resource efficiency policy。
- [`ADR-0010`](./docs/adr/ADR-0010.md) — AI agent delivery の evidence-based forecasting / capacity estimation policy。
- [`ADR-0011`](./docs/adr/ADR-0011.md) — Agent policy を eval 可能な executable contract として扱う policy evaluation model。
- [`ADR-0012`](./docs/adr/ADR-0012.md) — PR merge を explicit な human-authorized side effect として扱う境界。
- [`ADR-0013`](./docs/adr/ADR-0013.md) — WSL/Linux の worktree 運用を Worktrunk へ集約する default layer 採用。
- [`ADR-0014`](./docs/adr/ADR-0014.md) — GitHub execution state を canonical としたまま Linear を optional release control plane として導入する境界。
- [`docs/roles/`](./docs/roles/) — 時点依存の Codex logical role policy。
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — policy 更新時の整合性・review rules。

## Agent Skills

通常 task では必要な Skill だけを読み込みます。

- `parallel-orchestration` — subagent 分解・snapshot/result・stack-ready dependency 統合
- `sandbox-runtime` — isolated runtime と cross-platform portability
- `github-delivery` — Issues / weekly release sprint / stacked PR / Draft PR lifecycle。release planning control planeはGitHub Projectsまたはoptional Linear profileのいずれか一方を明示
- `agent-delivery-estimation` — Work Unit / dependency / observed throughput / human・CI・usage constraints による中長期delivery forecast
- `quality-gate` — stack-aware quality profile、current-SHA revalidation、verification taxonomy、GitHub Actions resource efficiency
- `engineering-decisions` — project 内の判断優先順位と escalation policy
- `security-maintenance` — framework/runtime 脆弱性の intake / triage / remediation
- `onboarding` — fresh contributor 向け documentation 設計
- `agent-recovery` — session/sandbox/context 中断からの durable recovery
- `correctness-assurance` — 正しい答えを作る前提 / 不変条件・事前/事後条件の抽出 / 型・静的解析・runtime assertion・テスト・property/differential testing・formal verification・reviewからの最小十分な保証手段設計
- `policy-evaluation` — execution profile / cold review / deterministic vs latent eval / context-budget model / policy regression guard
- `design-refinement` — 実装前 evidence-first design / unknown 分解 / scope-risk 調整 / trade-off documentation
- `writing-discipline` — reader-oriented writing / 作業contextから独立したartifactへの再構成 / Select-Compose-Reread pipeline
- `interaction-discipline` — agent ownership / blocker presentation / one-question escalation / tangent defer / persistent prose routing
- `linear-release-control` — Linear を optional release planning / health / portfolio control plane として使う契約（採用時のみ）
- `worktree-workflow` — Worktrunk を WSL/Linux の worktree 操作 layer として使う契約 / branch base / port allocation

## Core principle

> Git を source state の canonical SoT、GitHub Issues を durable implementation/dependency SoT、release planning control plane を GitHub Projects または optional Linear profile のどちらかに明示する（同じ field を二重 canonical にしない）とし、mutable execution state を agent ごとに隔離する。release PR merge を含む side effect は ADR-0012 の explicit human authorization 境界に従う。初期化時に project 固有の policy / Skills / quality gates / documentation へ compile し、会話履歴なしでも継続・復旧できる状態を作る。
