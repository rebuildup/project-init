# Contributing

このrepositoryはAI coding agent初期化ポリシーそのものを管理します。

## 基本方針

変更時は `PROMPT.ja.md` と `PROMPT.en.md` のoperational semanticsを一致させてください。

日本語版をprimary specificationとして扱って構いませんが、release/merge前に英語版へ同じ意味を反映してください。

`CODEX_ROLES.ja.md` と `CODEX_ROLES.en.md` もrole policyを変更する場合は同一変更で同期してください。

通常task向けSkillを変更する場合はfull prompt / README / ADRと意味が矛盾しないようにしてください。

## 変更時に確認すること

- project-local原則を弱めていないか
- root agent fileへ詳細ルールを詰め込む方向へ戻っていないか
- Skillによるprogressive disclosureを維持しているか
- deterministic verificationを主観的判断へ置き換えていないか
- unit / smoke / integration / contract / E2Eの責務が混同されていないか
- change riskからrequired verification levelを決めるmodelが維持されているか
- quality gateを固定bundleへ戻していないか
- framework/runtimeのcurrent official quality/testing guidanceを無視していないか
- local validationとGitHub Actionsのsemanticsが乖離していないか
- project-wide policy > design/spec/instruction > existing implementation majority のdecision precedenceを壊していないか
- project evidenceで解ける自明な判断をuserへ返す方向へ戻していないか
- user escalation boundaryを曖昧にしていないか
- framework/runtime security advisoryをofficial sourceから取得する方針を弱めていないか
- vulnerability priorityがseverityだけの機械判定に戻っていないか
- onboarding knowledgeがchat/private memory依存になっていないか
- documented commandがfresh environmentで再現可能か
- session/thread resumeを唯一のrecovery mechanismにしていないか
- unfinished workが会話履歴やSupervisor local DBだけに残らないか
- fresh agentがIssue/Project/PR/Git/checkpointからnext stepを再構成できるか
- stale execution generationが復帰後に同じticketへ書き込めないか
- parent agent failureでchild resultが失われないか
- timeout後のexternal side effectを無条件retryしないか
- recovery後に古いvalidation結果をcurrent codeへ流用していないか
- official architecture guidance優先を弱めていないか
- user-requested scopeを独自MVPへ縮小する余地を増やしていないか
- hidden state / unrecoverable local stateを増やしていないか
- macOS / Apple Silicon、Windows+WSL、Linux/NixOSのportabilityを壊していないか
- WSL自体をworker isolationとして扱っていないか
- `.env` / `.tmp/` / `.reference/` policyと矛盾しないか
- canonical Git remote/refをsource SoTとして維持しているか
- GitHub Issues / Projectsをdurable work SoTとして維持しているか
- `main`をreleased source stateとして維持しているか
- sprintとtarget release versionが1:1で対応しているか
- `release-x-y-z`をsprint integration branchとして維持しているか
- ticket branchがIssue番号だけになっているか
- implementation workerごとのexecution isolationを弱めていないか
- worktree単体をisolation boundaryとして再導入していないか
- parent/child delegationがimmutable snapshot/resultで表現できるか
- snapshot/resultがresolved commit SHA/content digestへpinされ、mutable refの再解決に依存していないか
- Supervisor外のworkerへhost-level sandbox管理権限を渡していないか
- ticket Draft PR -> release branch -> release PR -> main lifecycleを壊していないか
- release branch向けticket PRのmerge後にIssueを明示的にcloseする手順が維持されているか
- multi-agent parallelismがdependency graph、WIP、resource limitsに基づいているか

## Canonical ADRs

- ADR-0003: isolated multi-agent execution
- ADR-0004: release-version sprint / GitHub delivery / cross-platform runtime
- ADR-0005: adaptive stack-aware quality gate compilation
- ADR-0006: engineering decision hierarchy / verification taxonomy / security maintenance / onboarding
- ADR-0007: durable interruption recovery / execution fencing / side-effect reconciliation

これらのcanonical decisionを変更する場合はnew ADRまたは明示的revisionを追加してください。

## Multi-agent / delivery invariants

