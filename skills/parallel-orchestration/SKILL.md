---
name: parallel-orchestration
description: 複数AIエージェントへtaskを分解・委譲し、immutable snapshot/resultで安全に並行統合する時に使用する。
---

# Parallel Orchestration

非自明な実装をdependency graphへ分解し、Readyなnodeをresource/WIP制約内で最大限並行実行する。

## Invariants

- 1 implementation worker = 1 isolated mutable runtime。
- shared working tree / Git index / integration branchを複数workerが直接更新しない。
- parent -> child はimmutable snapshot。
- child -> parent はimmutable commit/ref/diff + validation result。
- sandbox lifecycleはworker外のSupervisorが管理する。
- worktree単体をexecution isolationとみなさない。
- durable planning unitはGitHub Issue、短命な内部subtaskはSupervisor taskとしてよい。
- child lifecycleはparent model processではなくSupervisorが所有する。
- task/resultには必要に応じて `execution_generation` を持たせ、stale generationを統合しない。
- long-running task / context limit / sandbox recreationでは `agent-recovery` Skillを適用する。

## Flow

1. Issueのobjective / acceptance criteria / dependencyを読む。
2. task graphを作る。
3. 各nodeのinput snapshot / output contract / recovery boundaryを決める。
4. unfinished prerequisiteのないnodeをspawnする。
5. meaningful boundaryでcheckpointする。
6. worker resultをinspectする。
7. Coordinator/Supervisorだけがticket branchへ順序立てて統合する。
8. integration checkpointごとにrequired validationを行う。
9. Reviewerをclean candidate snapshotから起動する。
10. GitHub board stateを実行状態と同期する。

## Spawn contract

最低限:

```text
issue_or_task_id
objective
acceptance_criteria
base_snapshot
execution_generation
role
allowed_tools
budget
expected_result
```

## Result contract

最低限:

```text
agent_id
issue_or_task_id
base_snapshot
execution_generation
result_commit_or_ref
summary
validation_results
known_issues
```

## Parent failure

parent agentが停止してもsafeなchildを自動破棄しない。

recovered CoordinatorはSupervisorからchildを再発見し、running/completed/failed/orphanedをreconcileする。completed resultはimmutable snapshot/result relationshipとgenerationを確認してから統合する。

## Fallback

true isolationが使えない場合、shared mutable workspaceで並列実装しない。read-only researchの並列化または安全な直列実装へ縮退する。
