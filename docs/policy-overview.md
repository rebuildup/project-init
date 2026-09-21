# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Policy hierarchy

project-init のcanonical hierarchyは次です。

1. **Constitution** — tool/provider-independentなorganizational property
2. **Operating Model** — 現在のrole / planning / delivery / review / release topology
3. **Practice** — Worktrunk / GitHub / Linear / CI等による交換可能な実装
4. **Skill** — context-dependent judgmentのprogressive disclosure

[`constitution/CONSTITUTION.md`](../constitution/CONSTITUTION.md) が最上位contractです。current workflowは [`organization/profiles/release-driven-solo.md`](../organization/profiles/release-driven-solo.md) にまとめ、具体toolをConstitutionへ昇格させません。

default practiceへの従属より、上位guaranteeを維持したproject全体最適を優先します。同等以上のguaranteeを説明できるalternativeへのdeviationは正常なpathです。

## Files

- `PROMPT.ja.md` — 日本語版の初期化prompt本体。
- `PROMPT.en.md` — 英語版。同じoperational semanticsを定義。
- `skills/parallel-orchestration/SKILL.md` — subagent分解・snapshot/result統合・stack-ready dependency execution。
- `skills/sandbox-runtime/SKILL.md` — isolated runtimeとmacOS / WSL/Linux portability。
- `skills/github-delivery/SKILL.md` — Issues / weekly release sprint / stacked PR / Draft PR / release integration。release planning control planeはLinear。
- `skills/agent-delivery-estimation/SKILL.md` — Work Unit / dependency /実測throughput / human・CI・usage constraintsによる中長期delivery forecast。
- `skills/quality-gate/SKILL.md` — stack-aware quality profile、test taxonomy、動作確認gate。
- `skills/engineering-decisions/SKILL.md` — project内の判断優先順位とuser escalation policy。
- `skills/security-audit/SKILL.md` — unknown vulnerabilityのreconnaissance / coverage-led hunting / independent verification / structured reporting。
- `skills/security-maintenance/SKILL.md` — framework/runtime脆弱性収集・priority・対応workflowとconfirmed findingのproject priority化。
- `skills/onboarding/SKILL.md` — fresh contributor向けdocumentation設計・検証。
- `skills/agent-recovery/SKILL.md` — session/sandbox/context中断からのdurable recovery。
- `skills/correctness-assurance/SKILL.md` — 正しい答えを作る前提 / 不変条件・事前/事後条件の抽出 / 型・静的解析・runtime assertion・テスト・property/differential testing・formal verification・reviewからの最小十分な保証手段設計。
- `skills/policy-evaluation/SKILL.md` — execution profile / cold review / deterministic vs latent eval / context-budget model / policy regression guard。
- `skills/design-refinement/SKILL.md` — 実装前evidence-first design / unknown分解 / scope-risk調整 / trade-off documentation。
- `skills/writing-discipline/SKILL.md` — reader-oriented writing / 作業contextから独立したartifactへの再構成 / Select-Compose-Reread pipeline。
- `skills/interaction-discipline/SKILL.md` — agent ownership / blocker presentation / one-question escalation / tangent defer / persistent prose routing。
- `skills/linear-release-control/SKILL.md` — Linearをoptional release planning / health / portfolio control planeとして使う契約（採用時のみ）。
- `skills/worktree-workflow/SKILL.md` — WorktrunkをWSL/Linuxのworktree操作layerとして使う契約 / branch base / port allocation。
- `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` — 時点依存のCodex logical role policy。
- `ADR-0001.md` — project-local / progressive disclosure / deterministic verification等の基本判断。
- `ADR-0002.md` — 低コストsafeguardとtime-sensitive role分離。
- `ADR-0003.md` — isolated multi-agent execution / Supervisor / snapshot-result integration。
- `ADR-0004.md` — GitHub ticket-driven release sprint deliveryとcross-platform local runtime。
- `ADR-0005.md` — framework/runtime固有のadaptive quality gate compilation。
- `ADR-0006.md` — decision hierarchy / verification taxonomy / security maintenance / onboarding。
- `ADR-0007.md` — durable agent interruption recovery / fencing / side-effect reconciliation。
- `ADR-0008.md` — weekly sprint cadence / dependency-aware stacked PR / mandatory durable Draft PR lifecycle。
- `ADR-0009.md` — quality gateを弱めないcost-aware GitHub Actions resource efficiency。
- `ADR-0010.md` — evidence-based agent delivery forecasting / capacity estimation。
- `ADR-0011.md` — agent policyをeval可能なexecutable contractとして扱うpolicy evaluation model。
- `ADR-0012.md` — PR mergeをexplicitなhuman-authorized side effectとして扱う境界。
- `ADR-0013.md` — WSL/Linuxのworktree運用をWorktrunkへ集約するdefault layer採用。
- `ADR-0014.md` — GitHub execution stateをcanonicalとしたままLinearをoptional release control planeとして導入する境界。
- `ADR-0015.md` — advisory maintenanceとactive source auditの責務分離、coverage-led security audit、independent verification。
- `ADR-0016.md` — Linear標準化、release version intent、main protection baseline、Worktrunk default。
- `ADR-0017.md` — Constitution / Operating Model / Practice / Skillの階層化とrefinement-based governance。
- `ADR-0018.md` — current release-driven profileのPR landingをmerge commitへ固定し、repository merge settingsをreconcileする方針。
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
- GitHub IssuesとPull Requestsによるweekly ticket-driven release sprint workflow。release planning control planeはLinearのいずれか一方を明示（SoTではない）
- dependency-aware stacked PR delivery
- durable branchごとのremote publication + mandatory Draft PR lifecycleとPR metadata management
- public repositoryのprotected `main` / release-only main integration
- framework/runtime固有のadaptive deterministic quality gates
- unit / smoke / integration / contract / E2Eのproject固有verification model
- project-local validation commands / GitHub Actions / required CI checks
- engineering decision precedence / autonomous escalation policy
- vulnerability intake / triage / patch-release workflow
- fresh contributor向けonboarding / architecture / development documentation
- persistent reader-facing proseのpre-write `writing-discipline` routingとrecovery/checkpoint stateの分離
- architecture / ADR / CI/CD / release rules

