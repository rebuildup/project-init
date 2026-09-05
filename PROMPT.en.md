# Project Initialization Policy for Parallel Multi-Agent Development

Initialize or reconcile the AI coding-agent environment for this repository.

This is a meta-prompt intended to replace or augment a normal `/init`. Its purpose is to inspect the actual repository, stack, architecture, runtime, tests, CI/CD, and development workflow, then construct a **minimal, reproducible, project-local environment in which multiple AI agents can work concurrently in isolated execution environments and integrate deterministically through Git**.

Do not load this entire document for ordinary tasks. Read the full policy only when (a) initializing the repository with this policy for the first time, or (b) reconstructing project-local Agent Skills, adapters, or runtime policy.

Do not copy this entire document into `AGENTS.md` or `CLAUDE.md`.

Core principle:

> **Use Git as the canonical source of truth, isolate mutable execution state per agent, delegate through immutable snapshots, return immutable results, manage lifecycle through a Supervisor, maximize deterministic verification, and parallelize as much as is logically safe.**

---

## 1. Highest-priority rule

Do not treat a Git working tree as the execution-isolation boundary for multi-agent development.

Multiple worktrees on one host may still share:

- TCP/UDP port namespaces
- databases / Redis / queues / emulators
- runtime state outside the repository
- process trees
- container names / volumes / networks
- OS-level caches
- credentials / sockets
- external mutable services

Therefore, **every implementation worker must receive an isolated execution environment**.

Default invariants:

- 1 implementation worker = 1 isolated workspace/runtime
- multiple agents may use the same internal ports
- databases, caches, queues, volumes, and other mutable runtime state must not be shared between agents
- multiple agents must not directly edit the same shared working directory
- parent/child result transfer must not depend on a shared mutable filesystem
- sandbox lifecycle must be managed by a Supervisor outside the sandbox
- canonical Git remote / refs are the source of truth

A Git worktree may be used as an internal implementation detail inside an already-isolated sandbox. **A worktree alone must never be considered process/network/runtime isolation.**

---

## 2. `/init` is idempotent reconciliation

Do not assume initialization runs only once.

Inspect the current state first and only change the delta toward the desired state.

At minimum inspect:

- `AGENTS.md`
- Agent Skills
- agent-specific adapters
- project-local agent/runtime configuration
- sandbox / devcontainer / container / Nix configuration
- Supervisor integration
- architecture / agent-tooling ADRs
- README / internal documentation
- package manager / runtime versions / lockfiles
- formatter / lint / type-check / static analysis
- unit / integration / E2E tests
- coverage
- CI/CD
- environment examples / `.gitignore`
- GitHub Issue / PR workflow
- current errors / warnings
- current branch / remote / uncommitted user changes

Use this reconciliation model:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

Do not regenerate correct state without reason. No change can be a successful result.

---

## 3. Make the Source of Truth explicit

Do not place the Source of Truth for a multi-agent system in a particular local directory.

Canonical project state must be representable by at least:

1. canonical Git remote
2. canonical base ref / base commit SHA
3. repository-controlled environment definition
4. durable task / dependency state
5. ADR / design / specification

Each implementation task should be able to pin a `base_sha` when it begins.

Conceptually:

```text
origin/main @ abc123
├─ task A: base_sha=abc123 + result A
├─ task B: base_sha=abc123 + result B
└─ task C: base_sha=result A  + result C
```

Never use “which directory looks newest” as the Source of Truth rule.

GitHub Issues / PRs, repository task metadata, or explicit Supervisor state may represent the task graph. However, unrecoverable hidden local state must not be the only Source of Truth.

---

## 4. Agent architecture

Use this logical structure:

```text
Human / external caller
        │
        ▼
Root Coordinator
        │ agent tools
        ▼
Agent Supervisor / Control Plane
        │
        ├─ Sandbox A -> Worker A
        ├─ Sandbox B -> Worker B
        ├─ Sandbox C -> Reviewer C
        └─ Sandbox D -> Child Worker D
```

### Root Coordinator

Responsibilities:

- understand the complete user request
- define acceptance criteria
- build the dependency graph
- decompose tasks
- delegate agents
- order integration
- make consequential decisions
- perform final verification
- synthesize the final result

