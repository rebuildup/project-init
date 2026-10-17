#!/usr/bin/env bash
# Control runner for the Skills CLI materialization eval.
#
# The grader is a script, so its controls are fixture trees rather than
# answer files: each fixture is a materialized project that must be accepted
# or rejected for a specific, named reason. A grader that cannot reject the
# negative and regression fixtures is not trustworthy as quality evidence,
# which is the same rule CONTRIBUTING states for latent graders.
#
#   bash controls.sh
#
# Exits non-zero if any control does not get the expected verdict.
set -uo pipefail

D=$(cd "$(dirname "$0")" && pwd)
RC=0

expect() {
  label=$1
  fixture=$2
  expected=$3

  out=$(bash "$D/grade.sh" --check "$fixture" 2>&1)
  rc=$?
  got=$(printf '%s\n' "$out" | tail -n 1)

  verdict_ok() {
    case "$got" in
      PASS|FAIL|FAIL\ *) return 0 ;;
      *) return 1 ;;
    esac
  }

  if [ "$expected" = "PASS" ]; then
    if [ "$rc" -eq 0 ] && [ "$got" = "PASS" ]; then
      printf '  ok   %-46s -> %s\n' "$label" "$got"
    else
      printf '  FAIL %-46s -> rc=%s last=%s (wanted PASS)\n' "$label" "$rc" "$got"
      printf '%s\n' "$out" | sed 's/^/         /'
      RC=1
    fi
  else
    if [ "$rc" -ne 0 ] && verdict_ok && [ "$got" != "PASS" ]; then
      printf '  ok   %-46s -> %s\n' "$label" "${got:0:70}"
    else
      printf '  FAIL %-46s -> rc=%s last=%s (wanted FAIL with FAIL marker)\n' "$label" "$rc" "$got"
      printf '%s\n' "$out" | sed 's/^/         /'
      RC=1
    fi
  fi
}

# positive: a well-formed materialization.
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/positive"
cp -R "$D/fixtures/positive/." "$tmp/positive/"
mkdir -p "$tmp/positive/.claude/skills" "$tmp/positive/.codex/skills"
expect "positive: valid project-local materialization" "$tmp/positive" PASS

# Whitespace and home-local paths are both valid consumer locations.
cp -R "$tmp/positive" "$tmp/My Projects"
expect "positive: project path contains spaces" "$tmp/My Projects" PASS
mkdir -p "$tmp/home"
cp -R "$tmp/positive" "$tmp/home/project"
HOME="$tmp/home" bash "$D/grade.sh" --check "$tmp/home/project" > "$tmp/home-check.txt" 2>&1
if [ $? -eq 0 ] && [ "$(tail -n 1 "$tmp/home-check.txt")" = "PASS" ]; then
  echo "  ok   positive: project under home directory"
else
  echo "  FAIL positive: project under home directory"
  cat "$tmp/home-check.txt"
  RC=1
fi

# Regression controls for reviewer-reported false passes.
cp -R "$tmp/positive" "$tmp/unclosed-frontmatter"
printf '%s\n' '---' 'name: engineering-decisions' 'description: Valid text' > "$tmp/unclosed-frontmatter/.agents/skills/engineering-decisions/SKILL.md"
expect "negative: unterminated frontmatter" "$tmp/unclosed-frontmatter" FAIL

cp -R "$tmp/positive" "$tmp/empty-provenance"
sed -i 's/"computedHash": "abc123"/"computedHash": ""/' "$tmp/empty-provenance/skills-lock.json"
expect "negative: empty computedHash value" "$tmp/empty-provenance" FAIL

cp -R "$tmp/positive" "$tmp/missing-list"
rm "$tmp/missing-list/list-output.txt"
expect "negative: no list transcript" "$tmp/missing-list" FAIL

cp -R "$tmp/positive" "$tmp/unrelated-list"
printf '%s\n' 'Project Skills' 'other-skill    .agents/skills/other-skill' > "$tmp/unrelated-list/list-output.txt"
expect "negative: installed skill absent from listing" "$tmp/unrelated-list" FAIL

cp -R "$tmp/positive" "$tmp/wrong-ignore"
printf '.codex/skills/\n' > "$tmp/wrong-ignore/.gitignore"
expect "negative: .claude link ignored only by codex rule" "$tmp/wrong-ignore" FAIL

# negative controls, one broken property each.

expect "negative: frontmatter name mismatch" \
  "$D/fixtures/negative-name-mismatch" FAIL

expect "negative: unquoted description with colon-space" \
  "$D/fixtures/negative-unquoted-colon" FAIL

expect "negative: missing computedHash in lock" \
  "$D/fixtures/negative-lock-no-hash" FAIL

expect "negative: SKILL.md listed as Skipped by the CLI" \
  "$D/fixtures/negative-skipped-in-list" FAIL

expect "negative: agent link directory not gitignored" \
  "$D/fixtures/negative-untracked-agent-link" FAIL

expect "negative: referenced references/ file missing" \
  "$D/fixtures/negative-missing-reference" FAIL

# regression control: the exact shape that shipped broken in xyt-media --
# four skills whose descriptions the Skills CLI refused to parse.
expect "regression: xyt-media unquoted-Triggers shape" \
  "$D/fixtures/regression-unquoted-triggers" FAIL

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"