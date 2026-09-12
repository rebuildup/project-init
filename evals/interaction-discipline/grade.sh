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

echo "interaction routing:"
must_exact "agent-owned edit stays agent-owned" "A owner=agent lead=result user_action=none"
must_exact "failed gate is operational and agent continues" "B owner=agent lead=blocker error=operational next=agent-fix"
must_exact "real deployment ambiguity asks one blocking question" "C owner=user lead=decision user_action=one-question"
must_exact "explicit detailed request preserves detail" "D detail=preserve brevity=task-controlled"
must_exact "unrelated tangent is deferred" "E tangent=defer"
must_exact "persistent PR prose routes through writing discipline" "F route=writing-discipline"
must_exact "time estimates require evidence" "estimate=evidence-only"
must_exact "completion reports verified outcome" "completion=verified-outcome"

echo "must-nots:"
never "no avoidable delegation" '^A owner=user|^B .*next=delegate-user'
never "no ceremonial lead" 'lead=ceremony'
never "no forced truncation" '^D detail=truncate|brevity=always-short'
never "no tangent mixing" '^E tangent=mix-in$'
never "no direct conversation copy into persistent prose" '^F route=direct-copy$'
never "no fabricated mandatory estimate" '^estimate=always-give$'
never "no activity-log completion" '^completion=activity-log$'

echo "schema:"
while IFS= read -r line; do
  case "$line" in
    "A owner=agent lead=result user_action=none"|"B owner=agent lead=blocker error=operational next=agent-fix"|"C owner=user lead=decision user_action=one-question"|"D detail=preserve brevity=task-controlled"|"E tangent=defer"|"F route=writing-discipline"|"estimate=evidence-only"|"completion=verified-outcome") ;;
    *)
      SCHEMA=$((SCHEMA + 1))
      printf '  INVALID record: %s\n' "$line"
      ;;
  esac
done <<< "$T"

for expected in \
  "A owner=agent lead=result user_action=none" \
  "B owner=agent lead=blocker error=operational next=agent-fix" \
  "C owner=user lead=decision user_action=one-question" \
  "D detail=preserve brevity=task-controlled" \
  "E tangent=defer" \
  "F route=writing-discipline" \
  "estimate=evidence-only" \
  "completion=verified-outcome"
do
  count=$(printf '%s\n' "$T" | grep -xcF "$expected" || true)
  if [ "$count" -gt 1 ]; then
    DUPLICATE=$((DUPLICATE + 1))
    printf '  DUPLICATE record: %s\n' "$expected"
  fi
done

echo
echo "hits: $HIT   misses: $MISS   violations: $VIOL   lines: $LINE_COUNT   invalid: $SCHEMA   duplicates: $DUPLICATE"

if [ "$HIT" -eq 8 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ] && [ "$LINE_COUNT" -eq 8 ] && [ "$SCHEMA" -eq 0 ] && [ "$DUPLICATE" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
