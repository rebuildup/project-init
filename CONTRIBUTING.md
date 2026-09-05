# Contributing

このrepositoryはAI coding agent初期化ポリシーそのものを管理します。

## 基本方針

変更時は `PROMPT.ja.md` と `PROMPT.en.md` のoperational semanticsを一致させてください。

日本語版をprimary specificationとして扱って構いませんが、release/merge前に英語版へ同じ意味を反映してください。

`CODEX_ROLES.ja.md` と `CODEX_ROLES.en.md` もrole policyを変更する場合は同一変更で同期してください。

通常task向けSkillを変更する場合は、full prompt / README / ADRと意味が矛盾しないようにしてください。

## 変更時に確認すること

- project-local原則を弱めていないか
- root agent fileへ詳細ルールを詰め込む方向へ戻っていないか
- Skillによるprogressive disclosureを維持しているか
- deterministic verificationを主観的判断へ置き換えていないか
- quality gateを固定bundleへ戻していないか
- framework/runtimeのcurrent official quality/testing guidanceを無視していないか
- local validationとGitHub Actionsのsemanticsが乖離していないか
- official architecture guidance優先を弱めていないか
- user-requested scopeを独自MVPへ縮小する余地を増やしていないか
- hidden state / unrecoverable local stateを増やしていないか
- macOS / Apple Silicon、Windows+WSL、Linux/NixOSのportabilityを壊していないか
- WSL自体をworker isolationとして扱っていないか
- `.env` / `.tmp/` / `.reference/` のpolicyと矛盾しないか
- canonical Git remote/refをsource SoTとして維持しているか
- GitHub Issues / Projectsをdurable work SoTとして維持しているか
- `main`をreleased source stateとして維持しているか
- sprintとtarget release versionが1:1で対応しているか
- `release-x-y-z`をsprint integration branchとして維持しているか
- ticket branchがIssue番号だけになっているか
- implementation workerごとのexecution isolationを弱めていないか
- worktree単体をisolation boundaryとして再導入していないか
- parent/child delegationがimmutable snapshot/resultで表現できるか
- Supervisor外のworkerへhost-level sandbox管理権限を渡していないか
- ticket Draft PR -> release branch -> release PR -> main lifecycleを壊していないか
- multi-agent parallelismがdependency graph、WIP、resource limitsに基づいているか

## Multi-agent policy invariants

canonical execution modelはADR-0003、delivery / cross-platform modelはADR-0004、adaptive quality modelはADR-0005です。

主要不変条件:

- Git remote / canonical refがsource SoT
- GitHub Issues / Projectsがdurable work SoT
- `main` = released/integrated source state
- 1 sprint = 1 target semantic version
- sprint integration branch = `release-<major>-<minor>-<patch>`
- 1 top-level Issue = 1 number-only ticket branch = 1 ticket PR
- ticket branch canonical format = `<issue-number>`
- ticket PR base = target release branch
- meaningful initial commit後にDraft PRを早期作成
- ticket PR merge + Issue close + Project Done = ticket Done boundary
- release-wide validation後 `release-x-y-z -> main` をmerge = release completion
- 1 implementation worker = 1 isolated mutable runtime
- worktree-only isolationは禁止
- immutable/cacheable stateのみ共有し、mutable runtime stateは隔離
- parent -> childはimmutable snapshot
- child -> parentはimmutable commit/ref/diff
- Supervisorがsandbox/agent lifecycle、budget、credential、integrationを管理
- workerが同じworking tree / Git index / durable ticket branchを同時更新しない
- nested workerはephemeral refs/commitsで統合可能
- quality gateはprojectの実stackとcurrent official guidanceからcompileする
- worker / integration / release gateを分離する
- GitHub Actionsはproject-local deterministic commandsと同じsemanticsを持つ
- coverage等のmetricはproject-specific signalとして設計し、固定数値を盲目的に全projectへ適用しない

これらを変更する場合はADRを追加してください。

## Progressive disclosure

初期化promptは包括的で構いませんが、通常taskで毎回全文を読ませる構成へ戻してはいけません。

標準Skill:

- `skills/parallel-orchestration/SKILL.md`
- `skills/sandbox-runtime/SKILL.md`
- `skills/github-delivery/SKILL.md`
- `skills/quality-gate/SKILL.md`

Skillは短いtriggerと主要責務を持ち、必要なworkflowだけをcontextへ入れる構成にしてください。

### Quality Skill

