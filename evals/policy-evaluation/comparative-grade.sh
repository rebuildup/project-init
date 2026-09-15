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
ORDER=0
# Count records directly off the file so trailing blank lines are
# correctly classified into TRAILING_BLANK rather than silently vanishing
# via command substitution.
TRAILING_BLANK=0
if [ "$(tail -c 1 "$A" | wc -l | tr -d ' ')" = "1" ]; then
  if [ "$(awk 'END{print length($0)}' "$A")" = "0" ]; then
    TRAILING_BLANK=1
  fi
fi
LINE_COUNT=$(awk 'END{print NR}' "$A")
EFFECTIVE_LINES=$((LINE_COUNT - TRAILING_BLANK))

must_exact() {
  # printf is used so a leading -n/-e/-- in $T cannot be misread as a flag.
  if printf '%s\n' "$T" | grep -qxF "$2"; then
    HIT=$((HIT + 1))
    printf '  hit   %s\n' "$1"
  else
    MISS=$((MISS + 1))
    printf '  MISS  %s\n' "$1"
  fi
}

never() {
  if printf '%s\n' "$T" | grep -qE "$2"; then
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

# Verify the answer preserves the canonical line ordering of the seven
# required records. must_exact() and the duplicate counter above only
# check presence and multiplicity, so an answer that emits the right
# records in the wrong order would otherwise pass the gate.
echo "ordering:"
expected_order=(
  "parity=same-cases-model-trials-rubric"
  "runner=isolated"
  "identity=pin-or-record"
  "judge=blind-paired"
  "labels=deterministic-per-group"
  "gate=critical-nonregression"
  "run=budgeted-resumable"
)
i=0
while IFS= read -r line; do
  i=$((i + 1))
  expected="${expected_order[$((i - 1))]:-}"
  if [ -n "$expected" ] && [ "$line" = "$expected" ]; then
    printf '  ord %d ok: %s\n' "$i" "$line"
  elif [ -n "$expected" ]; then
    ORDER=$((ORDER + 1))
    printf '  OUT-OF-ORDER line %d: got %q expected %q\n' "$i" "$line" "$expected"
  else
    printf '  ord %d extra: %s\n' "$i" "$line"
  fi
done <<< "$T"

echo
echo "hits: $HIT   misses: $MISS   violations: $VIOL   lines: $LINE_COUNT   effective: $EFFECTIVE_LINES   invalid: $SCHEMA   duplicates: $DUPLICATE   out_of_order: $ORDER   trailing_blank: $TRAILING_BLANK"

if [ "$HIT" -eq 7 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ] && [ "$EFFECTIVE_LINES" -eq 7 ] && [ "$TRAILING_BLANK" -eq 0 ] && [ "$SCHEMA" -eq 0 ] && [ "$DUPLICATE" -eq 0 ] && [ "$ORDER" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
