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
- official architecture guidance優先を弱めていないか
- user-requested scopeを独自MVPへ縮小する余地を増やしていないか
- hidden state / unrecoverable local stateを増やしていないか
- macOS / Apple Silicon、Windows+WSL、Linux/NixOSのportabilityを壊していないか
- WSL自体をworker isolationとして扱っていないか
- `.env` / `.tmp/` / `.reference/` のpolicyと矛盾しないか
- canonical Git remote/refをsource SoTとして維持しているか
- GitHub Issues / Projectsをdurable work SoTとして維持しているか
- implementation workerごとのexecution isolationを弱めていないか
- worktree単体をisolation boundaryとして再導入していないか
- parent/child delegationがimmutable snapshot/resultで表現できるか
- Supervisor外のworkerへhost-level sandbox管理権限を渡していないか
- Issue -> branch -> Draft PR -> Ready -> merge -> Done lifecycleを壊していないか
- Issue番号付きbranch namingを維持しているか
- multi-agent parallelismがdependency graph、WIP、resource limitsに基づいているか

## Multi-agent policy invariants

canonical execution modelはADR-0003、delivery / cross-platform modelはADR-0004です。

主要不変条件:

- Git remote / canonical refがsource SoT
- GitHub Issues / Projectsがdurable work SoT
- 1 implementation worker = 1 isolated mutable runtime
- worktree-only isolationは禁止
- immutable/cacheable stateのみ共有し、mutable runtime stateは隔離
- parent -> childはimmutable snapshot
- child -> parentはimmutable commit/ref/diff
- Supervisorがsandbox/agent lifecycle、budget、credential、integrationを管理
- workerが同じworking tree / Git index / integration branchを同時更新しない
- durable top-level workはIssueで管理
- 1 top-level Issue = 1 integration branch = 1 PRを基本とする
- canonical branch formatは `issue/<issue-number>-<short-slug>`
- meaningful initial commit後にDraft PRを早期作成
- nested workerはephemeral refs/commitsで統合可能
- merge + Issue close + Project Doneを標準Done boundaryとする

これらを変更する場合はADRを追加してください。

## Progressive disclosure

初期化promptは包括的で構いませんが、通常taskで毎回全文を読ませる構成へ戻してはいけません。

標準Skill:

- `skills/parallel-orchestration/SKILL.md`
- `skills/sandbox-runtime/SKILL.md`
- `skills/github-delivery/SKILL.md`
- `skills/quality-gate/SKILL.md`

Skillは短いtriggerと主要責務を持ち、必要なworkflowだけをcontextへ入れる構成にしてください。

## GitHub workflow for this repository

このrepository自身も可能な限りpolicyをdogfoodします。

### Issue

substantial policy changeはIssueを作成し、objective / acceptance criteria / scopeを明記してください。

### Branch

canonical format:

`issue/<issue-number>-<short-slug>`

### Pull Request

意味のある最初のcommit後、早期にDraft PRを開いてください。

Draft PR本文には最低限:

- linked Issue / `Closes #<id>`
- change summary
- motivation
- affected ADRs
- validation status
- known blockers

を含めます。

Ready for reviewへ移す前にJP/EN整合、ADR/README/Skill整合、Markdown構造、conflicting rulesを確認してください。

## Time-sensitive rules

次は時点依存です。

- Codex model lineup / pricing / role allocation
- native subagent / sandbox behavior
- plugin / MCP / ACP / Agent Skills ecosystem
- sandbox/runtime/provider ecosystem
- macOS / WSL / Linux local runtime options
- framework recommended architecture
- testing / linting / dependency-analysis tools

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
- Draft PR / branch naming lifecycleを変更
- cross-platform runtime strategyを変更
- source/document language policyを変更
- Python script禁止を変更
- standard quality gateを緩和
- coverage thresholdを変更
- Codex model-role strategyを変更
- Agent Skills以外を主要detail-disclosure mechanismに変更

以前のADRをrevise / supersedeする場合:

- 新ADRから旧ADRを参照
- 旧ADRから新ADRを参照
- 変更されたdecision範囲を明示

してください。

## Git messages

このrepository自体でもGit / GitHub messageは英語を使用してください。

commit format:

`<prefix>: <very concise title>`

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
- Issue-numbered branch / Draft PR lifecycleが一貫していること

を確認してください。
