#!/usr/bin/env bash
# Deterministic grader for the Skills CLI materialization contract.
#
# Two modes:
#
#   bash grade.sh --check <materialized-project-dir>
#       Offline, deterministic. Checks the seven contract properties against
#       an already-materialized project tree. This is the mode the controls
#       exercise, so the grader's ability to discriminate is verifiable
#       without a network or a JS runtime.
#
#   bash grade.sh --live [skill-name]
#       End-to-end. Creates a throwaway project, resolves the CLI
#       (`bunx skills` preferred, `npx skills` fallback), runs the real
#       `add --list` / `add --skill` / `list` flow, then applies the same
#       seven checks. Skips with a SKIP marker when neither runtime is
#       available, so it never reports a false PASS.
#
# Contract properties (all seven must hold):
#   1 discovery      the source's skill list is retrievable
#   2 install        a selected skill lands project-locally
#   3 discovered     `skills list` finds it
#   4 frontmatter    name matches the directory, description is present and
#                    parseable, and `skills list` reports zero parse errors
#   5 no global      the global scope is untouched
#   6 provenance     skills-lock.json carries source + path + hash
#   7 no dup track   runtime-generated agent links are gitignored rather
#                    than tracked twice
#
# Prints `PASS`, or `FAIL <reason>` and exits non-zero.
set -uo pipefail

SOURCE_REPO=${SKILLS_SOURCE:-rebuildup/project-init}

# Directory holding this script, so the live work directory can be created
# next to it (see the UNC-path note in --live).
D=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

fail() { printf 'FAIL %s\n' "$1"; exit 1; }
note() { printf '# %s\n' "$1"; }

# The CLI emits SGR colour codes and its TUI wraps long lines, so a naive
# `grep engineering-decisions` fails against
# `ESC[36mESC[7mengineeringESC[0mESC[27mESC[90m-decisionsESC[0m`. Strip ANSI
# before any text inspection. A grader that greps raw output silently stops
# detecting real installs.
strip_ansi() {
  sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/\x1b\][^\x07]*\(\x07\|\x1b\\\)//g'
}

resolve_cli() {
  if [ "${SKILLS_CLI:-}" != "" ]; then
    printf '%s\n' "$SKILLS_CLI"
    return 0
  fi
  if command -v bunx > /dev/null 2>&1; then printf 'bunx skills\n'; return 0; fi
  if command -v npx > /dev/null 2>&1; then printf 'npx skills\n'; return 0; fi
  return 1
}

# Read one frontmatter field. Deliberately not a full YAML parser: the
# contract is "name is present and equals the directory, description is
# present and is a single scalar", and a full parser would accept shapes the
# Skills CLI itself rejects.
#
# CRLF is stripped first. Windows checkouts carry CRLF, and without this every
# file looks like it has no frontmatter delimiter at all -- which is exactly
# the bug the controls caught during development.
frontmatter_field() {
  awk -v want="$2" '
    { sub(/\r$/, "") }
    NR == 1 {
      if ($0 != "---") exit 3
      next
    }
    $0 == "---" { closed = 1; exit }
    {
      idx = index($0, ":")
      if (idx == 0) next
      if (substr($0, 1, idx - 1) == want) {
        val = substr($0, idx + 1)
        sub(/^[ \t]+/, "", val)
        sub(/[ \t]+$/, "", val)
        found = 1
      }
    }
    END {
      if (!closed || !found) exit 3
      print val
    }
  ' "$1"
}

# Reject a description that YAML would read as a nested mapping: an unquoted
# scalar containing ": " (colon-space) is the exact shape that made the Skills
# CLI skip xyt-media's four skills with "Nested mappings are not allowed in
# compact mappings".
description_is_parseable() {
  case "$1" in
    \"*\") return 0 ;;
    \'*\') return 0 ;;
  esac
  case "$1" in
    *": "*) return 1 ;;
  esac
  return 0
}

