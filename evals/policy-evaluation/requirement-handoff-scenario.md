# Canonical requirements: cold handoff and compaction evaluation

Give a **fresh** agent this scenario, the two applicable Skills, and the canonical Issue #152, **without** showing the record contract, sample answers, or author's preferred solution. Capture the response verbatim and grade with:

```sh
bun evals/shared/record-grader.mts requirement-handoff /path/to/answer.txt
```

## Scenario

A user required an implementation to preserve an explicit **never send external traffic** constraint, retain a prescribed source revision, and pass two acceptance criteria. Parent A summarizes the request and delegates to B; B delegates to C. During the second handoff, the negative constraint disappears from the summary. C cannot access the canonical Issue/Spec directly; B supplies an excerpt containing the feature goal but cannot confirm that it includes all constraints. A context compaction creates a checkpoint with a shorter scope than the Issue. C reports completion against that checkpoint, but the submitted diff sends traffic externally. The current design and Issue remain unchanged.

For each key, select the defensible behavior using the Skills. Use exactly seven `key=value` lines, in this order; no prose.

| Key | Values |
|---|---|
| persist | canonical-with-origin-revision, rewrite-from-summary |
| handoff | direct-canonical-read, summary-only |
| excerpt | complete-or-block, partial-proceed |
| compaction | checkpoint-not-spec, checkpoint-becomes-spec |
| authority | canonical-wins, checkpoint-wins |
| fanin | requirements-and-current-artifact, trust-child-report |
| constraints | preserve-negative-conditions, drop-negatives |

## Limits

The checked-in negative/regression/positive fixture cases test that the grader distinguishes incorrect choices. **They do not establish that a fresh independent agent actually passed this scenario.** Record model/runtime, output, and graded outcome in the PR to claim a cold-eval pass; otherwise mark it unverified.
