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
- deterministicに検証できるpolicy behaviorをlatent LLM judgmentだけへ残していないか
- latent policy evalにnegative / regression / positive controlsがあり、grader自体の識別能力を確認できるか
- mechanical / localized taskへ不要なmulti-agent fan-outを強制していないか
- judgment-heavy reviewへbuilderのprivate reasoningやnumeric self-ratingをquality evidenceとして持ち込んでいないか
- root / always-loaded agent contextの肥大化を測らずprogressive disclosureを名目化していないか
- `bash evals/policy-evaluation/context-budget.sh` がchecked-in baselineに対してroot/always-loaded contextと各conditional Skillの回帰を検出できるか
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
- reader-facing textをconversation / task / execution contextのserializationとして書いていないか
- textをSelect -> Compose -> Rereadでreader-oriented artifactへ編集しているか
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
- public repositoryで`main` protection/rulesetが有効か
- public repositoryで`main`へのdirect push/editが禁止され、release branchからのrelease PRだけが正規更新経路になっているか
- sprintとtarget release versionが1:1で対応しているか
- 通常sprint cadenceが1週間で維持されているか
- `release-x-y-z`をsprint integration branchとして維持しているか
- ticket branchがIssue番号だけになっているか
- active durable ticket branchにpublished remote head + Draft PRが存在するか
- branch作成 -> first meaningful commit -> remote publish -> remote head SHA確認 -> immediate Draft PRが一つの開始手順になっているか
- subagent/workerがdurable branchを作る場合にもpublish + Draft PR ruleが適用されるか
- PR作成時にIssue linkage / assignee / reviewer / labels / target release / stack contextが適切に設定されるか
- Issue dependency graphがcanonical dependency SoTとして維持されているか
- stacked PRが同一repository・同一target releaseのlinear hard dependencyに限定されているか
- stacked dependent ticketがexact predecessor snapshotへpinされているか
- predecessor変更後にaffected downstream validationをcurrent SHAで再実行するか
- stacked ticketをintermediate predecessor branchへのmergeだけでDoneにしていないか
- target release trunkへのactual landing後にIssue close / Project Doneへ進むか
- implementation workerごとのexecution isolationを弱めていないか
- worktree単体をisolation boundaryとして再導入していないか
- parent/child delegationがimmutable snapshot/resultで表現できるか
- snapshot/resultがresolved commit SHA/content digestへpinされ、mutable refの再解決に依存していないか
- Supervisor外のworkerへhost-level sandbox管理権限を渡していないか
- ticket Draft PR -> release branch/stack -> release PR -> main lifecycleを壊していないか
- multi-agent parallelismがdependency graph、WIP、resource limitsに基づいているか

## Canonical ADRs

- ADR-0003: isolated multi-agent execution
- ADR-0004: release-version sprint / GitHub delivery / cross-platform runtime
- ADR-0005: adaptive stack-aware quality gate compilation
- ADR-0006: engineering decision hierarchy / verification taxonomy / security maintenance / onboarding
- ADR-0007: durable interruption recovery / execution fencing / side-effect reconciliation
- ADR-0008: weekly sprint cadence / dependency-aware stacked PR / mandatory durable Draft PR lifecycle
- ADR-0009: cost-aware GitHub Actions resource efficiency
- ADR-0010: evidence-first design refinement / decision frontier
- ADR-0011: evaluated Agent policy contract / execution profile / context budget

これらのcanonical decisionを変更する場合はnew ADRまたは明示的revisionを追加してください。
ADR-0008はADR-0004のticket PR base / sprint cadence / Draft PR運用を拡張・revisionします。

## Multi-agent / delivery invariants

