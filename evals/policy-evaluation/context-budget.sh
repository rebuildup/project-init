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

# Return the UTF-8 byte count for a tracked path, or zero when it is absent.
bytes_for() {
  local path=$1
  if [ -f "$R/$path" ]; then
    wc -c < "$R/$path" | tr -d ' '
  else
    printf '0'
  fi
}

# Return the whitespace-delimited word count for a tracked path, or zero when absent.
words_for() {
  local path=$1
  if [ -f "$R/$path" ]; then
    wc -w < "$R/$path" | tr -d ' '
  else
    printf '0'
  fi
}

# Sum byte counts for the root instruction files that are always loaded when present.
always_on_bytes() {
  local total=0 path
  for path in "${ROOT_FILES[@]}"; do
    total=$((total + $(bytes_for "$path")))
  done
  printf '%s' "$total"
}

# Sum word counts for the root instruction files that are always loaded when present.
always_on_words() {
  local total=0 path
  for path in "${ROOT_FILES[@]}"; do
    total=$((total + $(words_for "$path")))
  done
  printf '%s' "$total"
}

# Emit the canonical machine-readable snapshot used to create or compare a baseline.
# Root instruction files are always emitted (at 0 bytes when absent) so the
# baseline can keep tracking "expected-if-present" files across regenerations.
# Skill files are only emitted when they actually exist on disk, so the
# comparison loop can distinguish a deletion from a present-but-empty file.
snapshot() {
  local path
  printf 'kind\tpath\tbytes\n'
  for path in "${ROOT_FILES[@]}"; do
    printf 'root\t%s\t%s\n' "$path" "$(bytes_for "$path")"
  done
  printf 'always_on_total\t__always_on_total__\t%s\n' "$(always_on_bytes)"
  # Guard against missing or unreadable skills dir so the snapshot stays usable
  # even when the repo layout is mid-bootstrap; the main loop will still flag
  # every baselined skill as DELETED, which is the correct semantic.
  if [ -d "$R/skills" ]; then
    while IFS= read -r full; do
      path=${full#"$R/"}
      if [ -f "$full" ]; then
        printf 'skill\t%s\t%s\n' "$path" "$(bytes_for "$path")"
      fi
    done < <(find "$R/skills" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print | LC_ALL=C sort)
  fi
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

  # Differentiate "absent from snapshot" from "present with 0 bytes":
  # the previous awk fallback printed 0 for both, which silently PASSed any
  # deletion of a tracked skill/root file as if the file had merely shrunk.
  # A missing tracked entry is only a semantic regression when the baseline
  # already recorded a non-zero size; root instruction files baseline'd at 0
  # are tracked as "expected to be absent", so their continued absence is OK.
  if awk -F '\t' -v k="$kind" -v p="$path" '$1 == k && $2 == p { found=1; exit } END { exit !found }' "$TMP"; then
    current=$(awk -F '\t' -v k="$kind" -v p="$path" '$1 == k && $2 == p { print $3 }' "$TMP")
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
  elif [ "$base" -gt 0 ]; then
    # Baseline had a real file at non-zero size; its disappearance is a
    # semantic regression (lost rule, missing skill, dropped root file)
    # and must surface as DELETED with a non-zero exit.
    if [ "$kind" = "always_on_total" ]; then
      words=$(always_on_words)
    else
      words=0
    fi
    delta=$((-base))
    printf 'DELETED\t%s\t%s\t%s\t0\t%s\t%s\t%s\t0\n' "$kind" "$path" "$base" "$delta" "$base" "$words"
    RC=1
  else
    # Baseline already recorded 0 bytes for this entry; continued absence
    # matches the baseline and is not a regression. Emit a PASS row so the
    # audit log shows the file was checked and intentionally absent.
    if [ "$kind" = "always_on_total" ]; then
      words=$(always_on_words)
    else
      words=0
    fi
    printf 'PASS\t%s\t%s\t0\t0\t0\t0\t%s\t0\n' "$kind" "$path" "$words"
  fi
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
