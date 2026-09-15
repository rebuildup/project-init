#!/usr/bin/env bash
set -euo pipefail

answer=${1:?usage: bash grade.sh <answer-file>}
[ -f "$answer" ] || { printf 'no answer file at %s\n' "$answer"; exit 1; }

# Require the answer to be exactly 8 lines of key=value records - no prose,
# no preamble, no trailing commentary - so that adding explanatory text
# alongside the canonical record set cannot mask a wrong answer.
total_lines=$(grep -c '' "$answer" || true)
[ "$total_lines" -eq 8 ] || {
  printf 'FAIL expected exactly 8 total lines, got %s\n' "$total_lines"
  exit 1
}

if grep -nvE '^[a-z_]+=' "$answer" > /dev/null; then
  printf 'FAIL answer contains non key=value lines\n'
  exit 1
fi

structured_count=$(grep -Ec '^[a-z_]+=' "$answer" || true)
[ "$structured_count" -eq 8 ] || {
  printf 'FAIL expected 8 structured lines, got %s\n' "$structured_count"
  exit 1
}

require_exact() {
  # Quote the assignment so whitespace in $1 survives; the previous form
  # silently truncated multi-word expected values to the first word.
  local expected="$1"
  grep -Fxq -- "$expected" "$answer" || {
    printf 'FAIL missing-or-wrong: %s\n' "$expected"
    exit 1
  }
}

require_exact 'implementation_sot=github_issue'
require_exact 'dependency_sot=github_issue'
require_exact 'release_planning_control=linear_project'
require_exact 'mirror_all_github_issues=no'
require_exact 'default_linear_cycle=no'
require_exact 'implementation_worker_linear_access=none_or_readonly'
require_exact 'linear_coding_sessions_baseline=no'
require_exact 'linear_project_mapping=one_release_train'

printf 'PASS\n'
