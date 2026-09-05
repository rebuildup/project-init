# 複数AIエージェント並行駆動向けプロジェクト初期化ポリシー

このリポジトリ向けのAIコーディングエージェント環境を初期化・再整備してください。

これは一般的な `/init` の代替または補強として渡すメタプロンプトです。目的は、実際のリポジトリ、技術スタック、アーキテクチャ、ランタイム、テスト、CI/CD、開発ワークフローを調査したうえで、**複数AIエージェントが独立環境で安全に並行作業し、GitHub Issues / Projects / Pull Requestsとrelease branchを用いたversion-oriented sprintへ決定論的に統合できるproject-local開発環境**を構築することです。

この文書全文を通常taskのたびに読み込ませてはいけません。全文を読むのは、(a) このpolicyで初めて初期化する時、または (b) project-local Agent Skills / adapters / runtime policyを再構成する時だけです。

この文書全文を `AGENTS.md` や `CLAUDE.md` にコピーしてはいけません。

基本思想:

> **Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork stateのcanonical SoTとする + 1 implementation worker = 1 isolated mutable runtime + parent/child間はimmutable snapshot/result + Supervisor経由でagent lifecycleを管理 + sprintをtarget release versionとして表現 + deterministic verification + progressive disclosure + 論理的に安全な最大並列化**

---

## 1. 最優先原則

複数agent運用では、Git working treeを実行環境のisolation boundaryとして扱ってはいけません。

単一host上の複数worktreeだけでは次が共有され得ます。

- TCP/UDP port namespace
- database / Redis / queue / emulator
- filesystem外のruntime state
- process tree
- container name / volume / network
- OS-level cache
- credential / socket
- external mutable service

したがって、実装を行う各workerには独立したexecution environmentを与えてください。

原則:

- 1 implementation worker = 1 isolated workspace/runtime
- 同一内部portを複数workerが使用してよい
- DB / cache / queue / volume等のmutable stateをworker間で共有しない
- shared working directoryを複数workerが同時編集しない
- parent/child間の変更受け渡しにshared mutable filesystemを使わない
- agent lifecycleはsandbox外のSupervisorが管理する
- Git remote / canonical refsをsource stateのSoTとする
- GitHub Issues / Projectsをticket / priority / version / status / dependencyのSoTとする

Git worktreeはsandbox内部のGit実装詳細として利用できます。ただしworktree単体をprocess/network/runtime isolationとして扱ってはいけません。

---

## 2. `/init` はidempotent reconciliationにする

初期化は一度しか実行されないと仮定してはいけません。

最初に現在状態を調査し、理想状態との差分だけを変更してください。

最低限確認:

- `AGENTS.md` / agent固有adapter
- Agent Skills
- project-local plugin / MCP / protocol configuration
- sandbox / devcontainer / Containerfile / Nix configuration
- Supervisor integration
- architecture / tooling / workflow ADR
- README / internal docs
- package manager / runtime version / lockfile
- formatter / lint / type-check / static analysis
- unit / integration / E2E tests
- coverage
- CI/CD
- env examples / `.gitignore`
- GitHub Issues / Projects / PR / release workflow
- current errors / warnings
- current branch / remote / uncommitted user changes

振る舞い:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

正しい状態を理由なく再生成しないでください。変更不要も成功です。

---

## 3. Source of Truthを明示する

複数agent環境のSoTを「あるローカルdirectory」に置いてはいけません。

canonical stateは最低限、次の組み合わせで表現してください。

1. canonical Git remote
2. canonical released ref (`main` またはprojectが明示する同等branch)
3. active release integration ref (`release-x-y-z`)
4. repository-controlled environment definition
5. GitHub Issue / Projectによるdurable work state
6. ADR / design / specification

各ticket / workerは開始時に `base_sha` またはimmutable input snapshotを固定できるようにしてください。

source/work state:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient runtime execution: Supervisor

Supervisorのlocal DBやqueueはcache/execution stateとして使用できますが、復旧不能なhidden stateだけを唯一のSoTにしてはいけません。

---

## 4. Agent architecture

基本構成:

```text
Human / external caller
        │
        ▼
Root Coordinator
        │ agent tools
        ▼
Agent Supervisor / Control Plane
        │
        ├─ Sandbox A -> Worker A
        ├─ Sandbox B -> Worker B
        ├─ Sandbox C -> Reviewer C
        └─ Sandbox D -> Child Worker D
```

