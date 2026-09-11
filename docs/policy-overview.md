# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Files

- `PROMPT.ja.md` — 日本語版の初期化prompt本体。
- `PROMPT.en.md` — 英語版。同じoperational semanticsを定義。
- `skills/parallel-orchestration/SKILL.md` — subagent分解・snapshot/result統合・stack-ready dependency execution。
- `skills/sandbox-runtime/SKILL.md` — isolated runtimeとmacOS / WSL/Linux portability。
- `skills/github-delivery/SKILL.md` — Issues / Projects / weekly release sprint / stacked PR / Draft PR / release integration。
- `skills/quality-gate/SKILL.md` — stack-aware quality profile、test taxonomy、動作確認gate。
- `skills/engineering-decisions/SKILL.md` — project内の判断優先順位とuser escalation policy。
- `skills/security-maintenance/SKILL.md` — framework/runtime脆弱性収集・priority・対応workflow。
- `skills/onboarding/SKILL.md` — fresh contributor向けdocumentation設計・検証。
- `skills/agent-recovery/SKILL.md` — session/sandbox/context中断からのdurable recovery。
- `skills/policy-evaluation/SKILL.md` — policy behaviorのdeterministic/latent分離、execution profile、cold review、context budget。
- `evals/` — cold policy scenariosとdeterministic grader / controls。
- `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` — 時点依存のCodex logical role policy。
- `ADR-0001.md` — project-local / progressive disclosure / deterministic verification等の基本判断。
- `ADR-0002.md` — 低コストsafeguardとtime-sensitive role分離。
- `ADR-0003.md` — isolated multi-agent execution / Supervisor / snapshot-result integration。
- `ADR-0004.md` — GitHub ticket-driven release sprint deliveryとcross-platform local runtime。
- `ADR-0005.md` — framework/runtime固有のadaptive quality gate compilation。
- `ADR-0006.md` — decision hierarchy / verification taxonomy / security maintenance / onboarding。
- `ADR-0007.md` — durable agent interruption recovery / fencing / side-effect reconciliation。
- `ADR-0008.md` — weekly sprint cadence / dependency-aware stacked PR / mandatory durable Draft PR lifecycle。
- `ADR-0009.md` — cost-aware GitHub Actions resource efficiency。
- `ADR-0010.md` — evidence-first design refinement / decision frontier policy。
- `ADR-0011.md` — Agent policyをevaluated executable contractとして扱う方針。
- `CONTRIBUTING.md` — policy更新ルール。

## Purpose

このpolicyは巨大な `AGENTS.md` を作るためのものではありません。

初期化時だけ包括的なpromptでprojectを調査し、日常運用では短いroot contract + project-local Agent Skillsへcompileすることを目的とします。

構築対象:

- concise root agent instructions
- short Agent Skills
- isolated multi-agent execution
- Supervisor / subagent integration
- interruption/recovery protocol
- macOS / Windows+WSL / Linuxで再現可能なruntime
- GitHub Issues / Projects / Pull Requestsによるweekly ticket-driven release sprint workflow
- dependency-aware stacked PR delivery
- durable branchごとのremote publication + mandatory Draft PR lifecycleとPR metadata management
- public repositoryのprotected `main` / release-only main integration
- framework/runtime固有のadaptive deterministic quality gates
- unit / smoke / integration / contract / E2Eのproject固有verification model
- project-local validation commands / GitHub Actions / required CI checks
- engineering decision precedence / autonomous escalation policy
- vulnerability intake / triage / patch-release workflow
- fresh contributor向けonboarding / architecture / development documentation
- architecture / ADR / CI/CD / release rules
- Agent policyのdeterministic checks / cold eval / grader controls
- execution profileによるorchestration強度の調整
- always-loaded root contractのcontext budget

基本思想:

> Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork/dependency stateのcanonical SoTとする + mutable execution stateをagentごとに隔離する + immutable snapshot/resultで委譲する + Supervisor経由でagent lifecycleを管理する + 会話履歴なしでもdurable checkpointから復旧可能にする + 通常1週間のrelease sprintをintegration cadenceとする + hard dependencyのlinear pathをstacked PRとして安全にprojectionする + active durable ticket branchをpublished remote head + Draft PRなしで放置しない + public repositoryではmainを保護しrelease PRからのみ変更する + project固有quality/security/governance profileをcompileする + repository-controlled documentationへknowledgeを永続化する + progressive disclosure + 最大安全並列化

