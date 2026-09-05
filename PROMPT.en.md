# Project Initialization Policy for Parallel Multi-Agent Development

Initialize or reconcile the AI coding-agent environment for this repository.

This is a meta-prompt intended to replace or augment a normal `/init`. Its purpose is to inspect the actual repository, technology stack, architecture, runtime, tests, CI/CD, and development workflow, then construct a **minimal, reproducible, project-local environment in which multiple AI agents can work concurrently in isolated execution environments and integrate through GitHub Issues / Projects / Pull Requests using ticket-driven agile delivery**.

Do not load this entire document for ordinary tasks. Read the full policy only when (a) initializing the repository with this policy for the first time, or (b) reconstructing project-local Agent Skills, adapters, or runtime policy.

Do not copy this entire document into `AGENTS.md` or `CLAUDE.md`.

Core principle:

> **Use Git as the canonical Source of Truth for source state and GitHub Issues / Projects as the canonical Source of Truth for work state; isolate mutable execution state per agent; delegate through immutable snapshots; return immutable results; manage lifecycle through a Supervisor; integrate by Issue/PR; maximize deterministic verification; use progressive disclosure; and parallelize as much as is logically safe.**

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
- databases, caches, queues, volumes, and other mutable state must not be shared between agents
- multiple agents must not directly edit the same shared working directory
- parent/child change transfer must not depend on a shared mutable filesystem
- sandbox lifecycle must be managed by a Supervisor outside the sandbox
- canonical Git remote / refs are the Source of Truth for source-code state
- GitHub Issues / Projects are the Source of Truth for tickets, priority, sprint, status, and dependencies

A Git worktree may be used as an internal implementation detail inside an already-isolated sandbox. **A worktree alone must never be considered process/network/runtime isolation.**

---

## 2. `/init` is idempotent reconciliation

Do not assume initialization runs only once.

Inspect the current state first and change only the delta toward the desired state.

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
- GitHub Issues / Pull Requests / Projects / milestones / release workflow
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
4. durable GitHub Issue / Project work state
5. ADR / design / specification

Each implementation ticket should be able to pin a `base_sha` when it begins.

```text
origin/main @ abc123
├─ issue #101: base_sha=abc123 + result A
├─ issue #102: base_sha=abc123 + result B
└─ issue #103: depends_on=#101 + result C
```

Never use “which directory looks newest” as the Source of Truth rule.

### Separate source state from work state

- code / config / design state: Git repository
- ticket / priority / status / sprint / dependency: GitHub Issues / Projects
- review / integration: GitHub Pull Requests
- transient execution state: Supervisor

A Supervisor-local database or queue may be used as cache/execution state, but unrecoverable hidden state must not be the only Source of Truth for work management.

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
- align with sprint/release goals
- build the dependency graph
- decompose into tickets
- delegate agents
- order integration
- make consequential decisions
- perform final verification
- synthesize the final result

Do not concentrate large amounts of mechanical implementation in the Coordinator itself.

### Agent Supervisor

The Supervisor is a control plane that runs outside worker sandboxes.

Responsibilities:

- create / destroy / suspend sandboxes
- create workspace snapshots
- spawn / wait / cancel agents
- choose model / agent adapters
- enforce resource / cost budgets
- enforce recursion depth / child count
- inject credentials
- collect Git results
- support integration
- expose runtime logs / status

Do not give workers a Docker socket, host-root-equivalent privilege, cloud master credentials, or unrestricted sandbox creation capability.

### Worker / Reviewer

Each agent receives only the minimum required capabilities.

Define roles by logical responsibility rather than fixed vendor product names.

---

## 5. Make subagent spawning a first-class tool

Even when the selected coding agent has native subagents, verify that implementation workers satisfy the isolation requirements in this policy.

Ideally, the Coordinator and permitted parent agents should have logical tools equivalent to:

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

Expose **agent creation as a high-level tool** rather than requiring models to manage Docker/VM/container commands directly.

A spawn request may include:

- GitHub Issue / internal task reference
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

Do not impose an arbitrary low agent-count limit merely to simplify orchestration, but do enforce real resource, rate, quota, cost, WIP, and depth limits.

---

## 6. Distinguish subagent modes

At minimum distinguish these logical modes.

### Research

For:

