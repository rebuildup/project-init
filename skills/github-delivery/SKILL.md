---
name: github-delivery
description: GitHub Issues / Projects / Pull Requestsを使い、1週間のrelease sprint、dependency-aware stacked PR、durable Draft PR lifecycleでticket-drivenなアジャイル開発を進める時に使用する。
---

# GitHub Delivery

## Source of Truth

- released source state: `main`
- active sprint/release integration state: `release-x-y-z`
- durable work state: GitHub Issues / Projects
- dependency state: GitHub Issue / Project dependency metadata
- ticket review/integration: Pull Requests
- transient execution state: Supervisor

`main` はリリース済み・統合済みの安定状態を表す。
通常のticket PRを直接 `main` へ向けない。

## Weekly release sprint

通常のsprint期間は **1週間** とする。

1 sprint = 1 target semantic version = 1 release integration branchを維持する。

canonical format:

`release-<major>-<minor>-<patch>`

例:

- `release-0-1-0`
- `release-0-2-0`
- `release-1-0-0`

release branchはsprint開始時に `main` のrelease基準commitから作成する。

緊急patchや明示的なrelease判断では1週間から外れてよいが、通常planning cadenceは1週間を基準とする。

## Issue

durable planning unitは原則GitHub Issueにする。

Issueのtitle/bodyは日本語を標準とする。

最低限、該当するものを明示する:

- 目的 / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size
- area/component
- target version
- release date
- accountable assignee

短命なresearch/worker subtaskまでIssue化する必要はない。

Issue dependency graphはcanonical dependency SoTであり、Git branch topologyだけでdependencyを表現しない。

## Project / Kanban

最低限のStatus:

`Backlog -> Ready -> In Progress -> In Review -> Done`

推奨field:

- Priority
- Size
- Target Version
- Area / Component
- Blocked / dependency

WIPを無制限に増やさない。
Readyかつdependency条件を満たすticketからcapacity内で起動する。

Dependency execution上は必要に応じて次を区別する:

- `blocked`: prerequisite snapshotがまだ利用できない
- `stack-ready`: reviewable immutable predecessor snapshotがあり、dependent workを開始できる
- `integrated`: predecessorがtarget releaseへ統合済み

この3状態はdependency semanticsであり、Project Status自体を必ず増やす必要はない。

## Sprint / release cycle

1. 次version、1週間のsprint window、release dateを決める。
2. `release-x-y-z` branchを `main` から作成する。
3. sprint goalを定義する。
4. Ready ticketを選択する。
5. dependency / stack候補 / capacityを確認する。
6. ticketごとにnumber-only branchを作る。
7. 最初のmeaningful commit直後にDraft PRを必ず作成し、metadataを設定する。
8. isolated workerをdependency/WIP制約内で並行起動する。
9. independent ticketまたはstacked ticketをreview/integrationする。
10. ticket merge成功を確認後、linked Issueを明示的にcloseしてProject statusをDoneへ更新する。
11. release branch全体を検証する。
12. release PRを `main` へmergeする。
13. version/release処理を完了する。
14. 未完了ticketは次releaseへ明示的に再計画する。

## Ticket branch

原則、1 top-level Issueにつき1 durable ticket branchを作る。

canonical format:

`<issue-number>`

例:

- `123`
- `418`
- `1024`

branch名に `issue/` prefix、slug、title、type等を追加しない。

nested workerが返すephemeral immutable ref/commitはこの命名規則の対象外でよい。

## Branch creation and Draft PR are one start procedure

**active durable branchには必ずDraft PRを持たせる。**

GitHubはbaseと差分のないbranchにはPRを作れないため、canonical sequenceは次の通り:

1. durable branchを作成する
2. 最初のmeaningful commitを直ちに作る
3. Draft PRを直ちに作る
4. Draft PRがない状態でactive implementationを継続しない

「後でPRを作る」は禁止する。

このruleはhuman / Coordinator / implementation worker / subagentのすべてに適用する。
subagentがdurable branchを作る権限を持つ場合、そのsubagent自身がDraft PRまで作成するか、最初のcommit後ただちにSupervisor/Coordinatorへcontrolを返してDraft PRを作成させる。Draft PRなしで追加implementationを継続しない。

Ephemeral immutable worker ref/resultはdurable branchではないため対象外。

## PR metadata is required state

PRはdiffだけではなくdurable work stateである。
作成時にrepository evidenceから該当するmetadataを評価し、設定する。

最低限:

- linked Issue (`Issue: #<issue-number>` 等)
- accountable assignee
- reviewer request / CODEOWNERS-derived reviewer
- repositoryで定義済みの適切なlabels
- acceptance criteria
- implementation summary
- validation status/results
- known limitations / blockers
- target release branch
- stacked PRならstack trunk / immediate predecessor / relevant successor context

ownership、scope、stack position、review requirementが変わった場合はmetadataも更新する。

