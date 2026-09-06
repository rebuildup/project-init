# Project-local AI Agent Initialization Policy

AI coding agent の `/init` や新規リポジトリ初期化時に追加で渡す、project-local AI agent環境構築用のポリシープロンプトです。

## Files

- `PROMPT.ja.md` — 日本語版の初期化prompt本体。
- `PROMPT.en.md` — 英語版。同じoperational semanticsを定義。
- `skills/parallel-orchestration/SKILL.md` — subagent分解・snapshot/result統合。
- `skills/sandbox-runtime/SKILL.md` — isolated runtimeとmacOS / WSL/Linux portability。
- `skills/github-delivery/SKILL.md` — Issues / Projects / release sprint / branch / Draft PR / release integration。
- `skills/quality-gate/SKILL.md` — stack-aware quality profile、test taxonomy、動作確認gate。
- `skills/engineering-decisions/SKILL.md` — project内の判断優先順位とuser escalation policy。
- `skills/security-maintenance/SKILL.md` — framework/runtime脆弱性収集・priority・対応workflow。
- `skills/onboarding/SKILL.md` — fresh contributor向けdocumentation設計・検証。
- `skills/agent-recovery/SKILL.md` — session/sandbox/context中断からのdurable recovery。
- `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` — 時点依存のCodex logical role policy。
- `ADR-0001.md` — project-local / progressive disclosure / deterministic verification等の基本判断。
- `ADR-0002.md` — 低コストsafeguardとtime-sensitive role分離。
- `ADR-0003.md` — isolated multi-agent execution / Supervisor / snapshot-result integration。
- `ADR-0004.md` — GitHub ticket-driven release sprint deliveryとcross-platform local runtime。
- `ADR-0005.md` — framework/runtime固有のadaptive quality gate compilation。
- `ADR-0006.md` — decision hierarchy / verification taxonomy / security maintenance / onboarding。
- `ADR-0007.md` — durable agent interruption recovery / fencing / side-effect reconciliation。
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
- GitHub Issues / Projects / Pull Requestsによるticket-driven release sprint workflow
- framework/runtime固有のadaptive deterministic quality gates
- unit / smoke / integration / contract / E2Eのproject固有verification model
- project-local validation commands / GitHub Actions / required CI checks
- engineering decision precedence / autonomous escalation policy
- vulnerability intake / triage / patch-release workflow
- fresh contributor向けonboarding / architecture / development documentation
- architecture / ADR / CI/CD / release rules

基本思想:

> Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork stateのcanonical SoTとする + mutable execution stateをagentごとに隔離する + immutable snapshot/resultで委譲する + Supervisor経由でagent lifecycleを管理する + 会話履歴なしでもdurable checkpointから復旧可能にする + release branchをsprint integration lineとする + project固有quality/security/governance profileをcompileする + repository-controlled documentationへknowledgeを永続化する + progressive disclosure + 最大安全並列化

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

標準構造:

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

意味:

- `main`: リリース済み・統合済みsource state
- `release-x-y-z`: そのversionを目標とするsprint integration branch
- `<issue-number>`: 1 ticketのdurable branch

標準ライフサイクル:

```text
Version / Release Goal
        ↓
release-x-y-z
        ↓
GitHub Issue
        ↓
Project: Ready
        ↓
<issue-number>
        ↓
Draft PR -> release-x-y-z
        ↓
Isolated parallel workers
        ↓
Verification + CI + Review
        ↓
Ready for review
        ↓
Ticket merge
        ↓
Issue close + Project: Done
        ↓
Release-wide verification
        ↓
release-x-y-z -> main PR
        ↓
Release complete
```

原則:

- durable planning unitはGitHub Issue
- short-lived nested subtaskはSupervisor taskでよい
- GitHub Project/Kanbanは `Backlog -> Ready -> In Progress -> In Review -> Done`
- sprintはtarget semantic versionで識別する
- release branch formatは `release-<major>-<minor>-<patch>`
- ticket branch formatはIssue番号だけ: `123`
- branch名へ `issue/` prefixやslug/titleを入れない
- 1 top-level Issue = 1 ticket branch = 1 ticket PRを基本とする
- ticket PRのbaseは該当release branch
- meaningfulな最初のcommit後、可能な限り早くDraft PRを開く
- acceptance criteriaとticket quality gateを満たしてからReady for reviewへ移す
- ticket PR merge + Issue close + board updateをticket Done boundaryとする
- sprint完了時にrelease branch全体を検証し、`release-x-y-z -> main` PRをmergeする

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

必要であれば初期化agentがtest/lint/static-analysis、GitHub Actions、required checksまで実際に追加・修復します。

標準的に次を分離します。

- worker gate: 高速なfocused feedback
- integration gate: ticket PRのfull applicable validation
- release gate: `release-x-y-z -> main` 前のrelease-wide verification

local commandとGitHub Actionsは可能な限り同じdeterministic entry pointを呼びます。

coverageは有効なprojectでは利用しますが、一律thresholdを盲目的に全projectへ強制しません。

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

meaningful advisoryはGitHub Issueへ変換し、target releaseを割り当てます。critical exposed vulnerabilityではcurrent sprintを中断してpatch releaseを切ることも許可します。

projectに適切ならdependency review、code scanning、secret scanning、container scanning、SBOM等も初期化時に導入・修復します。

## Agent interruption recovery

AI agentの作業継続はconversation historyへ依存させません。

native thread/session/subagent resumeは高速経路として利用できますが、canonical recoveryは次からfresh agentが再構成できることです。

- Issue / Project
- target release branch
- ticket branch / commit graph
- Draft/Ready PR / review / CI
- design / ADR / Skills / docs
- immutable child results
- structured recovery checkpoint

long-running taskはmeaningful boundaryでcheckpointを作ります。保存するのはprivate chain-of-thoughtではなく、task identity、base/checkpoint snapshot、completed/next steps、pending validation、active children、external side effects、blockers、decision/artifact refsなどのoperational stateです。

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

repository-controlled docsから最低限、project purpose / architecture / bootstrap / run / migrate / validation / GitHub workflow / decision precedence / ADR / troubleshooting / release/security/recovery workflowへ到達できるようにします。

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
- `security-maintenance`
- `onboarding`
- `agent-recovery`

project固有のarchitecture / UI / release / debugging等は必要に応じて追加します。

## Important policy choices

- Global plugin/configurationは原則使用せずproject scope前提。
- local directoryではなくGit remote/refをsource SoTとする。
- GitHub Issues / Projectsをdurable work SoTとする。
- `main`をreleased source stateとする。
- sprintごとに `release-x-y-z` integration branchを使用する。
- ticket branchはIssue番号だけを使用する。
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
- engineering decision/security/recovery policy -> dedicated Skills / config / Issues
- onboarding knowledge -> repository-controlled documentation
- durable work workflow -> GitHub Issues / Projects / PR configuration

へ分解します。

再実行はidempotent reconciliationとして扱い、正しい状態なら変更しないことも正常です。
