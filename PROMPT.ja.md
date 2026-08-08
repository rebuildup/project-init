# プロジェクトローカル AI エージェント初期化ポリシー

このリポジトリ向けの AI コーディングエージェント環境を初期化・再整備してください。

これは一般的な `/init` の代替または補強として渡すメタプロンプトです。目的は、実際のリポジトリ、技術スタック、アーキテクチャ、ランタイム、テスト、CI/CD、開発ワークフローを調査したうえで、**最小限・再現可能・プロジェクトスコープに閉じた AI エージェント開発環境**を構築することです。

この文書全文を `AGENTS.md` や `CLAUDE.md` にコピーしてはいけません。

実行時は次の原則に従ってください。

1. 既存リポジトリを先に調査する。
2. このプロジェクトに本当に必要なルール・Skill・plugin・toolだけを選ぶ。
3. 常時必要な不変条件だけをルートのエージェント指示に置く。
4. 条件付き・専門的な手順は Agent Skills に分離する。
5. plugin/tool選定や基盤変更など、長期的判断はADRに残す。
6. すべてをproject-localで再現可能にする。
7. 実装タスクでは決定論的検証を最後まで実行する。
8. fresh clone と再 `/init` の双方で正しく動く状態にする。

基本思想は次です。

> **hidden state の最小化 + dependency の最小化 + deterministic verification の最大化 + project-local reproducibility + progressive disclosure + 論理的に安全な最大並列化**

---

## 1. `/init` の再実行と冪等性

この処理は一度だけ実行されると仮定してはいけません。

実行時はまず現在の状態を調べ、理想状態との差分だけを調整してください。

確認対象には最低限以下を含めます。

- `AGENTS.md`
- agent固有adapter
- Agent Skills
- project-local plugin configuration
- agent/toolchain ADR
- architecture ADR
- README / 開発ドキュメント
- package / tool version
- lockfile
- CI/CD
- test / coverage configuration
- env example
- `.gitignore`
- validation command
- `.tmp/` / `.reference/` の扱い

振る舞いは原則として次です。

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

既に正しいものを理由なく再生成・全面書き換えしてはいけません。

不足していれば追加し、不完全なら修復し、古ければ更新し、重複していれば統合し、不要になったものはADR上の判断を更新してから削除してください。

**変更不要が正しい結果になる場合もあります。**

---

## 2. 既存コードベースを最優先する

既存コードがある場合、アーキテクチャ、命名、plugin、Skill、tool、依存関係、テスト、CI/CDを決める前に必ず調査してください。

最低限確認してください。

- language / framework / SDK
- runtime version
- package manager
- manifest / lockfile
- workspace / monorepo structure
- directory / module structure
- architecture / dependency direction
- naming convention
- current agent instructions
- current Agent Skills
- project-local agent/plugin configuration
- design / specification
- ADR
- formatter / lint / type-check
- dependency analysis
- unit / integration / E2E tests
- coverage
- build
- CI/CD
- container / IaC
- generated-code boundary
- current errors / warnings
- skip / ignore / suppression / exclusion
- stale / duplicate dependencies and tools
- existing user changes in the working tree

一般論より、実際のリポジトリから得られる証拠を優先してください。

整合した既存構成を、単に別方式が流行しているという理由だけで置き換えてはいけません。

---

## 3. project-localのみを使用する

AIエージェント関連設定はすべてproject-localを原則とします。

禁止:

- user/global scopeへのplugin導入
- home directoryへのproject-specific rule保存
- global agent memoryをproject truthとして利用すること
- undocumented machine-specific stateへの依存
- global agent configurationの暗黙変更

対応しているものはリポジトリ管理下へ置いてください。

例:

- `AGENTS.md`
- Agent Skills
- project-local plugin declarations
- project-local agent settings
- bootstrap / validation scripts
- Nix configuration
- CI/CD
- test / coverage configuration
- tool version / lock information

credential、authentication、trust decision、secret valueなど、リポジトリに保存すべきでないものは例外です。

project truthは暗黙的memoryではなくrepository-controlled filesに置いてください。

---

## 4. ルートエージェントファイルはdispatcherにする

対応している場合、`AGENTS.md` をagent横断のcanonical project contractとして使用してください。

ただしルートファイルを巨大な規則集にしてはいけません。

ほぼすべてのタスクに作用する不変条件だけを記載してください。

例:

- project identity / boundaries
- basic toolchain
- source language policy
- internal documentation language
- task-scope policy
- design approval gate
- validation entry point
- Skill discovery
- branch / worktree policy
- mode / permission policy

以下の詳細はAgent Skillsへ分離してください。

- debugging
- testing / quality gate
- dependency hygiene
- architecture
- design-first workflow
- UI/browser verification
- container/IaC verification
- Git workflow
- parallel/subagent orchestration
- release/versioning
- external documentation retrieval
- code review

agent固有の設定形式・Skill配置・plugin設定は、そのagent自身が提供するproject-local機能を使用してください。

複数agent用に同じ全文を手動複製せず、可能な限り1つのcanonical sourceと薄いadapterにしてください。

---

## 5. Agent Skillsを詳細ルールの基本単位にする

詳細なワークフローはAgent Skillsとして構成してください。

この文書の各箇条書きを機械的に1 Skillずつ作ってはいけません。

Skillは次を基準に分割・統合してください。

- activation condition
- responsibility
- required tools
- context cost

発火条件がほぼ同じものは統合してください。

無関係なinstructionsが同時にcontextへ入るなら分割してください。

各Skillは可能な限り:

- 短いdescription
- 明確なtrigger
- 1つの主要責務
- deterministic tool invocation
- 必要な場合だけ読むreference
- 必要な場合だけ実行するscript

を持つ構成にしてください。

progressive disclosureを優先してください。

---

## 6. plugin / Skill / toolはゼロベースで選定する

この文書に登場する製品名だけを候補にしてはいけません。

初期化時点で現在の情報を調べてください。

調査対象:

- agent native capabilities
- current project configuration
- official plugin marketplace
- official / maintained Agent Skills
- first-party integrations
- current ecosystem tools
- framework / SDK official tooling

各候補について次を判定してください。

1. native capabilityで既に足りているか
2. project既存toolで足りているか
3. Skillとして実装した方がよいか
4. deterministic CLIの方がよいか
5. plugin / MCPが実際に優位か

重複した実装を理由なく導入してはいけません。

選定基準:

### 必要性
実プロジェクトの能力不足を埋めるか。

### 再現性
project-localに設定・version・bootstrapを残せるか。

### 保守性
原則として:

1. official / first-party
2. actively maintained established project
3. 明確な利点があるcommunity implementation

の順で優先してください。

### context cost
常時大量のschema・description・memory・resultを注入しないか。

### determinism
ローカルの機械的処理では原則:

1. existing project CLI
2. dedicated CLI + Skill
3. native agent integration
4. 明確な利点がある場合のみplugin / MCP

を優先してください。

### security
source、maintainer、permission、remote communication、secret requirement、executable behaviorを確認してください。

### license
license種別、project licenseとの互換性、redistribution、attribution、source copy制約を確認してください。

### cross-platform
対象のWindows/WSL ContainersおよびNixOS環境で実行可能か確認してください。

### version
latest stable compatible versionを基本とし、再現性のため必要ならpin / lockしてください。

---

## 7. plugin / tool選定をADRへ残す

主要なAI agent toolchainの採否は会話ログだけに残してはいけません。

必要に応じてagent toolchain用ADRを作成・更新してください。

最低限記録してください。

- 調査日
- status
- 解決したいcapability
- selected plugin / Skill / CLI / LSP
- selection reason
- alternatives considered
- rejection reasons
- overlap with native capability
- context cost
- maintenance state
- security consideration
- license
- version / pinning
- project-local reproduction method
- re-evaluation condition

採用したplugin/Skillは、利用しているagentが許す範囲でproject-local declaration、設定、version情報、lock、またはvendorされたSkill/plugin本体をrepositoryから再現できるようにしてください。

global installationしか存在しない状態を必須要件にしてはいけません。

---

## 8. 能力候補

以下は探索の起点でありmandatory bundleではありません。

### Code intelligence

利用言語についてsemantic code navigationとdiagnosticsを確保してください。

候補:

- TypeScript / JavaScript language tooling
- rust-analyzer
- Kotlin language tooling
- clangd
- C# language tooling
- その他実際の言語向けLSP

native LSPで十分な場合は重複させないでください。

large / complex repositoryではSerena等のsymbol-level navigationを評価できます。

構造検索・大規模変換では`ast-grep`等を評価できます。

テキスト検索の標準は`ripgrep`です。

### Browser / UI

WebではPlaywright系を優先してください。

通常のcoding-agent browser operationではCLI + Skill型を優先し、persistent interactive state等が本当に必要な場合だけより重いbrowser/MCP integrationを使用してください。

