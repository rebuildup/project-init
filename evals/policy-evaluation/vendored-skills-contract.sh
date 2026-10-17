#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
LOCK="$R/skills-lock.json"

fail() {
  printf 'vendored-skills-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null || fail "jq is required"
[ -r "$LOCK" ] || fail "missing skills-lock.json"

# Recompute the skills CLI folder hash: sha256 over each file's relative path
# followed by its bytes, with paths in case-insensitive order.
folder_hash() {
  local dir=$1
  (
    cd "$dir"
    find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | sed 's#^\./##' | sort -f |
      while IFS= read -r file; do
        printf '%s' "$file"
        cat "$file"
      done
  ) | sha256sum | cut -d' ' -f1
}

while IFS=$'\t' read -r name expected; do
  dir=""
  for root in .claude/skills .agents/skills; do
    if [ -f "$R/$root/$name/SKILL.md" ]; then
      dir="$R/$root/$name"
      break
    fi
  done
  [ -n "$dir" ] || fail "$name is in skills-lock.json but its files are not committed"
  actual=$(folder_hash "$dir")
  [ "$actual" = "$expected" ] || fail "$name differs from skills-lock.json; update it with 'bunx skills update' instead of editing the copy"
  [ ! -e "$R/skills/$name" ] || fail "$name is both vendored and published from skills/"
done < <(jq -r '.skills | to_entries[] | [.key, .value.computedHash] | @tsv' "$LOCK")

printf 'vendored-skills-contract: PASS\n'
