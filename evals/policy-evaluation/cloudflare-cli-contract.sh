#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)

fail() {
  printf 'cloudflare-cli-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

must_contain() {
  local file=$1
  local text=$2
  grep -Fq "$text" "$R/$file" || fail "$file missing: $text"
}

# Require one line of the prompt that routes a domain to its canonical source.
must_route() {
  local file=$1; shift
  local line
  line=$(grep -F -- "$1" "$R/$file" || true)
  shift
  local fragment
  for fragment in "$@"; do
    line=$(printf '%s\n' "$line" | grep -F -- "$fragment" || true)
  done
  [ -n "$line" ] || fail "$file has no line routing this domain to: $*"
}

PROFILE="organization/profiles/release-driven-solo.md"
PROMPT_JA="PROMPT.ja.md"
ADR="docs/adr/ADR-0026.md"
CONSTITUTION="constitution/CONSTITUTION.md"

must_contain "$PROFILE" '### Cloudflare CLI defaults'
must_contain "$PROFILE" 'primary CLIを `cf`'
must_contain "$PROFILE" '`cf cli search`'
must_contain "$PROFILE" 'explicit compatibility fallback'
must_contain "$PROFILE" 'silent fallbackにしない'
must_contain "$PROFILE" 'Cloudflareを利用しないprojectへ `cf` / Wranglerをpolicy complianceだけのために導入しない'

# PROMPT holds routing only; the profile is the canonical source checked above.
must_route "$PROMPT_JA" 'Cloudflare CLI（`cf`）' 'tool default' 'profile'
must_contain "$PROMPT_JA" 'Cloudflare CLI（`cf`）'


must_contain "$ADR" 'Wrangler examples trigger capability discovery, not automatic adoption'
must_contain "$ADR" 'Wrangler is an explicit compatibility fallback'
must_contain "$ADR" 'Capability is version-sensitive and must be reconciled'
must_contain "$ADR" 'Cloudflare CLI choice stays below the Constitution'

if grep -Eqi '(^|[^[:alnum:]_])(cloudflare|wrangler)([^[:alnum:]_]|$)' "$R/$CONSTITUTION"; then
  fail "Cloudflare-specific tooling leaked into Constitution"
fi

printf 'cloudflare-cli-contract: PASS\n'