- repository exploration
- external research
- architecture investigation
- bounded analysis

Research is read-only by default. A heavy isolated runtime is not mandatory when no code changes are returned, unless command/runtime execution would interfere with other work.

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

Start from a clean snapshot of the target commit/ref. Do not share the implementer's dirty workspace.

---

## 7. Parent -> Child uses an immutable snapshot

Do not assume a child agent can recover required state by looking at the parent's current directory.

If a parent has unintegrated changes when spawning a child, create an immutable checkpoint first.

Acceptable mechanisms include:

- ephemeral Git commit
- local immutable Git ref
- container/filesystem snapshot
- content-addressed workspace snapshot

Ensure:

- the snapshot identity is traceable
- child input cannot change when the parent continues editing
- the state can be reproduced in a clean environment
- the relationship between result and base can be determined

Do not make implicitly shared uncommitted working-tree state part of the subagent protocol.

---

## 8. Child -> Parent uses an immutable result

A child agent must not return work by directly editing the parent's workspace.

A result must be able to represent at least:

```text
agent_id
issue_or_task_id
base_snapshot
result_commit_or_ref
summary
validation_results
artifacts
known_issues
```

The standard result from an implementation worker is a Git commit or equivalent immutable diff.

The Coordinator uses the Supervisor to:

- inspect
- cherry-pick / merge / rebase equivalent
- reject
- request revision

Do not make multiple agents pushing concurrently to the same integration branch the default design.

Merge conflicts can happen, but conflict resolution must not be the normal parallelization strategy. Reduce conflicts in advance through ticket boundaries, interfaces, and dependencies.

---

## 9. Execution-environment isolation

An implementation worker environment must isolate at least:

- repository checkout / workspace
- process boundary
- network namespace or port mapping
- writable runtime filesystem
- database state
- Redis/cache/queue state
- application local state
- test artifacts
- mutable build output

All sandboxes may use the same internal ports.

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

```text
same repository + same environment specification
    -> macOS local sandbox
    -> WSL/Linux local sandbox
    -> remote sandbox
```

For remote compute, prefer task-lifecycle create/destroy over permanently running VMs when feasible.

Keep provider-specific behavior behind Supervisor adapters rather than leaking it throughout project semantics.

---

## 11. GitHub Issue / Project / Sprint / Branch / Draft PR workflow

Replace direct development on local `main` with **GitHub Issue-centered ticket-driven development**.

Treat `origin/main`, or the project's designated canonical integration branch, as the Source of Truth for source-code state.

### Issue

A durable work item that can be planned, implemented, and reviewed independently should normally be an Issue.

Where relevant, each Issue should contain:

- objective / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size / estimate
- area / component
- sprint / iteration
- target release / milestone

Split oversized Issues into vertically sliced tickets that are independently reviewable and mergeable.

Do not create GitHub Issues for every short-lived research agent or nested implementation subtask.

**durable planning unit = GitHub Issue**

**ephemeral execution unit = Supervisor task**

### GitHub Projects / Kanban

When available, use GitHub Projects as the canonical work board.

Minimum Status model:

`Backlog -> Ready -> In Progress -> In Review -> Done`

Recommended fields:

- Priority
- Size
- Iteration / Sprint
- Area / Component
- Target Release

Expose Blocked/dependency state when useful.

Do not allow unlimited WIP. The Coordinator selects Ready, dependency-cleared tickets within capacity and keeps board state aligned with actual execution.

### Sprint / iteration

Operate with explicit timeboxes.

For each sprint:

1. define the sprint goal
2. select Ready tickets
3. inspect the dependency graph
4. allocate human/agent capacity and budget
5. launch isolated parallel workers
6. use PR / review / CI as the Done gate
7. re-plan unfinished tickets rather than silently treating them as complete

When the project has a release date, connect sprint planning to milestone/target-release goals.

### Branch naming

Normally create one integration branch per top-level Issue.

Canonical format:

`issue/<issue-number>-<short-slug>`

Examples:

- `issue/123-add-oauth`
- `issue/418-fix-calendar-race`

Do not omit the Issue number for normal ticket work.

Ephemeral refs/commits returned by nested workers do not need this naming convention.

### Draft PR first

After an Issue begins and the integration branch has a meaningful initial commit, **open a Draft PR as early as practical**.

