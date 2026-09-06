# 複数AIエージェント並行駆動向けプロジェクト初期化ポリシー

このリポジトリ向けのAIコーディングエージェント環境を初期化・再整備してください。

これは一般的な `/init` の代替または補強として渡すメタプロンプトです。実際のrepository、技術stack、architecture、runtime、test、quality、security、CI/CD、GitHub workflow、documentationを調査したうえで、**複数AIエージェントが独立環境で安全に並行作業し、中断・context消失・sandbox消失からも復旧しながらversion-oriented release sprintへ決定論的に統合できるproject-local開発環境**を構築してください。

この全文を通常taskのたびに読ませてはいけません。全文を読むのは初回初期化、またはproject-local Agent Skills / adapters / runtime / quality / governance / recovery policyを再構成する時だけです。

全文を `AGENTS.md` や `CLAUDE.md` へコピーしてはいけません。

基本思想:

> **Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork stateのcanonical SoTとする + 1 implementation worker = 1 isolated mutable runtime + parent/child間はimmutable snapshot/result + Supervisor経由でagent lifecycleを管理 + 会話履歴なしでもdurable checkpointから復旧可能 + sprintをtarget release versionとして表現 + project固有quality/security/governance profileをcurrent official guidanceからcompile + repository-controlled documentationへknowledgeを永続化 + progressive disclosure + 論理的に安全な最大並列化**

---

## 1. 最優先原則

- Git working treeをexecution isolation boundaryとして扱わない。
- implementation workerごとに独立したmutable runtimeを与える。
- mutable DB / cache / queue / process / generated stateをworker間で共有しない。
- parent -> childはimmutable snapshot、child -> parentはimmutable resultで接続する。
- sandbox lifecycleはworker外のSupervisorが管理する。
- `main` はreleased/integrated source stateとする。
- active sprintは `release-<major>-<minor>-<patch>` branchで表現する。
- durable ticketはGitHub Issue、durable work stateはGitHub Projectsで管理する。
- ticket branchはIssue番号だけを使用する。
- quality gateは固定bundleではなくproject固有にcompileする。
- verification levelは変更surface/riskから決める。
- framework/runtime security情報を継続的にpriority化する。
- project knowledgeをchat/private memoryではなくrepository-controlled docsへ残す。
- project evidenceで解ける自明な判断をuserへ返さない。
- native session/thread resumeを唯一のrecovery mechanismにしない。
- fresh agentが会話履歴なしでunfinished workを再構成できるようにする。

Git worktree自体は禁止ではありません。既にisolatedなsandbox内部のGit実装詳細として使用できますが、worktreeだけでport/process/database等が分離されたとは扱いません。

---

## 2. `/init` はidempotent reconciliationにする

初期化は一度しか実行されないと仮定してはいけません。

最初に現在状態を調査し、理想状態との差分だけを変更してください。

最低限確認:

- root agent instructions
- Agent Skills / adapters
- plugin / MCP / ACP / protocol settings
- runtime / sandbox / devcontainer / Containerfile / Nix
- Supervisor integration / execution state model
- recovery checkpoint / lease / fencing model
- language/framework/runtime/SDK versions
- manifest / lockfile / workspace structure
- architecture / design / ADR
- test / lint / type / build / coverage configuration
- smoke/integration/E2E infrastructure
- GitHub Actions / CI/CD / required checks
- dependency/security tooling
- README / CONTRIBUTING / docs
- env examples / `.gitignore`
- GitHub Issues / Projects / PR / release workflow
- current errors / warnings
- branch / remote / userのuncommitted changes

振る舞い:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

正しい状態を理由なく再生成しないでください。変更不要も成功です。

---

## 3. Source of Truthを明示する

canonical stateは最低限次で表現してください。

1. canonical Git remote
2. released ref: `main` またはprojectが明示する同等branch
3. active release ref: `release-x-y-z`
4. repository-controlled environment definition
5. GitHub Issue / Project work state
6. project-wide policy / architecture / design / specification / ADR
7. repository-controlled operational documentation / Agent Skills
8. durable recovery checkpoint / immutable worker results

source/work state:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient execution: Supervisor

各ticket / workerは `base_sha` またはimmutable input snapshotを追跡可能にしてください。

local directory、会話履歴、native session ID、Supervisorの復旧不能なhidden DBだけを唯一のSoTにしてはいけません。

