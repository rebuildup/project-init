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
# Count records directly off the file (not off the substituted T, which
# silently drops trailing newlines). The previous form let an answer with 8
# records plus a trailing blank line slip through as LINE_COUNT=8 because
# command substitution "A\nB\n\n" -> "A\nB\n" -> printf '%s\n' -> "A\nB\n\n"
# counted only 2 records via wc -l.
TRAILING_BLANK=0
if [ "$(tail -c 1 "$A" | wc -l | tr -d ' ')" = "1" ]; then
  # File ends with \n. If the last line is empty (i.e. the file ends with
  # two consecutive newlines, "X\n\n"), that empty line must still count.
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
echo "hits: $HIT   misses: $MISS   violations: $VIOL   lines: $LINE_COUNT   invalid: $SCHEMA   duplicates: $DUPLICATE   trailing_blank: $TRAILING_BLANK"

if [ "$HIT" -eq 8 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ] && [ "$EFFECTIVE_LINES" -eq 8 ] && [ "$TRAILING_BLANK" -eq 0 ] && [ "$SCHEMA" -eq 0 ] && [ "$DUPLICATE" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
