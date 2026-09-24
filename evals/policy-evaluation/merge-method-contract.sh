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

must_match() {
  local file=$1
  local pattern=$2
  grep -Eq "$pattern" "$R/$file" || fail "$file missing pattern: $pattern"
}

PROFILE="organization/profiles/release-driven-solo.md"
SKILL="skills/github-delivery/SKILL.md"
PROMPT_JA="PROMPT.ja.md"
PROMPT_EN="PROMPT.en.md"
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

must_match "$PROMPT_JA" 'allow_merge_commit[[:space:]]*=[[:space:]]*true'
must_match "$PROMPT_JA" 'allow_squash_merge[[:space:]]*=[[:space:]]*false'
must_match "$PROMPT_JA" 'allow_rebase_merge[[:space:]]*=[[:space:]]*false'
must_match "$PROMPT_EN" 'allow_merge_commit[[:space:]]*=[[:space:]]*true'
must_match "$PROMPT_EN" 'allow_squash_merge[[:space:]]*=[[:space:]]*false'
must_match "$PROMPT_EN" 'allow_rebase_merge[[:space:]]*=[[:space:]]*false'

must_contain "$CONTRIB" 'current release-driven profileではGitHub Pull Requestをmerge commitでlandします。'
must_contain "$ADR" 'current release-driven profileでGitHub Pull Requestをlandする場合、標準methodは **merge commit** のみとする。'

for file in "$PROFILE" "$SKILL" "$PROMPT_JA" "$PROMPT_EN" "$CONTRIB"; do
  if grep -Eq 'merge / squash( merge)? / rebase( merge)?|merge / squash / rebase' "$R/$file"; then
    fail "$file still presents merge/squash/rebase as peer PR landing choices"
  fi
  if grep -Eq 'allow_squash_merge[[:space:]]*=[[:space:]]*true|allow_rebase_merge[[:space:]]*=[[:space:]]*true|allow_merge_commit[[:space:]]*=[[:space:]]*false' "$R/$file"; then
    fail "$file contains conflicting repository merge settings"
  fi
done

printf 'merge-method-contract: PASS\n'
