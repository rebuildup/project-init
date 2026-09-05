# 複数AIエージェント並行駆動向けプロジェクト初期化ポリシー

このリポジトリ向けのAIコーディングエージェント環境を初期化・再整備してください。

これは一般的な `/init` の代替または補強として渡すメタプロンプトです。実際のrepository、技術stack、architecture、runtime、test、quality、security、CI/CD、GitHub workflow、documentationを調査したうえで、**複数AIエージェントが独立環境で安全に並行作業し、version-oriented release sprintへ決定論的に統合できるproject-local開発環境**を構築してください。

この全文を通常taskのたびに読ませてはいけません。全文を読むのは初回初期化、またはproject-local Agent Skills / adapters / runtime / quality / governance policyを再構成する時だけです。

全文を `AGENTS.md` や `CLAUDE.md` へコピーしてはいけません。

基本思想:

> **Gitをsource stateのcanonical SoT、GitHub Issues / Projectsをwork stateのcanonical SoTとする + 1 implementation worker = 1 isolated mutable runtime + parent/child間はimmutable snapshot/result + Supervisor経由でagent lifecycleを管理 + sprintをtarget release versionとして表現 + project固有quality/security/governance profileをcurrent official guidanceからcompile + repository-controlled documentationへknowledgeを永続化 + progressive disclosure + 論理的に安全な最大並列化**

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
- Supervisor integration
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

source/work state:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient execution: Supervisor

各ticket / workerは `base_sha` またはimmutable input snapshotを追跡可能にしてください。

local directoryやSupervisorの復旧不能なhidden DBだけを唯一のSoTにしてはいけません。

---

## 4. Engineering decision precedence

開発判断では、原則として次の順で確認してください。

1. **project-wide policy / canonical architecture / invariant**
2. **design / specification / explicit task instruction**
3. **coherent existing implementation majority**
4. **current official framework/runtime/SDK guidance**
5. established ecosystem convention
6. local best judgment

同一levelで矛盾する場合は、よりspecificかつ新しいcanonical sourceを優先します。

existing implementationは重要なevidenceですが、古い実装やmigration途中の多数派が新しいcanonical design/policyを上書きしてはいけません。

conventionを確認する時は同じ責務の複数実装を見て、generated/vendor/example codeやmigration途中のold patternを除外してください。最初に見つけた1 fileだけをproject conventionとして扱わないでください。

### 自明な判断をuserへ返さない

次を満たす場合はagent自身で判断して進めてください。

- precedenceから答えが一意または実質一意
- reversibleで局所的
- acceptance criteriaを変更しない
- public/external contractを新規確定しない
- security/privacy/cost/release scopeを重大に変えない

例:

- project conventionに沿う命名/file placement
- official architectureに沿うmodule placement
- formatterが決めるformat
- 既存test structureに沿うtest location
- obvious lint/type error fix

project evidenceで解けるのに「A/Bどちらが良いですか」とuserへ返してはいけません。

### User escalationが必要な条件

userへ確認するのは本物の意思決定が残る場合に限定してください。

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

基本構成:

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

- sandbox create / destroy / suspend
- workspace snapshot
- agent spawn / wait / cancel
- agent/model adapter selection
- resource / cost / WIP / recursion budget
- credential injection
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
integrate_agent_result
```

transportはnative agent API、MCP、ACP、CLI wrapper、project-local Supervisor client等から選べます。

モデルにDocker/VM/provider commandそのものを覚えさせるのではなく、agent creationを高水準toolとして公開してください。

spawn request候補:

- Issue / internal task reference
- objective / acceptance criteria
- role
- immutable input snapshot
- allowed tools
- filesystem/network policy
- budget / timeout / maximum depth
- expected result format

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

候補provider:

- local container sandbox
- Dagger系execution
- devcontainer-compatible runtime
- lightweight VM
- SSH/devbox provider
- on-demand remote sandbox
- native cloud-agent machine

理想:

```text
same repository + same environment specification
    -> macOS local sandbox
    -> WSL/Linux local sandbox
    -> CI
    -> remote sandbox
