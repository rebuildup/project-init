#!/usr/bin/env bash
set -euo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)

fail() {
  printf 'worktree-lifecycle-contract: FAIL: %s\n' "$*" >&2
  exit 1
}

must_contain() {
  grep -Fq -- "$2" "$R/$1" || fail "$1 missing: $2"
}

# Every frontend must call the same repository-controlled entry points.
must_contain mise.toml '[tasks."worktree:setup"]'
must_contain mise.toml 'run = "bash scripts/worktree/setup.sh"'
must_contain mise.toml '[tasks."worktree:teardown"]'
must_contain mise.toml 'run = "bash scripts/worktree/teardown.sh"'
must_contain .config/wt.toml '[pre-start]'
must_contain .config/wt.toml 'setup = "mise run worktree:setup"'
must_contain .config/wt.toml '[pre-remove]'
must_contain .config/wt.toml 'teardown = "mise run worktree:teardown"'
must_contain orca.yaml 'mise run worktree:setup'
must_contain orca.yaml 'mise run worktree:teardown'
must_contain .gitignore '.worktree.env'

# Frontend-specific templates would make worktrees differ by creator.
if grep -Eq 'hash_port|\{\{' "$R/.config/wt.toml"; then
  fail ".config/wt.toml derives values with Worktrunk templates; derive them in scripts/worktree/setup.sh"
fi

# Orca reads .worktreeinclude as literal paths only, and secrets are injected at runtime.
if [ -f "$R/.worktreeinclude" ]; then
  if grep -Ev '^[[:space:]]*(#|$)' "$R/.worktreeinclude" | grep -Eq '[*?[]|^!'; then
    fail ".worktreeinclude uses globs or negation, which Orca skips"
  fi
  if grep -Ev '^[[:space:]]*(#|$)' "$R/.worktreeinclude" | grep -Eq '(^|/)\.env'; then
    fail ".worktreeinclude copies dotenv files; inject secrets at runtime instead"
  fi
fi

# Behavior: deterministic per branch, idempotent, and safe without a prior setup.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q -b main
git -C "$tmp" -c user.name=eval -c user.email=eval@example.invalid commit -q --allow-empty -m init
mkdir -p "$tmp/scripts/worktree"
cp "$R/scripts/worktree/setup.sh" "$R/scripts/worktree/teardown.sh" "$tmp/scripts/worktree/"

(cd "$tmp" && bash scripts/worktree/teardown.sh) || fail "teardown fails before setup ran"

git -C "$tmp" switch -q -c 123
(cd "$tmp" && bash scripts/worktree/setup.sh) || fail "setup failed"
first=$(cat "$tmp/.worktree.env")
(cd "$tmp" && bash scripts/worktree/setup.sh) || fail "setup failed on rerun"
[ "$(cat "$tmp/.worktree.env")" = "$first" ] || fail "setup is not idempotent"
grep -qx 'WORKTREE_KEY=123' "$tmp/.worktree.env" || fail "setup did not key the worktree by branch"
port=$(sed -n 's/^PORT=//p' "$tmp/.worktree.env")
[ "$port" -ge 20000 ] && [ "$port" -lt 30000 ] || fail "port $port outside 20000-29999"
ls "$tmp"/.worktree.env.* >/dev/null 2>&1 && fail "setup left a temporary file"

git -C "$tmp" switch -q -c 124
(cd "$tmp" && bash scripts/worktree/setup.sh) || fail "setup failed on second branch"
grep -qx 'WORKTREE_KEY=124' "$tmp/.worktree.env" || fail "setup did not rekey after a branch change"

(cd "$tmp" && bash scripts/worktree/teardown.sh && bash scripts/worktree/teardown.sh) || fail "teardown is not idempotent"

printf 'worktree-lifecycle-contract: PASS\n'