### Root Coordinator

責務:

- user requestの完全な理解
- acceptance criteria
- target release / release dateとの整合
- dependency graph
- Issue分解
- agent delegation
- integration ordering
- consequential decision
- final verification
- final synthesis

大量の機械的実装をCoordinator自身へ集中させないでください。

### Agent Supervisor

Supervisorはworker sandbox外で動くcontrol planeです。

責務:

- sandbox create / destroy / suspend
- workspace snapshot
- agent spawn / wait / cancel
- model / agent adapter selection
- resource / cost budget
- recursion depth / child count
- credential injection
- Git result collection
- integration support
- runtime logs / status

workerへDocker socket、host root相当権限、cloud master credential等を直接渡してsandbox生成させてはいけません。

---

## 5. Subagent spawnを第一級toolにする

利用agentがnative subagentを持つ場合でも、本policyのisolation要件を満たすか確認してください。

Coordinatorおよび許可されたparent agentから、可能なら次のlogical toolを使えるようにします。

```text
spawn_agent
wait_agent
get_agent_status
get_agent_result
send_agent_message
cancel_agent
integrate_agent_result
```

transportはnative agent API、MCP、ACP、CLI wrapper、project-local Supervisor client等から選べます。

モデルにDocker/VM/provider commandそのものを覚えさせるのではなく、agent creationを高水準toolとして公開してください。

spawn request候補:

- GitHub Issue / internal task reference
- objective / acceptance criteria
- role
- immutable input snapshot
- allowed tools
- filesystem mode
- network policy
- budget
- timeout
- maximum recursion depth
- expected result format

Supervisorはagent fork bombやunbounded costを防止してください。

---

## 6. Subagent mode

最低限、次を区別してください。

### Research

用途:

- repository exploration
- external research
- architecture investigation
- bounded analysis

原則read-onlyです。command/runtimeが相互干渉しないなら重いsandboxを必須にしなくても構いません。

### Worker

用途:

- implementation
- refactor
- test implementation
- migration
- generation
- runtime verification

必ず独立したmutable execution environmentを使用してください。

### Reviewer

用途:

- code review
- architecture review
- correctness review
- test adequacy
- integration review

review対象commit/refのclean snapshotから開始し、implementerのdirty workspaceを共有しないでください。

---

## 7. Parent -> Child はimmutable snapshot

childが必要なstateを「親の現在directoryを見れば分かる」と仮定してはいけません。

parentが未統合変更を持つ状態からchildをspawnする場合、immutable checkpointを作ってください。

方式例:

- ephemeral Git commit
- local immutable Git ref
- container/filesystem snapshot
- content-addressed workspace snapshot

次を満たしてください。

- snapshot identityを追跡可能
- spawn後のparent変更でchild inputが変化しない
- clean environmentへ再現可能
- resultとのbase relationshipを判定可能

未commit working treeの暗黙共有をsubagent protocolにしてはいけません。

---

## 8. Child -> Parent はimmutable result

childは親workspaceを直接編集して成果を返してはいけません。

resultは最低限、次を表現できる形式にしてください。

```text
agent_id
issue_or_task_id
base_snapshot
result_commit_or_ref
summary
validation_results
artifacts
known_issues
```

実装workerの標準resultはGit commitまたは同等のimmutable diffです。

CoordinatorはSupervisor経由でresultをinspect / integrate / reject / request revisionしてください。

同じdurable ticket branchへ複数agentが同時pushする設計を標準にしてはいけません。

merge conflict解消を通常のparallelization strategyにせず、ticket boundary / interface / dependency graphで事前に減らしてください。

---

## 9. Execution environment isolation

implementation workerでは最低限次を隔離してください。

- repository checkout / workspace
- process boundary
- network namespaceまたはport mapping
- writable runtime filesystem
- database state
- Redis/cache/queue state
- application local state
- test artifacts
- mutable build output

同じ内部portを全sandboxで使用して構いません。

```text
Sandbox A: app :3000, api :8000, db :5432
Sandbox B: app :3000, api :8000, db :5432
```

host公開port、preview URL、routeはSupervisor/runtime側で一意化してください。

共有しやすいもの:

- read-only base image
- immutable Nix store
- package download cache
- Cargo registry cache
- OCI layer cache
- read-only toolchain cache

共有してはいけないもの:

- application database volume
- concurrently-mutated `node_modules` / build output
- generated runtime files
- Git index / working tree
- host Docker socket
- shared dev-server process