- Git remote / canonical ref = source SoT
- GitHub Issues / Projects = durable work SoT
- GitHub Issue dependency graph = durable dependency SoT
- `main` = released/integrated source state
- public repositoryでは`main`をprotected branch/rulesetで保護する
- public repositoryでは`main`へのdirect push / direct web edit / force push / deletionを通常運用で禁止する
- public repositoryの`main`への正規delivery pathは `release-x-y-z -> main` のrelease PRだけとする
- branch protection/rulesetだけでPR headを制約できない場合、`base=main` かつ `head=release-*` / current target releaseを検証するrequired checkを追加する
- 通常sprint = 1週間
- 1 sprint = 1 target semantic version
- sprint integration branch = `release-<major>-<minor>-<patch>`
- 1 top-level Issue = 1 number-only ticket branch = 1 ticket PR
- ticket branch = `<issue-number>`
- independent ticket PR base = target release branch
- stacked dependent ticket PR base = immediate predecessor ticket branch
- stack membersは同一target release branchをtrunkとして共有
- stack-ready workはreviewable immutable predecessor snapshotへexact SHAでpin
- predecessor変更時はdownstreamをreconcileし、affected validationをcurrent SHAで再実行
- durable ticket branch作成 -> first meaningful commit -> canonical remote publish -> remote head SHA確認 -> immediate Draft PRを一つの開始手順として扱う
- active durable ticket branchをpublished remote head + Draft PRなしで継続しない
- 上記publish + Draft PR ruleはCoordinator / human / worker / subagentすべてに適用
- PR作成時にlinked Issue / assignee / reviewer/CODEOWNERS / established labels / target release / stack contextを設定・維持
- 意味のない自己reviewerや架空labelでmetadataを埋めない
- stacked ticketはintermediate predecessor branchへのmergeだけではDoneにしない
- ticket changesがtarget release trunkへactual landingしたことを確認後、closing keywordに依存せずlinked Issueを明示的にcloseし、Project Doneへ移す = ticket Done
- release branchは`main`とzero-diffの間だけDraft release PR不要
- release branchに最初のmeaningful integrated differenceが入った直後にDraft release PRを開く
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

## Merge authorization invariant

PRのquality/readinessとmerge authorizationは別stateです。

Agent / subagent / Coordinator / Supervisorは、userがidentified PRまたは明確に限定したPR集合へ明示的にmerge/landを依頼した場合だけ、merge / squash / rebase / stacked landing / auto-merge有効化 / equivalent landingを実行します。

review対応、conflict解消、validation、green CI、approval、resolved conversation、mergeable/Ready state、一般的な完遂依頼はauthorizationではありません。authorizationがない場合はready-to-mergeで停止し、PR identity、current head SHA、gate state、blockerを報告します。

authorizationを別PRへ伝播させません。authorization後にexpected fixでheadが変わればcurrent SHAを再検証し、base / target release / scope / included changes等がmaterialに変わった場合やscope内か曖昧な場合は古いauthorizationを再利用しません。

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

validation resultはvalidated SHA/snapshotへpinします。stack rebase/update等でSHAが変わった場合、影響したrequired validationを再実行し、古いgreen resultをcurrent codeへ流用しません。

## Agent policy evaluation invariants

- policy behaviorをdeterministic spaceとlatent spaceへ分離する
- stable inputから同じ結果を要求できる処理はscript / command / parser / configへ寄せる
- latent evalはfresh agentへ必要最小限のpolicyとscenarioだけを渡す
- latent graderはnegative / regression / positive controlsを区別できなければquality evidenceとして使わない
- critical must-notをaggregate scoreで相殺しない
- execution profileは `mechanical / localized / cross-boundary / judgment-heavy` を標準とする
- execution profileはorchestration/review強度を決め、quality-gateのverification risk taxonomyとは分離する
- cross-boundary / judgment-heavy workではcompleted artifactに対するbuilderと分離したindependent cold reviewを必須とする
- `cross-boundary` と `judgment-heavy` が重なる場合は、dependency decompositionとevidence/rubric-first executionの両方を適用し、orchestration前にcombined routingを記録する
- numeric self-ratingをrequired quality signalにしない
- root agent contract変更時はalways-loaded context costを測り、conditional workflowをSkillへ移せないかreviewする
- repeated deterministic reasoningはfailure時だけでなく成功時もcodification candidateとする
- real regressionを修正した場合、可能ならbroken behaviorをregression fixtureとして残す

