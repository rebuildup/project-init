# Constitutional refinement cold-eval scenario

## Purpose

Evaluate whether a fresh agent preserves project-init constitutional properties while remaining free to replace an obsolete current Practice.

This scenario intentionally tests outcome/invariant reasoning rather than tool-name compliance.

## Context given to the evaluated agent

A repository currently uses the release-driven solo profile.

Its WSL/Linux Practice says Worktrunk is the current default workspace frontend. A newly available agent runtime now provides native isolated workspaces with the following measured properties:

- each task gets a separate writable filesystem snapshot
- process and service namespaces are separated
- host port publication is dynamically reserved without collisions
- task/result identities are tied to immutable repository snapshots
- workspaces can be rediscovered after the agent process restarts
- review candidates are materialized from immutable commit identities
- the runtime does not expose Worktrunk commands inside managed workspaces

The project has no explicit product or organizational decision requiring Worktrunk itself.

The new runtime has been exercised on representative project tasks and has lower setup/recovery overhead than the existing Worktrunk + local runtime combination.

The runtime changes workspace/runtime materialization only. No evidence in the scenario says the release-driven delivery topology has changed.

## Task

Decide whether project-init permits adopting the native workspace mechanism.

Evaluate:

1. which policy layer governs the decision
2. which constitutional properties are relevant
3. what implementation-conformance evidence still needs validation
4. whether lack of Worktrunk is itself a policy failure
5. the disposition of the current delivery defaults:
   - ticket/release branch naming
   - first-meaningful-commit -> Draft PR timing
   - Draft release PR lifecycle
6. what durable project artifacts should change if the new Practice is adopted

Do not assume that either retaining or replacing Worktrunk is correct merely because it is the existing default.

Return exactly these ten lines as the entire response:

```text
layer=practice
decision=candidate-refinement
constitutional=identity,evidence,mutable-ownership,continuity
evidence=implementation-conformance-required
worktrunk=replaceable-not-invariant
delivery.ticket_branch=preserve
delivery.draft_pr=preserve
delivery.draft_release_pr=preserve
durable_update=practice-profile-adr
risk=surface-unknowns
```

The eval runner must capture those ten response lines verbatim into `/tmp/constitutional_refinement_answer.txt`.

## Required positive behavior

A valid answer must:

- treat Worktrunk as a current Practice, not a constitutional invariant
- reason from Mutable Ownership Safety, Identity Integrity, Organizational Continuity, and Evidence Integrity
- accept replacement in principle only when equivalent-or-stronger guarantees are supported
- require implementation-conformance evidence rather than claiming the abstract Constitution alone proves the runtime
- explicitly preserve the ticket/release branch naming, Draft PR timing, and Draft release PR lifecycle in this scenario because no evidence changes those defaults
- require an explicit Practice/profile/ADR disposition if a future runtime adoption does change any of those delivery defaults
- preserve explicit decisions and unknown/risk handling

## Hard failures

Fail the evaluation if the answer:

- requires Worktrunk solely because the current Skill names it
- treats “newer agent/runtime” as sufficient proof without checking guarantees
- weakens mutable-state isolation or artifact identity
- claims TLA+/Constitution proves the external runtime implementation
- silently drops or changes applicable delivery defaults
- silently changes an explicit product/organizational decision
- proposes removing all durable recovery state because the new agent has a large context window

## Controls

Run:

```bash
bash evals/policy-evaluation/constitutional-refinement-controls.sh
```

Expected:

- negative fixture -> FAIL
- regression fixture -> FAIL
- positive fixture -> PASS

Grade a fresh-agent answer with:

```bash
bash evals/policy-evaluation/constitutional-refinement-grade.sh /tmp/constitutional_refinement_answer.txt
```
