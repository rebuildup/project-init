#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
constitution="$root/constitution/CONSTITUTION.md"
profile="$root/organization/profiles/release-driven-solo.md"
formal="$root/formal/Organization.tla"

fail() {
  printf 'constitutional-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -f "$constitution" ]] || fail "missing Constitution"
[[ -f "$profile" ]] || fail "missing current operating profile"
[[ -f "$formal" ]] || fail "missing formal model"

for property in   "Identity Integrity"   "Authority Integrity"   "Evidence Integrity"   "Mutable Ownership Safety"   "Organizational Continuity"   "Canonical Consistency"   "Progress"
do
  grep -Fq "$property" "$constitution" || fail "missing constitutional property: $property"
done

# Tool/provider/workflow names belong below the Constitution layer.
for forbidden in   "Worktrunk"   "Linear"   "GitHub"   "Codex"   "Claude"   "Orca"   "release-x-y-z"   "Draft PR"
do
  if grep -Fq "$forbidden" "$constitution"; then
    fail "tool/workflow-specific term leaked into Constitution: $forbidden"
  fi
done

grep -Fq "IdentityIntegrity" "$formal" || fail "formal model missing IdentityIntegrity"
grep -Fq "AuthorityIntegrity" "$formal" || fail "formal model missing AuthorityIntegrity"
grep -Fq "EvidenceIntegrity" "$formal" || fail "formal model missing EvidenceIntegrity"
grep -Fq "MutableOwnershipSafety" "$formal" || fail "formal model missing MutableOwnershipSafety"
grep -Fq "OrganizationalContinuity" "$formal" || fail "formal model missing OrganizationalContinuity"
grep -Fq "EventuallyTerminal" "$formal" || fail "formal model missing liveness property"

printf 'constitutional-contract: PASS\n'
