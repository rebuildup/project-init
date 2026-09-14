#!/usr/bin/env bash
set -euo pipefail

D=$(cd "$(dirname "$0")" && pwd)
G="$D/grade.sh"

bash "$G" "$D/fixtures/positive.txt" >/dev/null

if bash "$G" "$D/fixtures/negative.txt" >/dev/null 2>&1; then
  printf 'FAIL negative control unexpectedly passed\n'
  exit 1
fi

if bash "$G" "$D/fixtures/regression.txt" >/dev/null 2>&1; then
  printf 'FAIL regression control unexpectedly passed\n'
  exit 1
fi

printf 'PASS controls\n'
