# 2026-11-16 verification placement policy migration audit

- Issue: #164
- Decision: ADR-0036 (proposed)
- Scope: current project-init canonical policy; downstream runtime/CI migration is a separate obligation, not silently claimed complete

## Normative rule migration

| Previous rule / source | Status | Revised ownership / preserved guarantee |
| --- | --- | --- |
| ADR-0005 worker / integration / release separation | Revised | ADR-0036, release-driven-solo, quality-gate: stage includes candidate freeze and human acceptance; reliable pre-landing boundary remains |
| ADR-0005 integration = `full applicable` | Revised | quality-gate §3/§10: sufficient risk-selected early contract/static/integration, rather than inheriting all release-grade checks |
| ADR-0006 level taxonomy (unit/integration/E2E/manual) | Retained | quality-gate §2: distinct evidence; levels unchanged, default execution timing changed |
| quality-gate §3 every user journey → E2E; build → smoke | Revised | risk table now states ticket/early vs frozen candidate; explicit early dangerous-operation exception |
| quality-gate §2 native/GUI verification | Revised | still required where applicable, but defaults to candidate/human acceptance not per-ticket |
| quality-gate §8.2 release trunk push → release-specific CI | Revised | release push may do cheap health; full candidate CI waits for deliberate freeze |
| quality-gate §8.3 release trunk as expensive matrix trigger | Intentionally removed | replacement: frozen candidate, risk-triggered early gate, explicit bounded manual verification. Reason: unbatched per-push matrix undermines release train |
| quality-gate §8.9 CI resource conservation without weakening checks | Retained/clarified | stage mapping / required-check audit / GitHub Pending vs success skip |
| quality-gate §9 focused worker check | Retained | cheap feedback without default full suite |
| quality-gate §10 ticket integration acceptance/CI/SHA | Retained/re-scoped | binding/current-SHA and meaningful blocking findings remain; expensive release-only scope removed |
| quality-gate §11 affected downstream revalidation | Retained | affected ticket proof rerun; unrelated release-only evidence not made ticket prerequisite |
| quality-gate §12 release verification | Retained/relocated | freeze → full integration/E2E/native/packages/security with known SHA |
| quality-gate §13 readiness | Revised | ticket and release readiness use different gates; required check must match stage |
| quality-gate §14 false green | Retained | NOT_RUN/DEFERRED/BLOCKED cannot become PASS |
| github-delivery ticket Ready/Done | Revised | ticket checks only; autonomous landing, Issue close, branch cleanup remain |
| github-delivery release authority / main guard | Retained | only current release-* → main PR with current explicit user authorization |
| ADR-0033 optional adaptive tests | Retained | optional worker scheduler may defer voluntary deterministic checks; required early/release checks not auto-deferred |
| Constitution: Identity, Authority, Evidence, Progress | Retained | SHA provenance, authority boundaries, no false green or indefinite unnecessary waiting |

## Downstream rollout blocking evidence

Policy migration is **not CI migration**. Before declaring an existing project compliant, inventory:
- workflow triggers on PR, ticket push, release-trunk push, candidate dispatch, tag, main;
- required GitHub checks and skipped/pending status behavior;
- pre-push/pre-commit hooks invoking full integration, build, native or deploy;
- Issue acceptance criteria and project-local AGENTS/Skills requiring per-ticket native tests;
- real release artifact smoke/manual ownership and SHA provenance.

For each check, record `property, cost, stage, trigger, owner, source of truth, failure semantics`, then revise workflow/rulesets and run targeted smoke of the new trigger topology. Merely adding ADR wording does not resolve upstream required statuses or local hooks. Avoid a mass rollout without project-specific migration verification.

## Objective evaluation

Baseline and post-change evidence must compare ticket landing latency, started job/runner-minutes, GUI/device reservation time, release freeze corrections, escaped defects, rollbacks, and unknown/false-green reports. A reduced CI bill alone is not acceptance.

## Re-evaluation and known limits

These documents were changed via GitHub contents API, not a local complete test installation. The new scenario file is a reusable cold-agent evaluation case, **not** proof that agents have been evaluated or that CI workflows of downstream projects have been changed. If a current required check blocks the policy's intended ticket stage, reconcile repository settings and gates before autonomous landing; do not bypass a dangerous failure or claim green.