原則は immutable/cacheable stateのみ共有し、mutable stateは隔離 です。

---

## 10. Runtime / providerは交換可能にする

特定vendorを必須にしてはいけません。

初期化時にcurrent native capabilityとecosystemを調査し、projectに適したruntimeを選んでください。

候補category:

- local container sandbox
- Dagger系execution
- devcontainer-compatible runtime
- lightweight VM
- SSH/devbox provider
- on-demand remote sandbox
- native cloud-agent machine

local/remoteで可能な限り同じenvironment definitionを再利用してください。

```text
same repository + same environment specification
    -> macOS local sandbox
    -> WSL/Linux local sandbox
    -> remote sandbox
```

remote computeは可能ならtask lifecycleに合わせてcreate/destroyしてください。

provider固有差分はSupervisor adapterへ閉じ込め、project semanticsへ漏らしすぎないでください。

---

## 11. Release sprint / Issue / Branch / Draft PR workflow

開発の基本単位をlocal `main`上の直接作業から、**target versionを持つrelease sprint + GitHub Issue中心のticket-driven development**へ置き換えてください。

### Branch hierarchy

標準:

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

意味:

- `main`: リリース済み・統合済みsource state
- `release-x-y-z`: target semantic versionを表すsprint integration branch
- `<issue-number>`: 1 durable ticket branch

### Sprint = target release version

スプリントを任意の連番で識別してはいけません。

各sprintは1つのtarget semantic versionを持ちます。

release branch canonical format:

`release-<major>-<minor>-<patch>`

例:

- `release-0-1-0`
- `release-0-2-0`
- `release-1-0-0`

Git branch上ではversion separatorに `.` ではなく `-` を使います。

sprint開始時に `main` から対象release branchを作成してください。

### Issue

独立して計画・実装・レビューできるdurable work itemは原則Issueにしてください。

Issue title/bodyは日本語を標準とします。

必要に応じて:

- 目的 / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size / estimate
- area / component
- target version
- release date

を持たせてください。

短命なresearch subagentやnested implementation subtaskをすべてIssue化する必要はありません。

**durable planning unit = GitHub Issue**

**ephemeral execution unit = Supervisor task**

### GitHub Projects / Kanban

利用可能ならGitHub Projectsをcanonical work boardとして使用してください。

最低限のStatus:

`Backlog -> Ready -> In Progress -> In Review -> Done`

推奨field:

- Priority
- Size
- Target Version
- Area / Component
- Blocked / dependency

WIPを無制限に増やしてはいけません。

### Ticket branch naming

1 top-level Issueにつき1 durable ticket branchを作ります。

canonical format:

`<issue-number>`

例:

- `123`
- `418`
- `1024`

branch名に `issue/` prefix、slug、title、work type等を入れてはいけません。

Issue番号だけでticket identityは一意に表せます。説明責務はIssue/PRに置いてください。

nested workerが返すephemeral ref/commitはこの命名規則の対象外です。

### Draft PR first

Issue開始後、ticket branchに意味のある最初のcommitができた段階で、可能な限り早くDraft PRを作成してください。

PR baseは、そのticketが所属する `release-x-y-z` branchです。

Draft PRは完成報告ではなくdurable integration surfaceとして使用します。

用途:

- Issue linkage
- progress visibility
- early CI
- reviewer context
- agent/human discussion
- scope inspection

PR title/body/review discussionは日本語を標準とします。

PR本文には最低限:

- linked Issue / `Closes #<issue-number>`
- acceptance criteria
- 変更概要
- validation status/results
- known limitations / blockers
- target release

を含めてください。

### Ready for review

DraftからReady for reviewへ移す条件:

- Issue acceptance criteriaを実装済み
- ticket-level quality gateを実行済み
- blocking known issueが解消済み、または明示的にscope外
- PR descriptionが現在の実装と一致
- target release branchとのstaleness/conflictを処理済み

### Ticket merge / Done

IssueのDone標準境界:

- acceptance criteria satisfied
- required CI/checks green
- blocking review resolved
- release branchとのstaleness handled
- ticket PR merged into target `release-x-y-z`
- linked Issue closed
- GitHub Project status = Done

workerが「完了」と返しただけではDoneにしないでください。

Issueはrelease branchへ統合された時点でDoneになり得ます。`main`へのrelease mergeを各IssueのDone条件にはしません。

