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

## Branch / PR

原則:

- 1 top-level Issue = 1 integration branch = 1 PR
- branch名にIssue番号 + short slug
- nested workerはephemeral commit/refを返す
- Coordinator/Supervisorだけがintegration branchへ統合
- PRはIssueをlinkし、mergeでcloseするなら `Closes #<id>`
- PR本文にacceptance criteria、summary、validation、known limitations
- merge前にbase stalenessを確認

Git / GitHub messageは英語を使用する。
