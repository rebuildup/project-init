# 複数AIエージェント並行駆動向けプロジェクト初期化ポリシー

このリポジトリ向けのAIコーディングエージェント環境を初期化・再整備してください。

これは一般的な `/init` の代替または補強として渡すメタプロンプトです。実際のrepository、技術stack、architecture、runtime、test、quality、security、CI/CD、GitHub workflow、documentationを調査したうえで、**複数AIエージェントが独立環境で安全に並行作業し、中断・context消失・sandbox消失からも復旧しながらversion-oriented weekly release sprintへ決定論的に統合できるproject-local開発環境**を構築してください。

この全文を通常taskのたびに読ませてはいけません。全文を読むのは初回初期化、またはproject-local Agent Skills / adapters / runtime / quality / governance / recovery policyを再構成する時だけです。

全文を `AGENTS.md` や `CLAUDE.md` へコピーしてはいけません。

基本思想:

> **Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork/dependency stateのcanonical SoTとする + 1 implementation worker = 1 isolated mutable runtime + parent/child間はimmutable snapshot/result + Supervisor経由でagent lifecycleを管理 + 会話履歴なしでもdurable checkpointから復旧可能 + 通常1週間のsprintをtarget release versionとして表現 + hard dependencyのlinear pathをstacked PRとして安全にprojection + active durable ticket branchはpublished remote head + immediate Draft PRを持つ + public repositoryではmainを保護しrelease PRからのみ変更する + project固有quality/security/governance profileをcurrent official guidanceからcompile + repository-controlled documentationへknowledgeを永続化 + progressive disclosure + 論理的に安全な最大並列化**

---

## 1. 最優先原則

- Git working treeをexecution isolation boundaryとして扱わない。
- implementation workerごとに独立したmutable runtimeを与える。
- mutable DB / cache / queue / process / generated stateをworker間で共有しない。
- parent -> childはimmutable snapshot、child -> parentはimmutable resultで接続する。
- sandbox lifecycleはworker外のSupervisorが管理する。
- `main` はreleased/integrated source stateとする。
- public repositoryでは`main`をbranch protection/rulesetで保護し、direct push / direct web edit / force push / deletionを通常運用で禁止する。
- public repositoryの`main`への正規delivery pathは `release-x-y-z -> main` のrelease PRだけとする。branch protection/rulesetだけでPR headを制約できない場合はrequired checkで `base=main` かつ `head=release-*` / intended target releaseを検証する。
- 通常sprintは1週間とし、active sprintは `release-<major>-<minor>-<patch>` branchで表現する。
- durable ticketはGitHub Issue、durable work/dependency stateはGitHub Issues / Projectsで管理する。
- Issue dependency graphをcanonical dependency SoTとする。Git branch topologyだけでdependencyを管理しない。
- ticket branchはIssue番号だけを使用する。
- 1 top-level Issue = 1 durable ticket branch = 1 ticket PRを基本とする。
- independent ticket PRはtarget release branch、same-release linear hard dependencyではdependent ticket PRをimmediate predecessor ticket branchへstackしてよい。
- durable ticket branch作成 -> first meaningful commit -> canonical remote publish -> remote head SHA確認 -> immediate Draft PRを一つの開始手順として扱い、published remote head + Draft PRなしでactive implementationを継続しない。
- 上記publish + Draft PR ruleはhuman / Coordinator / worker / subagentすべてに適用する。
- PR作成時にlinked Issue / assignee / reviewer/CODEOWNERS / repository-established labels / target release / stack context / validation stateを適切に設定・維持する。
- stacked ticketはintermediate predecessor branchへのmergeだけではDoneにせず、ticket changesがtarget release trunkへlandしてからIssue close / Project Doneへ進める。
- release branchは`main`とzero-diffの間だけDraft release PR不要とし、first meaningful integrated difference後はDraft release PRを必須とする。
- validation resultはvalidated SHA/snapshotへpinし、stack rebase/update後の別SHAへ古いgreen resultを流用しない。
- quality gateは固定bundleではなくproject固有にcompileする。
- verification levelは変更surface/riskから決める。
- framework/runtime security情報を継続的にpriority化する。
- project knowledgeをchat/private memoryではなくrepository-controlled docsへ残す。
- project evidenceで解ける自明な判断をuserへ返さない。
- native session/thread resumeを唯一のrecovery mechanismにしない。
- fresh agentが会話履歴なしでunfinished workを再構成できるようにする。
- significantなAgent policy / Skill / prompt / routing変更は、deterministicに検証できる部分とfresh agent判断が必要なlatent部分を分離して検証する。
- latent policy evalのgraderはpositiveだけで信用せず、negative / regression / positive controlsを識別できることを要求する。
- orchestration前にexecution profileを判定し、mechanical / localized taskへ不要なfan-outを導入しない。
- progressive disclosureではroot agent contractのalways-loaded context costも実測し、conditional workflowをSkillへ遅延できるかreviewする。