---

## 4. Engineering decision precedence

開発判断では原則として次の順で確認してください。

1. **project-wide policy / canonical architecture / invariant**
2. **design / specification / explicit task instruction**
3. **coherent existing implementation majority**
4. **current official framework/runtime/SDK guidance**
5. established ecosystem convention
6. local best judgment

同一levelで矛盾する場合は、よりspecificかつ新しいcanonical sourceを優先します。

existing implementationは重要なevidenceですが、old implementationやmigration途中の多数派が新しいcanonical design/policyを上書きしてはいけません。

convention確認時は同じ責務の複数実装を見て、generated/vendor/example codeやmigration途中のold patternを除外してください。最初に見つけた1 fileだけをproject conventionとして扱わないでください。

### 自明な判断をuserへ返さない

次を満たす場合はagent自身で判断して進めてください。

- precedenceから答えが一意または実質一意
- reversibleで局所的
- acceptance criteriaを変更しない
- public/external contractを新規確定しない
- security/privacy/cost/release scopeを重大に変えない

project evidenceで解けるのに「A/Bどちらが良いですか」とuserへ返してはいけません。

### User escalationが必要な条件

- canonical sources同士が矛盾しproduct semanticsが変わる
- acceptance criteriaが複数解釈できuser-visible behaviorが変わる
- irreversible/destructive operation
- public/external API contract確定
- security/privacy/compliance risk受容
- meaningful cost increase
- release scope/date変更
- explicit design-first approval gate

質問する場合も、調査可能なfactを先に確認し、選択肢・影響・推奨案を整理してから聞いてください。

---

## 5. Agent architecture

```text
Human / caller
    │
    ▼
Root Coordinator
    │ high-level agent tools
    ▼
Agent Supervisor / Control Plane
    ├─ Sandbox A -> Worker A
    ├─ Sandbox B -> Worker B
    ├─ Sandbox C -> Reviewer C
    └─ Sandbox D -> Child Worker D
```

### Root Coordinator

責務:

- user request / acceptance criteria
- target release / release date
- dependency graph / Issue decomposition
- delegation / integration ordering
- consequential decisions
- final verification / synthesis

大量の機械的実装をCoordinatorへ集中させないでください。

### Agent Supervisor

責務:

- sandbox create / destroy / suspend / recreate
- workspace snapshot / recovery checkpoint
- agent spawn / wait / cancel / resume / replace
- agent/model adapter selection
- resource / cost / WIP / recursion budget
- credential injection
- execution lease / generation / fencing
- child discovery / orphan reconciliation
- Git result collection / integration
- logs / status / preview routing

workerへhost Docker socket、root-equivalent権限、cloud master credential等を直接渡してsandbox生成させないでください。

---

## 6. Subagent spawnを第一級toolにする

可能ならCoordinatorおよび許可されたparent agentへ次のlogical capabilityを公開してください。

```text
spawn_agent
wait_agent
get_agent_status
get_agent_result
send_agent_message
cancel_agent
resume_or_replace_agent
integrate_agent_result
checkpoint_agent
recover_task
```

transportはnative agent API、MCP、ACP、CLI wrapper、project-local Supervisor client等から選べます。

モデルにDocker/VM/provider commandそのものを覚えさせるのではなく、agent creation/recoveryを高水準toolとして公開してください。

spawn request候補:

- Issue / internal task reference
- objective / acceptance criteria
- role
- immutable input snapshot
- allowed tools
- filesystem/network policy
- budget / timeout / maximum depth
- expected result format
- parent execution generation

fork bombやunbounded costを防止してください。

---

## 7. Subagent mode / immutable transfer

最低限次を区別してください。

### Research

repository exploration / external research / architecture investigation等。原則read-onlyです。

### Worker

implementation / refactor / test / migration / generation / runtime verification。必ず独立mutable environmentを使用してください。

### Reviewer

code / architecture / correctness / test adequacy / integration review。clean snapshotから開始し、implementerのdirty workspaceを共有しないでください。

### Parent -> Child

parentが未統合変更を持つ状態からchildをspawnする場合、immutable checkpointを作成してください。

候補:

- ephemeral Git commit
- immutable Git ref
- filesystem/container snapshot
- content-addressed workspace snapshot

必要条件:

- snapshot identityを追跡可能
- spawn後のparent変更でchild inputが変化しない
- clean environmentへ再現可能
- resultとのbase relationshipを判定可能

### Child -> Parent

childはparent workspaceを直接編集して成果を返してはいけません。

result候補:

```text
agent_id
issue_or_task_id
base_snapshot
execution_generation
result_commit_or_ref
summary
validation_results
artifacts
known_issues
```

Coordinator/Supervisorがinspect / integrate / reject / request revisionします。

---

## 8. Execution environment isolation

implementation workerでは最低限次を隔離してください。

- checkout / writable workspace
- process boundary
- network namespaceまたはport mapping
- database state
- Redis/cache/queue state
- application local state
- test artifacts
- mutable build output

同じ内部portをsandboxごとに再利用して構いません。

共有しやすいもの:

- read-only base image
- immutable Nix store
- package download cache
- Cargo registry cache
- OCI layer cache
- read-only toolchain cache

共有しないもの:

- writable application DB
- concurrently-mutated dependency/build directory
- generated runtime files
- Git index / working tree
- host Docker socket
- shared dev-server process

原則は **immutable/cacheable stateのみ共有し、mutable stateは隔離** です。

---

## 9. Runtime / host / provider portability

特定vendorをmandatoryにしてはいけません。

第一級local target:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandbox

portable Web/backend taskは可能な限り同じLinux sandbox definitionを使い、host差をSupervisor/runtime adapterへ閉じ込めてください。

Apple Siliconでは`arm64`を第一級architectureとして扱い、x86_64 CI/remoteとの差を必要に応じて検証してください。

WSL自体をworker isolationとみなしてはいけません。Linux-oriented repoは高頻度build/watchではWSL Linux filesystem側を優先してください。

Docker Desktopを必須前提にしないでください。

runtime/provider選定時はcreate/destroy costだけでなく、snapshot persistence、suspend/resume、provider-loss recovery、remote artifact durabilityも評価してください。

---

## 10. Project-local / progressive disclosure

AI agent関連設定はproject-localを原則とします。

禁止:

- global plugin/configをproject truthにする
- home directoryのproject-specific hidden ruleへ依存
- implicit persistent memoryをcanonical truthにする
- undocumented machine-specific stateへ依存

root agent fileはdispatcherにしてください。

rootに置くもの:

- project identity / boundaries
- source/work SoT
- active release rule
- decision precedence pointer
- environment bootstrap
- Supervisor/subagent/recovery entry point
- validation entry point
- language policy
- Skill discovery