### Documentation

参照優先順位:

1. repository design / docs
2. repository source
3. installed dependency source / types / schemas / local docs
4. 実versionに対応したofficial documentation
5. project-local reference Skill
6. Context7等のexternal documentation retrieval
7. general web

局所的なproject knowledgeが重要ならgeneric docs serviceを優先してはいけません。

### Context management

巨大repo、大量log、大量docs、長session、巨大tool output等で実際のcontext問題が確認された場合にcontext-mode等を評価してください。

### Workflow framework

Superpowers等はbundle全体ではなくcapability / Skill単位で評価してください。

### CLI output compression

RTK等は実際のCLI outputが問題になり、測定上意味がある場合だけ評価してください。

### Persistent memory

claude-mem等のimplicit persistent memoryはdefaultで導入しないでください。

repository documentation / design / ADR / Skillをsource of truthとしてください。

---

## 9. 開発環境

主な対象環境:

- Windows + WSL Containers (`wslc`)
- WSL上のNixOS
- container上のNixOS
- 必要に応じたnative Linux / NixOS

Docker Desktopを前提にしてはいけません。

container操作前に実際のruntimeとsupported commandsを確認してください。

system dependencyの再現性に意味がある場合、Nix flake / dev shell等のdeclarative environmentを優先してください。

不要なprojectへ形式上だけNixを導入してはいけません。

---

## 10. Package manager / search / script

JavaScript / TypeScriptではBunを標準package managerとしてください。

原則:

- `bun`
- `bun run`
- `bunx`
- Bun lockfile

を使用してください。

npm、Yarn、pnpm、`npx`等は具体的な非互換性がない限り導入しないでください。

既存projectが別package managerを使う場合は調査し、Bunへの移行が妥当ならADRを作成して移行してください。

不要なmixed package-manager stateを残してはいけません。

text searchには:

- `rg`
- `rg --files`

を使用してください。

text searchで不十分ならLSP / semantic / structural searchを使用してください。

### Python script禁止

新規`.py`スクリプトを作成してはいけません。

特に次の目的でPython scriptを新規追加することを強く禁止します。

- automation
- generation
- migration
- validation
- build support
- test support
- maintenance
- temporary analysis
- repository scripts

原則としてTypeScript、JavaScript、shell、Windows固有処理ではPowerShell、またはproject本来の適切な非Python言語で代替してください。

---

## 11. Source codeとdocumentationの言語

### Source code

source codeは英語のみを使用してください。

対象:

- filename
- directory name
- identifier
- class / function / variable
- component / hook
- test name
- developer-facing log/event identifier
- code comment
- source-code documentation
- config identifier

他言語は原則locale / localization resourceのみに置いてください。

### Internal development documentation

開発に使用する内部文書は日本語で記述してください。

対象例:

- architecture document
- design
- specification
- ADR
- internal runbook
- implementation documentation
- project Agent Skills
- project agent instructions

外部向けREADME、LICENSE、public API documentation、ecosystem標準上他言語が適切な文書は例外です。

### Git / GitHub

次は常に英語で記述してください。

- commit message
- GitHub Issue
- Pull Request
- GitHub review message
- Git/GitHub workflow由来のrelease communication

---

## 12. 公式推奨アーキテクチャを最優先する

アーキテクチャを決定・変更する場合、**対象platform / framework / SDKの現在の公式documentationを必ず調査してください。**

model knowledgeだけで「普通はこうする」と決めてはいけません。

優先順位:

1. current official recommended architecture / architecture guidance
2. current official reference implementation / sample
3. current official project structure / conventions
4. coherent existing project architecture
5. established ecosystem convention
6. custom architecture

公式が:

- Recommended
- Strongly recommended
- Best practice
- Preferred
- Standard architecture

等として明示している場合、**具体的なproject requirementと衝突しない限り原則準拠してください。**

公式推奨を単なる参考として無視して独自architectureを優先してはいけません。

architectureには少なくとも以下を含めます。

- directory / module structure
- dependency direction
- data flow
- state ownership
- component design / responsibilities
- domain boundaries
- persistence boundaries
- side-effect boundaries
- UI architecture
- error handling
- naming
- modularization
- testing boundaries
- framework/runtime recommended primitives

公式推奨から逸脱する場合はADRへ:

- なぜ適さないか
- 衝突する具体的要件
- alternativeの利点と負債
- 再評価条件

