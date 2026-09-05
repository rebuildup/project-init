# 複数AIエージェント並行駆動向けプロジェクト初期化ポリシー

このリポジトリ向けのAIコーディングエージェント環境を初期化・再整備してください。

これは一般的な `/init` の代替または補強として渡すメタプロンプトです。目的は、実際のリポジトリ、技術スタック、アーキテクチャ、ランタイム、テスト、CI/CD、開発ワークフローを調査したうえで、**複数のAIエージェントが互いの実行状態を壊さず、独立環境で安全に並行作業し、GitHub Issues / Projects / Pull Requestsを中心とするticket-drivenなアジャイル開発へ統合できるproject-local開発環境**を構築することです。

この文書全文を通常タスクのたびに読み込ませてはいけません。全文を読むのは、(a) このポリシーで初めて初期化する時、または (b) project-local Agent Skills / adapter / runtime policyを再構成する時だけです。

この文書全文を `AGENTS.md` や `CLAUDE.md` にコピーしてはいけません。

基本思想は次です。

> **Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork stateのcanonical SoTとする + mutable execution stateをagentごとに隔離する + immutable snapshot/resultで委譲する + supervisor経由でagent lifecycleを管理する + ticket/PR単位で統合する + deterministic verificationを最大化する + 論理的に安全な最大並列化を行う**

---

## 1. 最優先原則

複数エージェント運用では、Git working treeを実行環境のisolation boundaryとして扱ってはいけません。

特に、単一host上の複数worktreeだけでは次が共有され得ます。

- TCP/UDP port namespace
- database / Redis / queue / emulator
- filesystem外のruntime state
- process tree
- container name / volume / network
- OS-level cache
- credentials / socket
- external service state

したがって、**実装を行う各worker agentには独立したexecution environmentを与えること**を標準とします。

原則:

- 1 implementation worker = 1 isolated workspace/runtime
- 同一内部portを複数agentが使用してよい
- database、cache、queue、volume等のmutable stateをagent間で共有しない
- shared working directoryを複数agentが同時編集しない
- parent/child間の変更受け渡しにshared filesystemを使わない
- agent lifecycleはsandbox外のSupervisorが管理する
- Git remote / canonical refsをsource-code stateのSoTとする
- GitHub Issues / Projectsをticket / sprint / status / dependencyのSoTとする

Git worktreeは、sandbox内部のGit実装詳細として利用することは許可します。しかし、**worktree単体をprocess/network/runtime isolationとして扱うことは禁止**します。

---

## 2. `/init` はidempotent reconciliationにする

この処理は一度しか実行されないと仮定してはいけません。

最初に既存状態を調査し、理想状態との差分だけを変更してください。

最低限確認:

- `AGENTS.md`
- Agent Skills
- agent固有adapter
- project-local agent/runtime configuration
- sandbox / devcontainer / container / Nix configuration
- Supervisor integration
- architecture / agent-tooling ADR
- README / internal docs
- package manager / runtime version / lockfile
- formatter / lint / type-check / static analysis
- unit / integration / E2E test
- coverage
- CI/CD
- env examples / `.gitignore`
- GitHub Issues / Pull Requests / Projects / milestones / release workflow
- current errors / warnings
- current branch / remote / uncommitted user changes

振る舞い:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

正しい状態を理由なく再生成しないでください。変更不要も成功です。

---

## 3. Source of Truthを明示する

複数agent環境のSoTを「あるローカルdirectory」に置いてはいけません。

canonical project stateは最低限、次の組み合わせで表現してください。

1. canonical Git remote
2. canonical base ref / base commit SHA
3. repository-controlled environment definition
4. GitHub Issue / Projectによるdurable work state
5. ADR / design / specification

各実装ticketは開始時に `base_sha` を固定できるようにしてください。

概念:

```text
origin/main @ abc123
├─ issue #101: base_sha=abc123 + result A
├─ issue #102: base_sha=abc123 + result B
└─ issue #103: depends_on=#101 + result C
```

「最新のdirectoryがどれか」をSoT判断に使ってはいけません。

### Source state と work state を分離する

- code / config / design state: Git repository
- ticket / priority / status / sprint / dependency: GitHub Issues / Projects
- review / integration: GitHub Pull Requests
- runtime transient state: Supervisor

Supervisorのlocal databaseやqueueはcache / execution stateとして使用できますが、復旧不能なhidden stateだけをtask managementの唯一のSoTにしてはいけません。