Git worktree自体は禁止ではありません。既にisolatedなsandbox内部のGit実装詳細として使用できますが、worktreeだけでport/process/database等が分離されたとは扱いません。

---

## 2. `/init` はidempotent reconciliationにする

初期化は一度しか実行されないと仮定してはいけません。

最初に現在状態を調査し、理想状態との差分だけを変更してください。

最低限確認:

- root agent instructions
- root / always-loaded instructionのcontext budget
- Agent Skills / adapters
- policy eval scenarios / deterministic graders / controls
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
- repository visibility
- public repositoryの`main` branch protection / ruleset / bypass / required release-source check
- GitHub Issues / Projects / dependency / PR / stacked PR / release workflow
- current errors / warnings
- branch / remote / userのuncommitted changes

振る舞い:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

正しい状態を理由なく再生成しないでください。変更不要も成功です。

public repositoryで`main` protectionが不足し、変更権限がある場合は初期化中に作成・修復してください。権限がなく修復できない場合は未保護状態をblockerとして報告してください。

---

## 3. Source of Truthを明示する

canonical stateは最低限次で表現してください。

1. canonical Git remote
2. released ref: `main` またはprojectが明示する同等branch
3. active release ref: `release-x-y-z`
4. repository-controlled environment definition
5. GitHub Issue / Project work + dependency state
6. project-wide policy / architecture / design / specification / ADR
7. repository-controlled operational documentation / Agent Skills
8. durable recovery checkpoint / immutable worker results

source/work state:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- PR ownership/review/classification: assignee / reviewer/CODEOWNERS / labels / PR metadata
- public `main` protection: branch protection/ruleset + required release-source check when needed
- transient execution: Supervisor

各ticket / workerは `base_sha` またはimmutable input snapshotを追跡可能にしてください。
stack-ready dependent workではpredecessor Issue/PR identityとexact predecessor commit SHA / immutable snapshotも追跡可能にしてください。

durable ticket branchではfirst meaningful stateをcanonical remoteへpublishし、remote branch head SHAとDraft PR identityを追跡可能にしてください。

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

### Implementation前のevidence-first design refinement

非自明なfeature / architecture / product designでは、planningやimplementationへ進む前に `design-refinement` Skillを使い、質問を作る前にrepository-controlled evidenceを読んでください。

最低限:

- task / Issue / acceptance criteria、canonical policy / architecture、design/spec、relevant ADR / Skillを確認
- relevant code / tests / schema / contractを複数箇所確認
- version-sensitiveなfactはcurrent official sourceで確認
- unknownをfact / project evidenceで決まるdecision / unresolved consequential decisionへ分類
- factはagentが調査し、project evidenceで決まるdecisionは `engineering-decisions` に従って自律決定
- implementationを左右するhidden assumptionを検出
- unresolved decisionに依存関係がある場合はdecision graphを作り、上流が未確定なまま下流質問を先にしない
- userへは現在のdecision frontierにある本物のproduct/architecture decisionだけを、evidence・影響・推奨案付きで聞く
- long-livedなdecision/domain knowledgeだけをdesign/spec、ADR、Skill、glossary/domain context等へ永続化

