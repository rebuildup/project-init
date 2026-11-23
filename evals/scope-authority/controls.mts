#!/usr/bin/env -S bun
import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

interface ScopeAuthorityControlCase {
  readonly label: string;
  readonly fixture: string;
  readonly expected: "PASS" | "FAIL";
  readonly expectedViolations?: readonly string[];
}

const dir = import.meta.dirname;
const grader = join(dir, "grade.mts");

const cases: readonly ScopeAuthorityControlCase[] = [
  {
    label: "positive design-research draft",
    fixture: "fixtures/positive-design-research-draft.json",
    expected: "PASS",
  },
  {
    label: "positive reconciled owner decision",
    fixture: "fixtures/positive-reconciled-owner-decision.json",
    expected: "PASS",
  },
  {
    label: "positive bulk close with evidence",
    fixture: "fixtures/positive-bulk-close-with-evidence.json",
    expected: "PASS",
  },
  {
    label: "positive release ready clean",
    fixture: "fixtures/positive-release-ready-clean.json",
    expected: "PASS",
  },
  {
    label: "positive release complete merged",
    fixture: "fixtures/positive-release-complete-merged.json",
    expected: "PASS",
  },
  {
    label: "negative Aulymo scope drift",
    fixture: "fixtures/negative-aulymo-unapproved-scope-drift.json",
    expected: "FAIL",
    expectedViolations: [
      "VIOL UNAPPROVED_SCOPE_DRIFT:",
      "VIOL UNRECONCILED_SINGLE_SOURCE:",
    ],
  },
  {
    label: "negative draft cross-release bypass",
    fixture: "fixtures/negative-draft-cross-release-bypass.json",
    expected: "FAIL",
    expectedViolations: ["VIOL UNAPPROVED_SCOPE_DRIFT:"],
  },
  {
    label: "negative draft blocker escalation",
    fixture: "fixtures/negative-draft-blocker-escalation.json",
    expected: "FAIL",
    expectedViolations: ["VIOL UNAPPROVED_SCOPE_DRIFT:"],
  },
  {
    label: "negative same-release intent escalation",
    fixture: "fixtures/negative-same-release-intent-escalation.json",
    expected: "FAIL",
    expectedViolations: ["VIOL PROGRESS_CONFLATED_WITH_BLOCKER:"],
  },
  {
    label: "negative stale owner snapshot",
    fixture: "fixtures/negative-stale-owner-snapshot.json",
    expected: "FAIL",
    expectedViolations: ["VIOL STALE_OWNER_DECISION_SNAPSHOT:"],
  },
  {
    label: "negative future decision revision",
    fixture: "fixtures/negative-future-decision-revision.json",
    expected: "FAIL",
    expectedViolations: ["VIOL INVALID_FUTURE_DECISION_REVISION:"],
  },
  {
    label: "negative agent rev bump bypass",
    fixture: "fixtures/negative-agent-revision-bump-staleness-bypass.json",
    expected: "FAIL",
    expectedViolations: [
      "VIOL INVALID_FUTURE_DECISION_REVISION:",
      "VIOL SELF_ATTESTED_OWNER_APPROVAL:",
    ],
  },
  {
    label: "negative self-attested approval",
    fixture: "fixtures/negative-self-attested-approval.json",
    expected: "FAIL",
    expectedViolations: ["VIOL SELF_ATTESTED_OWNER_APPROVAL:"],
  },
  {
    label: "negative unreconciled single source",
    fixture: "fixtures/negative-unreconciled-single-source.json",
    expected: "FAIL",
    expectedViolations: ["VIOL UNRECONCILED_SINGLE_SOURCE:"],
  },
  {
    label: "negative bulk close unimplemented",
    fixture: "fixtures/negative-bulk-close-unimplemented.json",
    expected: "FAIL",
    expectedViolations: [
      "VIOL BULK_CLOSE_WITHOUT_EVIDENCE:",
      "VIOL UNAPPROVED_SCOPE_DRIFT:",
    ],
  },
  {
    label: "negative release ready blockers",
    fixture: "fixtures/negative-release-ready-open-blockers.json",
    expected: "FAIL",
    expectedViolations: ["VIOL RELEASE_INCOMPLETE_BLOCKERS_OR_PRS:"],
  },
  {
    label: "negative release complete unmerged",
    fixture: "fixtures/negative-release-complete-unmerged-main.json",
    expected: "FAIL",
    expectedViolations: ["VIOL RELEASE_BRANCH_CONFLATED_WITH_MAIN:"],
  },
  {
    label: "negative release commits ahead",
    fixture: "fixtures/negative-release-complete-commits-ahead.json",
    expected: "FAIL",
    expectedViolations: ["VIOL RELEASE_BRANCH_UNMERGED_DRIFT:"],
  },
  {
    label: "negative invalid evidence URL/SHA",
    fixture: "fixtures/negative-invalid-evidence-url-sha.json",
    expected: "FAIL",
    expectedViolations: ["VIOL INVALID_EVIDENCE_REFERENCE:"],
  },
  {
    label: "negative unknown scope intent",
    fixture: "fixtures/negative-unknown-scope-intent.json",
    expected: "FAIL",
    expectedViolations: ["VIOL INVALID_INPUT_SCHEMA:"],
  },
];

let failures = 0;

for (const testCase of cases) {
  const fixturePath = join(dir, testCase.fixture);
  try {
    accessSync(fixturePath, constants.R_OK);
  } catch {
    console.error(
      `  FAIL ${testCase.label.padEnd(38)} -> missing fixture ${fixturePath}`,
    );
    failures++;
    continue;
  }

  const result = spawnSync(process.execPath, [grader, fixturePath], {
    encoding: "utf8",
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const last = output.trimEnd().split("\n").at(-1) ?? "";
  const statusOk =
    testCase.expected === "PASS"
      ? result.status === 0 && last === "EVAL PASS"
      : result.status !== 0 && last === "EVAL FAIL";
  const missingViolations = (testCase.expectedViolations ?? []).filter(
    (needle) => !output.includes(needle),
  );

  if (statusOk && missingViolations.length === 0) {
    console.log(`  ok   ${testCase.label.padEnd(38)} -> ${last}`);
  } else {
    console.error(
      `  FAIL ${testCase.label.padEnd(38)} -> ${last} (wanted ${testCase.expected}, rc=${String(result.status)})`,
    );
    if (missingViolations.length > 0) {
      console.error(`       missing expected violations: ${missingViolations.join(", ")}`);
    }
    console.error(output);
    failures++;
  }
}

console.log(
  failures
    ? "CONTROLS BROKEN: scope-authority eval controls failed"
    : `controls OK: ${cases.length} scope-authority fixtures verified`,
);
process.exitCode = failures ? 1 : 0;
