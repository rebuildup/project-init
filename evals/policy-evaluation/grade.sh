#!/usr/bin/env bash
set -uo pipefail

A=${1:?usage: grade.sh /path/to/answer.txt}
[ -f "$A" ] || { echo "no answer file at $A"; exit 1; }

T=$(tr -d '\r' < "$A")
HIT=0
MISS=0
VIOL=0

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

echo
echo "hits: $HIT   misses: $MISS   violations: $VIOL"

if [ "$HIT" -eq 6 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
