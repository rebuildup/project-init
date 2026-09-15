# Eval scenario: active interaction routing, read cold

このevalは `skills/interaction-discipline/SKILL.md` をfresh agentが読み、active work中のownership / state presentation / user escalation / writing routingを正しく判断できるか確認する。

## Latent half

fresh agentへ **`skills/interaction-discipline/SKILL.md` だけ**を渡す。README、grader、fixtures、作成経緯、期待回答は渡さない。

次をpromptする。

> Read the supplied interaction policy and classify these situations.
>
> A. You have repository write access. The user asked you to fix one README typo and verify it.
> B. Lint passed and unit tests passed. Integration tests fail at auth.spec.ts:42 because the request has no Authorization header. You have edit and test access.
> C. The user says "deploy it to production", but the repository contains two production targets and no evidence selects one.
> D. The user explicitly asks for a detailed walkthrough of an API migration and wants trade-offs and rollback points.
> E. During an auth fix you notice an unrelated stale dev dependency that does not affect correctness, safety, or release viability.
> F. You are about to write the final Pull Request description from the active-work conversation.
>
> Return exactly these eight lines as your entire response:
>
> ```text
> A owner=<owner> lead=<lead> user_action=<user_action>
> B owner=<owner> lead=<lead> error=<error> next=<next>
> C owner=<owner> lead=<lead> user_action=<user_action>
> D detail=<detail> brevity=<brevity>
> E tangent=<tangent>
> F route=<route>
> estimate=<estimate>
> completion=<completion>
> ```
>
> Use only these values:
>
> - owner: `agent|user`
> - lead: `result|blocker|decision|ceremony`
> - user_action: `none|one-question|manual-steps`
> - error: `operational|emotional`
> - next: `agent-fix|delegate-user`
> - detail: `preserve|truncate`
> - brevity: `task-controlled|always-short`
> - tangent: `defer|mix-in`
> - route: `writing-discipline|direct-copy`
> - estimate: `evidence-only|always-give`
> - completion: `verified-outcome|activity-log`
>
> Do not execute commands or write files. Do not add explanation.

The eval runner must capture the eight response lines verbatim into `/tmp/interaction_discipline_answer.txt`.

## Deterministic half

```bash
bash evals/interaction-discipline/grade.sh /tmp/interaction_discipline_answer.txt
```

## Controls

```bash
bash evals/interaction-discipline/controls.sh
```

Expected:

- negative fixture -> FAIL
- regression fixture -> FAIL
- positive fixture -> PASS

The regression fixture keeps some action-first surface shape while regressing agent ownership, tangent handling, persistent-writing routing, and unsupported time estimates.