目的は大量interviewではなく **read relentlessly, ask minimally** です。domain vocabulary documentは必要なprojectだけに導入し、固定の `CONTEXT.md` を全projectへ強制しないでください。

### Reader-facing writing discipline

persistentまたは他者向けの文章を、conversation / task / investigation / execution contextのserializationとして生成してはいけません。

文章を書くときは次を明示的に分離してください。

1. **Select**: audienceとpurposeを決め、readerに必要なfact / decision / constraint / rationaleだけを選ぶ。作業順・会話順・tool output等のscaffoldingは捨てる。
2. **Compose**: 選んだcommunicative contentを、readerが理解する順序のstandalone proseへ再構成する。raw contextの要約を完成文章とみなさない。
3. **Reread**: 元のtaskやconversationを知らないreaderとして全文を読み直し、接続・冗長・referent・context依存・不自然なchronologyを編集する。

temporal/history/execution informationは一律禁止しません。version compatibility、migration、audit、reproducibility等、artifactの意味やreaderの判断に必要な場合だけ含めてください。

documentation / ADR / Issue / PR / commit message / code comment / review commentには同じ原則を適用し、詳細は `writing-discipline` Skillへprogressive disclosureしてください。

> **Think in context. Select for purpose. Compose for the reader. Reread without the context.**

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
- target release / 1週間のsprint window / release date
- dependency graph / Issue decomposition / stack候補
- delegation / integration ordering
- PR ownership/reviewer/metadata整合
- public repositoryのmain protection / release-only integration整合
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
- durable branch remote publication / Draft PR lifecycle coordination
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
- target release
- dependency / predecessor Issue or PR
- immutable input snapshot / predecessor snapshot
- immediate PR base
- durable branch identity / expected Draft PR identity when applicable
- assignee / reviewer / label expectations when applicable
- role
- allowed tools
- filesystem/network policy
- budget / timeout / maximum depth
- expected result format
- parent execution generation

subagent/workerへdurable branch作成権限を与える場合、その権限はremote publication + Draft PR作成・metadata設定とセットです。GitHubはremoteでheadを解決でき、head/baseに差分がある必要があるため、branch作成後にfirst meaningful commitを直ちに作り、canonical remoteへpublishし、remote branch head SHAがそのcommit SHAと一致することを確認した直後にDraft PRを作成してください。

remote publicationまたはPR mutation権限がないworkerはfirst meaningful commit後ただちにCoordinator/Supervisorへhandoffし、Coordinator/Supervisorがpublish + remote head SHA確認 + Draft PR作成を完了するまで追加implementationを進めてはいけません。

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
target_release
base_snapshot
predecessor_snapshot
execution_generation
result_commit_or_ref
draft_pr_identity
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
- weekly active release rule
- dependency / remote publication / Draft PR lifecycle pointer
- public main protection pointer when applicable
- decision precedence pointer
- environment bootstrap
- Supervisor/subagent/recovery entry point
- validation entry point
- language policy
- Skill discovery

標準Skill候補:

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

Agent Skillsの発見・導入にはSkills CLIを利用できます。Bunが利用可能なら `bunx skills` を標準とし、Node.js / npm環境では同じ引数を `npx skills` で実行できます。候補確認には `bunx skills add <source> --list`、project-local導入には `bunx skills add <source>` または `--skill <name>` を利用できます。既存のproject-local `skills/` とrepository policyを優先して確認し、source/trust/maintenance/reproducibilityを評価したうえで必要なSkillだけを導入してください。`--global` を既定にしてはいけません。

通常taskでは必要なSkillだけを読み、このfull promptを再読しない構成にしてください。

---

## 11. Weekly release sprint / GitHub workflow

開発は通常1週間のtarget-version release sprint + GitHub Issue中心で進めます。

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

### Sprint = one week + target release version

通常sprint期間は **1週間** です。
1 sprint = 1 target semantic version = 1 release integration branchです。

release branch:

`release-<major>-<minor>-<patch>`

sprint開始時に `main` からrelease branchを作成してください。