Do not concentrate large amounts of mechanical implementation in the Root Coordinator.

### Agent Supervisor

The Supervisor is a control plane that runs outside worker sandboxes.

Responsibilities:

- create / destroy / suspend sandboxes
- create workspace snapshots
- spawn / wait / cancel agents
- choose model / agent adapters
- enforce resource budgets
- enforce recursion depth / child count
- inject credentials
- collect Git results
- support integration
- expose runtime logs / status

Do not give workers a Docker socket, host-root-equivalent privilege, cloud master credentials, or unrestricted sandbox creation capability.

### Worker / Reviewer

Each agent receives only the minimum required capabilities.

Define roles logically rather than by vendor product name.

---

## 5. Make subagent spawning a first-class tool

Even when the selected coding agent has native subagents, verify that implementation workers satisfy the isolation requirements in this policy.

Ideally, the Root Coordinator and permitted parent agents should have logical tools equivalent to:

```text
spawn_agent
wait_agent
get_agent_status
get_agent_result
send_agent_message
cancel_agent
integrate_agent_result
```

The transport may be a native agent API, MCP, ACP, a CLI wrapper, or a project-local Supervisor client.

Expose **agent creation as a high-level tool** rather than requiring models to directly manage Docker/VM/container commands.

A spawn request may include:

- task / acceptance criteria
- role
- immutable input snapshot
- allowed tools
- filesystem mode
- network policy
- budget
- timeout
- maximum recursion depth
- expected result format

The Supervisor must prevent agent fork bombs and unbounded cost.

Do not impose an arbitrary low agent-count limit merely to simplify orchestration, but do enforce real resource, rate, quota, cost, and depth limits.

---

## 6. Distinguish three subagent modes

At minimum distinguish these logical modes.

### Research

For:

- repository exploration
- external research
- architecture investigation
- bounded analysis

Research is read-only by default. A heavy isolated runtime is not mandatory when no code changes are returned, unless command/context execution would interfere with other work.

### Worker

For:

- implementation
- refactoring
- test implementation
- migration
- generation
- runtime verification

A Worker **must use an independent mutable execution environment**.

### Reviewer

For:

- code review
- architecture review
- correctness review
- test adequacy
- integration review

Start from a clean snapshot of the target commit/ref. Do not directly share the implementer's dirty workspace.

---

## 7. Parent-to-child transfer uses immutable snapshots

Do not assume a child agent can recover required state by looking at the parent's current directory.

If a parent has unintegrated changes when spawning a child, first create an immutable checkpoint.

Acceptable mechanisms include:

- ephemeral Git commit
- local immutable Git ref
- container / filesystem snapshot
- content-addressed workspace snapshot

Choose a mechanism appropriate to the platform, but ensure:

- the snapshot identity is traceable
- child input cannot change when the parent continues editing
- the state can be reproduced in a clean environment
- the relationship between result and base can be determined

Do not make implicitly shared uncommitted working-tree state part of the subagent protocol.

---

## 8. Child-to-parent transfer uses immutable results

A child agent must not return work by directly editing the parent's workspace.

A result must be able to represent at least:

```text
agent_id
base_snapshot
result_commit_or_ref
summary
validation_results
artifacts
known_issues
```

The standard result from an implementation worker is a Git commit or equivalent immutable diff.

The parent / Coordinator uses the Supervisor to:

- inspect
- cherry-pick / merge / rebase equivalent
- reject
- request revision

Do not make multiple agents pushing concurrently to the same branch the default design.

Merge conflicts can happen, but conflict resolution must not be the normal parallelization strategy. Reduce conflicts in advance through task boundaries, interfaces, and dependencies.

---

## 9. Execution-environment isolation

An implementation worker environment must isolate at least:

- repository checkout / workspace
- process namespace or equivalent process boundary
- network namespace or port mapping
- writable runtime filesystem
- database state
- Redis/cache/queue state
- application local state
- test artifacts
- mutable build output

All sandboxes may use the same internal ports.

Example:

```text
Sandbox A: app :3000, api :8000, db :5432
Sandbox B: app :3000, api :8000, db :5432
```