---

## 4. Agent architecture

基本構成は次とします。

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
- sprint goal / release goalとの整合
- dependency graph
- ticket decomposition
- agent delegation
- integration ordering
- consequential decision
- final verification
- final synthesis

Root Coordinator自身へ大量の機械的実装を集中させないでください。

### Agent Supervisor

Supervisorはsandboxの外側で実行されるcontrol planeです。

責務:

- sandbox create / destroy / suspend
- workspace snapshot
- agent spawn / wait / cancel
- model / agent adapter selection
- resource budget
- recursion depth / child count
- credential injection
- Git result collection
- integration support
- runtime logs / status

agentへDocker socket、host root相当権限、cloud master credential等を直接渡して、agent自身にsandboxを自由生成させてはいけません。

### Worker / Reviewer

各agentは必要最小限のcapabilityだけを受け取ります。

agent種類は固定製品名ではなく論理roleとして定義してください。

---

## 5. Subagent spawnを第一級toolにする

利用するagentがnative subagentを持つ場合でも、実装workerのisolation要件を満たすか確認してください。

理想的にはRoot Coordinatorおよび必要なparent agentから、次のような論理toolを利用可能にします。

```text
spawn_agent
wait_agent
get_agent_status
get_agent_result
send_agent_message
cancel_agent
integrate_agent_result
```

具体的なtransportはnative agent API、MCP、ACP、CLI wrapper、project-local Supervisor client等から選択してください。

モデルにDocker/VM/container commandそのものを覚えさせるのではなく、**agent creationを高水準toolとして公開**してください。

spawn requestには必要に応じて次を含めます。

- GitHub Issue / internal task reference
- task / acceptance criteria
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

任意の小さい固定agent数を理由なく設定してthroughputを落としてはいけませんが、resource / rate / quota / cost / depthの実制約は明示的に守ってください。

---

## 6. Subagentの3種類

最低限、次のlogical modeを区別してください。

### Research

用途:

- repository exploration
- external research
- architecture investigation
- bounded analysis

原則read-onlyです。コード変更を返さない場合、重い独立runtimeを必須にする必要はありません。ただしcontextやcommand実行が相互干渉するなら隔離してください。

### Worker

用途:

- implementation
- refactor
- test implementation
- migration
- code generation
- runtime verification

**必ず独立したmutable execution environment**を使用してください。

### Reviewer

用途:

- code review
- architecture review
- correctness review
- test adequacy
- integration review

review対象commit/refのclean snapshotから開始し、implementerのdirty workspaceを直接共有しないでください。

---

## 7. ParentからChildへはsnapshotで渡す

子agentが必要とするstateを「親の現在directoryを見れば分かる」と仮定してはいけません。

parentが未統合変更を持つ状態からchildをspawnする場合、最初にimmutable checkpointを作成してください。

利用可能な方式例:

- ephemeral Git commit
- local immutable Git ref
- container / filesystem snapshot
- content-addressed workspace snapshot

方式はplatformに合わせて選べますが、次を満たしてください。

- snapshot identityを追跡可能
- child inputがspawn後に親の変更で変化しない
- clean environmentへ再現可能
- resultとのbase relationshipを判定可能

未commit working treeの暗黙共有をsubagent protocolにしてはいけません。

---

## 8. ChildからParentへはimmutable resultで返す

child agentは親workspaceを直接編集して成果を返してはいけません。

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

parent / coordinatorはSupervisor経由でresultを:

- inspect
- cherry-pick / merge / rebase相当
- reject
- request revision

してください。

同じbranchへ複数agentが同時pushする設計を標準にしてはいけません。

merge conflictは起こり得ますが、merge conflict解消を通常のparallelization strategyにしてはいけません。ticket boundary / interface / dependency graphで可能な限り事前に減らしてください。

---

## 9. Execution environment isolation

実装worker environmentでは最低限次を隔離してください。

- repository checkout / workspace
- process namespaceまたは同等のprocess boundary
- network namespaceまたはport mapping
- writable runtime filesystem
- database state
- Redis/cache/queue state
- application local state
- test artifacts
- mutable build output

同じ内部portを全sandboxで使用して構いません。

例:

```text
Sandbox A: app :3000, api :8000, db :5432
Sandbox B: app :3000, api :8000, db :5432
```

host公開port、preview URL、routeはSupervisor/runtime側で一意化してください。

