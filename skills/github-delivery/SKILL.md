---
name: github-delivery
description: GitHub Issues / Projects / Pull Requestsを使ってticket-drivenなsprint/Kanban開発を進める時に使用する。
---

# GitHub Delivery

## Work state

- source state SoT: canonical Git remote/ref
- work state SoT: GitHub Issues / Projects
- review/integration: Pull Requests
- transient execution state: Supervisor

## Issue

durable planning unitは原則Issueにする。

含める候補:

- objective / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size
- area/component
- iteration/sprint
- target release/milestone

短命なresearch/worker subtaskまでIssue化する必要はない。

## Project / Kanban

最低限のStatus:

`Backlog -> Ready -> In Progress -> In Review -> Done`

推奨field:

- Priority
- Size
- Iteration / Sprint
- Area / Component
- Target Release

WIPを無制限に増やさない。Readyかつdependency解消済みticketからcapacity内で起動する。

## Sprint

1. sprint goalを定義。
2. Ready ticketを選択。
3. dependencyとcapacityを確認。
4. parallel workerを起動。
5. PR / review / CIをDone gateにする。
6. unfinished ticketは再計画する。

## Branch

原則、1 top-level Issueにつき1 integration branchを作る。

canonical format:

`issue/<issue-number>-<short-slug>`

例:

- `issue/123-add-oauth`
- `issue/418-fix-calendar-race`

通常のticket workではIssue番号を省略しない。

nested workerが返すephemeral ref/commitはこの命名規則の対象外でよい。

## Draft PR first

Issueの実装を開始し、integration branchに意味のある最初のcommitができた段階で、可能な限り早くDraft PRを作成する。

Draft PRは完成報告ではなく、durable integration surfaceとして使用する。

用途:

- Issue linkage
- progress visibility
- early CI
- reviewer context
- agent/human discussion
- scope inspection

PR本文には最低限:

- `Closes #<issue-number>` または明示的なIssue link
- acceptance criteria
- implementation summary
- validation results
- known limitations / blockers

を含める。

## Ready for review

DraftからReady for reviewへ移す条件:

- Issue acceptance criteriaを実装済み
- integration quality gateを実行済み
- blocking known issueが解消済み、または明示的にscope外
- PR descriptionが現在の実装と一致
- integration branchがreview可能な状態

## Merge / Done

Doneの標準条件:

- acceptance criteria satisfied
- required CI/checks green
- blocking review resolved
- base staleness handled
- PR merged
- linked Issue closed
- GitHub Project status moved to Done

## Multi-agent integration

- 1 top-level Issue = 1 integration branch = 1 PRを基本とする。
- implementation workerはintegration branchを複数agentで直接共有しない。
- nested workerはimmutable commit/refを返す。
- Coordinator/Supervisorだけがintegration branchへ順序立てて統合する。
- merge前にcanonical baseとのstalenessを確認する。

Git / GitHub messageは英語を使用する。