## Execution model

```text
Human / caller
    │
    ▼
Root Coordinator
    │
    ▼
Agent Supervisor
    ├─ Sandbox A -> Worker A
    ├─ Sandbox B -> Worker B
    ├─ Sandbox C -> Reviewer C
    └─ Sandbox D -> Child Worker D
```

主要不変条件:

- 1 implementation worker = 1 isolated mutable runtime
- worktree単体をexecution isolationとみなさない
- DB / Redis / queue / runtime stateをworker間で共有しない
- parent -> child はimmutable snapshot
- child -> parent はimmutable commit/ref/diff
- 複数agentが同じworking tree / Git index / ticket branchを同時更新しない
- Supervisorはworker sandbox外でlifecycle / budget / credential / execution generationを管理
- native session resumeが失敗してもfresh agentがdurable stateから復旧可能
- durable ticket branchを作るworker/subagentにもremote publish + Draft PR lifecycleを適用
- validation evidenceはcurrent SHA/snapshotへpinし、stack update後にstale successを流用しない

## Local development targets

第一級target:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandbox

portable Web/backend taskはmacOSでもWindows/WSLでも可能な限り同じLinux sandbox definitionで実行し、CI/remoteとの差を減らします。

Apple Siliconでは`arm64`を第一級architectureとして扱い、x86_64 CI/remoteとの差を必要に応じて検証します。

WSL自体はworker isolationではありません。複数workerをWSL内で動かす場合も各workerにcontainer/VM/sandbox boundaryを設けます。

Docker Desktopは必須前提にしません。

## GitHub agile delivery

通常sprintは **1週間** です。

1 sprint = 1 target semantic version = 1 release integration branchを維持します。

independent tickets:

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

hard dependency stack:

```text
main
└─ release-0-2-0
   └─ 123
      └─ 124
         └─ 125
```

意味:

- `main`: リリース済み・統合済みsource state
- `release-x-y-z`: そのversionを目標とするweekly sprint integration branch / stack trunk
- `<issue-number>`: 1 ticketのdurable branch
- GitHub Issue / Project dependency metadata: canonical dependency SoT
- stacked PR: Issue dependency graphのlinear pathをGit/PR topologyへprojectionしたもの

標準ライフサイクル:

```text
Weekly Version / Release Goal
        ↓
release-x-y-z
        ↓
GitHub Issue + dependency
        ↓
Project: Ready / stack-ready
        ↓
<issue-number>
        ↓
first meaningful commit
        ↓
remote publish + remote head SHA verify
        ↓
immediate Draft PR + metadata
        ↓
Isolated parallel workers
        ↓
Verification + CI + Review
        ↓
Ready for review
        ↓
Ticket / contiguous stack landing
        ↓
target release trunk reached
        ↓
Issue close + Project: Done
        ↓
Release-wide verification
        ↓
release-x-y-z -> protected main
        ↓
Release complete
```

原則:

- durable planning unitはGitHub Issue
- short-lived nested subtaskはSupervisor taskでよい
- GitHub Project/Kanbanは `Backlog -> Ready -> In Progress -> In Review -> Done`
- 通常sprintは1週間
- sprintはtarget semantic versionで識別する
- release branch formatは `release-<major>-<minor>-<patch>`
- ticket branch formatはIssue番号だけ: `123`
- branch名へ `issue/` prefixやslug/titleを入れない
- 1 top-level Issue = 1 ticket branch = 1 ticket PRを基本とする
- Issue dependency graphをcanonical dependency SoTにする
- independent ticket PRのbaseはtarget release branch
- same-release linear hard dependencyではdependent ticket PRをimmediate predecessor ticket branchへstackできる
- stack membersは同じrelease branchをtrunkとして共有する
- reviewable immutable predecessor snapshotがあればpredecessor merge前でもdependent ticketをstack-readyとして開始できる
- branch作成 -> first meaningful commit -> canonical remote publish -> remote head SHA確認 -> Draft PRを一つの開始手順として扱う
- active durable ticket branchをpublished remote head + Draft PRなしで継続しない。subagent/workerも例外ではない
- remote publishまたはPR mutation権限がないworkerはfirst meaningful commit後にhandoffし、Coordinator/Supervisorがpublish + Draft PR作成を完了するまで追加implementationを進めない
- PR作成時にlinked Issue / assignee / reviewer/CODEOWNERS / established labels / target release / stack context / validation stateを設定する
- predecessor変更でdownstream SHAが変わったらaffected validationを再実行する
- acceptance criteriaとticket quality gateを満たしてからReady for reviewへ移す
- stacked ticketはintermediate predecessor branchへの通常mergeだけではDoneにせず、ticket changesがtarget release trunkへlandしてからexplicit Issue close + board updateを行う
- native stacked PRではcontiguous groupのtarget release trunk landingをDone boundaryとして扱う
- release branchが`main`とzero-diffの間だけDraft release PRは不要。first meaningful integrated difference直後にDraft release PRを開く
- sprint完了時にrelease branch全体を検証し、`release-x-y-z -> main` PRをmergeする

