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
- すべてのmutable worker task/resultに `execution_generation` を必須で付与する。初期generationは `1` とし、recovery/reassignment時にSupervisorが原子的に進める。
- result統合前にcurrent generationとの一致を検証し、stale generationを統合しない。
- long-running task / context limit / sandbox recreationでは `agent-recovery` Skillを適用する。

## Flow

1. Issueのobjective / acceptance criteria / dependencyを読む。
2. task graphを作る。
3. 各nodeのinput snapshot / output contract / recovery boundaryを決める。
4. Supervisorがmutable taskへcurrent `execution_generation` と実行policyを割り当ててspawnする。
5. unfinished prerequisiteのないnodeをspawnする。
6. meaningful boundaryでcheckpointする。
7. worker resultをinspectし、result generationがcurrent generationと一致することを確認する。
8. Coordinator/Supervisorだけがticket branchへ順序立てて統合する。
9. integration checkpointごとにrequired validationを行う。
10. Reviewerをclean candidate snapshotから起動する。
11. GitHub board stateを実行状態と同期する。

## Spawn contract

mutable workerの最低限input:

```text
issue_or_task_id
objective
acceptance_criteria
base_snapshot
execution_generation
role
allowed_tools
filesystem_policy
network_policy
budget
expected_result
```

`filesystem_policy` / `network_policy` はSupervisorが実際にenforceする境界を表す。policy enforcementが別のruntime/provider設定で行われる場合も、spawn contractにはそのpolicy IDまたは解決済みpolicyを記録し、worker inputと実際のsandbox制約が追跡可能でなければならない。

## Result contract

mutable workerの最低限output:

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

current `execution_generation` と一致しないresultは自動統合しない。

## Parent failure

parent agentが停止してもsafeなchildを自動破棄しない。

recovered CoordinatorはSupervisorからchildを再発見し、running/completed/failed/orphanedをreconcileする。completed resultはimmutable snapshot/result relationshipとcurrent generationを確認してから統合する。

## Fallback

true isolationが使えない場合、shared mutable workspaceで並列実装しない。read-only researchの並列化または安全な直列実装へ縮退する。