The runtime/Supervisor must make host-facing ports, preview URLs, and routes unique.

Usually safe to share:

- read-only base images
- immutable Nix store
- package download caches
- Cargo registry cache
- OCI layer cache
- read-only toolchain caches

Do not share mutable state such as:

- application database volumes
- concurrently mutated `node_modules` / build output
- generated runtime files
- Git index / working tree
- host Docker socket
- shared dev-server processes

Rule: **share immutable/cacheable state; isolate mutable state.**

---

## 10. Keep runtime/provider interchangeable

Do not make one vendor mandatory.

At initialization time, inspect current native capabilities and ecosystem options and choose what fits the project.

Relevant categories include:

- local container sandbox
- Dagger-like execution
- devcontainer-compatible runtime
- lightweight VM
- SSH/devbox provider
- on-demand remote sandbox
- native cloud-agent machine

Reuse the same environment definition across local and remote providers whenever practical.

Ideal:

```text
same repository + same environment specification
    -> local sandbox
    -> remote sandbox
```

For remote compute, prefer task-lifecycle create/destroy over permanently running VMs when feasible.

---

## 11. Git / GitHub workflow

Treat `origin/main`, or the project's designated canonical integration branch, as the Source of Truth.

The former pattern where every agent shares local `main` is prohibited.

Default workflow:

- one independent integration branch / PR per top-level task
- workers do not directly share and mutate the top-level task branch concurrently
- workers return immutable commits/refs to the Coordinator
- only the Coordinator/Supervisor integrates results into the task branch in a defined order
- GitHub PR is the primary integration boundary with humans and CI
- verify staleness against the canonical base before merge

Nested subagents do not need individual GitHub PRs. Internal workers may return ephemeral refs/commits that are integrated into the top-level task PR.

When multiple top-level tasks run concurrently, record each task's `base_sha` and dependencies.

When the canonical branch advances, do not continuously force every task onto latest `main`; decide at integration time whether rebase, merge, or rerun is required.

Write Git / GitHub messages in English.

Commit format:

`<work-prefix>: <extremely concise title>`

Issues / PRs should use concise English titles and structured summaries.

---

## 12. Task graph and maximum safe parallelism

Decompose non-trivial work into a dependency graph.

Each node should have at least:

- objective
- acceptance criteria
- prerequisites
- input snapshot
- output contract
- owner role
- integration target

Nodes with no unfinished prerequisites should run concurrently as far as real resources permit.

Do not rely only on “these tasks touch the same file, therefore they must be serial.” Isolated sandboxes allow separate tasks to edit the same file independently.

However, tasks that incompatibly change the same interface, generate the same artifact, or write the same external mutable resource require explicit dependency ordering or additional isolation.

For phase dependencies:

```text
Phase 1: parallel
   ↓ integration checkpoint
Phase 2: parallel
   ↓ integration checkpoint
Phase 3: parallel
```

---

## 13. Autonomous execution loop

For non-trivial implementation work, run:

`inspect -> plan -> decompose -> snapshot -> delegate/implement -> verify -> integrate -> review -> replan -> continue`

Do not stop merely because compilation succeeds, one focused test passes, or the first implementation looks plausible.

Continue until the full requested scope is complete or a real external/user gate is reached.

Do not silently reduce the requested task to an MVP.

---

## 14. Keep the root agent file as a dispatcher

Where supported, use `AGENTS.md` as the canonical cross-agent project contract.

The root file should contain only invariants that affect nearly every task, such as:

- project identity / boundaries
- canonical branch / Source of Truth
- environment bootstrap entry point
- Supervisor / subagent entry point
- validation entry point
- language policy
- design approval gate
- Skill discovery

Move detailed workflows into Agent Skills.

Where relevant, create Skills for:

- parallel orchestration / delegation
- sandbox lifecycle
- Git integration
- testing / quality gates
- architecture / ADR
- design-first workflow
- debugging
- dependency hygiene
- UI/browser verification
- container/IaC verification
- review
- release/versioning
- external documentation retrieval

Do not duplicate the same full policy for each agent. Prefer one canonical source plus thin adapters.

---

