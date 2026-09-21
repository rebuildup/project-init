#!/usr/bin/env bash
set -uo pipefail

A=${1:?usage: constitutional-refinement-grade.sh /path/to/answer.txt}
[ -f "$A" ] || { echo "no answer file at $A"; exit 1; }

mapfile -t ACTUAL < <(tr -d '\r' < "$A")
EXPECTED=(
  "layer=practice"
  "decision=candidate-refinement"
  "constitutional=identity,evidence,mutable-ownership,continuity"
  "evidence=implementation-conformance-required"
  "worktrunk=replaceable-not-invariant"
  "delivery.ticket_branch=preserve"
  "delivery.draft_pr=preserve"
  "delivery.draft_release_pr=preserve"
  "durable_update=practice-profile-adr"
  "risk=surface-unknowns"
)

RC=0

if [ "${#ACTUAL[@]}" -ne "${#EXPECTED[@]}" ]; then
  printf 'INVALID line-count=%s expected=%s\n' "${#ACTUAL[@]}" "${#EXPECTED[@]}"
  RC=1
fi

for i in "${!EXPECTED[@]}"; do
  got="${ACTUAL[$i]:-<missing>}"
  want="${EXPECTED[$i]}"
  if [ "$got" = "$want" ]; then
    printf '  hit   %02d %s\n' "$((i + 1))" "$want"
  else
    printf '  MISS  %02d got=%s expected=%s\n' "$((i + 1))" "$got" "$want"
    RC=1
  fi
done

T=$(printf '%s\n' "${ACTUAL[@]}")
for forbidden in   'worktrunk=mandatory'   'evidence=constitution-proves-runtime'   'delivery.ticket_branch=drop'   'delivery.draft_pr=drop'   'delivery.draft_release_pr=drop'   'durable_update=none'
do
  if printf '%s\n' "$T" | grep -qxF "$forbidden"; then
    printf '  VIOL  %s\n' "$forbidden"
    RC=1
  fi
done

if [ "$RC" -eq 0 ]; then
  echo "EVAL PASS"
  exit 0
fi

echo "EVAL FAIL"
exit 1