### Release integration

sprint対象ticketを統合したrelease branch上でfull applicable quality gateを実行してください。

release PR:

`release-x-y-z -> main`

を作成します。

release PR title/bodyは日本語を標準とし、最低限:

- release goal
- included Issues / PRs
- breaking changes
- migration notes
- full validation result
- known limitations
- release/version metadata

を含めてください。

release PR merge後、`main` がそのversionのreleased source stateになります。

---

## 12. Task graphと最大安全並列化

非自明なIssueをdependency graphへ分解してください。

各durable nodeに最低限:

- Issue ID
- objective
- acceptance criteria
- prerequisites
- input snapshot
- output contract
- owner role
- target release
- integration target

を持たせます。

unfinished prerequisiteがないReady nodeは、resource/WIP制約内で可能な限り並行起動してください。

「同じfileを触るから必ず直列」という判定だけに依存してはいけません。isolated sandboxでは同一fileを別taskが編集できます。

ただし、同一interfaceを互換性なく変更するtask、同一generated artifactを競合生成するtask、同じexternal mutable resourceへ書き込むtask等はdependencyを付けるか隔離してください。

---

## 13. 自律実行ループ

非自明な実装では:

`inspect -> plan release -> ticketize -> decompose -> snapshot -> delegate/implement -> verify -> integrate ticket -> review -> update board -> verify release -> replan -> continue`

を回してください。

compileが通った、focused testが1つ通った、first implementationがもっともらしい、という理由だけで終了してはいけません。

full requested scopeまたはrelease/sprint acceptanceを完了するか、本物のexternal/user gateに到達するまで継続してください。

要求されたtaskを独自にMVPへ縮小してはいけません。

---

## 14. Root agent fileはdispatcherにする

対応している場合、`AGENTS.md` をagent横断のcanonical project contractとして使用してください。

rootにはほぼ全taskへ作用する不変条件だけを置きます。

例:

- project identity / boundaries
- `main` / active release branch / source SoT
- GitHub Project / Issue work SoT
- environment bootstrap entry point
- Supervisor / subagent entry point
- validation entry point
- language policy
- design approval gate
- Skill discovery

詳細はAgent Skillsへ分離してください。

標準Skill候補:

1. `parallel-orchestration`
2. `sandbox-runtime`
3. `github-delivery`
4. `quality-gate`

必要に応じてarchitecture/design/ADR、debugging、dependency hygiene、UI/browser、container/IaC、review、release/versioning、external docs等を追加してください。

通常taskではroot agent fileから必要Skillだけを参照し、このfull promptを再読しない構成にしてください。

---

## 15. Tool / Skill / pluginはゼロベースで選定する

この文書に出てくる製品名をmandatory bundleとして扱ってはいけません。

初期化時点で調査:

- agent native capabilities
- subagent / sandbox capability
- current project configuration
- official plugin marketplace
- official / maintained Agent Skills
- MCP / ACP / agent protocols
- first-party integrations
- deterministic CLI
- framework / SDK official tooling

優先順位:

1. project既存のdeterministic tool
2. project-local CLI / Skill
3. native agent capability
4. project-local adapter / protocol integration
5. 明確な利点がある場合のみplugin / MCP

必要性、再現性、maintenance、security、license、context cost、cross-platform、version pinningを確認してください。

主要なagent runtime / Supervisor / sandbox選定はADRへ残してください。

---

## 16. 開発環境と再現性

第一級target:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandbox

### macOS / Apple Silicon

- `arm64`を第一級architectureとして扱う
- portable Web/backend taskは可能な限りLinux sandboxで実行し、CI/remoteとの差を減らす
- Xcode/iOS/macOS-native taskはmacOS-native workerを許可
- Apple-native workerでもworkspace isolationとimmutable resultを維持する

### Windows + WSL2

- Linux-oriented repositoryは高頻度build/watchではWSL Linux filesystem側を優先
- WSL自体をworker isolationとみなさない
- 複数workerには別container/VM/sandbox boundaryを設ける
- Windows host / WSL / container間のport差はruntime adapterへ閉じ込める

Docker Desktopを必須前提にしてはいけません。

system dependencyの再現性に意味がある場合、Nix flake/dev shell、Containerfile、devcontainer等のdeclarative environmentを優先してください。

fresh cloneから:

`clone -> bootstrap -> sandbox create -> install -> migrate/seed -> app/test start -> validation`

