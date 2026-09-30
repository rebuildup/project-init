#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)

fail() {
  printf 'herdr-orchestration-contract: FAIL: %s\n' "$*" >&2
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
PARALLEL="skills/parallel-orchestration/SKILL.md"
HERDR="skills/herdr-runtime/SKILL.md"
ADR="docs/adr/ADR-0025.md"
CONSTITUTION="constitution/CONSTITUTION.md"

must_contain "$PROFILE" 'Herdrをoptional adaptive Supervisor runtimeとして使用できる'
must_contain "$PROFILE" 'smallest useful fan-out'
must_contain "$PROFILE" 'agent数自体をoptimization targetにしない'

must_contain "$PROMPT_JA" '### Adaptive agent orchestration'
must_contain "$PROMPT_JA" '`herdr-runtime`'
must_contain "$PROMPT_JA" '多数決ではなくevidence / measurement / validation'
must_contain "$PROMPT_EN" '### Adaptive agent orchestration'
must_contain "$PROMPT_EN" '`herdr-runtime`'
must_contain "$PROMPT_EN" 'rather than majority vote'

must_contain "$PARALLEL" '## Adaptive fan-out / fan-in'
must_contain "$PARALLEL" '**competitive exploration**'
must_contain "$PARALLEL" 'smallest useful fan-out'
must_contain "$PARALLEL" '複数agentの同意だけをcorrectness evidenceにしない'

must_contain "$HERDR" '## Agent-driven Supervisor loop'
must_contain "$HERDR" '`HERDR_ENV=1`'
must_contain "$HERDR" 'herdr agent start'
must_contain "$HERDR" 'herdr agent prompt'
must_contain "$HERDR" 'herdr agent read'
must_contain "$HERDR" '`agent_prompt_stalled`'

must_contain "$ADR" 'Optimize admitted progress, not agent count'
must_contain "$ADR" 'Use four fan-out modes'
must_contain "$ADR" 'Herdr state remains telemetry'
must_contain "$ADR" 'Fan-in is evidence-based'

[[ -r "$R/$CONSTITUTION" ]] || fail "Constitution missing or unreadable"

if grep -Eqi '(^|[^[:alnum:]_])Herdr([^[:alnum:]_]|$)' "$R/$CONSTITUTION"; then
  fail "Herdr leaked into Constitution"
fi

printf 'herdr-orchestration-contract: PASS\n'