緊急patch等、release scope/dateの明示的なdecisionがある場合は1週間から外れてよいですが、通常planning cadenceは1週間を維持してください。patchでも`main`を直接変更せず、patch release branchからrelease PRを使用してください。

### Public repository main protection

repository visibilityを確認してください。public repositoryでは`main`をbranch protection/rulesetで保護してください。

最低限:

- direct push / direct web edit / force push / deletionを通常運用で禁止
- `main`変更にPull Requestを必須化
- release gateのrequired checks/review/conversation resolution等を満たすまでmerge不可
- normal actor/adminが保護を日常的にbypassする運用を作らない
- `main`への正規delivery pathを `release-x-y-z -> main` のrelease PRだけに限定

branch protection/rulesetだけでPR head branch patternを制限できない場合、`base == main` のPRで `head` がcanonical `release-*` patternかつintended target releaseであることを検証するrequired GitHub Action/status checkを追加してください。

public repositoryで保護が不足し、設定変更権限がある場合は初期化時に作成・修復してください。権限不足ならblockerとして明示してください。

### GitHub Issue / dependency SoT

独立して計画・実装・レビューできるdurable work itemは原則Issueにしてください。

Issue title/bodyは日本語です。

必要に応じて目的、acceptance criteria、scope/non-scope、dependency、priority、size、area/component、target version、release date、accountable assigneeを持たせてください。

Issue / Project dependency stateがcanonical dependency SoTです。branch parent-child relationだけでdependencyを表現してはいけません。

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

Dependency execution上は必要に応じて:

- `blocked`: prerequisite snapshotがまだ利用できない
- `stack-ready`: reviewable immutable predecessor snapshotがありdependent workを開始可能
- `integrated`: ticket changesがtarget release trunkへland済み

を区別してください。Project Status列自体を増やす必要はありません。

---

## 12. Ticket branch / mandatory Draft PR / stacked PR

1 top-level Issueにつき1 durable ticket branchを作ります。

branch名:

`<issue-number>`

`issue/` prefix、slug、title、work type等を入れてはいけません。説明責務はIssue/PRへ置きます。

### Branch start contract

**active durable ticket branchにはpublished remote head + Draft PRを必ず持たせてください。**

GitHubはremoteでheadを解決でき、head/baseに差分がある必要があるため、canonical start procedureは:

1. durable branchを作成
2. first meaningful commitを直ちに作成
3. canonical remoteへそのcommitをpublish
4. remote branch head SHAがfirst meaningful commit SHAと一致することを確認
5. Draft PRを直ちに作成
6. Issue linkage / assignee / reviewer/CODEOWNERS / repository-established labels / target release / stack contextを設定
7. implementationを継続

です。

Draft PRを「実装完了時に作る」運用や、first commitをlocalだけに残したまま追加実装する運用は禁止です。human / Coordinator / implementation worker / subagentのすべてに適用してください。

remote publicationまたはPR mutation権限がないworkerはfirst meaningful commit後ただちにCoordinator/Supervisorへhandoffし、Coordinator/Supervisorがpublish + remote head SHA確認 + Draft PR作成を完了するまで追加implementationを進めてはいけません。

### Independent ticket

hard predecessorがないticketはtarget release branchをdirect baseにします。

`123 -> release-x-y-z`

### Dependency-aware stacked PR

同一repository・同一target release内にreal linear hard dependencyがある場合、dependent ticket PRはimmediate predecessor ticket branchをbaseにしてよいです。

例:

- `123 -> release-x-y-z`
- `124 -> 123`
- `125 -> 124`

stack membersは共通のtarget release branchをstack trunkとして持ちます。

stackを使う条件:

- same repository
- same target release
- real hard dependency
- stacked segmentがordered chainとして表現可能
- predecessorにreviewable immutable commit/snapshotが存在

branching dependency DAGを無理に1本のstackへ変換しないでください。PR stackはcanonical Issue dependency graphのlinear pathをexecution/integration topologyへprojectionしたものです。

1 Issueを複数durable PRへ細切れにする目的だけでstackを使用しないでください。