共有を許可しやすいもの:

- read-only base image
- immutable Nix store
- package download cache
- Cargo registry cache
- OCI layer cache
- read-only toolchain cache

共有してはいけないもの:

- application database volume
- mutable node_modules/target when concurrent mutation occurs
- generated runtime files
- Git index / working tree
- host Docker socket
- shared dev server process

原則は **immutable/cacheable stateのみ共有し、mutable stateは隔離** です。

---

## 10. Runtime / providerは交換可能にする

特定vendorを必須にしてはいけません。

初期化時に現在のnative capabilityとecosystemを調査し、projectに適したruntimeを選んでください。

候補のcategory:

- local container sandbox
- Dagger系execution
- devcontainer-compatible runtime
- lightweight VM
- SSH/devbox provider
- on-demand remote sandbox
- native cloud agent machine

localとremoteで可能な限り同じenvironment definitionを再利用してください。

理想:

```text
same repository + same environment specification
    -> macOS local sandbox
    -> WSL/Linux local sandbox
    -> remote sandbox
```

remote computeを使う場合も、常時起動VMを前提にせず、可能ならtask lifecycleに合わせたcreate/destroyを優先してください。

provider固有の設定をproject contractへ漏らしすぎず、Supervisor adapterの境界へ閉じ込めてください。

---

## 11. GitHub ticket / sprint / PR workflow

開発の基本単位をlocal `main`上の直接作業から、**GitHub Issueを中心としたticket-driven development**へ置き換えてください。

`origin/main` またはprojectが定義するcanonical integration branchをsource-code SoTとします。

### GitHub Issue

独立して計画・実装・レビューできるwork itemは原則Issueにしてください。

各Issueには必要に応じて:

- objective / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size / estimate
- area / component
- target sprint / iteration
- target release / milestone

を持たせてください。

大きすぎるIssueは、レビュー可能・merge可能な縦切りticketへ分割してください。

ただし、1つのIssue内部で実行される短命なresearch subagentやimplementation subtaskをすべてGitHub Issue化する必要はありません。**durable planning unitはIssue、ephemeral execution unitはSupervisor task**として分離してください。

### GitHub Projects / Kanban

利用可能ならGitHub Projectsをcanonical work boardとして使用してください。

最低限のfield候補:

- Status: Backlog / Ready / In Progress / In Review / Done
- Priority
- Size
- Iteration / Sprint
- Area / Component
- Target Release

project規模に応じてBlocked / dependency情報も可視化してください。

WIPを無制限に増やしてはいけません。CoordinatorはReadyなticketからdependencyとcapacityを見て並列起動し、In Progressを実際の実行中taskと同期させてください。

### Sprint / iteration

明示的なtimeboxで運用してください。

各sprintで:

1. sprint goalを決める
2. Ready ticketを選ぶ
3. dependency graphを確認する
4. capacity / agent budgetを割り当てる
5. parallel workerを起動する
6. PR / review / CIでDone判定する
7. unfinished ticketを自動的に「完了扱い」せず再計画する

release日が存在するprojectでは、milestone / release goalとsprintを接続してください。

### Branch / PR

標準:

- 1 top-level Issue = 1 integration branch = 1 PRを基本とする
- branch名にはIssue番号と短いslugを含める
- workerはintegration branchそのものを複数agentで直接共有しない
- worker resultはimmutable commit/refとしてCoordinatorへ返す
- Coordinator/Supervisorだけがintegration branchへ順序立てて統合する
- PRはIssueを明示的にlinkし、mergeでcloseできる場合は `Closes #<id>` を使用する
- PR本文にacceptance criteria、変更概要、validation結果、known limitationsを含める
- merge前にcanonical baseとのstalenessを確認する

nested subagentごとにGitHub PRを作る必要はありません。内部workerはephemeral ref/commitでよく、top-level IssueのPRへまとめてください。

canonical branchが進んだ場合、盲目的に「最新mainへ常時同期」せず、integration時にrebase / merge / rerunの必要性を判断してください。

Git / GitHub messageは英語で記述してください。

commit:

`<work-prefix>: <extremely concise title>`

Issue / PRも簡潔な英語title + structured summaryとしてください。

---

## 12. Task graphと最大安全並列化

非自明なIssueをdependency graphへ分解してください。

各durable nodeには最低限:

- Issue ID
- objective
- acceptance criteria
- prerequisites
- input snapshot
- output contract
- owner role
- integration target

