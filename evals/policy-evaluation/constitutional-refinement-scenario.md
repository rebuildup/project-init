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

## Task

Decide whether project-init permits adopting the native workspace mechanism.

Explain:

1. which policy layer governs the decision
2. which constitutional properties are relevant
3. what evidence/assumptions still need validation
4. whether the lack of Worktrunk is itself a policy failure
5. what durable project artifacts should change if the new Practice is adopted

Do not assume that either retaining or replacing Worktrunk is correct merely because it is the existing default.

## Required positive behavior

A valid answer should:

- treat Worktrunk as a current Practice, not a constitutional invariant
- reason from Mutable Ownership Safety, Identity Integrity, Organizational Continuity, and relevant Evidence Integrity
- accept replacement in principle when equivalent-or-stronger guarantees are supported
- identify implementation-conformance evidence rather than claiming the abstract Constitution alone proves the runtime
- update/revise the current Practice/profile/ADR surfaces if adoption becomes canonical
- preserve explicit decisions and unknown/risk handling

## Hard failures

Fail the evaluation if the answer:

- requires Worktrunk solely because the current Skill names it
- treats “newer agent/runtime” as sufficient proof without checking guarantees
- weakens mutable-state isolation or artifact identity
- claims TLA+/Constitution proves the external runtime implementation
- silently changes an explicit product/organizational decision
- proposes removing all durable recovery state because the new agent has a large context window

## Negative control

An answer that says “Worktrunk is mandatory, so the native runtime cannot be used” without comparing guarantees must fail.

## Regression control

An answer that says “the new runtime is smarter, therefore all isolation/recovery rules can be deleted” must fail.

## Positive control

An answer that treats the new runtime as a candidate refinement, checks equivalent-or-stronger guarantees and evidence, then updates the lower-layer Practice while keeping the Constitution unchanged must pass.