を記録してください。

一方、Next.jsのproject organizationのように公式が意図的にunopinionatedな領域では、存在しない「公式推奨アーキテクチャ」を捏造してはいけません。

公式が規定する範囲と規定しない範囲を分離し、後者は既存コード・use case・ecosystem conventionから設計してください。

既存projectでも公式推奨との差を調査します。ただし既存設計が一貫しており移行利益が小さいなら機械的に全面rewriteしないでください。

重大な移行を行う場合はarchitecture decisionとしてADRに残してください。

---

## 13. 命名と責務

filename / directory / function / class / component等の名前は、その対象が所有する責務を表してください。

ancestor path / namespace / ownerも名前の一部です。

上位階層ですでに表現されている意味をleafで繰り返さないでください。

例えば:

`Viewer/ViewerWorkspaceGrid/WorkspaceGrid.tsx`

のようにleafからrootへ辿った際、同じ責務語が複数回現れる構造は疑ってください。

単なる略語化ではなく、どの階層がどの責務を持つかを見直してください。

短く、path contextを含めると明瞭になる名前を優先してください。

明確な責務名がある場合、次のようなdumping-ground名を避けてください。

- `utils`
- `helpers`
- `common`
- `misc`
- `manager`

### Directory width

同一directory階層に並列で存在するfile / directoryは**おおむね10以内**を強く推奨します。

hard limitではありません。

大幅に超える場合は複数責務が混在していないか調査し、domain / feature / responsibility / lifecycle等の実質的境界で分けてください。

数合わせだけの意味のない中間directoryは作らないでください。

---

## 14. 設計先行

design / specification fileが存在する場合はdesign-firstで開発してください。

対象仕様の実装前に:

1. current designを読む
2. 必要なdesign changeを整理する
3. ユーザーと協議する
4. 合意・確定する
5. designを更新する
6. implementationを開始する

実装後に仕様変更が生じた場合も、まずdesignへ戻って再設計してください。

design documentは**あるべき最終状態**を表します。

次を置いてはいけません。

- chronological memo
- implementation diary
- temporary TODO
- abandoned idea history

decision historyが必要ならADRを作成してください。

---

## 15. ADR lifecycle

ADRは決定同士の前後関係を明示してください。

後続ADRが以前のADRを:

- supersede
- revise
- deprecate
- replace
- invalidate

する場合:

- new ADR -> previous ADR
- previous ADR -> new ADR

の両方向referenceを残してください。

無効になったADRには状態を明示し、現在有効なdecisionへ直接辿れるようにしてください。

このルールはarchitectureだけでなく:

- agent tooling
- plugin selection
- package manager migration
- dependency strategy
- container strategy
- test strategy
- CI/CD
- infrastructure
- major toolchain changes

にも適用してください。

---

## 16. 初期開発段階の互換性

ユーザーから指定がない限り、applicationは初期開発段階とみなしてください。

原則として次を維持するための実装は不要です。

- backward compatibility
- obsolete internal APIs
- deprecated schemas
- old behavior
- historical data migration
- compatibility shims

目的とする設計へ直接移行してください。

「念のため」のcompatibility layerを残してはいけません。

ユーザーがstable external contractとして指定したものは例外です。

---

## 17. タスクスコープを勝手に狭めない

要求されたタスクを独自にMVPへ縮小してはいけません。

難しい部分を省略して完成扱いしてはいけません。

内部的には細分化して構いませんが、外部スコープは維持してください。

完了とは、要求された範囲がすべて満たされた状態です。

---

## 18. 自律実行ループ

非自明な実装タスクでは、ユーザーから毎回指示されなくても:

`inspect -> plan -> implement -> verify -> rubber-duck -> replan -> continue`

を自律的に回してください。

各loopで:

- concrete current problemを言語化
- evidenceを確認
- assumptionを洗い出す
- smallest useful next actionを選ぶ
- implement
- verify
- acceptance criteriaと比較
- replan

してください。

次だけを理由に終了してはいけません。

- compileが通った
- 1 testが通った
- happy pathが動いた
- first implementationがもっともらしい

full requested taskが完了するか、本物のexternal/user gateに到達するまで続けてください。

---

## 19. 論理的に可能な最大数のsubagentを使用する

大規模タスクでは、ユーザーから毎回指示されなくても**論理的に駆動可能な最大数のsubagent**を使用してください。

作業をdependency graphとして扱ってください。

並列化できる最低条件:

- unfinished prerequisiteがない
- 同一fileを同時編集しない
- overlapping generated outputがない
- shared mutable stateを競合更新しない
- incompatible interface changeを同時に行わない
- ownershipを明確にできる
- Git index / HEAD operationを競合させない
- agent/tool concurrency limit内
- model availability内
- rate limit / quota内
- 実行不能なresource exhaustionを起こさない

rate limit、quota、runtime制限等で追加agentが実行できない場合、そのagentはその時点では「論理的に駆動可能」ではありません。

逆に、agent数が多いという理由だけで任意の低い上限を設定してはいけません。

phase dependencyがある場合はphase間を直列化し、phase内を最大限安全に並列化してください。

---

## 20. Codexの役割分担 — 2026年8月時点

この節は**2026年8月時点の暫定運用方針**です。

Codexのmodel、pricing、availability、subagent routingが変わった場合は再調査し、必要ならADRを更新してください。

これはOpenAIが各modelに公式に割り当てた職務ではなく、現在のmodel特性を利用するproject policyです。

### Sol — coordinator / supervisor

主な責務:

- complete user request理解
- architecture-level reasoning
- dependency graph
- task decomposition
- subagent orchestration
- ownership boundaries
- consequential decisions
- difficult problem solving
- integration
- final verification
- final synthesis

機械的な大量実装をSol自身へ集中させないでください。

### Terra — independent reviewer

主な責務:

- implementation review
- architecture review
- correctness review
- integration review
- test adequacy review
- failure analysis
- independent second opinion

可能な場合、implementer自身のself-reviewだけで完了させないでください。

### Luna — primary implementation worker

主な責務:

- code implementation
- mechanical refactoring
- test implementation
- repository exploration
- bounded investigation
- repetitive changes
- deterministic tool execution
- independent implementation units

安全に分離できる実装は可能な限りLunaへ委譲し、現在の高速・低コスト特性を利用してthroughputを拡大してください。

品質よりcostを優先するという意味ではありません。

高難度・高影響判断はTerraまたはSolへ昇格してください。

実行時にsubagent modelを指定・確認できるか確認し、実際に確認できないmodelを使用したと虚偽に報告してはいけません。

明示model routingが利用不能でも、coordinator / reviewer / implementerという論理的役割は維持してください。

---

## 21. Git branch / worktree

ユーザーから明示指定がない限り:

- local `main` のみで作業
- feature branchを作らない
- temporary branchを作らない
- Git worktreeを作らない

でください。

agent/team機構がworktree必須なら、その機構を使用しないでください。

worktree不要のsubagent mechanismを使用してください。

利用可能な手段がworktreeを必須とする作業は並列化不能として扱い、必要なら直列実行してください。

開始前にcurrent branch、working tree、ユーザーのuncommitted changesを確認してください。

ユーザーの無関係な変更を上書き・stage・commitしてはいけません。

---

## 22. Subagent file ownershipとcommit

並列実装前にdisjoint file ownershipを割り当ててください。

同一fileを複数agentが並列編集してはいけません。

同じfileが必要なら:

- 1 ownership unitにまとめる
- またはphaseを直列化する

merge conflict解消を通常の並列化戦略にしてはいけません。

各subagentの完成作業は、そのagentの担当変更だけを含む独立commitにしてください。

shared `main`を使うためcommit操作自体は直列化してください。

各agentについて:

1. owned implementation完了
2. relevant validation完了
3. diff確認
4. owned filesのみstage
5. dedicated commit
6. 次のcommitへ

してください。

orchestrator自身の論理的に独立した変更も別commitにしてください。

---

## 23. Git / GitHub message format

Git / GitHub関連messageはすべて英語です。

commit message:

`<work-prefix>: <extremely concise title>`

空行の後:

- concise change summary
- relevant change summary
- validation/result when useful

必要な場合のみその後にdetailを追加してください。

prefix例:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `build`
- `ci`
- `chore`
- `perf`

Issue / PRも簡潔な英語title + structured summary + 必要なdetailsとしてください。

---

## 24. 基盤的・破壊的移行

必要性があり妥当なら、次のような基盤変更を自動実施できます。

- npm / pnpm / Yarn -> Bun
- Dockerfile -> Containerfile
- test framework replacement
- lint / formatter / toolchain changes
- CI/CD changes
- directory architecture changes
- agent tooling replacement

大きいという理由だけで機械的なuser confirmationを要求する必要はありません。

ただしproject上の具体的な理由が必要です。

