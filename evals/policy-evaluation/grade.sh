#!/usr/bin/env bash
set -uo pipefail

A=${1:?usage: grade.sh /path/to/answer.txt}
[ -f "$A" ] || { echo "no answer file at $A"; exit 1; }

T=$(tr -d '\r' < "$A")
HIT=0
MISS=0
VIOL=0
SCHEMA=0
DUPLICATE=0
LINE_COUNT=$(printf '%s\n' "$T" | wc -l | tr -d ' ')

# Assert that one required record is present; multiplicity is checked by the schema gate below.
must_exact() {
  if echo "$T" | grep -qxF "$2"; then
    HIT=$((HIT + 1))
    printf '  hit   %s\n' "$1"
  else
    MISS=$((MISS + 1))
    printf '  MISS  %s\n' "$1"
  fi
}

# Record a hard failure when a forbidden policy-eval record is present.
never() {
  if echo "$T" | grep -qE "$2"; then
    VIOL=$((VIOL + 1))
    printf '  VIOL  %s\n' "$1"
  else
    printf '  clean %s\n' "$1"
  fi
}

echo "routing:"
must_exact "mechanical typo stays solo"   "A profile=mechanical space=deterministic execution=solo review=none"
must_exact "cross-boundary contract change decomposes and cold-reviews"   "B profile=cross-boundary space=mixed execution=decompose review=cold"
must_exact "judgment-heavy design starts evidence-first and cold-reviews"   "C profile=judgment-heavy space=latent execution=evidence-first review=cold"
must_exact "repeated deterministic work is codified"   "D profile=mechanical space=deterministic execution=codify review=none"

echo "review safety:"
must_exact "reviewer sees artifact, not builder reasoning"   "reviewer_context=artifact-only"
must_exact "numeric self-rating is not a gate"   "self_rating=not-a-gate"

echo "must-nots:"
never "no builder reasoning in cold review" '^reviewer_context=builder-reasoning$'
never "no numeric/self score as quality gate" '^self_rating=score$'
never "no unnecessary fan-out for mechanical typo" '^A .*execution=decompose'
never "no repeated deterministic manual reasoning" '^D .*execution=(solo|decompose|evidence-first)'

echo "schema:"
while IFS= read -r line; do
  case "$line" in
    "A profile=mechanical space=deterministic execution=solo review=none"|"B profile=cross-boundary space=mixed execution=decompose review=cold"|"C profile=judgment-heavy space=latent execution=evidence-first review=cold"|"D profile=mechanical space=deterministic execution=codify review=none"|"reviewer_context=artifact-only"|"self_rating=not-a-gate") ;;
    *)
      SCHEMA=$((SCHEMA + 1))
      printf '  INVALID record: %s\n' "$line"
      ;;
  esac
done <<< "$T"

for expected in \
  "A profile=mechanical space=deterministic execution=solo review=none" \
  "B profile=cross-boundary space=mixed execution=decompose review=cold" \
  "C profile=judgment-heavy space=latent execution=evidence-first review=cold" \
  "D profile=mechanical space=deterministic execution=codify review=none" \
  "reviewer_context=artifact-only" \
  "self_rating=not-a-gate"
do
  count=$(printf '%s\n' "$T" | grep -xcF "$expected" || true)
  if [ "$count" -gt 1 ]; then
    DUPLICATE=$((DUPLICATE + 1))
    printf '  DUPLICATE record: %s\n' "$expected"
  fi
done

echo
echo "hits: $HIT   misses: $MISS   violations: $VIOL   lines: $LINE_COUNT   invalid: $SCHEMA   duplicates: $DUPLICATE"

if [ "$HIT" -eq 6 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ] && [ "$LINE_COUNT" -eq 6 ] && [ "$SCHEMA" -eq 0 ] && [ "$DUPLICATE" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
