#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)

fail() {
  printf 'merge-method-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

must_contain() {
  local file=$1
  local text=$2
  grep -Fq "$text" "$R/$file" || fail "$file missing: $text"
}

# Require one line of the prompt that routes a domain to its canonical source.
must_route() {
  local file=$1; shift
  local line
  line=$(grep -F -- "$1" "$R/$file" || true)
  shift
  local fragment
  for fragment in "$@"; do
    line=$(printf '%s\n' "$line" | grep -F -- "$fragment" || true)
  done
  [ -n "$line" ] || fail "$file has no line routing this domain to: $*"
}

must_match() {
  local file=$1
  local pattern=$2
  grep -Eq "$pattern" "$R/$file" || fail "$file missing pattern: $pattern"
}

PROFILE="organization/profiles/release-driven-solo.md"
SKILL="skills/github-delivery/SKILL.md"
PROMPT_JA="PROMPT.ja.md"
CONTRIB="CONTRIBUTING.md"
ADR="docs/adr/ADR-0018.md"

must_contain "$PROFILE" "PR landing method: merge commit only"
must_match "$PROFILE" 'allow_merge_commit[[:space:]]*=[[:space:]]*true'
must_match "$PROFILE" 'allow_squash_merge[[:space:]]*=[[:space:]]*false'
must_match "$PROFILE" 'allow_rebase_merge[[:space:]]*=[[:space:]]*false'

must_match "$SKILL" 'allow_merge_commit[[:space:]]*=[[:space:]]*true'
must_match "$SKILL" 'allow_squash_merge[[:space:]]*=[[:space:]]*false'
must_match "$SKILL" 'allow_rebase_merge[[:space:]]*=[[:space:]]*false'
must_contain "$SKILL" 'methodを暗黙選択せず `merge` を明示'

# PROMPT holds routing only; the profile is the canonical source checked above.
must_route "$PROMPT_JA" 'merge method' '`github-delivery`' 'profile'

must_contain "$CONTRIB" 'current release-driven profileではGitHub Pull Requestをmerge commitでlandします。'
must_contain "$ADR" 'current release-driven profileでGitHub Pull Requestをlandする場合、標準methodは **merge commit** のみとする。'

for file in "$PROFILE" "$SKILL" "$PROMPT_JA" "$CONTRIB"; do
  if grep -Eq 'merge / squash( merge)? / rebase( merge)?|merge / squash / rebase' "$R/$file"; then
    fail "$file still presents merge/squash/rebase as peer PR landing choices"
  fi
  if grep -Eq 'allow_squash_merge[[:space:]]*=[[:space:]]*true|allow_rebase_merge[[:space:]]*=[[:space:]]*true|allow_merge_commit[[:space:]]*=[[:space:]]*false' "$R/$file"; then
    fail "$file contains conflicting repository merge settings"
  fi
done

printf 'merge-method-contract: PASS\n'