を再現できる状態を目標にしてください。

---

## 17. Architecture / design / ADR

既存コードを最優先で調査してください。

architectureを決定・変更する場合は対象platform/framework/SDKの現在のofficial guidanceを確認してください。

優先順位:

1. current official recommended architecture
2. official reference implementation / conventions
3. coherent existing architecture
4. established ecosystem convention
5. custom architecture

公式が意図的にunopinionatedな領域で存在しない推奨を捏造してはいけません。

### Design-first

design/specificationが存在する変更では:

1. current designを読む
2. 必要変更を整理
3. userと合意
4. design更新
5. implementation

の順を守ってください。

長期的decisionはADRへ残してください。

特にADR対象:

- Agent Supervisor
- sandbox runtime/provider
- Git integration model
- release/sprint branching model
- environment reproducibility strategy
- architecture migration
- package/toolchain migration
- CI/CD
- test strategy

---

## 18. Source / documentation / GitHub language

### Source code

英語のみを使用してください。

対象:

- filename / directory
- identifiers
- class/function/component/test names
- code comments
- developer-facing logs
- config identifiers

localization resourceは例外です。

### Commit

commit messageは英語を使用してください。

format:

`<work-prefix>: <extremely concise title>`

### Internal documentation

日本語を使用してください。

### GitHub Issue / Pull Request

Issue title/body、PR title/body、review discussionは日本語を標準とします。

branch名に説明責務を持たせないでください。branchはIssue番号またはrelease versionだけを表します。

---

## 19. Package / search / scripts

JavaScript / TypeScriptでは、具体的な非互換性がなければBunを標準package managerとしてください。

- `bun`
- `bun run`
- `bunx`
- Bun lockfile

text searchは `rg` / `rg --files` を標準とします。

新規 `.py` scriptをautomation、generation、migration、validation、build/test support、temporary analysis目的で追加してはいけません。

原則としてTypeScript/JavaScript、shell、PowerShell、またはproject本来の適切な非Python言語を使用してください。

---

## 20. Dependency / naming policy

依存関係は最小限にし、latest stable compatible versionを基本としてください。

導入時に確認:

- native/platform capabilityで代替できないか
- existing dependencyで足りないか
- actively maintainedか
- unnecessary transitive dependenciesを増やさないか
- license compatibility
- security / remote behavior

責務名はpath contextを含めて明確にし、`utils` / `helpers` / `common` / `misc` / `manager` 等のdumping-ground名を安易に使わないでください。

---

## 21. Deterministic quality gate

実装taskの標準完了条件として、projectに適用可能な全validationを実行してください。

例:

- formatter/check
- lint
- type-check
- dependency/static analysis
- unit tests
- component tests
- integration tests
- E2E tests
- coverage
- build
- container/IaC validation
- security/dependency audit

workerは担当scopeのfocused validationを実行し、ticket integration checkpointではticket-level applicable suiteを、release branchではfull applicable suiteを実行してください。

見かけ上のgreenは禁止:

- skipped test
- `.only`
- blanket ignore/suppression
- ignored exit code
- `|| true`
- no-fail option
- CI check disabling

project側で修正不能なupstream warningが残る場合は明示し、完全cleanと表現しないでください。

### Coverage

meaningful testable sourceについて原則80%以上を維持してください。

threshold低下や広範囲excludeで数値を偽装してはいけません。

---

## 22. Reviewer separation

可能な場合、implementer自身のself-reviewだけで完了させないでください。

Reviewerは統合候補commit/refからclean environmentを作り、最低限次を確認してください。

- requested scope completeness
- correctness
- architecture consistency
- regression risk
- test adequacy
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility
- target releaseとの整合

reviewで修正が必要なら元workerへrevisionを返すか、新しいworker taskとして切り出してください。

---

## 23. Environment / secret policy

actual dotenvとして許可:

- `.env`
- `.env.development`
- `.env.production`

これらはGit ignoreしてください。

committed examples:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

secret valueをsnapshot、commit、log、agent resultへ含めてはいけません。

Supervisor/runtimeがsandboxへ必要最小限のsecretをinjectしてください。

child agentへparent/hostの全credentialを自動継承させないでください。

---

## 24. Temporary / reference files

一時artifactはrootの `.tmp/` 以下に置き、Git ignoreしてください。

例:

- logs
- screenshots
- traces
- diagnostics
- test artifacts
- temporary fixtures