存在しないlabelを勝手に作る、関係のないreviewerを形式的に指定する、PR author自身を自己reviewerとして埋める、という運用はしない。意味のあるreviewerが存在しない場合はPR bodyへその事実と代替review path（configured review automation / CI / explicit final review等）を記録する。

Issue/PR title/body/review discussionは日本語を標準とする。

## Independent ticket PR

hard predecessorを持たないticketはtarget release branchをdirect baseにする。

```text
main
└─ release-x-y-z
   └─ 123
```

PR:

`123 -> release-x-y-z`

## Dependency-aware stacked PR

同一repository・同一target release内でlinear hard dependencyを持つtop-level Issuesはstacked PRを使用してよい。

```text
main
└─ release-x-y-z
   └─ 123
      └─ 124
         └─ 125
```

PR:

- `123 -> release-x-y-z`
- `124 -> 123`
- `125 -> 124`

全ticketはtarget release `release-x-y-z` を共通stack trunkとして持つ。

Stack eligibility:

- same repository
- same target release
- real hard dependency
- stacked segmentがordered chainとして表現可能
- predecessorにreviewable immutable commit/snapshotが存在

Issue dependency graphがbranchする場合、無理に1本のlinear stackへ変換しない。
PR stackはIssue dependency graphのlinear pathをexecution/integration topologyへprojectionしたものにすぎない。

`1 top-level Issue = 1 durable ticket branch = 1 ticket PR` はstackでも維持する。
1 Issueを細切れのdurable PRへ分割するためだけにstackを使わない。

## Stack-ready execution

predecessorがrelease branchへ未mergeでも、reviewable immutable snapshotが存在すればdependent ticketを開始してよい。

開始時に少なくとも以下をpinする:

- predecessor Issue/PR identity
- predecessor commit SHA / immutable snapshot
- common target release
- immediate PR base

predecessor reviewで変更が入った場合、downstreamをdependency orderでrebase/updateし、影響したrequired validationを再実行する。

古いgreen resultを異なるSHAへ流用しない。

## Ready for review

DraftからReady for reviewへ移す条件:

- Issue acceptance criteriaを実装済み
- current SHAに対するticket-level integration quality gateを実行済み
- blocking known issueが解消済み、または明示的にscope外
- PR description / assignee / labels / reviewer metadataが現在の実装と一致
- required reviewerをrequest済み、または意味のあるreviewer不在を明記済み
- target release branchまたはimmediate stack predecessorとのstaleness/conflictを処理済み
- predecessor変更によるdownstream revalidationを処理済み

## Ticket merge / Done

IssueのDone条件:

- acceptance criteria satisfied
- required CI/checks green for current SHA
- blocking review resolved
- release/stack staleness handled
- ticket PRが意図したintegration pathへmerge済み
- linked Issue explicitly closed after successful merge
- GitHub Project status moved to Done

通常stackはearliest predecessorからdownstreamへ順序立ててmergeする。
platform/repository policyがatomic stack landingを安全に提供する場合は、stack内すべてのticketが個別にacceptance criteria / review / current-SHA validationを満たす時だけ使用してよい。merge後は各Issue/Project stateを明示的にreconcileする。

`main`へのmergeをIssue単位のDone条件にはしない。

GitHubのclosing keywordはdefault branch向けPRでのみ自動closeに使えるため、non-default integrationではmerge成功確認後にCoordinatorまたはdelivery automationがIssueを明示的にcloseする。

## Release integration

release branchは複数ticketの統合結果を保持するsprint integration lineである。

release branchはsprint開始時に作成する。GitHubは`main`と差分がない状態ではPRを作れないため、release branchに最初のmeaningful integrated differenceが入った直後にDraft release PRを作成する。

Draft release PRにもassignee / reviewer / labels / release goal / included Issues / current validation stateを設定し、release期間中維持する。

release完了前にrelease branch上でfull applicable quality gateを実行する。

release PR:

`release-x-y-z -> main`

最低限:

- release goal
- included Issues/PRs
- breaking changes
- migration notes
- full validation result
- known limitations
- version/release metadata

release PRがmergeされた時点で `main` がそのversionのreleased source stateになる。

## Multi-agent integration

- 1 top-level Issue = 1 ticket branch = 1 ticket PRを基本とする。
- independent ticket PR base = target `release-x-y-z`。
- stacked dependent ticket PR base = immediate predecessor ticket branch。
- all stack members share one target release trunk。
- implementation workerはticket branchを複数agentで直接共有しない。
- nested workerはresolved immutable identityへpinされたcommit/ref resultを返す。
- durable branchを作るworker/subagentにはDraft PR creation / metadata contractも適用する。
- Coordinator/Supervisorだけがshared durable integration stateへ順序立てて統合する。
- merge前にtarget release / predecessor / current validation SHAを確認する。

## Language policy

- Issue title/body: 日本語
- PR title/body/review discussion: 日本語
- internal planning docs: 日本語
- commit message: 英語
- source code: 英語

commit format:

`<work-prefix>: <extremely concise title>`
