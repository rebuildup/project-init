#!/usr/bin/env bash
set -euo pipefail

answer=${1:?usage: bash grade.sh <answer-file>}

require_exact() {
  local expected=$1
  grep -Fxq -- "$expected" "$answer" || {
    printf 'FAIL missing-or-wrong: %s\n' "$expected"
    exit 1
  }
}

line_count=$(grep -Ec '^[a-z_]+=' "$answer" || true)
[ "$line_count" -eq 8 ] || {
  printf 'FAIL expected 8 structured lines, got %s\n' "$line_count"
  exit 1
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