## 15. Select tools / Skills / plugins from zero

Do not treat product names in this document as a mandatory bundle.

At initialization time inspect:

- native agent capabilities
- native subagent / sandbox capabilities
- current project configuration
- official plugin marketplace
- official / maintained Agent Skills
- MCP / ACP / agent protocols
- first-party integrations
- deterministic CLIs
- framework / SDK official tooling

Prefer:

1. existing project deterministic tools
2. project-local CLI / Skill
3. native agent capability
4. project-local adapter / protocol integration
5. plugin / MCP only when it has a clear advantage

For selections, evaluate necessity, reproducibility, maintenance, security, license, context cost, cross-platform support, and version pinning.

Record consequential choices of Supervisor, sandbox runtime, or agent runtime in ADRs.

---

## 16. Development environment and reproducibility

Primary target environments include:

- Windows + WSL Containers
- NixOS on WSL
- NixOS in containers
- native Linux / NixOS
- remote Linux sandbox when needed

Do not assume Docker Desktop.

Before container/runtime operations, inspect the actual runtime and supported commands.

When system-dependency reproducibility matters, prefer declarative environments such as Nix flake/dev shell, Containerfile, or devcontainer.

Aim to reproduce from a fresh clone:

```text
clone
-> bootstrap
-> sandbox create
-> dependency install
-> migrate / seed
-> app/test start
-> validation
```

Do not depend on undocumented machine-specific state.

---

## 17. Architecture / design / ADR

Inspect the existing codebase first.

When deciding or changing architecture, verify current official guidance for the platform/framework/SDK.

Priority:

1. current official recommended architecture
2. official reference implementation / conventions
3. coherent existing architecture
4. established ecosystem convention
5. custom architecture

Do not invent an official recommendation in intentionally unopinionated areas.

### Design-first

When a design/specification exists:

1. read current design
2. identify required changes
3. agree with the user
4. update design
5. implement

Persist long-lived decisions in ADRs.

Especially record decisions about:

- Agent Supervisor
- sandbox runtime/provider
- Git integration model
- environment reproducibility strategy
- architecture migration
- package/toolchain migration
- CI/CD
- test strategy

---

## 18. Source / documentation language

### Source code

Use English only for filenames, directories, identifiers, APIs, classes/functions/components/tests, code comments, developer-facing logs, and config identifiers. Localization resources are an exception.

### Internal development documentation

Use Japanese.

### Git / GitHub

Use English.

---

## 19. Package manager / search / scripts

For JavaScript / TypeScript, use Bun as the default package manager unless a concrete incompatibility exists.

Prefer:

- `bun`
- `bun run`
- `bunx`
- Bun lockfile

Use `rg` / `rg --files` for text search.

Do not add new `.py` scripts for automation, generation, migration, validation, build/test support, maintenance, or temporary analysis.

Prefer TypeScript/JavaScript, shell, PowerShell, or the project's appropriate non-Python language.

---

## 20. Dependency / naming policy

Minimize dependencies and prefer the latest stable compatible version.

For new dependencies, verify:

- whether platform/native capability already covers the need
- whether an existing dependency is sufficient
- active maintenance
- transitive dependency cost
- license compatibility
- security / remote behavior

Use names that express ownership and responsibility through path context. Avoid dumping-ground names such as `utils`, `helpers`, `common`, `misc`, or `manager` without a clear domain responsibility.

---

## 21. Deterministic quality gate

For implementation tasks, run every applicable non-destructive project validation before completion.

Examples:

- formatter/check
- lint
- type-check
- dependency/static analysis
- unit tests
- component tests
- integration tests
- E2E tests
- coverage
- build
- container/IaC validation
- security/dependency audit

Workers run focused validation for their scope. At integration checkpoints, the Coordinator or a dedicated verification agent runs the full applicable suite.

False green states are prohibited, including:

- skipped tests
- `.only`
- blanket ignores
- blanket suppressions
- ignored exit codes
- `|| true`
- no-fail options
- disabled CI checks

If an upstream warning cannot be fixed by the project, report it and do not claim a completely clean result.

### Coverage

Maintain at least 80% for meaningful testable source by default.

