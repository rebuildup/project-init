# Dedicated Supervisor guard (Claude Code reference adapter)

This is an opt-in **guarded preview** for a *dedicated non-authoring Supervisor checkout*. It is not a Worker setting and not an OS/security sandbox.

## Install

From the framework checkout:

```sh
node templates/supervisor-boundary/materialize.mts --target /path/to/supervisor-control-checkout --check
node templates/supervisor-boundary/materialize.mts --target /path/to/supervisor-control-checkout
node --test templates/supervisor-boundary/guard.test.mts
```

This copies `guard.mts` into the selected checkout and merges a `PreToolUse` catch-all hook with `onFailure: block` into **that checkout's** `.claude/settings.json`. Existing hooks and permissions are preserved; direct Write/Edit/Bash/PowerShell/Agent/Task tools also receive explicit deny rules. Changes to a previously installed guard are reconciled only if its old hash matches the managed manifest; local customizations and inconsistent hooks are rejected.

**Never** install this into the normal project checkout used by implementation Workers. Supervisor and Worker must use independent launch contexts, tool configurations, and credentials. The plain `agent-routing/materialize.mts` setup does not automatically install this optional control.

Requires Node.js with TypeScript stripping support (Node 22.18+ or compatible runtime) and Claude Code **2.1.295+** for `onFailure: block`. Validate the actual hook startup and hook failure behavior on the host. Run `claude /hooks` or inspect loaded hook settings and perform a denied Edit/Bash attempt; do not infer it from local unit tests. A hook that cannot start on older versions can fail open.

## Broker delegation

The default allowlist contains `Read`, `Glob`, `Grep`, `ToolSearch`. This intentionally blocks direct shell and unregistered MCP/connector tools, including GitHub mutations and Herdr's arbitrary shell controls. A Supervisor with only this default allowlist cannot start Workers: provision a separate, policy-enforcing broker tool first.

A trusted parent launcher can provide an exact allowlist via:

```sh
SUPERVISOR_BROKER_TOOLS='["mcp__trusted-broker__spawn_worker","mcp__trusted-broker__observe_worker"]'
```

These names are **illustrative, not installed tool IDs**. The actual broker must validate operation, role, resource lease, task/fencing identity and authorization, and must not expose arbitrary shell, Git write, or generic filesystem mutation. Do not add broad `mcp__herdr__*` or `mcp__github__*` entries. The environment allowlist is a harness filtering convenience, not a capability or credential boundary. An untrusted launcher that can change it invalidates this layer.

In the existing Herdr+dotfiles flow, `dispatch.mts` is normally invoked through a shell. That path is **deliberately blocked** inside this dedicated Supervisor session. A separate broker/control-plane process must call the dispatcher. Until this adapter exists and is tested for the target host, the dedicated Supervisor is expected to report delegation as blocked, **not** bypass the restriction.

## Operational acceptance (not covered by unit tests)

1. Supervisor source checkout is mounted/readable but not writable from its OS identity; no cross-path mutable workspace or local git-credential write route exists.
2. Supervisor has no direct remote/service write token; connector and network access are scoped separately. A read-only checkout alone is insufficient.
3. Worker runs in an independent writable workspace, with bounded credentials and authority.
4. Broker accepts only constrained operations, verifies immutable SHA/fencing and required approval before changing integration state.
5. Confirm negative attacks (Edit/Write/Bash, alternate CLI, direct GitHub API, compromised hook/settings, broad MCP tool) and positive delegated execution **on the actual host**.
6. Track verification evidence by host/harness version; without evidence, status remains `blocked` or `unverified`, never `enforced`.

See `skills/supervisor-boundary/SKILL.md`, `organization/execution-roles.md` and ADR-0035. The hook is defense in depth; do not claim that a local deny result proves prevention of cross-process or remote writes.
