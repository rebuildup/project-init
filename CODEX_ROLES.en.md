# Codex role allocation — August 2026

This document is a **time-bound operating policy for August 2026**.

Re-evaluate it when Codex models, pricing, availability, subagent behavior, or model routing changes.

These are project roles based on current model characteristics, not official job descriptions assigned by OpenAI.

## Sol — coordinator / supervisor

Primary responsibilities:

- complete user-request understanding
- architecture-level reasoning
- dependency graph construction
- task decomposition
- subagent orchestration
- ownership boundaries
- consequential decisions
- difficult problem solving
- integration
- final verification
- final synthesis

Avoid concentrating large amounts of routine implementation work in Sol.

## Terra — independent reviewer

Primary responsibilities:

- implementation review
- architecture review
- correctness review
- integration review
- test adequacy review
- failure analysis
- independent second opinion

Where practical, do not let the implementing agent's self-review be the only review.

## Luna — primary implementation worker

Primary responsibilities:

- code implementation
- mechanical refactoring
- test implementation
- repository exploration
- bounded investigation
- repetitive changes
- deterministic tool execution
- independent implementation units

Delegate safely separable implementation work to Luna where practical and use its current speed/cost characteristics to scale throughput.

This does not permit sacrificing correctness for cost.

Escalate high-difficulty or high-consequence judgment to Terra or Sol.

At runtime, verify whether the effective subagent model can actually be selected and observed. Never falsely claim a model was used when it cannot be verified.

If explicit model routing is unavailable, preserve the logical coordinator / reviewer / implementer roles using the best available mechanism.