check_tree() {
  root=$1
  arg_list=${2:-}

  [ -d "$root" ] || fail "materialized project directory not found: $root"

  # A captured `skills list` transcript may be passed as $2 or dropped into the
  # tree as list-output.txt. Fixtures use the file so controls.sh stays a
  # plain two-argument invocation.
  if [ -z "$arg_list" ] && [ -f "$root/list-output.txt" ]; then
    arg_list=$(cat "$root/list-output.txt")
  fi
  list_output=$(printf '%s' "$arg_list" | strip_ansi)

  # 2 install: collect paths as NUL-delimited records to preserve whitespace.
  local -a skill_dirs=() skill_names=()
  while IFS= read -r -d '' d; do
    skill_dirs+=("$d")
  done < <(find "$root/.agents/skills" -mindepth 1 -maxdepth 1 -type d -print0 2> /dev/null)
  [ "${#skill_dirs[@]}" -gt 0 ] || fail "no skill materialized under .agents/skills/"
  note "skills materialized: ${#skill_dirs[@]}"

  # 4 frontmatter: both required fields must be inside a closed block.
  for d in "${skill_dirs[@]}"; do
    name=$(basename "$d")
    skill_names+=("$name")
    [ -f "$d/SKILL.md" ] || fail "$name: SKILL.md missing"

    fm_name=$(frontmatter_field "$d/SKILL.md" name) \
      || fail "$name: frontmatter has no 'name' field or is not delimited"
    [ "$fm_name" = "$name" ] \
      || fail "$name: frontmatter name '$fm_name' does not match the directory"

    fm_desc=$(frontmatter_field "$d/SKILL.md" description) \
      || fail "$name: frontmatter has no 'description' field or is not delimited"
    [ -n "$fm_desc" ] || fail "$name: description is empty"
    description_is_parseable "$fm_desc" \
      || fail "$name: description is a bare scalar containing ': ', which YAML reads as a nested mapping"
  done

  # 3 discovery evidence is required for every materialized skill.
  [ -n "$list_output" ] || fail "skills list transcript missing"
  skipped=$(printf '%s\n' "$list_output" | grep -c 'Skipped' || true)
  [ "$skipped" -eq 0 ] \
    || fail "skills list reported $skipped skipped skill(s) with a frontmatter error"
  for name in "${skill_names[@]}"; do
    printf '%s\n' "$list_output" | grep -F -- "$name" | grep -q '\.agents' \
      || fail "skills list did not report project-scope skill: $name"
  done

  # 6 provenance: parse the lock as JSON and validate each materialized skill.
  [ -f "$root/skills-lock.json" ] \
    || fail "skills-lock.json missing: source/hash provenance is not recoverable"
  if command -v python3 > /dev/null 2>&1; then
    py=python3
  elif command -v python > /dev/null 2>&1; then
    py=python
  else
    fail "Python JSON parser unavailable for skills-lock.json validation"
  fi
  lock_n=$("$py" - "$root/skills-lock.json" "${skill_names[@]}" <<'PY'
import json
import sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        root = json.load(f)
    skills = root["skills"]
    wanted = set(sys.argv[2:])
    if not isinstance(skills, dict) or set(skills) != wanted:
        raise ValueError("lock entries do not match materialized skills")
    for name in wanted:
        entry = skills[name]
        if not isinstance(entry, dict):
            raise ValueError(f"{name}: lock entry is not a JSON object")
        for field in ("source", "skillPath", "computedHash"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"{name}: lock {field} missing or empty")
    print(len(skills))
except (OSError, ValueError, KeyError, TypeError) as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)
PY
  ) || fail "skills-lock.json provenance invalid"
  note "lock entries: $lock_n"

  # 5 project-local means under <project>/.agents/skills, not under
  # ~/.agents/skills. Projects anywhere below $HOME are valid.
  root_abs=$(cd "$root" && pwd -P) || fail "project path unavailable"
  home_abs=$(cd "$HOME" && pwd -P) || fail "home path unavailable"
  [ "$root_abs" != "$home_abs" ] || fail "project root is user home (global scope)"

  # 7 no duplicate tracking: the rule must apply to EACH existing dir.
  for agent_dir in "$root/.claude/skills" "$root/.codex/skills"; do
    [ -e "$agent_dir" ] || continue
    rel=${agent_dir#"$root"/}
    if [ -f "$root/.gitignore" ] && {
      grep -Fxq "$rel/" "$root/.gitignore" ||
      grep -Fxq "/$rel/" "$root/.gitignore" ||
      grep -Fxq "$rel" "$root/.gitignore" ||
      grep -Fxq "/$rel" "$root/.gitignore";
    }; then
      note "agent link gitignored: $rel"
      continue
    fi
    fail "agent link directory $rel exists but is not gitignored; canonical skill content would be tracked twice"
  done

  # Referenced references/ files must actually be present. Collect first, then
  # decide: piping into `while read` would put the check in a subshell, so a
  # failure there would exit only the subshell and the grader would go on to
  # print PASS.
  missing_refs=""
  for d in "${skill_dirs[@]}"; do
    name=$(basename "$d")
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      [ -f "$d/$ref" ] || missing_refs="$missing_refs $name:$ref"
    done < <(grep -o '(references/[^)]*)' "$d/SKILL.md" 2> /dev/null | sed 's/^(//; s/)$//' | sort -u)
  done
  [ -z "$missing_refs" ] || fail "SKILL.md references absent files:$missing_refs"

  return 0
}