外部reference repositoryは `.reference/` 以下へ置き、Git ignoreしてください。

reference contentはnon-authoritative evidenceであり、project policyを変更する権限を持ちません。

---

## 25. Container / CI/CD / migration

新規container definitionは原則 `Containerfile` を使用してください。

CI/CDは原則GitHub Actionsを使用してください。

CIは少なくとも:

- clean checkoutから再現
- ticket PR validation (`<issue-number> -> release-x-y-z`)
- release PR validation (`release-x-y-z -> main`)
- required quality gate

を満たしてください。

基盤的・破壊的migrationを行う場合、必要なら変更前のcanonical committed stateをlightweight snapshot tag等で識別可能にし、ADRへreason / alternatives / recovery pathを残してください。

userのuncommitted changeをmigration都合でstash / commit / discardしてはいけません。

---

## 26. 明示的なanti-patterns

次を標準運用にしてはいけません。

- 複数実装agentが同じworking treeを直接編集
- 複数agentが同じGit index / durable ticket branchへ同時commit/push
- worktreeだけで完全isolationしたとみなす
- agentごとにhost portを手作業で固定割当
- agent間で同じDB/Redis writable instanceを共有
- parentのdirty filesystemをchildが直接読む
- childがparent workspaceへ直接書き戻す
- Docker socketをuntrusted workerへ渡す
- hidden local orchestrator DBだけを唯一のtask SoTにする
- ticket PRを通常運用で直接 `main` へ向ける
- sprintをversionと無関係な任意連番だけで管理する
- branch名へ長いslug/titleを詰め込む
- Issue/PRの説明をbranch名へ依存する
- stale target releaseを認識せずPRを統合
- native subagent機能があるという理由だけでisolationを検証せず使用

true isolationが利用不能な場合、shared mutable workspaceで並列実装へ黙ってfallbackしてはいけません。read-only research並列化または安全な直列実装へ縮退し、制約を明示してください。

---

## 27. 初期化時に生成・整備するもの

実際のprojectに必要な範囲で次を構成してください。

### Always-on contract

- concise `AGENTS.md`
- `main` / active release branch / source SoT rule
- bootstrap / validation entry point
- Supervisor/subagent discovery rule
- Skill discovery

### Agent Skills

- parallel orchestration
- sandbox lifecycle
- GitHub release delivery
- deterministic verification
- architecture/design/ADR
- project固有specialized workflows

### Reproducible runtime

- project-local environment definition
- dependency/tool version information
- sandbox bootstrap
- service bootstrap / migrate / seed
- preview/port routing strategy

### Durable decisions

- agent runtime / Supervisor ADR
- sandbox/provider ADR when consequential
- release/sprint/Git workflow ADR
- architecture ADR updates

### GitHub

- Issue template / conventions where useful
- GitHub Project/Kanban fields
- target release/version workflow
- `release-x-y-z` branch convention
- number-only ticket branch convention
- Draft PR workflow
- ticket PR and release PR quality gates

不要なframework、plugin、MCP、custom orchestratorを形式だけのために導入してはいけません。native capabilityで要件を満たすならそれを利用してください。

---

## 28. 初期化完了条件

初期化を完了と報告する前に、少なくとも次を確認してください。

- fresh cloneからproject-local instructionsを発見できる
- environmentを再現できる
- macOS/Apple SiliconとWindows+WSL/Linuxでhost-specific hidden stateを最小化している
- 2つ以上のimplementation workerを同時に起動してもruntime/port/stateが競合しない設計
- parent -> childをimmutable snapshotで委譲可能
- child resultをimmutable commit/ref/diffとして回収可能
- shared mutable working treeを複数agentが直接編集しない
- `main` がreleased source stateとして定義されている
- sprintがtarget semantic versionとして定義されている
- release branch formatが `release-<major>-<minor>-<patch>`
- ticket branch formatが `<issue-number>` のみ
- ticket PR targetが該当release branch
- release PRが `release-x-y-z -> main`
- Issue/PRは日本語、commitは英語というlanguage policyが反映されている
- deterministic validation entry pointが存在する
- README / AGENTS / Skills / ADRに矛盾がない
- secretがrepositoryやagent resultへ漏れない
- providerが失われてもcanonical Git/GitHub stateから復旧可能

最後に、生成・変更したproject-local構成、選択したSupervisor/runtime、release workflow、並列化model、validation結果、残る制約を簡潔に報告してください。