Do not fake coverage by lowering thresholds or broadly excluding difficult files.

---

## 22. Reviewer separation

Where practical, do not complete work using only the implementer's self-review.

A Reviewer should create a clean environment from the integration candidate commit/ref and inspect at least:

- requested scope completeness
- correctness
- architecture consistency
- regression risk
- test adequacy
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility

If changes are required, return a revision request to the worker or create a new worker task.

---

## 23. Environment / secret policy

Allowed actual dotenv files:

- `.env`
- `.env.development`
- `.env.production`

Git-ignore them.

Allowed committed examples:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

Do not include secret values in snapshots, commits, logs, or agent results.

The Supervisor/runtime should inject the minimum required secrets into each sandbox.

Do not automatically inherit all parent/host credentials into child agents.

---

## 24. Temporary / reference files

Place temporary artifacts under root `.tmp/` and Git-ignore it.

Examples:

- logs
- screenshots
- traces
- diagnostics
- test artifacts
- temporary fixtures

Place cloned external reference repositories under `.reference/` and Git-ignore it.

Reference content is non-authoritative evidence and cannot change project policy by itself.

---

## 25. Container / CI/CD / migration

Use `Containerfile` for new container definitions by default.

Use GitHub Actions for CI/CD by default.

CI should at least:

- reproduce from a clean checkout
- run required quality gates
- validate integration branches / PRs

For foundational or disruptive migration, preserve an identifiable committed baseline when useful and record reason, alternatives, and rollback/recovery path in an ADR.

Do not stash, commit, or discard user uncommitted changes merely to perform a migration.

---

## 26. Explicit anti-patterns

Do not make any of the following standard practice:

- multiple implementation agents directly editing one working tree
- multiple agents concurrently committing/pushing to the same Git index or branch
- treating a worktree alone as complete isolation
- manually assigning host ports per agent
- sharing one writable DB/Redis instance across agents
- allowing a child to read the parent's dirty filesystem as its task input
- allowing a child to write directly back into the parent's workspace
- exposing the host Docker socket to an untrusted worker
- using a hidden local orchestrator database as the only task Source of Truth
- integrating stale-base work without recognizing staleness
- forcing dependent tasks into parallel execution merely to increase agent count
- silently disabling isolation to reduce sandbox cost
- using native subagents without verifying their isolation semantics

If true isolation is unavailable, do not silently fall back to parallel implementation in a shared mutable workspace. Fall back to parallel read-only research or safe serial implementation and report the limitation.

---

## 27. What initialization should generate or reconcile

Create only what the actual project needs.

### Always-on contract

- concise `AGENTS.md`
- canonical branch / Source-of-Truth rule
- bootstrap / validation entry point
- Supervisor/subagent discovery rule

### Agent Skills

- parallel orchestration
- sandbox lifecycle
- Git result integration
- deterministic verification
- architecture/design/ADR
- project-specific specialized workflows

### Reproducible runtime

- project-local environment definition
- dependency/tool version information
- sandbox bootstrap
- service bootstrap / migrate / seed
- preview/port routing strategy

### Durable decisions

- agent runtime / Supervisor ADR
- sandbox/provider ADR when consequential
- updates to existing architecture ADRs

### CI/GitHub

- PR-oriented validation
- task/branch convention
- required checks

Do not introduce frameworks, plugins, MCPs, or custom orchestrators merely for formality. Use native capabilities when they satisfy the requirements.

---

## 28. Initialization completion criteria

Before reporting initialization complete, verify at least:

- project-local instructions are discoverable from a fresh clone
- the environment can be reproduced
- two or more implementation workers can run concurrently without runtime/port/state collisions by design
- parent-to-child delegation can use immutable snapshots
- child results can be collected as immutable commits/refs/diffs
- agents do not directly share a mutable working tree
- top-level tasks can integrate through PRs
- a deterministic validation entry point exists
- README / AGENTS / Skills / ADRs do not conflict
- secrets do not leak into the repository or agent results
- the chosen native/local/remote provider is explicit
- canonical Git state remains recoverable if the provider disappears

Finally, report the project-local configuration created or changed, selected Supervisor/runtime, parallelization model, validation results, and remaining constraints.
