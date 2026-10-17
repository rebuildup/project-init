#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
CAP="$R/catalog/capabilities.tsv"
CAND="$R/catalog/candidates.tsv"

fail() {
  printf 'skill-catalog-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

[ -r "$CAP" ] || fail "missing catalog/capabilities.tsv"
[ -r "$CAND" ] || fail "missing catalog/candidates.tsv"

[ "$(head -1 "$CAP")" = $'capability\tscope\tneeded_when\tdescription' ] || fail "capabilities.tsv header changed"
[ "$(head -1 "$CAND")" = $'skill\tsource\tpath\tcapability\tstatus\tinvocation\tlicense\treview_depth\treviewed_rev\treviewed_on\treason' ] || fail "candidates.tsv header changed"

# Validate capability rows: four fields, known scope, unique ids.
problems=$(awk -F '\t' 'NR > 1 {
  if (NF != 4) print "capabilities.tsv line " NR ": expected 4 fields, got " NF
  if ($2 != "single" && $2 != "multi") print "capabilities.tsv line " NR ": unknown scope " $2
  if (seen[$1]++) print "capabilities.tsv line " NR ": duplicate capability " $1
}' "$CAP")
[ -z "$problems" ] || fail "$problems"

# Validate candidate rows against the capability list and the value vocabularies.
problems=$(awk -F '\t' '
  FNR == NR { if (FNR > 1) { scope[$1] = $2 } next }
  FNR > 1 {
    where = "candidates.tsv line " FNR
    if (NF != 11) { print where ": expected 11 fields, got " NF; next }
    if (!($4 in scope)) print where ": unknown capability " $4
    if ($5 !~ /^(default|alternative|reference|watch|excluded)$/) print where ": unknown status " $5
    if ($6 !~ /^(auto|manual)$/) print where ": unknown invocation " $6
    if ($8 !~ /^(listed|skimmed|read|evaluated)$/) print where ": unknown review_depth " $8
    if ($9 == "") print where ": empty reviewed_rev"
    if ($10 !~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) print where ": reviewed_on is not YYYY-MM-DD"
    if ($11 == "") print where ": empty reason"
    if ($5 == "default" && $1 == "*") print where ": a package-wide record cannot be default"
    if ($5 == "default" && $4 == "routing") print where ": routing belongs to the root contract, not an installed Skill"
    if ($5 == "default" && scope[$4] == "single") {
      if (owner[$4] != "") print where ": second default for single-owner capability " $4 " (already " owner[$4] ")"
      owner[$4] = $1 " from " $2
    }
  }' "$CAP" "$CAND")
[ -z "$problems" ] || fail "$problems"

# Capabilities needed by every project must have a standard owner.
problems=$(awk -F '\t' '
  FNR == NR { if (FNR > 1 && $3 == "always") always[$1] = 1; next }
  FNR > 1 && $5 == "default" { owned[$4] = 1 }
  END { for (c in always) if (!(c in owned) && c != "routing") print "capability " c " is needed always but has no default" }' "$CAP" "$CAND")
[ -z "$problems" ] || fail "$problems"

# In-repository candidates must point at Skills that exist.
while IFS=$'\t' read -r skill source path _rest; do
  [ "$source" = "rebuildup/project-init" ] || continue
  [ -f "$R/$path" ] || fail "candidates.tsv points at missing in-repo Skill: $path"
done < <(tail -n +2 "$CAND")

# Every in-repository Skill must be reachable from the catalog.
for dir in "$R"/skills/*/; do
  name=$(basename "$dir")
  awk -F '\t' -v n="$name" '$1 == n && $2 == "rebuildup/project-init" { found = 1 } END { exit found ? 0 : 1 }' "$CAND" \
    || fail "in-repo Skill $name has no candidates.tsv record"
done

# The init prompt must route Skill choice through the selection Skill.
grep -Fq '`skill-selection`' "$R/PROMPT.ja.md" || fail "PROMPT.ja.md does not route to skill-selection"

printf 'skill-catalog-contract: PASS\n'