実施時:

1. current stateを調査
2. migration reasonを明確化
3. alternativesを比較
4. ADRを作成・更新
5. migrate
6. full quality gate
7. obsolete configurationを削除
8. fresh-clone reproducibilityを確認

してください。

理由なくold/new方式を併存させないでください。

設計書が関係する変更では、別途design-firstのuser agreement gateを守ってください。

---

## 25. Dependency policy

使用するpackageはlatest stable compatible versionを基本としてください。

dependencyは最小限にしてください。

新規dependencyごとに確認:

- 本当に必要か
- platform/runtime/frameworkが既に持っていないか
- existing dependencyで足りないか
- smaller maintained alternativeがないか
- direct useされるか
- unnecessary transitive dependenciesを増やさないか
- actively maintainedか
- licenseは適切か

単純処理のためだけにdependencyを増やさないでください。

責務の重複するlibraryを理由なく併用しないでください。

既存dependencyのoutdated / stale / duplicateも確認してください。

### License audit

package / plugin / Skill / tool / reference implementation導入時に最低限:

- license type
- project license compatibility
- redistribution
- attribution
- copied source restrictions

を確認してください。

重要な判断は該当ADRに残してください。

---

## 26. Dependency / static analysis

JavaScript / TypeScriptでは、適用可能ならKnipまたは現在のより適切な同等toolを使用してください。

確認対象:

- unused dependencies
- unlisted / missing dependencies
- unused exports
- unused files
- unresolved references
- configuration problems

broad ignoreを追加して通すのではなく、原因を修正してください。

formatter/linterではBiomeを優先できますが、既存projectやframeworkにより別toolが適切なら実態に合わせてください。

---

## 27. 自動quality gate

ユーザーが毎回、

> biome、type-check、knip、build、その他packageに含まれるすべてのtestをerrorもwarningもない状態で成功させる

と指示しなくても、これを**実装タスクの標準完了条件**として扱ってください。

actual package scripts / workspace scripts / project toolingを調査し、適用可能な非破壊的validationをすべて実行してください。

例:

- formatter/check
- Biome / lint
- type-check
- Knip / dependency analysis
- static analysis
- unit tests
- component tests
- integration tests
- E2E tests
- coverage
- build
- container/IaC validation
- dependency/security audit

変更した部分だけではなく、project/packageに含まれる適用可能な全validation/test suiteを最終的に実行してください。

開発途中のfocused testは許可しますが、最終完了判定はfull applicable suiteで行ってください。

deploy / release / destructive scriptsは「package scriptにある」という理由だけで自動実行してはいけません。

---

## 28. Error / warningを本当の意味で0にする

必須checkはproject側で対処可能なerror / warningが残らない状態まで修正してください。

次による見かけ上のgreenは禁止です。

- skipped test
- `.only`
- disabled suite
- blanket ignore
- blanket lint suppression
- blanket type suppression
- warning suppression
- broad coverage exclusion
- ignored exit code
- `|| true`
- no-fail option
- CI check disabling

narrow exclusionが許されるのは、generated/vendor code等、本当にmeaningful validation domain外の場合のみです。

exclusionはspecific / minimal / justifiedでなければなりません。

projectから修正不能なupstream/toolchain warningが残る場合は明示し、「完全clean」と表現しないでください。

---

## 29. Test / coverage

platformごとのcurrent standard testing toolを使用してください。

JavaScript / TypeScriptでは、framework上より適切な標準がなければVitestをunit/component testの第一候補としてください。

Web E2EはPlaywrightを優先してください。

既に高品質なtest stackがある場合、統一だけを目的に置き換えないでください。

private implementation detailではなくbehaviorをtestしてください。

testはisolated / reproducibleでなければなりません。

### Coverage

meaningful testable sourceについて80%以上を維持してください。

Vitestでは最低限:

- lines >= 80%
- statements >= 80%
- functions >= 80%
- branches >= 80%

をenforceしてください。

testからimportされていないsource fileがcoverage対象から消えるだけの設定にしてはいけません。

thresholdを下げる、難しいfileを除外する等により数値を偽装してはいけません。

---

## 30. `.tmp/`

test result、一次log、screenshot、trace、diagnostic file、検証用生成物、一時fixture等はすべてroot直下の:

`.tmp/`

以下に置いてください。

repository rootへ直接置いてはいけません。

`.tmp/`はGit ignoreしてください。

正式なdocumentation/test fixture等へ明示的に昇格しない限りcommitしてはいけません。

