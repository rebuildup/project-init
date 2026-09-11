#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
BASELINE="$R/evals/policy-evaluation/context-budget-baseline.tsv"
MAX_GROWTH_PERCENT=10
MAX_GROWTH_BYTES=512
ROOT_FILES=(
  "AGENTS.md"
  "CLAUDE.md"
  ".github/copilot-instructions.md"
)

bytes_for() {
  local path=$1
  if [ -f "$R/$path" ]; then
    wc -c < "$R/$path" | tr -d ' '
  else
    printf '0'
  fi
}

words_for() {
  local path=$1
  if [ -f "$R/$path" ]; then
    wc -w < "$R/$path" | tr -d ' '
  else
    printf '0'
  fi
}

always_on_bytes() {
  local total=0 path
  for path in "${ROOT_FILES[@]}"; do
    total=$((total + $(bytes_for "$path")))
  done
  printf '%s' "$total"
}

always_on_words() {
  local total=0 path
  for path in "${ROOT_FILES[@]}"; do
    total=$((total + $(words_for "$path")))
  done
  printf '%s' "$total"
}

snapshot() {
  local path
  printf 'kind\tpath\tbytes\n'
  for path in "${ROOT_FILES[@]}"; do
    printf 'root\t%s\t%s\n' "$path" "$(bytes_for "$path")"
  done
  printf 'always_on_total\t__always_on_total__\t%s\n' "$(always_on_bytes)"
  while IFS= read -r full; do
    path=${full#"$R/"}
    printf 'skill\t%s\t%s\n' "$path" "$(bytes_for "$path")"
  done < <(find "$R/skills" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print | LC_ALL=C sort)
}

if [ "${1:-}" = "--snapshot" ]; then
  snapshot
  exit 0
fi

[ -f "$BASELINE" ] || {
  printf 'status\tkind\tpath\tbaseline_bytes\tcurrent_bytes\tdelta_bytes\tlimit_bytes\tcurrent_words\ttoken_estimate\n'
  printf 'FAIL\tbaseline\t%s\t0\t0\t0\t0\t0\t0\n' "$BASELINE"
  exit 1
}

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
snapshot > "$TMP"

printf 'status\tkind\tpath\tbaseline_bytes\tcurrent_bytes\tdelta_bytes\tlimit_bytes\tcurrent_words\ttoken_estimate\n'
RC=0

while IFS=$'\t' read -r kind path base; do
  [ "$kind" = "kind" ] && continue

  current=$(awk -F '\t' -v k="$kind" -v p="$path" '$1 == k && $2 == p { print $3; found=1 } END { if (!found) print 0 }' "$TMP")
  percent_growth=$(( (base * MAX_GROWTH_PERCENT + 99) / 100 ))
  allowance=$MAX_GROWTH_BYTES
  if [ "$percent_growth" -gt "$allowance" ]; then
    allowance=$percent_growth
  fi
  limit=$((base + allowance))
  delta=$((current - base))

  if [ "$kind" = "always_on_total" ]; then
    words=$(always_on_words)
  else
    words=$(words_for "$path")
  fi
  tokens=$(( (current + 3) / 4 ))

  status=PASS
  if [ "$current" -gt "$limit" ]; then
    status=FAIL
    RC=1
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n'     "$status" "$kind" "$path" "$base" "$current" "$delta" "$limit" "$words" "$tokens"
done < "$BASELINE"

while IFS=$'\t' read -r kind path current; do
  [ "$kind" = "kind" ] && continue
  if ! awk -F '\t' -v k="$kind" -v p="$path" '$1 == k && $2 == p { found=1 } END { exit found ? 0 : 1 }' "$BASELINE"; then
    words=0
    if [ "$kind" = "always_on_total" ]; then
      words=$(always_on_words)
    else
      words=$(words_for "$path")
    fi
    tokens=$(( (current + 3) / 4 ))
    printf 'UNBASELINED\t%s\t%s\t0\t%s\t%s\t0\t%s\t%s\n'       "$kind" "$path" "$current" "$current" "$words" "$tokens"
    RC=1
  fi
done < "$TMP"

exit "$RC"