### Stack-ready execution

predecessorがreleaseへ未mergeでもreviewable immutable predecessor snapshotがあればdependent workerを開始できます。

開始時にpredecessor Issue/PR identity、exact predecessor SHA/snapshot、common target release、immediate PR baseを記録してください。

predecessor reviewで変更が入りdownstream branchをrebase/updateした場合、変更されたSHAに対してaffected required validationを再実行してください。古いgreen resultを流用してはいけません。

### PR metadata

PR作成時に少なくとも該当するものを評価・設定してください。

- linked Issue
- accountable assignee
- requested reviewer / CODEOWNERS-derived reviewer
- repository-established labels
- acceptance criteria
- implementation summary
- validation results/status
- known blockers/limitations
- target release
- stack trunk / immediate predecessor / successor context when applicable

存在しないlabelを形式的に作る、無関係なreviewerを指定する、author自身を自己reviewerとして欄だけ埋める、という運用はしないでください。meaningful reviewerが存在しない場合はその事実とconfigured review automation / CI / explicit final review等の代替pathをPR bodyへ明記してください。

PR title/body/review discussionは日本語です。

Draft -> Ready条件:

- acceptance criteria実装済み
- current SHAでticket integration gate成功
- blocking issue解消またはscope外明示
- PR description / assignee / labels / reviewer metadataが現状と一致
- required reviewer request済み、またはmeaningful reviewer不在を明記
- target release branchまたはimmediate predecessorとのstaleness/conflict処理済み
- predecessor変更に伴うdownstream reconciliation/revalidation済み
- latest durable checkpointとbranch stateが矛盾しない

Ticket Done:

- required CI/checks current landing candidateでgreen
- blocking review resolved
- ticket changesがtarget release trunkへland済み
- Issue explicitly closed after successful target release-trunk landing
- Project status = Done

native stacked PRではcontiguous stack landingでtarget release trunkへ到達したticketだけをDoneにしてください。ordinary nested PR fallbackでは `124 -> 123` のようなintermediate predecessor branch mergeだけでIssue #124をclose/Doneにしてはいけません。

non-default branchへのmergeではclosing keywordだけに依存しないでください。

---

## 13. Release integration

release branchはsprint開始時に作成します。

GitHubは`main`と差分がないrelease branchにはPRを作れないため、zero-diff release branchはDraft release PR invariantの例外です。**最初のmeaningful integrated release differenceが入った直後にDraft release PRを作成**してください。

Draft release PRにもassignee / reviewer / labels / release goal / included Issues / current validation stateを設定し、sprint中のdurable release surfaceとして維持してください。

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

public repositoryではprotected `main`に対し、このrelease PR以外の経路で変更を入れないでください。

merge後 `main` がそのversionのreleased stateです。

---

## 14. Task graphと最大安全並列化

非自明なIssueをcanonical dependency graphへ分解してください。

各node候補:

- objective / acceptance criteria
- prerequisites
- target release
- input snapshot
- predecessor Issue/PR / predecessor snapshot
- immediate PR base
- output contract
- owner role
- branch / remote publish / Draft PR contract
- integration target
- recovery/checkpoint policy

次のどちらかを満たすnodeはresource / rate / quota / WIP / cost内で最大限並行化できます。

1. unfinished prerequisiteがないReady node
2. predecessorが未mergeでもreviewable immutable predecessor snapshotを持つstack-ready node

同じfileを触ること自体だけを直列化条件にしないでください。isolated sandboxでは同一fileの独立編集は可能です。

ただしsame interfaceの非互換変更、same generated artifact、same external mutable resource等はdependencyまたは追加isolationが必要です。

stacked deliveryを安全に維持できない場合はdependency SoTを壊さず、predecessor merge後の通常ticket workflowへ縮退してください。

---

## 15. 自律実行ループ

非自明taskでは:

`inspect -> refine design/requirements -> plan weekly release -> ticketize/dependency -> decompose -> snapshot -> create branch + first commit + remote publish + head verify + Draft PR -> delegate/implement -> checkpoint -> verify worker -> reconcile stack -> verify target release landing -> review -> update PR/board metadata -> verify release -> replan -> continue`

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

