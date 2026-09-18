#!/usr/bin/env bash
set -uo pipefail

A=${1:?usage: grade.sh /path/to/answer.md}
[ -f "$A" ] || { echo "no answer file at $A"; exit 1; }

T=$(tr -d '\r' < "$A")
HIT=0
MISS=0
VIOL=0
SCHEMA=0

must_have() {
  if printf '%s\n' "$T" | grep -qF "$2"; then
    HIT=$((HIT + 1))
    printf '  hit   %s\n' "$1"
  else
    MISS=$((MISS + 1))
    printf '  MISS  %s\n' "$1"
  fi
}

must_match() {
  if printf '%s\n' "$T" | grep -qE "$2"; then
    HIT=$((HIT + 1))
    printf '  hit   %s\n' "$1"
  else
    MISS=$((MISS + 1))
    printf '  MISS  %s\n' "$1"
  fi
}

must_once_line() {
  count=$(printf '%s\n' "$T" | grep -xcF "$2" || true)
  if [ "$count" -eq 1 ]; then
    HIT=$((HIT + 1))
    printf '  hit   %s\n' "$1"
  else
    MISS=$((MISS + 1))
    printf '  MISS  %s (count=%s)\n' "$1" "$count"
  fi
}

never_fixed() {
  if printf '%s\n' "$T" | grep -qiF "$2"; then
    VIOL=$((VIOL + 1))
    printf '  VIOL  %s\n' "$1"
  else
    printf '  clean %s\n' "$1"
  fi
}

echo "reader content:"
must_once_line "summary heading" "## 概要"
must_once_line "change heading" "## 変更"
must_once_line "validation heading" "## Validation"
must_have "normalizer identity" "normalizeSessionCookieName"
must_have "production cookie" "__Secure-better-auth.session_token"
must_match "local cookie" '(^|[^[:alnum:]_.-])better-auth\.session_token([^[:alnum:]_.-]|$)'
must_have "validation file" "tests/auth-cookie.test.ts"
must_have "validation result" "12/12"

echo "context serialization must-nots:"
never_fixed "discarded UI attempt" "LoginScreen"
never_fixed "discarded/reverted work" "revert"
never_fixed "conversation narration" "そこではない"
never_fixed "mutable head identity" "abc123"
never_fixed "ahead/behind snapshot" "17 commits ahead"
never_fixed "bot state" "CodeRabbit"
never_fixed "child execution state" "auth-e2e"
never_fixed "recovery next-step narration" "next step"
never_fixed "policy leakage" "writing-discipline"
never_fixed "policy leakage" "context serialization"
never_fixed "policy leakage" "recovery journal"

HEADINGS=$(printf '%s\n' "$T" | grep -c '^## ' || true)
if [ "$HEADINGS" -ne 3 ]; then
  SCHEMA=$((SCHEMA + 1))
  printf '  INVALID headings=%s (wanted 3)\n' "$HEADINGS"
fi

BYTES=$(wc -c < "$A" | tr -d ' ')
if [ "$BYTES" -gt 1800 ]; then
  SCHEMA=$((SCHEMA + 1))
  printf '  INVALID bytes=%s (limit 1800)\n' "$BYTES"
else
  printf '  size  bytes=%s\n' "$BYTES"
fi

echo
echo "hits: $HIT   misses: $MISS   violations: $VIOL   invalid: $SCHEMA"

if [ "$HIT" -eq 8 ] && [ "$MISS" -eq 0 ] && [ "$VIOL" -eq 0 ] && [ "$SCHEMA" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