- Git remote / canonical ref = source SoT
- GitHub Issues / Projects = durable work SoT
- `main` = released/integrated source state
- 1 sprint = 1 target semantic version
- sprint integration branch = `release-<major>-<minor>-<patch>`
- 1 top-level Issue = 1 number-only ticket branch = 1 ticket PR
- ticket branch = `<issue-number>`
- ticket PR base = target release branch
- meaningful initial commit後にDraft PRを早期作成
- ticket PR merge後、non-default baseではclosing keywordに依存せずlinked Issueを明示的にcloseし、Project Doneへ移す = ticket Done
- release-wide verification後 `release-x-y-z -> main` merge = release completion
- 1 implementation worker = 1 isolated mutable runtime
- worktree-only isolationは禁止
- parent -> child = immutable snapshot
- child -> parent = immutable commit/diffまたはnever-moved ref
- snapshot/resultはresolved commit SHAまたはcontent-addressed digestを記録し、integration/materializationは記録済みimmutable identityを使用する
- mutable branch/refをsnapshot/result identityとして再解決しない。refが記録済みidentityと異なるtargetへ移動した場合は拒否する
- Supervisorがsandbox/agent lifecycle、budget、credential、integrationを管理

## Engineering decision invariants

開発判断の標準precedence:

1. project-wide policy / canonical architecture / invariant
2. design / specification / explicit task instruction
3. coherent existing implementation majority
4. current official framework/runtime/SDK guidance
5. ecosystem convention
6. local best judgment

project evidenceで実質一意に決まる、可逆・局所的なimplementation choiceはagent自身で決めて進めます。

userへ確認するのは、canonical source conflict、product semantics、public API、security/privacy risk acceptance、meaningful cost、release scope/date、irreversible operation、explicit design approval等、本物の意思決定が残る場合に限定します。

## Verification / quality invariants

`quality-gate` Skillは固定check listではなくproject-specific quality profile compilerです。

最低限のverification taxonomy:

- unit: local logic/component behavior
- smoke/connectivity: startup/wiring/basic connectivity/critical-path entry
- integration: multiple real components/boundaries
- contract/schema: API/event/DB/interface compatibility when meaningful
- E2E/system: user/system critical flow
- manual/visual: automation不足領域のみ明示的に使用

変更surface/riskから必要test levelを選択します。

worker / ticket integration / release gateを分離し、repository-controlled canonical quality profileとlocal deterministic entry point / GitHub Actionsのsemanticsを揃えます。

coverage等のmetricはproject-specific signalとして設計し、固定数値を盲目的に全projectへ適用しません。

## Security maintenance invariants

security source priority:

1. framework/runtime/SDK official security advisories
2. official release/security announcements
3. ecosystem official advisory source
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary source

priorityはseverityだけでなく、exploitability、project reachability、external exposure、required privilege、impact、fix availability、workaround quality、regression risk、release timingを評価します。

meaningful advisoryはGitHub Issueへ変換しtarget releaseを割り当てます。critical exposed vulnerabilityではpatch releaseを優先できます。

## Agent recovery invariants

- native conversation/thread/subagent resumeはoptimizationでありcanonical SoTではない
- fresh agentがchat historyなしでunfinished taskを再構成できる
- durable recovery sourcesはIssue / Project / PR / Git refs / committed docs / immutable results / structured checkpoint
- checkpointへprivate chain-of-thoughtやsecretを保存しない
- soft checkpointとprovider-lossに耐えるhard checkpointを区別する
- checkpointはtask identity / snapshot / completed / next / validation / children / side effects / blockersを表現できる
- parent model processではなくSupervisorがchild lifecycleを所有する
- recovery時にchild stateをreconcileし、stale resultを盲目的に統合しない
- mutable taskには初期値 `1` のexecution generationとlease/fencing tokenを持たせ、recovery時はcompare-and-set等で所有権を原子的に取得する
- stale generation/tokenのwrite/integrationを拒否し、external write直前にもcurrent tokenを再検証する
- external side effectは可能ならidempotency keyとdurable intent/resultを使用し、timeout後はremote actual stateを確認してからretryする
- validation resultはvalidated SHA/snapshotへpinし、current codeと完全一致しない古いgreen resultを流用しない
- context limit接近時はstructured handoffを作成してplanned recoveryへ移る
- project/runtimeが重要ならintentional recovery drillを実行できる

## Onboarding / documentation invariants

