---
name: github-delivery
description: GitHub Issues / Projects / Pull Requestsを使い、release branchをsprint integration lineとしてticket-drivenなアジャイル開発を進める時に使用する。
---

# GitHub Delivery

## Source of Truth

- released source state: `main`
- active sprint/release integration state: `release-x-y-z`
- durable work state: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient execution state: Supervisor

`main` はリリース済み・統合済みの安定状態を表す。
通常のticket PRを直接 `main` へ向けない。

## Release branch = sprint branch

各sprintは、目標とするversionに対応した1本のrelease branchを持つ。

canonical format:

`release-<major>-<minor>-<patch>`

例:

- `release-0-1-0`
- `release-0-2-0`
- `release-1-0-0`

Git ref上の可読性とshell/URLでの扱いやすさのため、version separatorには `.` ではなく `-` を使用する。

そのsprintに含まれるticket PRはすべて対応するrelease branchをbaseにする。

```text
main
└─ release-x-y-z
   ├─ 123
   ├─ 124
   └─ 125
```

release branchはsprint開始時に `main` のrelease基準commitから作成する。

## Issue

durable planning unitは原則GitHub Issueにする。

Issueのtitle/bodyは日本語を標準とする。

含める候補:

- 目的 / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size
- area/component
- target version
- release date

短命なresearch/worker subtaskまでIssue化する必要はない。

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
Readyかつdependency解消済みticketからcapacity内で起動する。

## Sprint / release cycle

1. 次versionとrelease dateを決める。
2. `release-x-y-z` branchを作成する。
3. sprint goalを定義する。
4. Ready ticketを選択する。
5. dependencyとcapacityを確認する。
6. ticketごとにnumber-only branchを作る。
7. isolated workerを並行起動する。
8. ticket PRをrelease branchへ統合する。
9. merge成功を確認後、linked Issueを明示的にcloseしてProject statusをDoneへ更新する。
10. release branch全体を検証する。
11. release PRを `main` へmergeする。
12. version/release処理を完了する。
13. 未完了ticketは次releaseへ明示的に再計画する。

## Ticket branch

原則、1 top-level Issueにつき1 durable ticket branchを作る。

canonical format:

`<issue-number>`

例:

- `123`
- `418`
- `1024`

branch名に `issue/` prefix、slug、title、type等を追加しない。

理由:

- Issue番号だけでticket identityを一意に表せる
- 説明責務はIssue/PRへ置く
- branch一覧を短く保つ
- 自動化でbranch <-> Issue対応を機械的に解決できる

nested workerが返すephemeral ref/commitはこの命名規則の対象外でよい。

## Draft PR first

Issueの実装を開始し、ticket branchに意味のある最初のcommitができた段階で、可能な限り早くDraft PRを作成する。

PRのbaseは、そのticketが所属する `release-x-y-z` branchとする。

Draft PRは完成報告ではなくdurable integration surfaceとして使用する。

用途:

- Issue linkage
- progress visibility
- early CI
- reviewer context
- agent/human discussion
- scope inspection

PR title/bodyは日本語を標準とする。

PR本文には最低限:

- linked Issue (`Issue: #<issue-number>` 等。non-default release branch向けPRではclosing keywordによる自動closeに依存しない)
- acceptance criteria
- implementation summary
- validation results
- known limitations / blockers
- target release branch

を含める。

## Ready for review

DraftからReady for reviewへ移す条件:

- Issue acceptance criteriaを実装済み
- ticket-level integration quality gateを実行済み
- blocking known issueが解消済み、または明示的にscope外
- PR descriptionが現在の実装と一致
- target release branchとのstaleness/conflictを処理済み

## Ticket merge / Done

IssueのDone条件:

- acceptance criteria satisfied
- required CI/checks green
- blocking review resolved
- release branchとのstaleness handled
- ticket PR merged into target `release-x-y-z`
- linked Issue explicitly closed after successful merge
- GitHub Project status moved to Done

`main`へのmergeをIssue単位のDone条件にはしない。
Issueはrelease branchへの統合後、explicit close / Project Done更新まで完了した時点でDoneになる。

GitHubのclosing keywordはdefault branch向けPRでのみ自動closeに使えるため、ticket PRではmerge成功確認後にCoordinatorまたはdelivery automationがIssueを明示的にcloseする。`Closes #<issue-number>`だけをDone transitionにしない。

## Release integration

release branchは複数ticketの統合結果を保持するsprint integration lineである。

release完了前にrelease branch上でfull applicable quality gateを実行する。

release PR:

`release-x-y-z -> main`

を作成し、最低限次を含める。

- release goal
- included Issues/PRs
- breaking changes
- migration notes
- full validation result
- known limitations
- release/version metadata

release PR title/bodyは日本語を標準とする。

release PRがmergeされた時点で `main` がそのversionのreleased source stateになる。

## Multi-agent integration

- 1 top-level Issue = 1 ticket branch = 1 ticket PRを基本とする。
- ticket branchのbase/PR targetは該当 `release-x-y-z`。
- implementation workerはticket branchを複数agentで直接共有しない。
- nested workerはresolved immutable identityへpinされたcommit/ref resultを返す。
- Coordinator/Supervisorだけがticket branchへ順序立てて統合する。
- release branchへはReadyなticket PRを通して統合する。
- merge前にtarget release branchとのstalenessを確認する。

## Language policy

- Issue title/body: 日本語
- PR title/body/review discussion: 日本語
- internal planning docs: 日本語
- commit message: 英語
- source code: 英語

commit format:

`<work-prefix>: <extremely concise title>`
