# Release scope admission gate

A release's target version/date is calendar intent, **not** automatic admission to the release critical path.

Before a ticket enters the critical path, verify against current GitHub Issue/PR evidence:

1. Requirements are determined enough to make implementation decisions.
2. A bug is reproduced **or** independent evidence identifies the failing behavior.
3. Acceptance criteria are executable and verifiable.
4. Dependencies and blockers have an accountable owner.
5. A validation path is defined for the resulting candidate.
6. The Work Graph (scope, dependencies, architecture) is sufficiently stable.

If any prerequisite is unknown, retain the item in **discovery / research / backlog** and assign the unknown an owner. A calendar target must not silently promote such items. Re-evaluate admission when evidence arrives.

**Admission gate** determines whether an item is actionable within the release. **Terminal gate** independently verifies the integrated candidate (reviews, current SHA, tests, authorization, and publication). Admitted never implies release-ready; a passing terminal check cannot retroactively make unadmitted work actionable.

A `Structural unknown` in `agent-delivery-estimation` means the Work Graph is unstable; corresponding release forecast may be `unavailable`, not a fabricated date. Keep such work outside the critical path until clarified.

The executable reference policy is `evals/release-scope-admission/grade.py` and its positive/negative controls. The controlling facts are durable Issue/PR fields; the sample JSON is only a machine-checkable representation.

Document the admission decision, evidence, excluded work and owner in the canonical release planning Issue/PR. Rerun admission after changes to scope or dependencies and rerun terminal validation for a changed candidate.