---

## 31. `.reference/`

参考にする外部repositoryをroot直下の:

`.reference/`

へcloneすることを許可します。

`.reference/`は必ずGit ignoreしてください。

reference repositoryはproject本体ではありません。

禁止:

- source treeへ直接組み込む
- implicit build dependencyにする
- implicit runtime dependencyにする
- reference repositoryの変更をprojectへcommitする
- fresh cloneの必須条件にする

必要な場合だけcloneし、なくてもprojectが動く状態を維持してください。

参照・copy前にlicenseを確認し、sourceをcopyする場合はlicense / attribution条件を守ってください。

---

## 32. dotenv / GitHub Secrets

実値を保持するdotenvとして使用可能なのは:

- `.env`
- `.env.development`
- `.env.production`

のみです。

これらはGit ignoreしてください。

禁止:

- `.env.local`
- `.env.test`
- その他実値用の任意`.env.*`

### Example files

以下は許可し、commitしてください。

- `.env.example`
- `.env.development.example`
- `.env.production.example`

example filesをenvironment variable schemaとして扱ってください。

GitHub Secretsで利用するvariable名も対応するexample fileに記載してください。

secret:

`SECRET_NAME=`

public configuration:

`PUBLIC_VALUE=safe-example`

のようにしてください。

secret value、token、credential、private keyをexampleへ書いてはいけません。

GitHub Secretsとlocal environmentで同じ概念のvariable名を不必要に変えないでください。

GitHub Actionsで使うsecretに対応するlocal variableは、実行に必要な環境では適切なignored actual env fileにも保持する構成にしてください。

GitHubからstored secret valueを読み戻せることを前提にしてはいけません。

---

## 33. `.gitignore`

project stackを調査して適切に整備してください。

最低限検討:

- `.tmp/`
- `.reference/`
- actual dotenv files
- dependencies
- build outputs
- generated caches
- test / coverage outputs
- tool caches
- OS temporary files
- editor temporary files
- local secret artifacts

誤ってignoreしてはいけないもの:

- source
- lockfile
- reproducibility config
- Agent Skills
- project agent config
- CI/CD config
- committed env examples

重複ruleを無秩序に増やさず整理してください。

### Pre-commit hook

この初期化方針のためだけにpre-commit hookを新設しないでください。

必要な検査はproject scriptsとCI/CDから再現可能に実行できることを優先してください。

---

## 34. CI/CD

CI/CDはユーザーから別指定がない限りGitHub Actionsを使用してください。

CIではapplicable quality gateを実行してください。

localとCIで別々のvalidation logicを重複実装せず、可能な限り同じproject scriptsを呼び出してください。

環境差を隠すのではなく検出してください。

---

## 35. Version / release

versionはSemantic Versioning:

`MAJOR.MINOR.PATCH`

形式を使用してください。

例:

- `1.0.0`
- `2.4.1`

external ecosystem上の明確な理由がない限り`1`や`1.2`等の省略形式を使わないでください。

### Tag-triggered release

tag pushでreleaseする場合、tag versionとauthoritative package/project versionを同期してください。

例:

- tag: `v1.4.2`
- project version: `1.4.2`

release workflowは不一致を検出したら自動修正せずfailしてください。

最低限:

1. tag format validation
2. semantic version extraction
3. authoritative version comparison
4. full quality gate
5. release build
6. successful validation後のみpublish/release

の順で実行してください。

複数release packageがある場合はauthoritative versionまたは各release unitのversion policyを明確化してください。

---

## 36. Container / IaC

新規container definitionには`Dockerfile`ではなく`Containerfile`を使用してください。

toolがDockerfileをdefaultとする場合は`Containerfile`を明示指定してください。

既存Dockerfileは、移行が妥当ならADRを作成してContainerfileへ移行してください。

Containerfile、Compose、Kubernetes、Terraform、CloudFormation、Helm等がある場合、projectに必要な最小validation toolsetを選んでください。

候補:

- Hadolint系lint
- Trivy
- platform-native validator
- image scanner
- IaC validator

すべてを機械的に導入しないでください。

broad ignoreでscanを通してはいけません。

container imageがdeliverableなら、可能な場合built imageも検証してください。

---

## 37. UI architecture

UIはdata modelのpropertyをそのまま画面へ並べるのではなく:

1. data model
2. use case
3. user goal
4. information priority
5. interaction timing

からinformation architectureを設計してください。

決定してください。

