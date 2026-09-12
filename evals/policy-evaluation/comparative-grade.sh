#!/usr/bin/env bash
set -uo pipefail

A=${1:?usage: comparative-grade.sh /path/to/answer.txt}
[ -f "$A" ] || { echo "no answer file at $A"; exit 1; }

T=$(tr -d '\r' < "$A")
HIT=0
MISS=0
VIOL=0
SCHEMA=0
DUPLICATE=0
LINE_COUNT=$(printf '%s\n' "$T" | wc -l | tr -d ' ')

must_exact() {
  if echo "$T" | grep -qxF "$2"; then
    HIT=$((HIT + 1))
    printf '  hit   %s\n' "$1"
  else
    MISS=$((MISS + 1))
    printf '  MISS  %s\n' "$1"
  fi
}

never() {
  if echo "$T" | grep -qE "$2"; then
    VIOL=$((VIOL + 1))
    printf '  VIOL  %s\n' "$1"
  else
    printf '  clean %s\n' "$1"
  fi
}

echo "comparative evaluation:"
must_exact "condition parity" "parity=same-cases-model-trials-rubric"
must_exact "runner isolation" "runner=isolated"
must_exact "identity pinning or recording" "identity=pin-or-record"
must_exact "blind paired judging" "judge=blind-paired"
must_exact "deterministic per-group labels" "labels=deterministic-per-group"
must_exact "critical dimensions cannot regress" "gate=critical-nonregression"
must_exact "paid runs are budgeted and resumable" "run=budgeted-resumable"

echo "must-nots:"
never "no incomparable conditions" '^parity=different-conditions$'
never "no ambient user config contamination" '^runner=ambient-user-config$'
never "no implicit model/runtime default" '^identity=implicit-default$'
never "no named or separate judging" '^judge=named-separate$'
never "no fixed-position label bias" '^labels=fixed-position$'
never "no weighted-total-only release gate" '^gate=weighted-total-only$'
never "no unbounded restart behavior" '^run=unbounded-restart$'

echo "schema:"
while IFS= read -r line; do
  case "$line" in
    "parity=same-cases-model-trials-rubric"|"runner=isolated"|"identity=pin-or-record"|"judge=blind-paired"|"labels=deterministic-per-group"|"gate=critical-nonregression"|"run=budgeted-resumable") ;;
    *)
      SCHEMA=$((SCHEMA + 1))
      printf '  INVALID record: %s\n' "$line"
      ;;
  esac
done <<< "$T"

for expected in \
  "parity=same-cases-model-trials-rubric" \
  "runner=isolated" \
  "identity=pin-or-record" \
  "judge=blind-paired" \
  "labels=deterministic-per-group" \
  "gate=critical-nonregression" \
  "run=budgeted-resumable"
do
  count=$(printf '%s\n' "$T" | grep -xcF "$expected" || true)
  if [ "$count" -gt 1 ]; then
    DUPLICATE=$((DUPLICATE + 1))
    printf '  DUPLICATE record: %s\n' "$expected"
  fi
done

echo
echo "hits: $HIT   misses: $MISS   violations: $VIOL   lines: $LINE_COUNT   invalid: $SCHEMA   duplicates: $DUPLICATE"

if [ "$HIT" -eq 7 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ] && [ "$LINE_COUNT" -eq 7 ] && [ "$SCHEMA" -eq 0 ] && [ "$DUPLICATE" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
