#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

# Run one fixture through the selected grader and assert the expected PASS/FAIL result.
expect_with() {
  label=$1
  grader=$2
  file=$3
  expected=$4

  out=$(bash "$grader" "$file" 2>&1)
  rc=$?
  got=$(printf '%s\n' "$out" | tail -1)

  # The grader exit code is part of the verdict: PASS exits 0 and FAIL exits non-zero.
  if { [ "$expected" = "PASS" ] && [ "$rc" -eq 0 ] && [ "$got" = "EVAL PASS" ]; } ||
     { [ "$expected" = "FAIL" ] && [ "$rc" -ne 0 ] && [ "$got" = "EVAL FAIL" ]; }; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted EVAL %s, rc=%s)\n' "$label" "$got" "$expected" "$rc"
    printf '%s\n' "$out" | grep -E 'MISS|VIOL|INVALID|DUPLICATE' | sed 's/^/         /'
    RC=1
  fi
}

expect() {
  expect_with "$1" "$R/evals/policy-evaluation/grade.sh" "$2" "$3"
}

expect "negative control"   "$R/evals/policy-evaluation/fixtures/negative.txt" FAIL
expect "regression control"   "$R/evals/policy-evaluation/fixtures/regression.txt" FAIL
expect "positive control"   "$R/evals/policy-evaluation/fixtures/positive.txt" PASS

MERGE_GRADER="$R/evals/policy-evaluation/merge-authorization-grade.sh"
expect_with "merge auth negative" "$MERGE_GRADER" "$R/evals/policy-evaluation/fixtures/merge-authorization-negative.txt" FAIL
expect_with "merge auth regression" "$MERGE_GRADER" "$R/evals/policy-evaluation/fixtures/merge-authorization-regression.txt" FAIL
expect_with "merge auth stack scope" "$MERGE_GRADER" "$R/evals/policy-evaluation/fixtures/merge-authorization-stack-scope-regression.txt" FAIL
expect_with "merge auth positive" "$MERGE_GRADER" "$R/evals/policy-evaluation/fixtures/merge-authorization-positive.txt" PASS

if merge_method_out=$(bun "$R/evals/policy-evaluation/text-contracts.mts" merge-method-contract 2>&1); then
  printf '  ok   %-34s -> PASS\n' "merge method contract"
else
  printf '  FAIL %-34s -> FAIL\n' "merge method contract"
  printf '%s\n' "$merge_method_out" | sed 's/^/         /'
  RC=1
fi

if cloudflare_cli_out=$(bun "$R/evals/policy-evaluation/text-contracts.mts" cloudflare-cli-contract 2>&1); then
  printf '  ok   %-34s -> PASS\n' "Cloudflare CLI contract"
else
  printf '  FAIL %-34s -> FAIL\n' "Cloudflare CLI contract"
  printf '%s\n' "$cloudflare_cli_out" | sed 's/^/         /'
  RC=1
fi

if lifecycle_out=$(bash "$R/evals/policy-evaluation/worktree-lifecycle-contract.sh" 2>&1); then
  printf '  ok   %-34s -> PASS\n' "worktree lifecycle contract"
else
  printf '  FAIL %-34s -> FAIL\n' "worktree lifecycle contract"
  printf '%s\n' "$lifecycle_out" | sed 's/^/         /'
  RC=1
fi

if vendored_out=$(bun "$R/evals/policy-evaluation/vendored-skills-contract.mts" 2>&1); then
  printf '  ok   %-34s -> PASS\n' "vendored skills contract"
else
  printf '  FAIL %-34s -> FAIL\n' "vendored skills contract"
  printf '%s\n' "$vendored_out" | sed 's/^/         /'
  RC=1
fi

if catalog_out=$(bun "$R/evals/policy-evaluation/skill-catalog-contract.mts" 2>&1); then
  printf '  ok   %-34s -> PASS\n' "skill catalog contract"
else
  printf '  FAIL %-34s -> FAIL\n' "skill catalog contract"
  printf '%s\n' "$catalog_out" | sed 's/^/         /'
  RC=1
fi

if budget_out=$(bash "$R/evals/policy-evaluation/context-budget.sh" 2>&1); then
  printf '  ok   %-34s -> PASS\n' "context budget regression"
else
  printf '  FAIL %-34s -> FAIL\n' "context budget regression"
  printf '%s\n' "$budget_out" | sed 's/^/         /'
  RC=1
fi

if herdr_out=$(bun "$R/evals/policy-evaluation/text-contracts.mts" herdr-orchestration-contract 2>&1); then
  printf '  ok   %-34s -> PASS\n' "Herdr orchestration contract"
else
  printf '  FAIL %-34s -> FAIL\n' "Herdr orchestration contract"
  printf '%s\n' "$herdr_out" | sed 's/^/         /'
  RC=1
fi

if refinement_out=$(bash "$R/evals/policy-evaluation/constitutional-refinement-controls.sh" 2>&1); then
  printf '  ok   %-34s -> PASS\n' "constitutional refinement controls"
else
  printf '  FAIL %-34s -> FAIL\n' "constitutional refinement controls"
  printf '%s\n' "$refinement_out" | sed 's/^/         /'
  RC=1
fi

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"
