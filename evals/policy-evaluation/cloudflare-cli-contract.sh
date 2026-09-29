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

PROFILE="organization/profiles/release-driven-solo.md"
PROMPT_JA="PROMPT.ja.md"
PROMPT_EN="PROMPT.en.md"
ADR="docs/adr/ADR-0026.md"
CONSTITUTION="constitution/CONSTITUTION.md"

must_contain "$PROFILE" '### Cloudflare CLI defaults'
must_contain "$PROFILE" 'primary CLIを `cf`'
must_contain "$PROFILE" '`cf cli search`'
must_contain "$PROFILE" 'explicit compatibility fallback'
must_contain "$PROFILE" 'silent fallbackにしない'
must_contain "$PROFILE" 'Cloudflareを利用しないprojectへ `cf` / Wranglerをpolicy complianceだけのために導入しない'

must_contain "$PROMPT_JA" '### Cloudflare CLI default'
must_contain "$PROMPT_JA" 'primary CLIを `cf`'
must_contain "$PROMPT_JA" '`cf cli search`'
must_contain "$PROMPT_JA" 'Wranglerをexplicit compatibility fallbackとして残す'
must_contain "$PROMPT_JA" 'tool update / initialization reconciliation時に `cf` capabilityを再確認'

must_contain "$PROMPT_EN" '### Cloudflare CLI default'
must_contain "$PROMPT_EN" 'use `cf` as the primary CLI'
must_contain "$PROMPT_EN" '`cf cli search`'
must_contain "$PROMPT_EN" 'explicit compatibility fallback'
must_contain "$PROMPT_EN" 're-check `cf` capability during tool upgrades and initialization reconciliation'

must_contain "$ADR" 'Wrangler examples trigger capability discovery, not automatic adoption'
must_contain "$ADR" 'Wrangler is an explicit compatibility fallback'
must_contain "$ADR" 'Capability is version-sensitive and must be reconciled'
must_contain "$ADR" 'Cloudflare CLI choice stays below the Constitution'

if grep -Eqi '(^|[^[:alnum:]_])(cloudflare|wrangler)([^[:alnum:]_]|$)' "$R/$CONSTITUTION"; then
  fail "Cloudflare-specific tooling leaked into Constitution"
fi

printf 'cloudflare-cli-contract: PASS\n'