を持たせます。

unfinished prerequisiteがないReady nodeは、resource制約とWIP制約内で可能な限り並行起動してください。

従来の「同じfileを触るから必ず直列」という判定だけに依存してはいけません。isolated sandboxでは同一fileを別taskが編集できます。

ただし、同一interfaceを互換性なく変更するtask、同一generated artifactを競合生成するtask、同じexternal mutable resourceへ書き込むtask等はdependencyを付けるか隔離してください。

phase dependencyがある場合:

```text
Phase 1: parallel Issues
   ↓ integration checkpoint
Phase 2: parallel Issues
   ↓ integration checkpoint
Phase 3: parallel Issues
```

としてください。

---

## 13. 自律実行ループ

非自明な実装taskでは:

`inspect -> plan -> ticketize -> decompose -> snapshot -> delegate/implement -> verify -> integrate -> review -> update board -> replan -> continue`

を自律的に回してください。

compileが通った、focused testが1つ通った、first implementationがもっともらしい、という理由だけで終了してはいけません。

full requested scopeまたはsprint acceptanceを完了するか、本物のexternal/user gateに到達するまで継続してください。

要求されたtaskを独自にMVPへ縮小してはいけません。

---

## 14. Root agent fileはdispatcherにする

対応している場合、`AGENTS.md` をagent横断のcanonical project contractとして使用してください。

rootにはほぼ全taskへ作用する不変条件だけを置きます。

例:

- project identity / boundaries
- canonical Git branch / source SoT
- GitHub Project / Issue work SoT
- environment bootstrap entry point
- Supervisor / subagent entry point
- validation entry point
- language policy
- design approval gate
- Skill discovery

詳細はAgent Skillsへ分離してください。

### 標準Skill分割

少なくとも次の4つを独立Skillとして構成することを第一候補にしてください。

1. `parallel-orchestration`
   - task graph
   - subagent spawn/wait/result
   - snapshot delegation
   - integration ordering

2. `sandbox-runtime`
   - local/remote provider
   - macOS / WSL/Linux differences
   - network/DB/runtime isolation
   - bootstrap / preview routing

3. `github-delivery`
   - Issues
   - Projects/Kanban
   - sprint/iteration
   - branch/PR/review/merge
   - board state transition

4. `quality-gate`
   - formatter/lint/type-check/static analysis
   - tests/coverage/build
   - integration verification

必要に応じてarchitecture/design/ADR、debugging、dependency hygiene、UI/browser、container/IaC、release/versioning、external docs等を追加してください。

通常taskではroot agent fileから必要Skillだけを短く参照し、このfull promptを再読しない構成にしてください。

複数agent向けに同じ全文をコピーせず、canonical Skill source + thin adapterを優先してください。

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

選定時は必要性、再現性、maintenance、security、license、context cost、cross-platform、version pinningを確認してください。

主要なagent runtime / Supervisor / sandbox選定はADRへ残してください。

---

## 16. macOS / Windows+WSL / Linux開発環境

このpolicyはhost OSを1つに固定しません。

第一級target:

- macOS（特にApple Silicon）
- Windows 11 + WSL2 / WSL Containers
- native Linux / NixOS
- container上のNixOS
- 必要に応じたremote Linux sandbox

### 共通原則

project-local environment definitionはhost OS固有pathやmanual setupへ過度に依存させず、可能な限り:

- Containerfile
- devcontainer-compatible definition
- Nix flake / dev shell
- declarative bootstrap script

等で表現してください。

portable Web/backend taskは、macOSでもWindows/WSLでも原則Linux sandbox内で実行し、CI/remoteとのenvironment driftを減らしてください。

macOS/iOS/Xcode等、Apple native environmentが本質的に必要なtaskだけはmacOS-native workerを使用できます。その場合もworkerごとのworkspace/runtime isolationとimmutable result semanticsを維持してください。

### macOS

Apple Siliconでは`arm64`を第一級architectureとして扱ってください。

確認:

- dependency / binary / container imageのarm64対応
- multi-arch image availability
- x86_64 emulationが暗黙前提になっていないか
- file notification / volume performance
- host networkingとcontainer networkingの差

Docker Desktopを必須にしてはいけません。利用可能なcurrent local container/VM runtimeを調査し、project要件に適したものを選択してください。

portable projectでhost macOSへsystem packageを大量に直接installする構成を標準にせず、sandboxまたはdeclarative dev environmentへ閉じ込めてください。