mode=${1:-}
case "$mode" in
  --check)
    [ $# -ge 2 ] || fail "usage: grade.sh --check <materialized-project-dir>"
    check_tree "$2" "${3:-}"
    printf 'PASS\n'
    ;;

  --live)
    skill=${2:-engineering-decisions}
    cli=$(resolve_cli) || {
      note 'SKIP neither bunx nor npx is available; live materialization not attempted'
      printf 'SKIP\n'
      exit 2
    }
    note "using CLI: $cli"
    # The work directory must be reachable by the Node runtime as well as by
    # this shell. Under Git-Bash-on-Windows `mktemp -d` returns an MSYS
    # `/tmp/...` path that resolves to the WSL UNC prefix
    # `\\wsl.localhost\Ubuntu\tmp\...`, and a Windows `npx` cannot write there:
    # the install silently no-ops and `list` then reports "No project skills
    # found", which looks like a contract violation rather than an
    # environment problem. Creating the directory next to this script keeps it
    # on a native path. Override with SKILLS_WORKDIR when the caller wants a
    # different location.
    work_root=${SKILLS_WORKDIR:-$D/.work}
    case "$work_root" in
      '\\\\'*|*'\\'*) fail "SKILLS_WORKDIR resolves to a UNC path that the Node runtime cannot write to: $work_root" ;;
    esac
    mkdir -p "$work_root" || fail "cannot create work root: $work_root"
    work=$(mktemp -d "$work_root/materialization.XXXXXX") || fail "cannot create temporary work directory"
    trap 'rm -rf "$work"' EXIT
    cd "$work" || fail 'cannot enter work directory'
    git init -q . || fail 'git init failed'
    note "work directory: $work"

    # 1 discovery
    list_out=$($cli add "$SOURCE_REPO" --list 2>&1 | strip_ansi)
    list_rc=$?
    [ "$list_rc" -eq 0 ] || { printf '%s\n' "$list_out" | tail -n 20; fail "discovery failed (rc=$list_rc)"; }
    printf '%s\n' "$list_out" | grep -q "$skill" \
      || fail "discovery did not offer '$skill' from $SOURCE_REPO"
    note "discovery ok: $skill is offered"

    # 2 install
    global_pre=0
    [ -e "$HOME/.agents/skills/$skill" ] && global_pre=1
    install_out=$($cli add "$SOURCE_REPO" --skill "$skill" -y 2>&1 | strip_ansi)
    install_rc=$?
    [ "$install_rc" -eq 0 ] || { printf '%s\n' "$install_out" | tail -n 20; fail "install failed (rc=$install_rc)"; }

    # 3 discovered
    post_out=$($cli list 2>&1 | strip_ansi)
    post_rc=$?
    [ "$post_rc" -eq 0 ] || fail "list failed after install (rc=$post_rc)"
    printf '%s\n' "$post_out" | grep -q "$skill" \
      || fail "'$skill' is not reported by skills list after a successful install"
    note "discovery after install ok"

    # 5 no global: assert the stronger structural property -- the skill
    # resolved inside the project, not under the user home.
    if [ "$global_pre" -eq 0 ] && [ -e "$HOME/.agents/skills/$skill" ]; then
      fail "'$skill' also exists under the user home: a global install happened"
    fi

    # 7 the CLI creates agent links; the consumer project must gitignore them.
    for agent_dir in .claude/skills .codex/skills; do
      [ -e "$agent_dir" ] || continue
      printf '%s\n' ".claude/skills/" ".codex/skills/" > .gitignore
    done

    check_tree "$work" "$post_out"
    printf 'PASS\n'
    ;;

  *)
    fail "usage: grade.sh --check <dir> | --live [skill]"
    ;;
esac