### Public repository main protection

public repositoryでは`main`をbranch protection / rulesetで保護します。

最低限:

- direct push / direct web edit / force push / deletionを通常運用で禁止
- `main`への変更はPull Request必須
- protectionを通常のadmin/automationが安易にbypassしない
- `main`への正規delivery pathは `release-x-y-z -> main` のrelease PRのみ
- release gateのrequired checks / review / conversation resolution等を満たしてからmerge

branch protection/rulesetだけでPR head branch patternを制限できない場合は、`base == main` のPRについて `head == release-*` かつcurrent target releaseであることを検証するrequired GitHub Actions/status checkを追加し、ticket/arbitrary branchから`main`へのmergeを機械的に拒否します。

初期化時にrepository visibilityとmain protection/rulesetを実際に確認し、public repositoryで不足していれば作成・修復します。権限不足で変更できない場合は未保護状態をblockerとして報告します。

## Engineering decision policy

開発判断は原則として次の順で確認します。

```text
project-wide policy / canonical architecture
    > design / specification / explicit task instruction
    > coherent existing implementation majority
    > current official framework/runtime guidance
    > ecosystem convention
    > local best judgment
```

既存実装は重要なevidenceですが、canonical design/policyを上書きしません。

project evidenceから実質一意に決まる可逆・局所的な判断を、agentが毎回userへ質問してはいけません。

user escalationは、product semantics、public contract、security/privacy、meaningful cost、release scope、irreversible operation、canonical source間の矛盾など、本物の意思決定が残る場合に限定します。

## Evidence-first design refinement

非自明なfeature / architecture / product designでは、planning / implementation前にrepository-controlled evidenceを読み、unknownとhidden assumptionを整理します。

標準workflow:

```text
inspect evidence
  -> classify facts / decisions
  -> investigate facts
  -> resolve project-determined decisions
  -> build unresolved decision graph
  -> ask only consequential decision frontier
  -> persist significant results
  -> plan / implement
```

factはrepository、official source、executable probe等からagentが調査し、userへ返しません。project evidenceから実質一意に決まるdecisionは `engineering-decisions` のprecedenceで自律決定します。

複数のmeaningful optionが残り、product semantics / architecture / public contract / risk / cost / release scope等が変わるdecisionだけをuser escalation候補にします。

decision同士に依存関係がある場合はgraphとして扱い、未解決の上流decisionに依存する下流質問を先に投げません。userへは現在のdecision frontierだけを、既知evidence・選択肢・meaningful consequence・推奨案とともに提示します。

long-livedなdecision/domain knowledgeだけをdesign/spec、ADR、project-local Skill、architecture docs、schema/test、glossary/domain context等へ永続化します。domain vocabularyが単純なprojectへ独立documentを強制せず、固定の `CONTEXT.md` を標準必須fileにしません。

このworkflowはexternal interview Skillをmandatory dependencyにせず、project-initの既存decision hierarchyとprogressive disclosureへnativeにcompileします。

## Reader-oriented writing discipline

agentが保持しているtext contextと、readerへ渡す文章を同一視しません。

conversation、task、調査、実装、tool output、current execution stateはwriting inputにはなりますが、その順序や粒度のままdocumentation等へ転写する対象ではありません。reader-facing textは次の変換を通します。

```text
raw context
  -> Select: audience / purposeに必要なcommunicative contentを選ぶ
  -> Compose: readerの理解順へstandalone proseとして再構成する
  -> Reread: 元contextを知らないreaderとして全文を読み直し編集する
```

rereadは誤字脱字確認だけではありません。文・段落の接続、冗長、指示語、前提不足、chronology leakage、context dependencyを確認し、必要なら削除・統合・並べ替え・書き直しを行います。

