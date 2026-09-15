#!/usr/bin/env bash
set -uo pipefail

D=$(cd "$(dirname "$0")" && pwd)
RC=0

# Match the expect() pattern used by sibling controls.sh files: aggregate
# failures via RC instead of exiting on the first error, and surface grader
# diagnostics so a control failure is debuggable instead of opaque.
#
# Both exit code and last-line output are checked so a grader crash or empty
# output cannot be misread as an expected FAIL. The earlier "got != PASS =>
# expected FAIL" form would treat a hung grader producing no output as a
# passing FAIL control, which would silently disable every regression check.
expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$D/grade.sh" "$file" 2>&1)
  rc=$?
  got=$(printf '%s\n' "$out" | tail -n 1)

  verdict_ok() {
    # Accept either a clean PASS marker, a clean FAIL marker on the last
    # line, or a FAIL-prefixed diagnostic line (the grader prints
    # "FAIL <reason>" before exiting non-zero).
    case "$got" in
      PASS|FAIL|FAIL\ *) return 0 ;;
      *) return 1 ;;
    esac
  }

  if [ "$expected" = "PASS" ]; then
    if [ "$rc" -eq 0 ] && [ "$got" = "PASS" ]; then
      printf '  ok   %-34s -> %s\n' "$label" "$got"
    else
      printf '  FAIL %-34s -> rc=%s last=%s (wanted PASS)\n' "$label" "$rc" "$got"
      printf '%s\n' "$out" | sed 's/^/         /'
      RC=1
    fi
  else
    # expected=FAIL requires (a) a non-zero exit code, and (b) a recognizable
    # FAIL marker on the last line. Without both, the control is treated as
    # broken rather than as a passing FAIL control.
    if [ "$rc" -ne 0 ] && verdict_ok && [ "$got" != "PASS" ]; then
      printf '  ok   %-34s -> %s\n' "$label" "$got"
    else
      printf '  FAIL %-34s -> rc=%s last=%s (wanted FAIL with FAIL marker)\n' "$label" "$rc" "$got"
      printf '%s\n' "$out" | sed 's/^/         /'
      RC=1
    fi
  fi
}

expect "linear release positive control"   "$D/fixtures/positive.txt" PASS
expect "linear release negative control"   "$D/fixtures/negative.txt" FAIL
expect "linear release regression control" "$D/fixtures/regression.txt" FAIL

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"