1. GitHub Issue / Project / dependency state
2. target release branch
3. ticket branch / remote commit graph
4. Draft/Ready PR / assignee / reviewer / labels / review / CI state
5. stack predecessor / pinned predecessor SHA when applicable
6. committed design / ADR / Skills / docs
7. immutable worker/subagent results
8. structured recovery checkpoint

native conversation ID、agent ID、Supervisor local DB、shell history、IDE stateはtransient optimizationです。

active durable ticket branchにpublished remote head + Draft PRがない場合は正常状態として扱わず、Issue/branch ownership・remote head・intended PR baseを確認してdelivery surfaceを修復してください。

release branchは`main`とzero-diffの間だけDraft release PR不要です。first meaningful integrated differenceが存在するrelease branchにDraft release PRがない場合は修復してください。

### Structured recovery checkpoint

private chain-of-thoughtを保存してはいけません。復旧に必要な外部化可能stateだけを保存してください。

最低限候補:

```text
schema_version
issue_id
target_release
ticket_branch
pr_number
immediate_pr_base
predecessor_issue_or_pr
predecessor_sha
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
- hard checkpoint: sandbox/providerを失っても復旧する境界。meaningful code/work stateがdurable remote infrastructureから到達可能であること。durable ticketではrecorded commitがcanonical remoteで到達可能でremote head identityとDraft PRが追跡できること。release branchはzero-diffならDraft release PR不要、first-difference後はDraft release PRが存在すること。

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

1. Issue / PR / target release / dependencyを特定。
2. ticket/release branch / remote commit graph / stack relationをfetch。
3. durable ticketではpublished remote head + Draft PR / metadataを確認・修復。release branchではzero-diff例外またはfirst-difference後Draft release PRを確認。
4. latest valid checkpointを読む。
5. canonical policy/design/decision refsを確認。
6. active childrenをSupervisorから再発見。
7. checkpointからworkspaceをrecreate。
8. completed/pending validationを再評価。
9. external side effectのactual remote stateを確認。
10. stale base / predecessor / conflicting integrationを確認。
11. remaining planを再構成。
12. safeな最小verificationでreconstructed stateを確認。
13. execution generation/leaseを更新して続行。

native resumeに成功してもbranch/PR/checkpointとの整合を確認してから続行してください。

---

## 17. Parent / child recovery と split-brain防止

child lifecycleはparent model processではなくSupervisor/control planeが所有してください。

parentが死亡してもsafeならchildを即cancelしないでください。

recovered parent/coordinatorは:

- child一覧を再発見
- input snapshot / predecessor snapshot / execution generationを確認
- running / completed / failed / orphanedを分類
- completed resultをimmutable resultとして回収
- durable branch childではpublished remote head / Draft PR identity / metadataをreconcile
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
- current GitHub PR / stacked PR / review / branch protection / ruleset capabilities

優先順位:

1. project既存のdeterministic tool
2. project-local CLI / Skill
3. native agent capability
4. project-local adapter / protocol integration
5. 明確な利点がある場合のみplugin / MCP

必要性、再現性、maintenance、security、license、context cost、cross-platform、version pinningを確認してください。

GitHub native stacked PR等のplatform featureは利用可能なら実装手段として使って構いませんが、policy semanticsを一時的なpreview feature固有の挙動へ依存させないでください。

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
- release/sprint branching model / weekly sprint cadence
- dependency-aware stacked PR model
- durable branch / remote publication / Draft PR / PR metadata lifecycle
- public repository main protection / release-only main integration
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

### Stack reconciliation gate

predecessor変更、rebase、stack push等でdownstream head SHAが変化した場合、影響範囲のrequired validationを新しいSHAで再実行します。

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
- stacked PR / non-default baseでのrequired check semantics
- public repositoryで `base == main` のPR headがcurrent `release-*` かを検証するrequired release-source check

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

meaningful advisoryはGitHub Issueへ変換しtarget releaseを割り当てます。critical exposed vulnerabilityではcurrent sprintを中断してpatch releaseを優先できますが、public repositoryの`main`を直接変更せずpatch release branchからrelease PRを使用してください。

projectに適切ならdependency review、code scanning、secret scanning、container scanning、SBOM等を初期化時に導入・修復してください。

---

## 26. Reviewer separation

可能な場合implementer自身のself-reviewだけで完了させないでください。

PR作成時にrepository ownershipから意味のあるreviewer / CODEOWNERSを解決してrequestしてください。

意味のある別reviewerが存在しない場合、形式的な自己reviewerを設定するのではなく、その事実とconfigured review automation / CI / explicit final review等の代替pathをPR bodyへ明記してください。

Reviewerはclean integration candidateから最低限次を確認してください。

- requested scope completeness
- decision precedenceとの整合
- correctness / architecture consistency
- regression risk
- test adequacy / required verification level
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility
- target release / stack predecessorとの整合
- PR metadata / Issue linkageの整合
- recovery/checkpoint consistency when relevant

---

## 27. Onboarding / repository-controlled knowledge

fresh contributorやfresh agentがchat history/private memoryなしで開発開始・復旧できることを初期化完了条件に含めてください。

repository-controlled docsから最低限次へ到達できるようにします。

- project purpose / scope
- architecture / dependency direction / data flow / trust boundary
- bootstrap / run / migrate / seed
- worker/integration/release validation
- 1週間sprint / target release / Issue dependency workflow
- ticket branch / first meaningful commit / remote publish / remote head SHA確認 / immediate Draft PR workflow
- PR assignee / reviewer / labels / Issue linkage / stack context
- independent PR / stacked PRのbase rules
- stacked ticketのtarget release-trunk landing Done boundary
- public repositoryのmain protection / release-only main integration
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
4. branch/remote head/PR/stack/children/validation/side-effect journalを再構成
5. release branchのzero-diff Draft PR例外またはfirst-difference後Draft release PRを確認
6. duplicate mutationなしで続行

できることを確認してください。

### 初期化完了条件

少なくとも次を確認してください。

- fresh cloneからproject-local instructionsを発見できる
- environmentを再現できる
- macOS/Apple SiliconとWindows+WSL/Linuxでhidden host stateを最小化
- 2つ以上のimplementation workerを同時に起動してruntime/port/stateが競合しない設計
- parent -> childをimmutable snapshotで委譲可能
- child resultをimmutable commit/ref/diffとして回収可能
- `main` = released state、`release-x-y-z` = weekly sprint integration、ticket branch = Issue番号のみ
- public repositoryでは`main` protection/rulesetが有効でdirect push/editを禁止し、release PRだけが正規更新経路
- branch protection/rulesetだけでsource branchを制限できない場合、required release-source checkが存在
- 通常sprint cadence = 1週間、1 sprint = 1 target semantic version
- Issue dependency graphがcanonical dependency SoT
- independent ticketはrelease base、same-release linear hard dependencyはstacked PRを使用可能
- active durable ticket branchはfirst meaningful commitをcanonical remoteへpublishしてhead SHAを確認した直後にDraft PRを持ち、worker/subagentも例外でない
- PR作成時にIssue linkage / assignee / reviewer/CODEOWNERS / established labels / target release / stack contextが設定される
- stacked ticketのDone boundaryがtarget release trunk landingである
- release branchはzero-diffの間だけDraft release PR不要で、最初のmeaningful integrated difference後にDraft release PRを持つ
- Issue/PRは日本語、commit/source codeは英語
- engineering decision precedenceとuser escalation boundaryが明示
- unit/smoke/integration/contract/E2E責務とrequired verification policyが明示
- stack update後のcurrent-SHA revalidation policyが明示
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

最後に、生成・変更したproject-local構成、選択したSupervisor/runtime、weekly release workflow、stacked PR/dependency model、public main protection、parallelization model、quality/security/recovery profile、validation結果、残る制約を簡潔に報告してください。