このdisciplineはREADME等のdocumentationだけでなく、ADR、Issue、Pull Request、commit message、code comment、review comment等のpersistentまたは他者向けtextへ共通適用します。

temporal/history/execution informationは、それ自体を禁止しません。version compatibility、migration、audit、incident、reproducibility、readerの判断に必要なstatus等、artifactの責務として必要な場合だけ残します。単にagentのcurrent contextへ存在することは記載理由になりません。

詳細なartifact別workflowは `writing-discipline` Skillへprogressive disclosureします。

## Adaptive quality / verification gate

quality gateは全project共通の固定bundleではありません。

初期化時に実repoのlanguage / framework / runtime / SDK / app target / persistence / release targetを検出し、実versionに対応するcurrent official guidanceを調査してproject-local quality profileへcompileします。

### Verification taxonomy

- **Unit**: 局所logic/component behavior
- **Smoke / connectivity（疎通）**: startup / wiring / DB/API接続 / critical-path入口
- **Integration（結合）**: 複数real component/boundaryのdata flow / transaction
- **Contract/schema**: API / event / DB / generated interface compatibility
- **E2E/system**: user/system critical flow
- **Manual/visual**: automationが不足するUI/native/hardware領域のみ明示的に使用

変更surfaceからrequired verificationを決めます。

例:

- pure logic -> unit
- API/service behavior -> unit + integration
- DB/schema/migration -> integration + schema/migration + smoke
- runtime/env/network/DI -> smoke + relevant integration
- user journey/auth/navigation -> integration/contract + E2E
- build/package/container -> build/package + smoke
- release -> full applicable integration + critical E2E/smoke + release checks

必要であれば初期化agentがtest/lint/static-analysis、GitHub Actions、required checksまで実際に追加・修復します。

標準的に次を分離します。

- worker gate: 高速なfocused feedback
- integration gate: ticket PRのfull applicable validation
- release gate: `release-x-y-z -> main` 前のrelease-wide verification

local commandとGitHub Actionsは可能な限り同じdeterministic entry pointを呼びます。

validation evidenceはvalidated SHA/snapshotに結び付けます。stack rebase/updateでSHAが変わった場合は影響したrequired verificationを再実行します。

coverageは有効なprojectでは利用しますが、一律thresholdを盲目的に全projectへ強制しません。

## Agent policy evaluation / execution profile

Agent policyは文章の整合だけで完了としません。

significantなSkill / prompt / routing変更では、対象behaviorを次へ分けます。

- **deterministic space**: file/config/schema/metadata/exact SHA/command等、stable inputから機械的に検証できる部分
- **latent space**: decomposition / escalation / prioritization / qualitative review等、fresh agentの判断が必要な部分

deterministic部分はscript / command / parser / fixtureへ寄せ、latent部分は必要最小限のpolicyだけをfresh agentへ渡すcold evalで確認します。

latent eval graderには最低限:

- naive negative control -> FAIL
- real/representative regression control -> FAIL
- current positive control -> PASS

を要求します。critical must-notはscoreで相殺しません。controlsが識別できないgraderのscoreはquality evidenceとして扱いません。

orchestration前に `mechanical / localized / cross-boundary / judgment-heavy` のexecution profileを決めます。これはquality gateのtest-risk taxonomyとは別です。small/mechanical taskへ不要なfan-outを入れません。cross-boundary / judgment-heavy workではcompleted artifactに対するbuilderと分離したindependent cold reviewを必須とします。`cross-boundary` と `judgment-heavy` が重なる場合は、dependency decomposition / safe parallelismとevidence/rubric-first executionの両方を適用し、combined routingをorchestration前に記録します。

cross-boundary / judgment-heavy reviewではbuilderのprivate reasoningではなくobjective / frozen rubric / completed artifact / validation evidenceをreviewerへ渡します。numeric self-ratingはrequired quality signalにしません。

progressive disclosureはdirectory構造だけでなくalways-loaded context量も測ります。root agent contractが大きくなった場合、追加内容が本当にall-task invariantかを確認し、conditional workflow / reference / Skillへ移せないかreviewします。critical invariantはcontext削減だけを理由に削除しません。repository regression checkは `bash evals/policy-evaluation/context-budget.sh` で実行し、checked-in baselineに対するroot / total always-on / 各conditional Skillのbyte growthをmachine-readable TSVで検査します。

同じ非自明な手順を繰り返した場合、failureだけでなく成功例もcodification candidateとします。deterministicならscript/config、judgment workflowならSkill、long-lived invariantならpolicy/ADRへ昇格させます。