`quality-gate` Skillは固定check listではなく、初期化時にproject-specific quality profileをcompileする責務も持ちます。

stack/framework/runtimeの変更に追従して、必要なら以下を追加・修復します。

- formatter / lint / static analysis
- compiler / type-check
- unit/component/integration/E2E testing
- framework/platform-specific validation
- project-local validation commands
- GitHub Actions
- CI matrix / artifact / report
- specialized quality Agent Skills

公式documentationやfirst-party examplesを優先し、existing projectと重複するtoolを理由なく増やさないでください。

## GitHub workflow for this repository

このrepository自身も可能な限りpolicyをdogfoodします。

### Release branch

sprint開始時にtarget versionを決め、`main` からrelease branchを作成します。

canonical format:

`release-<major>-<minor>-<patch>`

例:

`release-0-1-0`

### Issue

substantial policy changeはIssueを作成し、目的 / acceptance criteria / scopeを日本語で明記してください。

### Ticket branch

canonical format:

`<issue-number>`

例:

`2`

`issue/` prefix、slug、title等は付けません。

### Ticket Pull Request

意味のある最初のcommit後、ticket branchからtarget release branchへ早期にDraft PRを開いてください。

PR title/body/review discussionは日本語を標準とします。

Draft PR本文には最低限:

- linked Issue / `Closes #<id>`
- 変更概要
- 目的
- affected ADRs
- validation status
- known blockers
- target release

を含めます。

Ready for reviewへ移す前にJP/EN整合、ADR/README/Skill整合、Markdown構造、conflicting rules、target release branchとのstalenessを確認してください。

### Release Pull Request

sprint対象ticketが統合されrelease-level verificationを通過したら:

`release-x-y-z -> main`

のPRを作成します。

release PR title/bodyは日本語で、release goal、含まれるIssue/PR、validation、migration/breaking changeをまとめてください。

## Language policy

- source code: 英語
- commit message: 英語
- internal development docs: 日本語
- GitHub Issue title/body: 日本語
- PR title/body/review discussion: 日本語
- branch: identifier/versionのみ

commit format:

`<prefix>: <very concise title>`

## Time-sensitive rules

次は時点依存です。

- Codex model lineup / pricing / role allocation
- native subagent / sandbox behavior
- plugin / MCP / ACP / Agent Skills ecosystem
- sandbox/runtime/provider ecosystem
- macOS / WSL / Linux local runtime options
- framework recommended architecture
- framework/runtime official quality/testing guidance
- testing / linting / dependency-analysis tools
- GitHub Actions official guidance / first-party actions / security practices

更新時はcurrent official sourceを確認してください。

## ADR

長期的な設計思想を変える変更はADR対象です。

例:

- project-local以外のscopeを標準化
- canonical Git/GitHub SoT modelを変更
- worktree-only isolationを許可
- Supervisor architectureを変更
- immutable snapshot/result protocolを変更
- Issue/Project/PR delivery modelを変更
- release branch/sprint modelを変更
- ticket branch namingを変更
- cross-platform runtime strategyを変更
- source/document/GitHub language policyを変更
- Python script禁止を変更
- adaptive quality-gate compiler modelを変更
- local/CI quality semanticsを変更
- coverage policyを固定universal thresholdへ戻す
- Codex model-role strategyを変更
- Agent Skills以外を主要detail-disclosure mechanismに変更

以前のADRをrevise / supersedeする場合:

- 新ADRから旧ADRを参照
- 旧ADRから新ADRを参照
- 変更されたdecision範囲を明示

してください。

## Validation

変更後は最低限:

- `PROMPT.ja.md` と `PROMPT.en.md` のmajor section対応
- role policy変更時の `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` 意味同値性
- full promptと4つの標準Skillのoperational semantics整合
- broken Markdown structureがないこと
- conflicting rulesがないこと
- ADR reference整合性
- READMEの説明とprompt/Skill本体の一致
- old shared-main / worktree-only assumptionsがcanonical ruleとして残っていないこと
- parent/child snapshot/result semanticsが一貫していること
- macOS / WSL/Linux portability policyが一貫していること
- `release-x-y-z` / number-only ticket branch / Draft PR lifecycleが一貫していること
- Issue/PR language policyが一貫していること
- quality gateがframework/runtime固有にcompileされること
- worker/integration/release gateが区別されていること
- GitHub Actionsがcurrent official guidanceとproject-local commandsに整合すること

を確認してください。
