#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)

# Report a deterministic contract failure and stop the check.
fail() {
  printf 'mise-toolchain-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

# Require an exact policy fragment in a repository-controlled file.
must_contain() {
  local file=$1
  local text=$2
  grep -Fq "$text" "$R/$file" || fail "$file missing: $text"
}

PROFILE="organization/profiles/release-driven-solo.md"
PROMPT_JA="PROMPT.ja.md"
PROMPT_EN="PROMPT.en.md"
ONBOARDING="skills/onboarding/SKILL.md"
ADR="docs/adr/ADR-0022.md"
CONSTITUTION="constitution/CONSTITUTION.md"

must_contain "$PROFILE" 'project-local toolchain/bootstrap frontend: mise'
must_contain "$PROFILE" '`mise install`'
must_contain "$PROFILE" '`mise exec -- ...` / `mise run <task>`'
must_contain "$PROFILE" 'native canonical version source'
must_contain "$PROFILE" 'native canonical version sourceがある場合、mise側へ独立した競合pinを作らない'
must_contain "$PROFILE" 'mise unavailable/incompatible時は同等のversion/reproducibility guaranteeを持つ明示的fallbackを使用する'
must_contain "$PROFILE" 'bounded version request + committed mise lockfile'
must_contain "$PROFILE" '`mise install --locked`'

must_contain "$PROMPT_JA" '### Project toolchain / bootstrap default'
must_contain "$PROMPT_JA" '`mise install`'
must_contain "$PROMPT_JA" 'canonical version sourceが既にある場合、mise側へ独立した競合pinを追加しない'
must_contain "$PROMPT_JA" 'bounded version request + committed mise lockfile'
must_contain "$PROMPT_JA" '`mise install --locked`'
must_contain "$PROMPT_JA" 'arbitraryなhost-global toolへsilent fallbackしない'
must_contain "$PROMPT_JA" 'miseはPracticeでありConstitutionではない'

must_contain "$PROMPT_EN" '### Project toolchain / bootstrap default'
must_contain "$PROMPT_EN" '`mise install`'
must_contain "$PROMPT_EN" 'do not add an independent conflicting mise pin'
must_contain "$PROMPT_EN" 'a bounded version request plus a committed mise lockfile'
must_contain "$PROMPT_EN" '`mise install --locked`'
must_contain "$PROMPT_EN" 'never silently fall back to arbitrary host-global tools'
must_contain "$PROMPT_EN" 'mise is a Practice, not a Constitutional invariant'

must_contain "$ONBOARDING" 'project-local toolchain bootstrap: mise'
must_contain "$ONBOARDING" '`mise exec -- ...` / `mise run <task>`'
must_contain "$ONBOARDING" '`mise install --locked`'
must_contain "$ONBOARDING" 'external/untrusted PRではmise command実行前にtrust reviewまたはbounded sandboxを必須'
must_contain "$ADR" 'mise is the default project-local toolchain/bootstrap Practice'
must_contain "$ADR" 'Do not create competing version authorities'
must_contain "$ADR" 'mise does not replace system/runtime isolation layers'

if grep -Eqi '(^|[^[:alnum:]_])mise([^[:alnum:]_]|$)' "$R/$CONSTITUTION"; then
  fail "mise leaked into Constitution"
fi

printf 'mise-toolchain-contract: PASS\n'