詳細は `skills/policy-evaluation/SKILL.md`、`evals/`、ADR-0011を参照します。

## Security maintenance

framework/runtime/SDK/dependencyのsecurity情報はprojectで実際に使用しているversionに紐付けて継続的に扱います。

source priority:

1. official framework/runtime/SDK security advisory
2. official release/security announcement
3. ecosystem official advisory source
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary source

priorityはseverityだけでなくexploitability、project reachability、external exposure、impact、fix availability、regression risk、target release timingで決定します。

meaningful advisoryはGitHub Issueへ変換し、target releaseを割り当てます。critical exposed vulnerabilityではcurrent sprintを中断してpatch releaseを切ることも許可しますが、patchでも`main`を直接変更せずpatch release branchからrelease PRを使用します。

projectに適切ならdependency review、code scanning、secret scanning、container scanning、SBOM等も初期化時に導入・修復します。

## Agent interruption recovery

AI agentの作業継続はconversation historyへ依存させません。

native thread/session/subagent resumeは高速経路として利用できますが、canonical recoveryは次からfresh agentが再構成できることです。

- Issue / Project / dependency state
- target release branch
- ticket branch / remote commit graph
- Draft/Ready PR / assignee / reviewer / labels / review / CI
- stack predecessor / pinned predecessor SHA when relevant
- design / ADR / Skills / docs
- immutable child results
- structured recovery checkpoint

long-running taskはmeaningful boundaryでcheckpointを作ります。保存するのはprivate chain-of-thoughtではなく、task identity、base/checkpoint snapshot、completed/next steps、pending validation、active children、external side effects、blockers、decision/artifact refsなどのoperational stateです。

active durable ticket branchではmeaningful stateがcanonical remoteへpublishされ、remote head identityとDraft PRが追跡できることをhard recovery boundaryに含めます。release branchは`main`とzero-diffの間だけDraft release PR不要で、first meaningful integrated difference後はDraft release PRを必須とします。

### Recovery levels

- **native resume**: session/thread/agent IDが残っていれば利用
- **soft recovery**: same host/sandboxでlocal immutable ref/snapshot/journalから再開
- **hard recovery**: sandbox/provider消失後もremote durable stateから再構成

### Split-brain防止

Supervisorはtaskごとにexecution lease/generationまたは同等のfencingを持ちます。recovery後に旧agentが戻ってもstale generationのresult/外部writeを通常統合しません。

### Parent/child recovery

child lifecycleはparent model processではなくSupervisorが所有します。parentが落ちてもsafeならchildを残し、recovered parentがrunning/completed/failed/orphanedを再発見してimmutable resultを回収します。

### External side effects

migration、deploy、publish、release、cloud mutation、notification等はtimeout後の状態が曖昧になり得ます。可能ならidempotency keyを使い、intent/result/remote identifierをdurableに記録し、recovery時はremote actual stateを確認してからretryします。

### Context exhaustion

context limit接近はplanned handoff eventです。objective、accepted decisions、relevant refs、current checkpoint、completed/pending work、validation、blockerをstructured stateへ外部化してfresh agentへ引き継ぎます。

## Onboarding / project knowledge

fresh contributorや新しいagentが会話履歴・private memoryなしで開発開始できることを初期化完了条件に含めます。

repository-controlled docsから最低限、project purpose / architecture / bootstrap / run / migrate / validation / weekly sprint / Issue dependency / ticket branch / remote publication / immediate Draft PR / PR metadata / stacked PR / protected main / decision precedence / ADR / troubleshooting / release/security/recovery workflowへ到達できるようにします。

project規模に応じて `README.md`、`CONTRIBUTING.md`、`docs/architecture.md`、`docs/development.md`、`docs/troubleshooting.md`、`docs/release.md` 等へprogressive disclosureします。

必要ならMermaid等でarchitecture / data flow / trust boundariesを可視化します。

documented commandも可能な限りfresh sandbox/CIで検証します。

## Language policy

branch名はidentifier/versionだけを持ち、説明責務を持たせません。

- source code: 英語
- commit message: 英語
- internal development docs: 日本語
- GitHub Issue title/body: 日本語
- Pull Request title/body/review discussion: 日本語

## Progressive disclosure

full promptを読むのは初回初期化とpolicy再構成時だけです。

