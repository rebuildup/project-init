#!/usr/bin/env bash
set -uo pipefail

D=$(cd "$(dirname "$0")" && pwd)
RC=0

# Match the expect() pattern used by sibling controls.sh files: aggregate
# failures via RC instead of exiting on the first error, and surface grader
# diagnostics so a control failure is debuggable instead of opaque.
expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$D/grade.sh" "$file" 2>&1)
  got=$(printf '%s\n' "$out" | tail -n 1)

  if [ "$got" = "PASS" ] && [ "$expected" = "PASS" ]; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  elif [ "$got" != "PASS" ] && [ "$expected" = "FAIL" ]; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted %s)\n' "$label" "$got" "$expected"
    printf '%s\n' "$out" | sed 's/^/         /'
    RC=1
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