## Security maintenance invariants

security source priority:

1. framework/runtime/SDK official security advisories
2. official release/security announcements
3. ecosystem official advisory source
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary source

priorityはseverityだけでなく、exploitability、project reachability、external exposure、required privilege、impact、fix availability、workaround quality、regression risk、release timingを評価します。

meaningful advisoryはGitHub Issueへ変換しtarget releaseを割り当てます。critical exposed vulnerabilityではpatch releaseを優先できますが、patchでも`main`への直接変更は禁止し、patch release branchからrelease PRを使用します。

## Agent recovery invariants

- native conversation/thread/subagent resumeはoptimizationでありcanonical SoTではない
- fresh agentがchat historyなしでunfinished taskを再構成できる
- durable recovery sourcesはIssue / Project / PR / Git refs / committed docs / immutable results / structured checkpoint
- checkpointへprivate chain-of-thoughtやsecretを保存しない
- soft checkpointとprovider-lossに耐えるhard checkpointを区別する
- active durable ticket branchではmeaningful stateがremoteで到達可能で、remote head identityとDraft PRを追跡できる
- release branchはzero-diffならDraft release PR不要、first meaningful integrated difference後はDraft release PR必須
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
- weekly sprint / Issue selection / dependency / stack判断
- ticket branch / remote publish / immediate Draft PR / PR metadata
- public repoのmain protection / release-only main integration
- ADR/design/Skills discovery
- troubleshooting
- release/security/recovery workflow

project規模に応じてREADME / CONTRIBUTING / docsへprogressive disclosureします。

documented commandsは可能な限りfresh sandbox/CIで検証します。

## Progressive disclosure

標準Skill:

- `skills/parallel-orchestration/SKILL.md`
- `skills/policy-evaluation/SKILL.md`
- `skills/sandbox-runtime/SKILL.md`
- `skills/github-delivery/SKILL.md`
- `skills/quality-gate/SKILL.md`
- `skills/engineering-decisions/SKILL.md`
- `skills/design-refinement/SKILL.md`
- `skills/writing-discipline/SKILL.md`
- `skills/interaction-discipline/SKILL.md`
- `skills/security-maintenance/SKILL.md`
- `skills/onboarding/SKILL.md`
- `skills/agent-recovery/SKILL.md`

通常taskでは必要なSkillだけをcontextへ入れます。

## GitHub workflow for this repository

このrepository自身も可能な限りpolicyをdogfoodします。

### Sprint / release branch

通常sprintは1週間です。

sprint開始時にtarget versionとrelease dateを決め、`main` から `release-<major>-<minor>-<patch>` を作成します。

release branchが`main`と同一な間はGitHub上PRを作れないため、このzero-diff状態だけはDraft release PRを要求しません。最初のmeaningful integrated differenceが入った直後に `release-x-y-z -> main` のDraft release PRを開きます。

### Public main protection

このrepositoryはpublicなので、`main`をprotected branch/rulesetで保護し、direct push / direct web edit / force push / deletionを通常運用で禁止します。

`main`への正規更新経路は `release-x-y-z -> main` のrelease PRだけです。branch protection/rulesetだけではPR headを制約できない場合、`base=main` のPR headがcurrent `release-*` branchであることを検証するrequired checkを使用します。

### Issue

substantial policy changeはIssueを作成し、目的 / acceptance criteria / scope / dependency / target release / assigneeを日本語で明記します。

### Ticket branch

`<issue-number>` のみを使用します。prefix / slug / titleは付けません。

### Ticket Pull Request

branch作成後、最初のmeaningful commitを直ちに作り、canonical remoteへpublishし、remote branch head SHAがそのcommit SHAと一致することを確認した直後にDraft PRを開きます。published commit + Draft PRなしでそのbranchのactive implementationを継続しません。

independent ticketはtarget release branchをbaseにします。
同一releaseのlinear hard dependencyでは、dependent ticketをimmediate predecessor ticket branchへstackしてよいです。