- what is visible
- when it is visible
- what remains implicit
- what belongs together
- primary actions
- progressive disclosure

情報構造を改善しない不要なcard、wrapper、panel、border、visual chromeを増やさないでください。

### UI library

適用可能ならheadless UI primitivesを基礎とすることを優先してください。

behavior/accessibility primitiveとproject-specific presentationを分離してください。

既存の整合したdesign systemやplatform-native recommendationがある場合はそれを優先できます。

---

## 38. UI verification

visible UIを変更した場合はsourceだけで合否判定せず、実際のrendered resultを確認してください。

WebではPlaywright等を利用してください。

必要に応じて:

- screenshots
- desktop/mobile viewport
- loading
- empty
- error
- interaction states
- overflow
- visibility
- console errors
- network failures

を確認してください。

verification artifactsは`.tmp/`に置いてください。

表示が設計を満たさない場合は実装ループを続行してください。

---

## 39. Mode / permission / trust

active agent modeによって必要なtool/capabilityが意図的に制限されている場合:

- bypassを探さない
- unrelated toolで迂回しない
- validationを弱めない

ユーザーへ適切なmode変更を要求してください。

permission / trust / authentication gateも同様に正当なuser gateとして扱ってください。

---

## 40. Deterministic verificationを優先する

機械的に判定できる事実は決定論的toolで検証してください。

例:

- compiler / type checker
- formatter
- Biome / linter
- Knip
- test runner
- coverage
- Playwright
- container/IaC scanner
- dependency audit

AIはtool resultを解釈してください。

AIの主観で機械検証を置き換えてはいけません。

既存のskip / ignore / suppression / deprecated tool等も存在理由を確認し、盲目的に維持・削除せず、可能ならroot causeを修正してください。

---

## 41. Fresh-clone audit

初期化完了前にfresh cloneの視点で確認してください。

- agent behaviorを定義するfileは何か
- Skillsはどこにあるか
- pluginはproject-localか
- required binariesは何か
- binariesはどうprovisionされるか
- global softwareを暗黙要求していないか
- environment variablesは何か
- secretsはどう供給されるか
- Windows/WSLCで動くか
- NixOSで動くか
- home directory configへ依存していないか
- implicit persistent memoryへ依存していないか
- `.tmp/` / `.reference/` はignoredか
- actual envはignoredか
- env examplesはcommittedか
- local/CI validationが同一ロジックか

hidden dependencyを排除してください。

---

## 42. 初期化で作るもの

実projectに必要なものだけ作成してください。

候補:

- concise `AGENTS.md`
- thin agent-specific adapter
- Agent Skills
- project-local plugin configuration
- agent/toolchain ADR
- architecture ADR
- development dependency
- Nix/dev environment
- validation scripts
- test / coverage config
- `.gitignore`
- GitHub Actions
- release/version validation
- env examples
- README / development documentation

空のboilerplate Skillやdirectoryを作ってはいけません。

この文書に名前があるという理由だけでpluginを導入してはいけません。

---

## 43. 完了報告

初期化完了時は簡潔に以下を報告してください。

- detected stack
- detected architecture
- official architecture guidance investigated
- existing agent configuration
- files created/changed
- Skills and activation conditions
- plugins/tools considered
- selected plugins/tools
- rejected candidates and reasons
- ADRs created/updated
- canonical validation command
- test / coverage configuration
- CI/CD configuration
- environment configuration
- remaining trust/authentication steps
- existing quality debt
- unreproducible items, if any

不採用候補と理由も残してください。

---

# 実装タスクの標準動作

この初期化によって、以後ユーザーが毎回指示しなくても、すべての非自明な実装タスクで原則として次を自動実行できる状態を作ってください。

1. repositoryと関連designを調査する
2. official architecture guidanceが関係する場合は現在の公式情報を確認する
3. user-requested scopeを縮小しない
4. dependency graphを作る
5. 論理的に安全な最大数のsubagentを駆動する
6. local `main`のみで作業する
7. worktreeを作らない
8. disjoint file ownershipを割り当てる
9. commit操作を直列化する
10. agentごとの担当変更を個別commitする
11. formatter / Biome / type-check / Knip / build / test / coverage / applicable checksをすべて実行する
12. error / actionable warning / unjustified skip / ignore / suppressionを残さない
13. UI変更では実際のrendered resultを確認する
14. final diffを確認する
15. 未完項目があればrubber-duckして再計画する
16. full requested taskが完了するまで続行する