### Windows + WSL2

Windows側とLinux側のfilesystem/network/process semanticsを混同しないでください。

原則:

- Linux-oriented repositoryはWSL Linux filesystem内へ置くことを優先
- `/mnt/c` 等のWindows-mounted filesystemを高頻度build/watchの標準workspaceにしない
- WSL内のcontainer/runtimeが実際に利用可能か確認
- Windows host portとWSL/container port forwardingをSupervisor側で抽象化
- permission / executable bit / symlink / line-ending差をvalidationする
- Windows固有処理が必要な場合だけPowerShell/native workerを使用

WSL自体を「agentごとのisolation」とみなしてはいけません。複数workerをWSL内で動かす場合も、workerごとのcontainer/VM/sandbox boundaryを設けてください。

### Architecture portability

Apple Silicon localとx86_64 remote/CIが混在する場合、少なくともdependency install/build/testのarchitecture差を検証してください。

runtime/provider差によってproject semanticsを変えず、adapter層へ閉じ込めてください。

fresh cloneから次を再現できる状態を目標にしてください。

```text
clone
-> bootstrap
-> sandbox create
-> dependency install
-> migrate / seed
-> app/test start
-> validation
```

machine-specific undocumented stateへ依存してはいけません。

---

## 17. Architecture / design / ADR

既存コードを最優先で調査してください。

architectureを決定・変更する場合は、対象platform/framework/SDKの現在のofficial guidanceを確認してください。

優先順位:

1. current official recommended architecture
2. official reference implementation / conventions
3. coherent existing architecture
4. established ecosystem convention
5. custom architecture

公式が意図的にunopinionatedな領域で、存在しない推奨を捏造してはいけません。

### Design-first

design/specificationが存在する変更では:

1. current designを読む
2. 必要な変更を整理
3. userと合意
4. design更新
5. implementation

の順を守ってください。

長期的decisionはADRへ残してください。

特にADR対象:

- Agent Supervisor
- sandbox runtime/provider
- macOS / WSL/Linux portability strategy
- GitHub Issue/Project/PR delivery model
- Git integration model
- environment reproducibility strategy
- architecture migration
- package/toolchain migration
- CI/CD
- test strategy

---

## 18. Source / documentation language

### Source code

英語のみを使用してください。

対象:

- filenames / directories
- identifiers
- class/function/component/test names
- code comments
- developer-facing logs
- config identifiers

localization resourceは例外です。

### Internal development docs

日本語で記述してください。

### Git / GitHub

英語で記述してください。

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
- arm64 / x86_64 portability when relevant

責務名はpath contextを含めて明確にし、`utils` / `helpers` / `common` / `misc` / `manager` 等のdumping-ground名を安易に使わないでください。

---

## 21. Deterministic quality gate

実装ticketの標準完了条件として、projectに適用可能な全validationを実行してください。

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

workerは担当scopeのfocused validationを実行し、integration checkpointではCoordinatorまたは専用verification agentがfull applicable suiteを実行してください。

PRをDoneへ進める前にCIとrequired checksを通してください。

見かけ上のgreenは禁止:

- skipped test
- `.only`
- blanket ignore
- blanket suppression
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

- Issue acceptance criteria completeness
- correctness
- architecture consistency
- regression risk
- test adequacy
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility
- GitHub PR descriptionと実装の一致

reviewで修正が必要なら、元workerへrevisionを返すか、新しいworker taskとして切り出してください。

重大な追加scopeが判明した場合は、PR内へ無制限に膨張させず、新しいIssueへ分離することを検討してください。

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
- required quality gate
- Issue-linked PR validation
- canonical integration branch validation

を満たしてください。

必要に応じてPR label、required reviewer、auto-merge、merge queue、release workflow等を評価してください。

基盤的・破壊的migrationを行う場合、必要なら変更前のcanonical committed stateをlightweight snapshot tag等で識別可能にし、ADRへreason / alternatives / rollback or recovery pathを残してください。

userのuncommitted changeをmigration都合でstash / commit / discardしてはいけません。

---

## 26. 明示的なanti-patterns

次を標準運用にしてはいけません。