Use the Draft PR as a durable integration surface rather than a completion announcement.

Purposes:

- Issue linkage
- progress visibility
- early CI
- reviewer context
- agent/human discussion
- change-scope inspection

The PR body should include at least:

- `Closes #<issue-number>` or an explicit Issue link
- acceptance criteria
- change summary
- validation status/results
- known limitations / blockers

### Ready for review

Move a Draft PR to Ready for review only when:

- Issue acceptance criteria are implemented
- the integration quality gate has been run
- blocking known issues are resolved or explicitly out of scope
- the PR description matches the current implementation
- the integration branch is reviewable

### Merge / Done

The standard Done boundary is:

- acceptance criteria satisfied
- required CI/checks green
- blocking review resolved
- canonical-base staleness handled
- PR merged
- linked Issue closed
- GitHub Project status = Done

Do not mark a ticket Done merely because a worker reports success.

### Multi-agent branch integration

- normally 1 top-level Issue = 1 integration branch = 1 PR
- workers do not directly share and mutate the integration branch concurrently
- workers return immutable commits/refs to the Coordinator
- only the Coordinator/Supervisor integrates results into the integration branch in a defined order
- nested subagents do not need individual PRs
- verify canonical-base staleness before merge

When the canonical branch advances, do not continuously force every ticket onto latest `main`; decide at integration time whether rebase, merge, or rerun is required.

Write Git / GitHub messages in English.

Commit format:

`<work-prefix>: <extremely concise title>`

---

## 12. Task graph and maximum safe parallelism

Decompose non-trivial Issues into a dependency graph.

Each durable node should have at least:

- Issue ID
- objective
- acceptance criteria
- prerequisites
- input snapshot
- output contract
- owner role
- integration target

Ready nodes with no unfinished prerequisites should run concurrently within real resource/WIP constraints.

Do not rely only on “these tasks touch the same file, therefore they must be serial.” Isolated sandboxes allow separate tasks to edit the same file independently.

However, tasks that incompatibly change the same interface, generate the same artifact, or write the same external mutable resource require explicit dependency ordering or additional isolation.

```text
Phase 1: parallel Issues
   ↓ integration checkpoint
Phase 2: parallel Issues
   ↓ integration checkpoint
Phase 3: parallel Issues
```

---

## 13. Autonomous execution loop

For non-trivial implementation work, run:

`inspect -> plan -> ticketize -> decompose -> snapshot -> delegate/implement -> verify -> integrate -> review -> update board -> replan -> continue`

Do not stop merely because compilation succeeds, one focused test passes, or the first implementation looks plausible.

Continue until the full requested scope or sprint acceptance is complete, or a real external/user gate is reached.

Do not silently reduce the requested task to an MVP.

---

## 14. Keep the root agent file as a dispatcher

Where supported, use `AGENTS.md` as the canonical cross-agent project contract.

The root file should contain only invariants that affect nearly every task, such as:

- project identity / boundaries
- canonical Git branch / source SoT
- GitHub Project / Issue work SoT
- environment bootstrap entry point
- Supervisor / subagent entry point
- validation entry point
- language policy
- design approval gate
- Skill discovery

Move detailed workflows into Agent Skills.

### Default Skill split

Prefer at least these four independent Skills:

1. `parallel-orchestration`
   - dependency graph
   - spawn/wait/result
   - snapshot delegation
   - integration ordering

2. `sandbox-runtime`
   - local/remote providers
   - macOS / WSL/Linux differences
   - network/DB/runtime isolation
   - bootstrap / preview routing

3. `github-delivery`
   - Issues
   - Projects/Kanban
   - sprint/iteration
   - `issue/<number>-<slug>` branch
   - Draft PR -> Ready -> merge -> Done

4. `quality-gate`
   - formatter/lint/type-check/static analysis
   - tests/coverage/build
   - integration verification

Add architecture/design/ADR, debugging, dependency hygiene, UI/browser, container/IaC, review, release/versioning, or external-documentation Skills when needed.

Ordinary tasks should reach relevant policy through short root pointers and Skills rather than rereading this full prompt.

Do not duplicate the same full policy for each agent. Prefer canonical Skill sources plus thin adapters.

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

Evaluate necessity, reproducibility, maintenance, security, license, context cost, cross-platform support, and version pinning.