通常taskではroot `AGENTS.md` 等から必要なSkillだけを読みます。

標準Skill:

- `parallel-orchestration`
- `policy-evaluation`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`
- `engineering-decisions`
- `design-refinement`
- `writing-discipline`
- `security-maintenance`
- `onboarding`
- `agent-recovery`

project固有のarchitecture / UI / release / debugging等は必要に応じて追加します。

## Important policy choices

- Global plugin/configurationは原則使用せずproject scope前提。
- local directoryではなくGit remote/refをsource SoTとする。
- GitHub Issues / Projectsをdurable work/dependency SoTとする。
- `main`をreleased source stateとする。
- public repositoryでは`main`をprotected branch/rulesetで保護し、direct push/editを禁止してrelease branchからのPRのみを正規更新経路にする。
- 通常sprintは1週間。
- sprintごとに `release-x-y-z` integration branchを使用する。
- ticket branchはIssue番号だけを使用する。
- 1 top-level Issue = 1 durable branch = 1 ticket PRを基本とする。
- independent PRはrelease branch、same-release linear hard dependencyはpredecessor branchへstack可能。
- active durable ticket branchはfirst meaningful commitをremoteへpublishしてhead SHAを確認した直後にDraft PRを持つ。worker/subagentも例外なし。
- PR作成時にIssue linkage / assignee / reviewer/CODEOWNERS / established labels / release / stack contextを設定する。
- stacked ticket Doneはintermediate mergeではなくtarget release trunk landingで判定する。
- implementation workerごとにisolated mutable runtimeを使用。
- worktree-only isolationは禁止。sandbox内部実装としてのworktreeは許可。
- nested delegationはimmutable snapshot/resultを使用。
- session/context消失時もdurable checkpointからfresh agentが復旧できるようにする。
- execution generation/fencingでduplicate continuationを防ぐ。
- source code/commitは英語、internal docs/Issue/PR discussionは日本語。
- project-wide policy > design/spec/instruction > existing implementation majority の判断順序を標準化する。
- project evidenceで解ける自明な判断をuserへ返さない。
- 非自明なdesignでは実装前にevidence-first refinementを行い、factを自律調査し、本物のunresolved decision frontierだけをuserへ返す。
- reader-facing textはcontext serializationにせず、Select -> Compose -> Rereadで独立した文章へ変換する。
- Bun / ripgrepを標準利用。
- 新規Python scriptは禁止。
- significantなAgent policy / Skill / prompt / routing変更はdeterministic checksと必要なcold evalでbehavior preservationを検証し、graderにはpositive / negative / regression controlsを持たせる。
- orchestration前にexecution profileを判定し、mechanical / localized taskへ不要なfan-outを導入しない。
- progressive disclosureではalways-loaded root contractのcontext costも測定し、肥大化をreviewする。
- repeated deterministic reasoningはscript / command / configへcodifyする。
- quality gateはframework/runtime固有のcurrent official guidanceからproject-localにcompileする。
- unit/smoke/integration/contract/E2Eの責務を区別し、変更riskからrequired verificationを決める。
- GitHub Actions / Agent Skills / test toolingもproject固有の必要性に応じて初期化時に導入・修復する。
- framework/runtime security advisoryをproject reachability込みでpriority化する。
- fresh contributor/new agentがhidden contextなしで開発開始・復旧できるdocumentationを維持する。
- significant architecture/tooling/runtime/workflow/quality/security/recovery decisionsはADRへ永続化。
- temporary verification filesは `.tmp/`、external reference repositoriesは `.reference/`。
- new container definitionは `Containerfile`。
- CI/CDは原則GitHub Actions。

## Usage

新規または既存projectで通常の `/init` 相当処理と同時に `PROMPT.ja.md` または `PROMPT.en.md` を渡してください。

初期化agentは全文をroot agent fileへコピーせず:

- always-on invariants -> root agent file
- conditional workflows -> Agent Skills
- long-lived decisions -> ADR
- reproducible runtime/tools -> project-local configuration
- adaptive quality profile -> project-local commands / Skills / CI workflows
- engineering decision/security/recovery/policy-evaluation -> dedicated Skills / config / evals / Issues
- onboarding knowledge -> repository-controlled documentation
- durable work workflow -> GitHub Issues / Projects / PR configuration
- public main protection -> branch protection/ruleset + required release-source check when necessary

へ分解します。

再実行はidempotent reconciliationとして扱い、正しい状態なら変更しないことも正常です。