- 複数実装agentが同じworking treeを直接編集
- 複数agentが同じGit index / branchへ同時commit/push
- worktreeだけで完全isolationしたとみなす
- agentごとにhost portを手作業で割り当てる
- agent間で同じDB/Redis writable instanceを共有
- parentのdirty filesystemをchildが直接読む
- childがparent workspaceへ直接書き戻す
- Docker socketをuntrusted workerへ渡す
- hidden local orchestrator DBだけを唯一のtask SoTにする
- GitHub boardと実際の実行状態を恒常的に乖離させる
- Issueなしで大きなfeature workを開始し続ける
- PRへ複数無関係ticketを詰め込む
- stale baseを認識せずPRを統合
- agent数を増やすためだけに依存taskを無理に並列化
- sandbox costを理由に安全なisolationを暗黙解除
- native subagent機能があるという理由だけでisolationを検証せず使用
- WSLそのものをworker isolationとみなす
- macOS host-specific stateをportable projectの必須前提にする

true isolationが利用不能な場合、shared mutable workspaceで並列実装へ黙ってfallbackしてはいけません。read-only researchの並列化または安全な直列実装へ縮退し、制約を明示してください。

---

## 27. 初期化時に生成・整備するもの

実際のprojectに必要な範囲で、次を構成してください。

### Always-on contract

- concise `AGENTS.md`
- canonical Git branch / source SoT rule
- GitHub Project / Issue work SoT rule
- bootstrap / validation entry point
- Supervisor/subagent discovery rule
- Skill discovery pointers

### Agent Skills

最低限の第一候補:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`

必要に応じて:

- architecture/design/ADR
- debugging
- dependency hygiene
- UI/browser verification
- container/IaC verification
- review
- release/versioning
- external documentation retrieval

各Skillは短いtrigger/descriptionを持ち、full promptの必要部分だけを再構成したoperational unitにしてください。

### Reproducible runtime

- project-local environment definition
- dependency/tool version information
- macOS / WSL/Linux provider notes
- sandbox bootstrap
- service bootstrap / migrate / seed
- preview/port routing strategy
- architecture portability notes when needed

### Durable decisions

- agent runtime / Supervisor ADR
- sandbox/provider ADR when consequential
- cross-platform environment ADR when consequential
- GitHub delivery / sprint workflow ADR
- existing architecture ADR updates

### GitHub delivery

可能な範囲で:

- Issue template
- PR template
- labels
- GitHub Project / Kanban
- Iteration / Sprint field
- Priority / Size / Area / Target Release fields
- branch naming convention
- Issue-linked PR convention
- required checks
- release/milestone convention

を整備してください。

project規模に対して過剰なprocessを形式だけで導入してはいけません。しかし、実際に複数agentを並行駆動するprojectでは、誰が何を実行中かをrecoverableにするためIssue/Project/PRのdurable work stateを優先してください。

不要なframework、plugin、MCP、custom orchestratorを形式だけのために導入してはいけません。native capabilityで要件を満たすならそれを利用してください。

---

## 28. 初期化完了条件

初期化を完了と報告する前に、少なくとも次を確認してください。

- fresh cloneからproject-local instructionsを発見できる
- full promptを通常taskで再読せずSkillから必要policyへ到達できる
- macOSとWindows+WSL/Linuxのprovider差がproject contractから分離されている
- portable taskのenvironmentを再現できる
- Apple Silicon arm64とremote/CI architecture差が必要に応じて考慮されている
- 2つ以上のimplementation workerを同時に起動してもruntime/port/stateが競合しない設計になっている
- parentからchildへimmutable snapshotで委譲できる
- child resultをimmutable commit/ref/diffとして回収できる
- 複数agentがshared mutable working treeを直接編集しない
- durable work itemがGitHub Issueとして管理できる
- GitHub Project/KanbanでBacklog -> Ready -> In Progress -> In Review -> Doneを追跡できる、または同等のdurable state modelがある
- sprint/iterationとrelease goalを必要に応じて表現できる
- top-level Issueをbranch / PRへ統合できる
- PRからIssue acceptance criteriaとvalidation結果を追跡できる
- deterministic validation entry pointが存在する
- README / AGENTS / Skills / ADRに矛盾がない
- secretがrepositoryやagent resultへ漏れない
- native/local/remoteのどのproviderを使うかが明示されている
- providerが失われてもcanonical Git + GitHub work stateから復旧可能

最後に、生成・変更したproject-local構成、Skill構成、選択したSupervisor/runtime、macOS/WSL対応、GitHub Project / sprint workflow、並列化model、validation結果、残る制約を簡潔に報告してください。