Record consequential choices of Supervisor, sandbox runtime, or agent runtime in ADRs.

---

## 16. macOS / Windows+WSL / Linux development environments

This policy does not pin development to one host OS.

First-class targets:

- macOS, especially Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- native Linux / NixOS
- NixOS in containers
- remote Linux sandboxes

### Common rules

Avoid excessive dependence on host-specific paths and manual setup. Express project-local environments through declarative mechanisms such as:

- `Containerfile`
- devcontainer-compatible definitions
- Nix flake / dev shell
- declarative bootstrap scripts

For portable web/backend work, prefer Linux sandboxes on both macOS and Windows/WSL to reduce drift from CI/remote execution.

Use macOS-native workers only when Apple-native tooling is actually required. Preserve per-worker workspace/runtime isolation and immutable result semantics there as well.

### macOS / Apple Silicon

Treat `arm64` as a first-class architecture.

Verify:

- dependency / binary / container-image arm64 support
- multi-arch image availability
- accidental dependence on x86_64 emulation
- file-watch / volume performance
- host/container networking differences

Do not make Docker Desktop mandatory. Inspect current local container/VM runtimes and select one appropriate to the project.

For portable projects, avoid making large sets of host-installed macOS system packages mandatory project state; keep them in a sandbox or declarative dev environment where practical.

### Windows + WSL2

Do not confuse Windows-side and Linux-side filesystem/network/process semantics.

Default guidance:

- keep Linux-oriented repositories in the WSL Linux filesystem when practical
- avoid `/mnt/c`-style mounted Windows filesystems as the default high-frequency build/watch workspace
- verify that the actual container/runtime is available inside WSL
- abstract Windows-host vs WSL/container port forwarding in the Supervisor/runtime
- validate permission / executable-bit / symlink / line-ending behavior
- use PowerShell/native Windows workers only when Windows-specific behavior is required

Do not treat WSL itself as per-agent isolation. Multiple workers inside WSL still require their own container/VM/sandbox boundaries.

### Architecture portability

When Apple Silicon local development and x86_64 remote/CI coexist, validate architecture-sensitive dependency install/build/test behavior.

Keep runtime/provider differences behind adapters rather than changing project semantics.

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
- macOS / WSL/Linux portability strategy
- GitHub Issue/Project/PR delivery model
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
- arm64 / x86_64 portability when relevant

Use names that express ownership and responsibility through path context. Avoid dumping-ground names such as `utils`, `helpers`, `common`, `misc`, or `manager` without a clear domain responsibility.

---

## 21. Deterministic quality gate

For implementation tickets, run every applicable non-destructive project validation before completion.

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

Required CI/checks must pass before a PR moves to Ready/Done.

False green states are prohibited, including:

- skipped tests
- `.only`
- blanket ignores/suppressions
- ignored exit codes
- `|| true`
- no-fail options
- disabled CI checks
- lowered coverage thresholds or unjustified exclusions

If an upstream warning cannot be fixed by the project, report it and do not claim a completely clean result.

Maintain at least 80% coverage for meaningful testable source by default.

---

## 22. Reviewer separation

Where practical, do not complete work using only the implementer's self-review.

A Reviewer should create a clean environment from the integration candidate commit/ref and inspect at least:

- Issue acceptance-criteria completeness
- correctness
- architecture consistency
- regression risk
- test adequacy
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility
- consistency between PR description and implementation

If changes are required, return a revision request to the worker or create a new worker task.

If substantial new scope is discovered, consider splitting it into a new Issue rather than expanding one PR indefinitely.

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
- validate Issue-linked Draft/Ready PRs
- validate the canonical integration branch

Evaluate PR labels, required reviewers, auto-merge, merge queues, and release workflows when useful.

For foundational or disruptive migration, preserve an identifiable committed baseline when useful and record reason, alternatives, and rollback/recovery path in an ADR.

Do not stash, commit, or discard user uncommitted changes merely to perform a migration.

---

## 26. Explicit anti-patterns

Do not make any of the following standard practice:

- multiple implementation agents directly editing one working tree
- multiple agents concurrently committing/pushing to the same Git index or integration branch
- treating a worktree alone as complete isolation
- manually assigning host ports per agent
- sharing one writable DB/Redis instance across agents
- allowing a child to read the parent's dirty filesystem as its task input
- allowing a child to write directly back into the parent's workspace
- exposing the host Docker socket to an untrusted worker
- using a hidden local orchestrator database as the only task Source of Truth
- allowing the GitHub board to remain permanently inconsistent with actual execution state
- repeatedly starting substantial feature work without an Issue
- creating normal ticket branches without an Issue number
- delaying the Draft PR until implementation is almost complete and losing early integration feedback
- putting multiple unrelated tickets into one PR
- integrating stale-base work without recognizing staleness
- forcing dependent tasks into parallel execution merely to increase agent count
- silently disabling isolation to reduce sandbox cost
- using native subagents without verifying their isolation semantics
- treating WSL itself as worker isolation
- making macOS host-specific state mandatory for a portable project

If true isolation is unavailable, do not silently fall back to parallel implementation in a shared mutable workspace. Fall back to parallel read-only research or safe serial implementation and report the limitation.

---

## 27. What initialization should generate or reconcile

Create only what the actual project needs.

### Always-on contract

- concise `AGENTS.md`
- canonical Git branch / source SoT rule
- GitHub Project / Issue work SoT rule
- bootstrap / validation entry point
- Supervisor/subagent discovery rule
- Skill discovery pointers

### Agent Skills

Default first choices:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`

Add as needed:

- architecture/design/ADR
- debugging
- dependency hygiene
- UI/browser verification
- container/IaC verification
- review
- release/versioning
- external documentation retrieval

Each Skill should have a short trigger/description and reconstruct only the operational subset needed for that workflow.

### Reproducible runtime

- project-local environment definition
- dependency/tool version information
- macOS / WSL/Linux provider notes
- sandbox bootstrap
- service bootstrap / migrate / seed
- preview/port routing strategy
- architecture portability notes when needed

### Durable decisions

- agent runtime / Supervisor ADR
- sandbox/provider ADR when consequential
- cross-platform environment ADR when consequential
- GitHub delivery / sprint workflow ADR
- updates to existing architecture ADRs

### GitHub delivery

Where practical configure:

- Issue template
- PR template
- labels
- GitHub Project / Kanban
- Iteration / Sprint field
- Priority / Size / Area / Target Release fields
- branch naming convention `issue/<issue-number>-<short-slug>`
- early Draft PR convention
- Issue-linked PR convention
- required checks
- release/milestone convention

Do not introduce process merely for formality. However, in projects that actually run several agents concurrently, prefer durable Issue/Project/PR state so active work is recoverable and inspectable.

Do not introduce frameworks, plugins, MCPs, or custom orchestrators merely for formality. Use native capabilities when they satisfy the requirements.

---

## 28. Initialization completion criteria

Before reporting initialization complete, verify at least:

- project-local instructions are discoverable from a fresh clone
- ordinary tasks can reach relevant policy through Skills without rereading the full prompt
- macOS and Windows+WSL/Linux provider differences are separated from the project contract
- portable-task environments are reproducible
- Apple Silicon arm64 vs remote/CI architecture differences are handled when relevant
- two or more implementation workers can run concurrently without runtime/port/state collisions by design
- parent-to-child delegation can use immutable snapshots
- child results can be collected as immutable commits/refs/diffs
- agents do not directly share a mutable working tree
- durable work items can be managed as GitHub Issues
- GitHub Projects/Kanban can track Backlog -> Ready -> In Progress -> In Review -> Done, or an equivalent durable state model exists
- sprint/iteration and release goals can be represented when relevant
- a top-level Issue can create an `issue/<number>-<slug>` branch
- a Draft PR can open after a meaningful initial commit
- Draft -> Ready for review -> merge -> Issue close -> Done lifecycle is defined
- Issue acceptance criteria and validation results are traceable from the PR
- a deterministic validation entry point exists
- README / AGENTS / Skills / ADRs do not conflict
- secrets do not leak into the repository or agent results
- the chosen native/local/remote provider is explicit
- canonical Git + GitHub work state remains recoverable if the provider disappears

Finally, report the project-local configuration created or changed, Skill structure, selected Supervisor/runtime, macOS/WSL handling, GitHub Project / sprint / Draft PR workflow, parallelization model, validation results, and remaining constraints.