標準Skill候補:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`
- `engineering-decisions`
- `security-maintenance`
- `onboarding`
- `agent-recovery`

Agent Skillsの発見・導入にはSkills CLIを利用できます。Bunが利用可能なら `bunx skills` を標準とし、Node.js / npm環境では同じ引数を `npx skills` で実行できます。候補確認には `bunx skills add <source> --list`、project-local導入には `bunx skills add <source>` または `--skill <name>` を利用できます。既存のproject-local `skills/` とrepository policyを優先して確認し、source/trust/maintenance/reproducibilityを評価したうえで必要なSkillだけを導入してください。`--global` を既定にしてはいけません。

通常taskでは必要なSkillだけを読み、このfull promptを再読しない構成にしてください。

---

## 11. Release sprint / GitHub workflow

開発はtarget versionを持つrelease sprint + GitHub Issue中心で進めます。

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

### Sprint = target release version

1 sprint = 1 target semantic versionです。

release branch:

`release-<major>-<minor>-<patch>`

sprint開始時に `main` からrelease branchを作成してください。

### GitHub Issue

独立して計画・実装・レビューできるdurable work itemは原則Issueにしてください。

Issue title/bodyは日本語です。

必要に応じて目的、acceptance criteria、scope/non-scope、dependency、priority、size、area/component、target version、release dateを持たせてください。

短命なnested subtaskはSupervisor taskで構いません。

### GitHub Projects / Kanban

最低限:

`Backlog -> Ready -> In Progress -> In Review -> Done`

推奨field:

- Priority
- Size
- Target Version
- Area / Component
- Blocked / dependency

WIPを実capacityに合わせて制限してください。

---

## 12. Ticket branch / Draft PR

1 top-level Issueにつき1 durable ticket branchを作ります。

branch名:

`<issue-number>`

`issue/` prefix、slug、title、work type等を入れてはいけません。説明責務はIssue/PRへ置きます。

meaningfulな最初のcommit後、ticket branchからtarget `release-x-y-z` へDraft PRを早期作成してください。

PR title/body/review discussionは日本語です。

Draft -> Ready条件:

- acceptance criteria実装済み
- ticket integration gate成功
- blocking issue解消またはscope外明示
- PR descriptionが現状と一致
- release branchとのstaleness/conflict処理済み
- latest durable checkpointとbranch stateが矛盾しない

Ticket Done:

- required CI/checks green
- blocking review resolved
- PR merged into target release branch
- Issue closed
- Project status = Done

---

## 13. Release integration

sprint対象ticketをrelease branchへ統合後、release gateを実行してください。

release PR:

`release-x-y-z -> main`

release PR title/bodyは日本語です。

最低限:

- release goal
- included Issues / PRs
- breaking changes
- migration notes
- full validation result
- known limitations
- version/release metadata

merge後 `main` がそのversionのreleased stateです。

---

## 14. Task graphと最大安全並列化

非自明なIssueをdependency graphへ分解してください。

各node候補:

- objective / acceptance criteria
- prerequisites
- input snapshot
- output contract
- owner role
- target release
- integration target
- recovery/checkpoint policy

Readyかつdependency解消済みnodeはresource / rate / quota / WIP / cost内で最大限並行化してください。

同じfileを触ること自体だけを直列化条件にしないでください。isolated sandboxでは同一fileの独立編集は可能です。

ただしsame interfaceの非互換変更、same generated artifact、same external mutable resource等はdependencyまたは追加isolationが必要です。

---

## 15. 自律実行ループ

非自明taskでは:

`inspect -> plan release -> ticketize -> decompose -> snapshot -> delegate/implement -> checkpoint -> verify worker -> integrate ticket -> verify integration -> review -> update board -> verify release -> replan -> continue`

を自律的に回してください。

compile成功、focused test 1件成功、first implementationがもっともらしい、というだけで完了扱いしないでください。

要求scopeを独自にMVPへ縮小してはいけません。

---

## 16. Agent interruption recovery

AI agent recoveryは「同じconversationをresumeできること」に依存させてはいけません。

native session/thread/subagent resumeが利用できる場合は高速経路として利用できますが、canonical pathは**fresh agentがdurable project stateからreconstructすること**です。

### Failure model

最低限次を想定してください。

- model/session context loss
- agent process crash / cancellation
- IDE/terminal restart
- parent agent crash while child continues
- child/subagent crash
- sandbox/container/VM recreation
- Supervisor restart
- transient network/provider failure
- host reboot
- context-window exhaustion

project/provider要件に応じてmachine/provider lossまでのRPO/RTOも定義してください。

### Durable recovery sources

優先するevidence:

1. GitHub Issue / Project
2. target release branch
3. ticket branch / commit graph
4. Draft/Ready PR / review / CI state
5. committed design / ADR / Skills / docs
6. immutable worker/subagent results
7. structured recovery checkpoint

native conversation ID、agent ID、Supervisor local DB、shell history、IDE stateはtransient optimizationです。

### Structured recovery checkpoint

private chain-of-thoughtを保存してはいけません。復旧に必要な外部化可能stateだけを保存してください。

最低限候補:

```text
schema_version
issue_id
target_release
ticket_branch
pr_number
base_sha
checkpoint_sha_or_snapshot
execution_generation
status
completed_steps
next_steps
pending_validation
active_children
integrated_child_results
external_side_effects
blockers
decision_refs
artifact_refs
updated_at
```

secret、machine-specific absolute path、private reasoningへ依存させないでください。

### Soft checkpoint / Hard checkpoint

- soft checkpoint: same host/sandbox recovery向け。local immutable ref、filesystem snapshot、Supervisor journal、native session state等。
- hard checkpoint: sandbox/providerを失っても復旧する境界。meaningful code/work stateがdurable remote infrastructureから到達可能であること。

すべての小editをremote commitしてhistoryを汚す必要はありません。projectのRPO、task length、provider TTLからcheckpoint頻度を設計してください。

### Checkpoint trigger

最低限、次の前後で検討してください。

- meaningful implementation milestone
- risky refactor/migration
- child spawn
- child result integration
- long validation
- external side effect
- user/external input待ち
- provider TTL/shutdown接近
- graceful cancellation/shutdown signal
- context limit接近

### Recovery algorithm

fresh agentはprevious conversationを推測しないでください。

1. Issue / PR / target releaseを特定。
2. ticket branch / remote commit graphをfetch。
3. latest valid checkpointを読む。
4. canonical policy/design/decision refsを確認。
5. active childrenをSupervisorから再発見。
6. checkpointからworkspaceをrecreate。
7. completed/pending validationを再評価。
8. external side effectのactual remote stateを確認。
9. stale base / conflicting integrationを確認。
10. remaining planを再構成。
11. safeな最小verificationでreconstructed stateを確認。
12. execution generation/leaseを更新して続行。

native resumeに成功してもbranch/PR/checkpointとの整合を確認してから続行してください。

---

## 17. Parent / child recovery と split-brain防止

child lifecycleはparent model processではなくSupervisor/control planeが所有してください。

parentが死亡してもsafeならchildを即cancelしないでください。

recovered parent/coordinatorは:

- child一覧を再発見
- input snapshot / execution generationを確認
- running / completed / failed / orphanedを分類
- completed resultをimmutable resultとして回収
- stale child resultは自動統合しない
- 必要ならretry/resume/re-spawn

を行います。

network partitionやtimeout後に旧agentと新agentが同時実行される可能性を前提にしてください。

Supervisorはtaskごとにleaseまたはgeneration/fencing tokenを持たせてください。

- recovery時に `execution_generation` を進める
- worker resultへgenerationを付与
- stale generationからのbranch integration / external writeを拒否
- heartbeat消失だけで即同一side effectを再実行しない

同じticket branchへ複数generationが同時pushすることを通常運用にしないでください。

---

## 18. External side effects / idempotency

Git外の操作は中断復旧で特に危険です。

例:

- production/staging deploy
- DB migration
- package publish
- release/tag creation
- cloud resource mutation
- notification/email/comment creation
- billing/cost-producing operation

可能ならidempotency keyを使用してください。

side effect前にintent、後にresult/remote identifierをdurable journalへ記録し、recovery時はremote actual stateを確認してからretryしてください。

`command returned no response = operation did not happen` と推測してはいけません。

irreversible/destructive operationはengineering-decisionsのuser escalation policyも適用してください。

---

## 19. Tool / Skill / pluginはゼロベースで選定する

初期化時点で調査:

- native agent capability / resume behavior
- official / maintained Agent Skills
- deterministic project CLI
- framework/runtime/SDK official tooling
- first-party integration
- LSP / MCP / ACP / plugin
- recovery/snapshot/provider persistence capability

優先順位:

1. project既存のdeterministic tool
2. project-local CLI / Skill
3. native agent capability
4. project-local adapter / protocol integration
5. 明確な利点がある場合のみplugin / MCP

必要性、再現性、maintenance、security、license、context cost、cross-platform、version pinningを確認してください。

---

## 20. Architecture / design / ADR

architectureを決定・変更する場合は対象platform/framework/SDKのcurrent official guidanceを確認してください。

優先順位:

1. current official recommended architecture
2. official reference implementation / conventions
3. coherent existing architecture
4. established ecosystem convention
5. custom architecture

公式がunopinionatedな領域で存在しない推奨を捏造してはいけません。

Design-first gateが存在する変更はdesign合意後にimplementationへ進んでください。

長期的decisionはADRへ残してください。

特にADR対象:

- Agent Supervisor
- sandbox runtime/provider
- Git integration / recovery checkpoint model
- execution fencing / side-effect reconciliation
- release/sprint branching model
- environment reproducibility
- architecture migration
- package/toolchain migration
- CI/CD / quality model
- security priority model
- onboarding strategy

---

## 21. Adaptive quality profile

quality gateは全project共通の固定bundleではありません。

初期化時に実repoのlanguage / framework / runtime / SDK / app target / persistence / release targetを検出し、**実versionに対応するcurrent official guidance**を調査してください。

優先順位:

1. framework/runtime/SDK official quality/testing guidance
2. official examples/templates/starters
3. official first-party CI / GitHub Actions guidance
4. official language/toolchain guidance
5. coherent existing configuration
6. maintained ecosystem tooling
7. custom tooling

調査だけで終わらず、必要ならformatter/lint/static analysis、compiler/type-check、test infrastructure、GitHub Actions、required checks、specialized Skillまで実装・修復してください。

local gateとCI gateは可能な限り同じdeterministic entry pointを使ってください。

---

## 22. Verification taxonomy と動作確認gate

最低限次を区別してください。

### Unit

局所logic/component behavior。外部boundaryをreal integrationとして証明するものではありません。

### Smoke / connectivity（疎通）

startup、wiring、DI、DB/API接続、critical path入口が最低限成立することを安価に確認します。

### Integration（結合）

複数real component/boundary間のdata flow、transaction、persistence、service integrationを確認します。

### Contract / schema

API/event/DB/generated interface等のcompatibilityを確認します。

### E2E / system

user/system critical flowをrelease-like boundaryで確認します。

### Manual / visual

automationが不足するUI/native/hardware領域だけ明示的に使用します。

変更surface/riskからrequired verification levelをproject-specificに決めてください。

例:

- pure logic -> unit
- API/service -> unit + integration
- DB/schema/migration -> integration + schema/migration + smoke
- runtime/env/network/DI -> smoke + relevant integration
- user journey/auth/navigation -> integration/contract + E2E
- build/package/container -> build/package + smoke
- release -> full applicable integration + critical E2E/smoke + release checks

unit testだけでsmoke/integration correctnessを証明した扱いにしてはいけません。

---

## 23. Worker / integration / release gate

### Worker gate

担当scopeで高速なfocused validationを行います。

### Ticket integration gate

clean integration candidateからticketに必要なfull applicable validationを実行します。

### Release gate

`release-x-y-z -> main` 前にrelease-wide verificationを実行します。

必要に応じてfull integration、critical E2E/smoke、production build/package、browser/device/OS matrix、migration rehearsal、signing/notarization、deployment/IaC plan等を含めます。

validation途中で中断した場合、途中までのgreenをfull passとみなさないでください。check resultはcode snapshotに結び付け、stale successを再利用しないでください。

coverageは有用なprojectでproject-specific signalとして扱い、一律thresholdを盲目的に適用しないでください。

False greenは禁止です。skipped test、`.only`、ignored exit code、`|| true`、blanket suppression、CI disabling等でgreenを偽装してはいけません。

---

## 24. GitHub Actions / CI

CI/CDは原則GitHub Actionsを使用してください。

initialization時にcurrent official GitHub Actions guidanceとframework/runtimeのofficial CI examplesを確認してください。

検討対象:

- first-party setup actions
- dependency/toolchain cache
- matrix testing
- service containers
- browser/device dependencies
- artifact/report upload
- code scanning / dependency review
- concurrency / cancellation
- permissions minimization
- secrets handling
- action pinning policy
- trusted/untrusted PR behavior

CI YAMLだけにhidden validation logicを増やしすぎず、project-local deterministic commandを薄く呼ぶ構成を優先してください。

---

## 25. Security maintenance

framework/runtime/SDK/dependencyのsecurity情報はprojectで実際に使用しているversionに紐付けて継続的に扱ってください。

source priority:

1. official framework/runtime/SDK security advisory
2. official release/security announcement
3. ecosystem official advisory source
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary source

priorityはseverityだけでなくexploitability、project reachability、external exposure、required privilege、impact、fix availability、workaround quality、regression risk、release timingで決めてください。

meaningful advisoryはGitHub Issueへ変換しtarget releaseを割り当てます。critical exposed vulnerabilityではcurrent sprintを中断してpatch releaseを優先できます。

projectに適切ならdependency review、code scanning、secret scanning、container scanning、SBOM等を初期化時に導入・修復してください。

---

## 26. Reviewer separation

可能な場合implementer自身のself-reviewだけで完了させないでください。

Reviewerはclean integration candidateから最低限次を確認してください。

- requested scope completeness
- decision precedenceとの整合
- correctness / architecture consistency
- regression risk
- test adequacy / required verification level
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility
- target releaseとの整合
- recovery/checkpoint consistency when relevant

---

## 27. Onboarding / repository-controlled knowledge

fresh contributorやfresh agentがchat history/private memoryなしで開発開始・復旧できることを初期化完了条件に含めてください。

repository-controlled docsから最低限次へ到達できるようにします。

- project purpose / scope
- architecture / dependency direction / data flow / trust boundary
- bootstrap / run / migrate / seed
- worker/integration/release validation
- Issue / release branch / ticket branch / Draft PR workflow
- decision precedence
- ADR / design / Agent Skills
- troubleshooting
- release/security/recovery workflow

project規模に応じてREADME、CONTRIBUTING、`docs/architecture.md`、`docs/development.md`、`docs/troubleshooting.md`、`docs/release.md`、`docs/security.md` 等へprogressive disclosureしてください。

必要ならMermaid等でarchitecture/data flow/trust boundariesを可視化してください。

documented commandsは可能な限りfresh sandbox/CIで実際に検証してください。

architecture/runtime/workflow変更時は同じticketで関連documentationも更新してください。

---

## 28. Source / documentation / GitHub language

### Source code

英語のみを使用してください。filename、identifier、comment、developer-facing log、config identifier等を含みます。localization resourceは例外です。

### Commit

commit messageは英語を使用してください。

`<work-prefix>: <extremely concise title>`

### Internal documentation

日本語を使用してください。

### GitHub Issue / Pull Request

Issue title/body、PR title/body、review discussionは日本語を標準とします。

branch名はIssue番号またはrelease versionだけを表し、説明責務を持たせません。

---

## 29. Package / search / scripts / secret / temporary policy

JavaScript / TypeScriptでは具体的な非互換性がなければBunを標準package managerとしてください。

text searchは `rg` / `rg --files` を標準とします。

新規 `.py` scriptをautomation、generation、migration、validation、build/test support、temporary analysis目的で追加してはいけません。project本来の適切な言語、TypeScript/JavaScript、shell、PowerShell等を使用してください。

actual dotenv:

- `.env`
- `.env.development`
- `.env.production`

はGit ignoreしてください。

committed examples:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

secretをsnapshot、checkpoint、commit、log、agent resultへ含めてはいけません。

一時artifactは `.tmp/`、external reference repositoryは `.reference/` 以下に置きGit ignoreしてください。

新規container definitionは原則 `Containerfile` を使用してください。

---

## 30. Recovery test / context handoff / 初期化完了条件

### Context handoff

context window接近はfailureではなくplanned handoff eventとして扱ってください。

context不足になる前に次をstructured checkpointへ外部化してください。

- current objective
- accepted decisions
- relevant refs/files
- completed work
- current diff/checkpoint
- pending work
- validation state
- active children
- external side effects
- blockers

長いconversation summaryやprivate reasoningを保存するのではなく、fresh agentが再実行可能なoperational stateへ圧縮してください。

### Recovery drill

project/runtimeが許す範囲で定期的に:

1. ticket workをcheckpoint
2. agent/sandboxを意図的に停止
3. fresh agent/sandboxからrecovery
4. branch/children/validation/side-effect journalを再構成
5. duplicate mutationなしで続行

できることを確認してください。

### 初期化完了条件

少なくとも次を確認してください。

- fresh cloneからproject-local instructionsを発見できる
- environmentを再現できる
- macOS/Apple SiliconとWindows+WSL/Linuxでhidden host stateを最小化
- 2つ以上のimplementation workerを同時に起動してruntime/port/stateが競合しない設計
- parent -> childをimmutable snapshotで委譲可能
- child resultをimmutable commit/ref/diffとして回収可能
- `main` = released state、`release-x-y-z` = sprint integration、ticket branch = Issue番号のみ
- Issue/PRは日本語、commit/source codeは英語
- engineering decision precedenceとuser escalation boundaryが明示
- unit/smoke/integration/contract/E2E責務とrequired verification policyが明示
- stack-aware quality profileとdeterministic validation entry pointが存在
- framework/runtime security advisory intake/priority workflowが存在
- fresh contributor/new agent向けdocsが存在
- session/context消失後にfresh agentがIssue/PR/Git/checkpointからtaskを復旧可能
- provider/sandbox消失に対するhard checkpoint boundaryが定義
- execution generation/fencingでduplicate continuationを防止可能
- parent loss後にchild state/resultを再発見可能
- external side effectのambiguous retryを防ぐjournal/idempotency policyが存在
- partial/stale validationをfull passとして再利用しない
- secretがrepository/checkpoint/resultへ漏れない
- README / AGENTS / Skills / ADRに矛盾がない

最後に、生成・変更したproject-local構成、選択したSupervisor/runtime、release workflow、parallelization model、quality/security/recovery profile、validation結果、残る制約を簡潔に報告してください。