基本思想:

> 最上位ではIdentity / Authority / Evidence / Mutable Ownership / Organizational Continuity / Canonical Consistency / Progressを守る。Git / GitHub / Linear / Worktrunk / Supervisor / release branchはcurrent operating profileによる実装であり、Constitutionを満たす限り置換可能とする。

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
- GitHub Issue dependency metadata: canonical dependency SoT
- stacked PR: Issue dependency graphのlinear pathをGit/PR topologyへprojectionしたもの
- release planning / health / portfolio control plane: Linear Projects / Initiatives。GitHub Issuesはimplementation/dependency SoTであり、GitHub Projectsは標準運用へ導入しない

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
Tag / GitHub Release / package / deploy publication
        ↓
Publication artifact re-fetch + identity verification
        ↓
Release complete
```

原則:

- durable planning unitはGitHub Issue
- short-lived nested subtaskはSupervisor taskでよい
- Linearをrelease planning / health / portfolio control planeとして使い、GitHub Projectsは標準運用へ導入しない
- 通常sprintは1週間
- sprintはtarget semantic versionで識別する。production/stable releaseはmajor、通常sprintはminor、sprint内または導入後の微調整はpatchをdefault bumpとする
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
- PR landing methodはmerge commitに固定し、squash merge / rebase mergeは使用しない。branch-local `git rebase` は別のbranch mechanicsとして許可する
- release PR mergeとpublication completeを分離し、project-local contractで定義したtag / GitHub Release / package / deploy等をpublish後にprovider/APIから再取得してexpected release SHAとの一致を確認する
- CI/release healthはcombined statusの色ではなく、quality profileが要求するsemantic check identityがcurrent candidate SHAに存在してsuccessしているかで判定する
- workflow実装の存在とbranch protection/rulesetによるrequired enforcementを別々に監査し、enforcement未設定・未確認をgreen扱いしない

### Pull Request merge method

current release-driven profileでは、GitHub Pull Requestのlanding methodを **merge commit** に固定します。

repository merge settingsは、repository visibilityに関係なく次へreconcileします。

```text
allow_merge_commit = true
allow_squash_merge = false
allow_rebase_merge = false
```

Agent / automation / release toolingがmerge APIを使用する場合はmethodをrepository defaultへ委ねず、`merge` を明示します。auto-mergeを使う場合もmerge commit以外へ落ちないことをrepository settingsから確認します。

このruleが禁止するのはPRのrebase mergeであり、stacked PR追従やconflict解消に必要なbranch-local `git rebase` ではありません。設定変更権限がない場合は期待設定との差分をblockerまたは明示的configuration limitationとして報告します。

merge method固定はADR-0012のauthorization boundaryを変更しません。readinessや正しいrepository settingsからmerge authorizationを導出しません。

### Public repository main protection

public repositoryでは`main`をbranch protection / rulesetで保護します。

最低限:

- direct push / direct web edit / force push / deletionを通常運用で禁止
- `main`への変更はPull Request必須
- protectionを通常のadmin/automationが安易にbypassしない
- `main`への正規delivery pathは current `release-x-y-z -> main` release PRのみ
- required approving review countは0、conversation resolutionは必須、required status checksは既定で設定しない
- CIは存在する場合のquality evidenceとして扱い、存在しないcheck名をmain protectionへ固定しない

branch protection/rulesetだけでPR head branch patternを制限できない場合も、存在しないrequired CI/status checkを生成しません。merge executor / release automationが `base == main` なら `head == current release-*` を検証し、ticket/arbitrary branchからのmergeを拒否します。

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

必要であれば初期化agentがtest/lint/static-analysis、GitHub Actionsまで実際に追加・修復します。required status checkはmain protectionの既定要件にせず、実在し安定したproject固有checkを明示的に採用する場合だけ設定します。

標準的に次を分離します。

- worker gate: 高速なfocused feedback
- integration gate: ticket PRのfull applicable validation
- release gate: `release-x-y-z -> main` 前のrelease-wide verification

local commandとGitHub Actionsは可能な限り同じdeterministic entry pointを呼びます。

validation evidenceはvalidated SHA/snapshotに結び付けます。stack rebase/updateでSHAが変わった場合は影響したrequired verificationを再実行します。

coverageは有効なprojectでは利用しますが、一律thresholdを盲目的に全projectへ強制しません。

## Security audit

既知advisoryとは別に、source codeから未知のsecurity invariant failureを探す場合は `security-audit` を使用します。principal / trust boundary / entry surface / attack classからcoverage unitを作り、candidateを発見したhunterとは別のfresh verifierが反証します。source外factが決定的なら `needs_validation` とし、audit中にlive/shared environmentをprobeしません。confirmed findingは `security-maintenance` へ渡してproject priorityを決め、通常のIssue / remediation / quality / releaseへ接続します。

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

- Issue (canonical dependency SoT) / dependency state。release planning / health / portfolio control planeはLinear
- target release branch
- ticket branch / remote commit graph
- Draft/Ready PR / assignee / reviewer / labels / review / CI
- stack predecessor / pinned predecessor SHA when relevant
- design / ADR / Skills / docs
- immutable child results
- structured recovery checkpoint

long-running taskはmeaningful boundaryでcheckpointを作ります。保存するのはprivate chain-of-thoughtではなく、task identity、base/checkpoint snapshot、completed/next steps、pending validation、active children、external side effects、blockers、decision/artifact refsなどのoperational stateです。

通常のREADME / ADR / Issue・PR本文はrecovery journalとして使用しません。recovery stateをIssue / PR上へ保持する必要がある場合も、reader-facing proseとは分離されたdesignated structured checkpoint / handoff surfaceを使用します。

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
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`
- `engineering-decisions`
- `security-audit`
- `security-maintenance`
- `onboarding`
- `agent-recovery`
- `correctness-assurance`
- `policy-evaluation`
- `design-refinement`
- `writing-discipline`
- `interaction-discipline`
- `linear-release-control`
- `worktree-workflow`