fresh contributor / new agentがchat historyやprivate memoryなしで次を実行できる状態を維持します。

- project purpose/scope理解
- architecture/boundary理解
- bootstrap / run / migrate / seed
- worker/integration/release validation
- Issue選択 / ticket branch / Draft PR
- ADR/design/Skills discovery
- troubleshooting
- release/security/recovery workflow

project規模に応じてREADME / CONTRIBUTING / docsへprogressive disclosureします。

documented commandsは可能な限りfresh sandbox/CIで検証します。

## Progressive disclosure

標準Skill:

- `skills/parallel-orchestration/SKILL.md`
- `skills/sandbox-runtime/SKILL.md`
- `skills/github-delivery/SKILL.md`
- `skills/quality-gate/SKILL.md`
- `skills/engineering-decisions/SKILL.md`
- `skills/security-maintenance/SKILL.md`
- `skills/onboarding/SKILL.md`
- `skills/agent-recovery/SKILL.md`

通常taskでは必要なSkillだけをcontextへ入れます。

## GitHub workflow for this repository

このrepository自身も可能な限りpolicyをdogfoodします。

### Release branch

sprint開始時にtarget versionを決め、`main` から `release-<major>-<minor>-<patch>` を作成します。

### Issue

substantial policy changeはIssueを作成し、目的 / acceptance criteria / scopeを日本語で明記します。

### Ticket branch

`<issue-number>` のみを使用します。prefix / slug / titleは付けません。

### Ticket Pull Request

meaningful initial commit後、ticket branchからtarget release branchへDraft PRを開きます。

PR title/body/review discussionは日本語です。

Ready前にacceptance criteria、required verification level、JP/EN semantics、ADR/README/Skill consistency、target release branch stalenessを確認します。

merge後はPR baseがdefault branchではないため`Closes #<issue-number>`の自動closeに依存せず、linked Issueを明示的にcloseしProject statusをDoneへ更新します。

### Release Pull Request

release gate通過後 `release-x-y-z -> main` のPRを作成します。

## Language policy

- source code: 英語
- commit message: 英語
- internal development docs: 日本語
- GitHub Issue title/body: 日本語
- PR title/body/review discussion: 日本語
- branch: identifier/versionのみ

commit format:

`<work-prefix>: <extremely concise title>`

## Time-sensitive rules

current official sourceを確認すべき対象:

- model lineup / native session/subagent resume behavior
- plugin / MCP / ACP / Agent Skills ecosystem
- sandbox/runtime/provider persistence behavior
- macOS / WSL / Linux local runtime options
- framework architecture guidance
- framework/runtime quality/testing guidance
- framework/runtime security advisories
- testing/linting/dependency-analysis tools
- GitHub Actions guidance / first-party actions / security practices

## ADR対象

例:

- canonical Git/GitHub SoT変更
- Supervisor/sandbox model変更
- release branch/sprint model変更
- ticket branch naming変更
- decision precedence / user escalation model変更
- verification taxonomy / quality compiler変更
- security advisory prioritization model変更
- onboarding/documentation strategy変更
- recovery checkpoint / fencing / side-effect reconciliation model変更
- cross-platform runtime strategy変更
- source/document/GitHub language policy変更
- Python script禁止変更
- Codex model-role strategy変更
- progressive disclosure mechanism変更

## Validation

変更後は最低限:

- `PROMPT.ja.md` / `PROMPT.en.md` のoperational semantics一致
- role policy変更時の `CODEX_ROLES.*` 意味同値性
- full promptと8つの標準Skillの整合
- README / CONTRIBUTING / ADR整合
- broken Markdown structureがない
- conflicting rulesがない
- old shared-main/worktree-only assumptionsがcanonical ruleとして残っていない
- release/ticket branch lifecycleが一貫
- release branch向けticket PR merge後のexplicit Issue close手順が一貫
- snapshot/resultがresolved immutable identityへpinされている
- decision precedence / escalation boundaryが一貫
- unit/smoke/integration/contract/E2E責務が一貫
- security source/priority policyが一貫
- onboarding docs generation/verification policyが一貫
- session loss / parent loss / sandbox lossからdurable recovery pathが存在する
- execution fencing / side-effect retry policyが一貫

を確認してください。
