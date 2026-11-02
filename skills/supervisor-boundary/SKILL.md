---
name: supervisor-boundary
description: 専用Supervisorセッションと実装Workerを権限で分離する。Supervisorの直接実装やshell/API経由の権限迂回を防ぐ環境を導入・監査するときに使用。
---

# Supervisor Authority Boundary

Layer: Operating Model + Skill. Canonical semantics: `organization/execution-roles.md`, ADR-0035.

## Dedicated non-authoring Supervisor

- A dedicated Supervisor owns decomposition, delegation, observation, review coordination, and result admission decisions. It does **not** author source changes in its own process, regardless of task size.
- `solo execution` optimizes how a **Worker** executes mechanical/localized tasks; it never promotes the Supervisor session into an implementation Worker. If delegation is unavailable, report a blocked attempt rather than implementing locally.
- Supervisor may prepare designs, patches as text, acceptance criteria and review feedback; applying them to source/remote state remains a separate authorized execution.
- A combined actor is allowed only when the project explicitly **does not** use the dedicated Supervisor profile. Switching from dedicated Supervisor to combined mode requires an external launch/authority change, not a prompt or self-granted promotion.

## Capability contract

The enforcement layer, not a prompt, provisions these capabilities:

| Capability | Dedicated Supervisor | Worker / bounded broker |
| --- | --- | --- |
| Read project state and evaluate candidates | yes, subject to secret access limits | as required |
| Edit source/test files or run arbitrary shell | no | scoped workspace only |
| Push branch, mutate PR/release, operate devices | no direct credential/tool | specifically authorized side effects |
| Spawn/observe/cancel workers | broker operation only | as delegated |
| Admit result to integration state | decision by Supervisor; mutation executed by authorized broker | after SHA/fencing/validation checks |

Use **separate execution identities**. A writable checkout with only a prompt or optional hook is not an enforced boundary. A read-only mount does not prevent writes to remote APIs, and a disabled local tool does not revoke credentials already present in other channels.

Required independent controls: read-only project source for the Supervisor OS/runtime identity; no write-capable GitHub/remote/device credentials; a narrow broker that checks role, task, operation, resource lease and authorization before each side effect; independent mutable Worker environments. Do not expose a general-purpose shell/process tool through an allowlisted broker name.

## Current Claude Code adapter

The optional `templates/supervisor-boundary/` adapter is a **defense-in-depth** PreToolUse guard. It denies unknown tools, direct write/edit, shell, native Agent/Task and privileged MCP tools by default; exact broker tools can be supplied via a trusted launcher. `materialize.mts` installs it **only** in a dedicated Supervisor checkout. Never apply its settings to Worker checkouts.

It is not a complete sandbox. Other harnesses and APIs require their own enforcement; hook availability, missing runtime, timeout, user changes to settings and privileged credentials must not be treated as solved merely by adding a hook. Claude Code v2.1.295+ is required for `onFailure: block` support. Verify the actual harness/host with negative E2E before marking the integration operational.

## Verification and refusal

- Negative: requests for Edit/Write, arbitrary Bash/PowerShell, GitHub write MCP and unregistered tools must be rejected.
- Positive: read-only research and only explicitly configured **limited** broker operations succeed, without auto-approving unrelated permissions.
- Negative: hook startup/timeout, malformed input and unsupported harness runtime must not fall through to a writable Supervisor.
- Negative: on the actual host, source write, git push, alternate CLI/API calls, indirect broker general shell, and secret escalation all fail under Supervisor identity.
- Positive: authorized Worker implements in isolation; broker rechecks immutable SHA, fencing, leases and applicable release authority before mutation.

Local unit tests verify only the adapter decision logic/materialization. Real credential, filesystem isolation, broker authorization and macOS/WSL/Linux end-to-end gates remain separately required. Without them, report `unverified`/`blocked`, not `enforced`.

Re-evaluate if the runtime offers a smaller portable, auditable permission model with equal or stronger guarantees.