project固有のarchitecture / UI / release / debugging等は必要に応じて追加します。

## Important policy choices

- Global plugin/configurationは原則使用せずproject scope前提。
- local directoryではなくGit remote/refをsource SoTとする。
- GitHub Issuesをdurable implementation/dependency SoTとする。
- release planning / health / portfolio control planeはLinearに統一し、GitHub Projectsは標準運用へ導入しない。
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
- Bun / ripgrepを標準利用。
- 新規Python scriptは禁止。
- quality gateはframework/runtime固有のcurrent official guidanceからproject-localにcompileする。
- unit/smoke/integration/contract/E2Eの責務を区別し、変更riskからrequired verificationを決める。
- GitHub Actions / Agent Skills / test toolingもproject固有の必要性に応じて初期化時に導入・修復する。
- 導入済みAgent Skillのpresenceをfreshnessの証拠にしない。明示的なpin/freezeがなければcanonical sourceとの差分を確認し、変更があればproject-local customizationを保持してreconcile/updateする。確認不能をagent判断の据え置き理由にしない。
- framework/runtime security advisoryをproject reachability込みでpriority化する。
- unknown source vulnerabilityの探索は `security-audit` でcoverage-ledに行い、candidateをfresh verifierが反証してからfindingへ確定する。
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
- engineering decision/security/recovery policy -> dedicated Skills / config / Issues
- onboarding knowledge -> repository-controlled documentation
- durable work workflow -> GitHub Issues / PR configuration; release planning control plane -> Linearのいずれか一方を明示
- main protection -> Pull Request required / approvals 0 / conversation resolution required / no fixed required status checks by default。GitHub ruleset単体ではPR head patternを制約できないため、release-source policyはmerge executor/release automationでpreflightし、machine-enforced範囲を誇張しない

へ分解します。

再実行はidempotent reconciliationとして扱い、正しい状態なら変更しないことも正常です。


## Refinement / policy decay

non-constitutional ruleは永久化しません。各Operating Model / Practiceは、必要な範囲でimplements / assumptions / guarantees / evidence / known limits / deviation / re-evaluate / remove条件を持ちます。

新しいagent/runtime/toolが同等以上のguaranteeをより単純に提供する場合、current defaultを降格・削除できます。policy migrationではsemantic-loss preventionと同じ強さでobsolete-rule removalを扱います。

formal modelは `formal/Organization.tla` に置き、abstract organizationのsafety/liveness counterexample探索に使用します。model checkingの成功をreal implementation全体のproofとして扱いません。