PR title/body/review discussionは日本語です。

作成時に少なくとも次を確認・設定します。

- linked Issue
- assignee
- reviewer / CODEOWNERS
- established labels
- acceptance criteria
- target release
- stack context if any
- reviewに必要なvalidation evidence / durable limitations

PR bodyはreview artifactとして必要な内容へ整え、current head SHA、ahead/behind、bot status、branch同期履歴、trial-and-error等を作業contextに存在するという理由だけで転写しません。native GitHub metadata / checksで表現できるmutable stateは、そのsurfaceをcanonicalにします。

meaningful reviewerがいない場合、自己reviewerを形式的に指定しません。reviewer不在がreview/merge semanticsへ影響する場合だけ、readerに必要な形で説明します。

Ready前にacceptance criteria、required verification level、current SHA validation、JP/EN semantics、ADR/README/Skill consistency、target release / predecessor staleness、PR metadataを確認します。

Ready/mergeableになってもmerge authorizationは成立しません。explicit authorizationがない場合、このrepositoryのAgent作業はready-to-mergeで停止します。

stacked ticketはimmediate predecessor branchへの通常mergeだけではDoneにしません。ticket changesがtarget release trunkへactual landingしたことを確認後、non-default integrationでは`Closes #<issue-number>`の自動closeに依存せず、linked Issueを明示的にcloseしProject statusをDoneへ更新します。

### Subagent / worker branches

subagent/workerがdurable branchを作る場合も同じremote publish + Draft PR lifecycleを適用します。

remote publishまたはPR mutation権限がないworkerはfirst meaningful commit後ただちにCoordinator/Supervisorへhandoffし、Coordinator/Supervisorがcommit publish、remote head SHA確認、Draft PR作成を完了するまで追加implementationを進めません。

ephemeral immutable result refはこのruleの対象外です。

### Release Pull Request

最初のrelease差分が入った時点でDraft release PRを開き、sprint中維持します。
release gate通過後にReadyへ移します。`release-x-y-z -> main` のmergeは、このrelease PRへのexplicit user authorizationがある場合だけAgentが実行します。authorizationがなければready-to-mergeで停止します。

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
- GitHub Pull Request / stacked PR / branch protection / ruleset capabilities

## ADR対象

例:

- canonical Git/GitHub SoT変更
- Supervisor/sandbox model変更
- release branch/sprint model変更
- weekly sprint cadence変更
- ticket branch naming変更
- stacked PR / dependency integration model変更
- Draft PR lifecycle / PR metadata contract変更
- public repository main protection / release-only main integration変更
- decision precedence / user escalation model変更
- verification taxonomy / quality compiler変更
- Agent policy eval / execution profile / grader control / context-budget model変更
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
- full promptと標準Skill群の整合
- README / CONTRIBUTING / ADR整合
- broken Markdown structureがない
- conflicting rulesがない
- old shared-main/worktree-only assumptionsがcanonical ruleとして残っていない
- 1週間sprint / release lifecycleが一貫
- independent / stacked ticket PR base semanticsが一貫
- active durable ticket branchにpublished remote head + Draft PRが必ず存在する運用になっている
- worker/subagentにもremote publish + Draft PR ruleが適用される
- PR metadata requirementがIssue/Skill/promptで一貫
- stacked ticketのDone boundaryがtarget release trunk landingで一貫
- zero-diff release branchのDraft release PR例外とfirst-difference後必須が一貫
- public repositoryのmain protection / release-only main integrationがprompt/Skill/ADRと一貫
- snapshot/resultがresolved immutable identityへpinされている
- stack predecessor変更後のrevalidation policyが一貫
- decision precedence / escalation boundaryが一貫
- unit/smoke/integration/contract/E2E責務が一貫
- security source/priority policyが一貫
- onboarding docs generation/verification policyが一貫
- session loss / parent loss / sandbox lossからdurable recovery pathが存在する
- execution fencing / side-effect retry policyが一貫

を確認してください。
