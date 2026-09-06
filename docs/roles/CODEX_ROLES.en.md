# Codex Role Allocation — as of August 2026

This document is a **provisional operating policy as of August 2026**.

Re-evaluate it when Codex models, pricing, availability, subagent behavior, model routing, or native sandbox capabilities change, and update ADRs when the underlying decision changes.

These are project-defined logical roles, not official job assignments made by OpenAI.

For execution isolation, snapshot/result semantics, and Git integration, treat `ADR-0003` and the project-local parallel-orchestration Skill as canonical.

## Sol — coordinator / supervisor role

Primary responsibilities:

- understand the complete user request
- define acceptance criteria
- architecture-level reasoning
- dependency graph
- task decomposition
- subagent orchestration
- snapshot / integration ordering
- consequential decisions
- difficult problem solving
- final verification
- final synthesis

Important:

- Sol is not expected to become the host-level sandbox manager itself.
- sandbox create/destroy, credential injection, and child lifecycle belong to the external Agent Supervisor/control plane.
- integrate worker output as immutable commits/diffs or never-moved refs pinned to a recorded commit SHA/content digest.
- never re-resolve a mutable branch/ref name during integration; use the recorded immutable identity and reject ref movement.
- do not place multiple implementation agents into one shared mutable working tree.

Do not concentrate large amounts of mechanical implementation in Sol itself.

## Terra — independent reviewer role

Primary responsibilities:

- implementation review
- architecture review
- correctness review
- integration review
- test adequacy review
- failure analysis
- independent second opinion
- sandbox/runtime reproducibility review

Where practical, do not complete work using only the implementer's self-review.

Start Reviewers from a clean snapshot pinned to the integration candidate commit SHA/content digest rather than from a mutable ref or the implementer's dirty workspace.

## Luna — primary implementation worker role

Primary responsibilities:

- code implementation
- mechanical refactoring
- test implementation
- repository exploration
- bounded investigation
- repetitive changes
- deterministic tool execution
- independent implementation units

When used as an implementation worker, run it in a **worker-specific isolated mutable execution environment**.

The standard worker input is an immutable snapshot pinned to a resolved commit SHA/content digest; the standard worker output is an immutable commit/diff or a never-moved ref pinned to a recorded immutable identity.

Delegate safely separable implementation to workers as much as practical to increase throughput. This does not mean prioritizing cost over quality.

Escalate difficult or high-impact decisions to reviewer/coordinator roles.

At runtime, verify whether the actual subagent model can be selected or observed. Do not claim a model was used when it cannot be verified.

Even when explicit model routing is unavailable, preserve the logical coordinator / reviewer / implementer roles and the isolation semantics defined by ADR-0003.