```

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
- Supervisor/subagent entry point
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

通常taskでは必要なSkillだけを読み、このfull promptを再読しない構成にしてください。

---

## 11. Release sprint / GitHub workflow

開発はtarget versionを持つrelease sprint + GitHub Issue中心で進めます。

標準branch hierarchy:

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

必要に応じて:

- 目的 / outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority / size
- area/component
- target version / release date

を持たせてください。

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

## 12. Ticket branch / Draft PR / release integration

1 top-level Issueにつき1 durable ticket branchを作ります。

branch名:

`<issue-number>`

`issue/` prefix、slug、title、work type等を入れてはいけません。説明責務はIssue/PRへ置きます。

meaningfulな最初のcommit後、ticket branchからtarget `release-x-y-z` へDraft PRを早期作成してください。

PR title/body/review discussionは日本語です。

Draft -> Ready条件:

- acceptance criteria実装済み
- required ticket verification成功
- blocking issue解消またはscope外明示
- PR descriptionが現状と一致
- release branchとのstaleness/conflict処理済み

Ticket Done:

- required CI/checks green
- blocking review resolved
- PR merged into target release branch
- Issue closed
- Project status = Done

release branchのfull release gate通過後:

`release-x-y-z -> main`

のrelease PRを作成してください。

release PRにはrelease goal、included Issues/PRs、breaking changes、migration、full validation result、known limitations、version metadataを含めてください。

---

## 13. Task graphと最大安全並列化

非自明なIssueをdependency graphへ分解してください。

Readyかつdependency解消済みnodeはresource / rate / quota / WIP / cost内で最大限並行化してください。

同じfileを触ること自体だけを直列化条件にしないでください。isolated sandboxでは同一fileの独立編集は可能です。

ただしsame interfaceの非互換変更、same generated artifact、same external mutable resource等はdependencyまたは追加isolationが必要です。

---

## 14. Architecture / design / ADR

既存コードを調査したうえで、architectureを決定・変更する時は対象platform/framework/SDKのcurrent official guidanceを確認してください。

優先:

1. current official recommended architecture
2. official reference implementation / convention
3. project-wide canonical architecture/design
4. coherent existing architecture
5. ecosystem convention
6. custom architecture

officialがunopinionatedな領域で存在しない推奨を捏造しないでください。

### Design-first

design/specificationが存在する変更では:

1. current designを読む
2. necessary design changeを整理
3. user approvalがpolicy上必要なら取得
4. design更新
5. implementation

の順を守ってください。

significant decisionはADRへ残し、historical diaryをdesign docへ混ぜないでください。

---

## 15. Adaptive quality profile compiler

quality gateは固定check listではありません。

初期化時に実repoから次を検出してください。

- languages / frameworks / SDKs / versions
- app type / workspace structure
- architecture boundaries
- persistence / queue / cache / external service
- auth/network/filesystem boundary
- existing test/lint/type/build config
- browser / OS / CPU architecture target
- release/deploy target

次に実versionに対応するcurrent official documentationを調査します。

優先:

1. framework/runtime/SDK official quality/testing guidance
2. official examples/templates/starters
3. official first-party Actions / CI examples
4. official language/toolchain guidance
5. coherent existing configuration
6. maintained ecosystem tooling
7. custom tooling

調査だけで終わらず、必要なら実際に追加・修復してください。

- formatter / lint / static analysis
- compiler / type-check
- test infrastructure
- framework/platform-specific checks
- schema/migration validation
- browser/device/OS matrix
- build/package checks
- project-local specialized Skills
- `.github/workflows/*`
- required CI checks

project-localに少数のstable validation entry pointを用意してください。

例:

```text
validate:fast
validate:integration
validate:release
```

実command名はproject conventionに合わせてください。

---

## 16. Verification taxonomy

project内で最低限次の責務を区別してください。

### Unit test

1つの小さいlogic/component/moduleのbehaviorを外部boundaryを最小化して高速に検証します。

### Smoke / connectivity test（疎通テスト）

system/serviceが起動し、主要boundaryが最低限接続可能で、critical pathの入口が成立することを安価に検証します。

対象例:

- startup
- health/readiness
- app -> DB/cache/queue
- frontend -> API basic request
- required migration/schema
- desktop/mobile/package launch

### Integration test（結合テスト）

複数のreal component/boundaryを組み合わせ、interface/data flow/transactionが成立することを検証します。

mockだけでboundary contractを再現したtestをreal integration testと報告してはいけません。

### Contract / schema test

OpenAPI / GraphQL / protobuf / DB schema / event schema / generated client/server等、interface compatibilityが重要なprojectで使用します。

### E2E / system test

user-visibleまたはsystem-level critical flowをproductionに近いboundary構成でend-to-endに検証します。

### Manual / visual verification

UI/UX、native platform、hardware等でautomationが不十分な場合のみ明示的gateとして定義します。手順・期待結果・artifactを残してください。

---

## 17. 動作確認gateを変更riskから決める

全ticketに全test levelを機械的に要求しないでください。

代表default:

| Change | Minimum verification candidate |
| --- | --- |
| pure/domain logic | unit |
| API/service behavior | unit + integration |
| DB/schema/migration | integration + schema/migration + smoke |
| runtime/env/DI/network | smoke + relevant integration |
| frontend local component | unit/component |
| user journey/auth/navigation | integration/contract + E2E |
| external API adapter | unit + contract/integration + failure path |
| build/package/container | build/package + smoke |
| security fix | regression + vulnerable-path verification + applicable integration/E2E |
| release | full applicable integration + critical E2E/smoke + release checks |

framework official guidanceとproject architectureでprofileをcompileしてください。

### Gate layers

- worker gate: focused fast feedback
- ticket integration gate: `<issue-number> -> release-x-y-z` candidateのfull applicable validation
- release gate: `release-x-y-z -> main` 前のrelease-wide verification

coverageは有用な領域でproject-specific signalとして利用し、一律thresholdを万能hard ruleにしないでください。

False greenは禁止です。skip、`.only`、blanket suppression、ignored exit code、`|| true`、mock-only testをreal integrationと報告、未実施manual checkを動作確認済みと報告、coverage偽装等を行ってはいけません。

---

## 18. GitHub Actions / CI

GitHub Actionsを使用するprojectではlocal gateとCI gateを同じsemanticsへ揃えてください。

初期化時にcurrent official GitHub Actions guidanceとframework/runtime公式CI exampleを確認してください。

検討:

- first-party setup actions
- dependency/toolchain cache
- matrix testing
- service containers
- browser/device dependencies
- artifact/report upload
- code/dependency/security checks
- concurrency/cancellation
- least-privilege permissions
- secrets handling
- action version/pinning
- trusted/untrusted PR behavior

Actionsを増やすこと自体を目的にせず、project-local deterministic validation commandを薄くCIから呼ぶ構成を優先してください。

---

## 19. Security maintenance

framework/runtime/SDK/dependencyのsecurity情報を継続的に収集し、projectへの実影響でpriority化してください。

source priority:

1. framework/runtime/SDK official security advisory
2. official release/security announcement
3. ecosystem official advisory source
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary source

security inventory:

- direct dependencies
- security-sensitive transitive dependencies
- framework/runtime/SDK versions
- container/base image
- relevant OS/runtime packages
- build/deploy toolchain
- externally exposed services/endpoints
- auth/session/crypto/storage/network boundaries

priorityはseverityだけでなく次を評価します。

- exploitability / exploit maturity
- project reachability
- external exposure
- auth前到達可能性
- confidentiality/integrity/availability impact
- required privilege
- affected scope
- fix availability
- workaround quality
- regression/migration risk
- release timing

概念priority:

- P0/Critical: active exploitationまたは直接exposed。即時対応/patch release候補
- P1/High: reachableで重大impact、fix available。current release blocking候補
- P2/Medium: 条件付きreachable/impact限定。近いreleaseへ計画
- P3/Low: non-reachable/defense-in-depth。maintenanceとして処理

meaningful advisoryはGitHub Issueへ変換し、target releaseを割り当ててください。

projectに適切ならdependency vulnerability scan、dependency review、code scanning/SAST、secret scanning、container scanning、SBOM等も初期化時に導入・修復してください。

大量false positiveをそのままblockingにしないでください。

---

## 20. Onboarding / project knowledge

fresh contributor / new agentがchat history・private memory・既存memberの口頭説明なしで次を行える状態を初期化完了条件に含めてください。

1. project purpose/scope理解
2. architecture / major boundary理解
3. local environment bootstrap
4. app/service起動
5. validation実行
6. Issue選択 / ticket branch作成
7. Draft PRをtarget releaseへ作成
8. policy/design/ADR/Skills発見
9. common failure切り分け
10. release/security workflow理解

project規模に応じて:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/troubleshooting.md`
- `docs/release.md`
- `docs/security.md`
- ADR / design / Skill directories

等へprogressive disclosureしてください。

architecture guideでは必要ならMermaid等でmajor components、dependency direction、data flow、external systems、persistence、trust/security boundaries、runtime/deploy boundariesを可視化してください。

documented commandは可能な限りfresh sandbox/CIで実行して検証してください。

「READMEには書いてあるがfresh cloneでは動かない」を許容しないでください。

bootstrap/run/validation command、architecture、framework/runtime、host support、release/security workflowが変わったら同じticketでdocsを更新してください。

---

## 21. Tool / Skill / plugin selection

初期化時点でcurrent ecosystemを調査してください。

優先:

1. project existing deterministic CLI
2. framework/runtime official tooling
3. project-local Skill
4. native agent capability
5. first-party integration
6. 明確な優位があるplugin/MCP等

選定時に必要性、再現性、maintenance、security、license、context cost、cross-platform、version pinningを確認してください。

同じ責務のtoolを理由なく重複導入しないでください。

---

## 22. Package / search / script policy

JavaScript / TypeScriptでは具体的非互換性がなければBunを標準package managerとしてください。

text searchは `rg` / `rg --files` を標準とします。

新規 `.py` scriptをautomation、generation、migration、validation、build/test support、temporary analysis目的で追加してはいけません。

原則TypeScript/JavaScript、shell、PowerShell、またはproject本来の適切な非Python言語を使用してください。

既存projectが別package manager/toolchainを一貫して使用している場合は、変更の実利益を調査し、理由なくmigrationしないでください。

---

## 23. Dependency / naming policy

依存関係は最小限にしlatest stable compatible versionを基本とします。

導入時:

- platform/native capabilityで代替できないか
- existing dependencyで足りないか
- actively maintainedか
- unnecessary transitive dependencyを増やさないか
- license compatibility
- security/remote behavior

を確認してください。

責務名はpath context込みで明確にし、`utils` / `helpers` / `common` / `misc` / `manager` 等のdumping-ground名を安易に使わないでください。

---

## 24. Environment / secret policy

actual dotenvとして許可:

- `.env`
- `.env.development`
- `.env.production`

これらはGit ignoreしてください。

committed example:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

secret valueをsnapshot、commit、log、agent result、cacheへ含めないでください。

Supervisor/runtimeがsandboxへ必要最小限のsecretをinjectしてください。

---

## 25. Temporary / reference / container / CI artifacts

一時artifactはroot `.tmp/` 以下へ置きGit ignoreしてください。

外部reference repositoryは `.reference/` 以下へ置きGit ignoreしてください。

reference contentはnon-authoritative evidenceです。

新規container definitionは原則 `Containerfile` を使用してください。

CI/CDは原則GitHub Actionsを使用し、clean checkoutからreproducibleであることを確認してください。

---

## 26. Reviewer separation / autonomous loop

可能ならimplementer自身のself-reviewだけで完了させないでください。

Reviewerはclean integration candidateから:

- requested scope completeness
- correctness
- architecture consistency
- regression risk
- required verification level
- test adequacy
- security impact
- validation evidence
- hidden coupling
- runtime reproducibility
- target release整合

を確認してください。

非自明taskでは:

`inspect -> resolve decision context -> plan release -> ticketize -> decompose -> snapshot -> delegate/implement -> verify worker -> integrate ticket -> verify integration -> review -> update board -> verify release -> replan -> continue`

を自律的に回してください。

compile成功、unit test 1件成功、first implementationがもっともらしいというだけで完了扱いしないでください。

要求scopeを独自MVPへ縮小してはいけません。

---

## 27. 明示的anti-patterns

禁止または標準運用にしない:

- 複数agentが同じworking tree/branchを同時編集
- worktreeだけでruntime isolationしたとみなす
- shared writable DB/cache/dev server
- parent dirty filesystemの暗黙共有
- workerへhost Docker socket/root-equivalent credential
- ticket PRを直接 `main` へ向ける
- branch名へ長いslug/titleを詰め込む
- project evidenceで解ける実装判断を毎回userへ質問
- first found implementationをconventionと決める
- unit testだけでintegration/smokeを証明したと報告
- mock-only testをreal integration testと呼ぶ
- manual check未実施を動作確認済みと報告
- CVSS/severityだけでsecurity priorityを決める
- generic security alertをproject reachability確認なしでblocking
- README/setupを検証せず生成
- hidden chat memoryをproject knowledgeの唯一のsourceにする
- stale official guidanceをcurrentとして扱う
- blanket ignore/suppressionでquality gateをgreenにする

---

## 28. 初期化時に生成・整備するもの

実projectに必要な範囲で構成してください。

### Always-on contract

- concise root `AGENTS.md` 等
- source/work SoT
- active release rule
- decision precedence pointer
- bootstrap / Supervisor / validation / Skill discovery

### Standard operational Skills

- parallel orchestration
- sandbox runtime
- GitHub delivery
- quality gate
- engineering decisions
- security maintenance
- onboarding

agent固有形式へはcanonical sourceからthin adapterを作ってください。

### Quality / CI

- project-specific verification taxonomy
- change-risk -> required verification mapping
- worker / integration / release commands
- test/lint/type/build/security tooling
- GitHub Actions / required checks

### Runtime

- declarative environment definition
- dependency/tool versions
- sandbox bootstrap
- service/migration/seed/bootstrap
- preview routing

### Documentation

- README entry point
- contribution/development workflow
- architecture/data-flow/trust-boundary guide when useful
- troubleshooting
- release/security docs when applicable
- ADR/design index

### Durable decisions/workflow

- relevant ADR
- GitHub Issue/Project fields
- release branch convention
- number-only ticket branch
- Draft PR workflow
- vulnerability issue/release policy

不要なframework/plugin/custom orchestratorを形式だけのために導入しないでください。

---

## 29. 初期化完了条件

完了報告前に最低限確認してください。

- fresh cloneからproject-local instructionsを発見できる
- fresh contributorがhidden contextなしでbootstrap/run/validateできる
- decision precedenceがroot/Skill/docsから発見できる
- project evidenceで解ける自明なdecisionがuser escalation対象になっていない
- environmentがmacOS/Apple SiliconとWindows+WSL/Linuxで再現可能な設計
- 2つ以上のimplementation workerがruntime/port/state競合なしで並行可能
- parent -> child immutable snapshot / child -> parent immutable result
- `main` = released state
- sprint = target semantic version
- release branch = `release-x-y-z`
- ticket branch = Issue番号のみ
- ticket PR -> release branch / release PR -> main
- project固有quality profileが実versionのcurrent official guidanceを反映
- unit/smoke/integration/contract/E2Eの責務とrequired verification mappingが定義済み
- local validationとCI semanticsが整合
-必要なGitHub Actions/Skills/toolingをrecommendationだけでなく実装済み
- security advisory source/priority/Issue化workflowが定義済み
- relevant security automationがproject riskに応じて構成済み
- onboarding/architecture/development docsがfresh environmentと整合
- Issue/PRは日本語、commit/source codeは英語
- secretがrepository/log/cache/resultへ漏れない
- README / root instructions / Skills / ADR / designに矛盾がない
- providerが失われてもcanonical Git/GitHub/docsから復旧可能

最後に、生成・変更した構成、選択したruntime/Supervisor、release workflow、verification profile、security profile、onboarding docs、validation結果、残る制約を簡潔に報告してください。
