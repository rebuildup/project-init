# Project Initialization Policy for Parallel Multi-Agent Development

Initialize or reconcile the AI coding-agent environment for this repository.

This is a meta-prompt intended to replace or augment a normal `/init`. Its purpose is to inspect the actual repository, stack, architecture, runtime, tests, CI/CD, and development workflow, then construct a **project-local development environment where multiple AI agents can work safely in isolated environments and integrate deterministically through GitHub Issues / Projects / Pull Requests and a version-oriented release-sprint branch**.

Do not load this entire document for every normal task. Read it only when (a) the repository is initialized with this policy for the first time, or (b) project-local Agent Skills / adapters / runtime policy are being rebuilt.

Do not copy this document wholesale into `AGENTS.md` or `CLAUDE.md`.

Core principle:

> **Git is the canonical source-state SoT, GitHub Issues / Projects are the canonical work-state SoT + 1 implementation worker = 1 isolated mutable runtime + parent/child delegation uses immutable snapshots/results + agent lifecycle is controlled through a Supervisor + each sprint is represented by its target release version + deterministic verification + progressive disclosure + maximum logically safe parallelism**

---

## 1. Highest-priority invariants

Do not treat a Git working tree as the execution-isolation boundary for multiple agents.

Multiple worktrees on one host may still share:

- TCP/UDP port namespace
- database / Redis / queue / emulator
- runtime state outside the filesystem
- process tree
- container names / volumes / networks
- OS-level caches
- credentials / sockets
- external mutable services

Therefore every implementation worker must receive an independent execution environment.

Principles:

- 1 implementation worker = 1 isolated workspace/runtime
- workers may reuse the same internal ports
- do not share mutable DB/cache/queue/volume state between workers
- do not allow multiple workers to edit one shared working directory concurrently
- do not use a shared mutable filesystem as the parent/child transfer protocol
- agent lifecycle is controlled by a Supervisor outside worker sandboxes
- Git remote / canonical refs are the source-state SoT
- GitHub Issues / Projects are the SoT for tickets, priority, target version, status, and dependencies

Git worktrees may be used as an internal Git implementation detail inside an already isolated sandbox. Never treat worktree-only separation as process/network/runtime isolation.

---

## 2. `/init` is idempotent reconciliation

Do not assume initialization runs only once.

Inspect the current state first and change only the gap between current and desired state.

Inspect at least:

- `AGENTS.md` / agent-specific adapters
- Agent Skills
- project-local plugin / MCP / protocol configuration
- sandbox / devcontainer / Containerfile / Nix configuration
- Supervisor integration
- architecture / tooling / workflow ADRs
- README / internal documentation
- package manager / runtime version / lockfile
- formatter / lint / type-check / static analysis
- unit / integration / E2E tests
- coverage
- CI/CD
- env examples / `.gitignore`
- GitHub Issues / Projects / PR / release workflow
- current errors / warnings
- current branch / remote / uncommitted user changes

Behavior:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

Do not regenerate correct state without reason. No change may be the correct result.

---

## 3. Make the Sources of Truth explicit

Do not define the multi-agent SoT as “whichever local directory is current.”

Canonical state should be representable through at least:

1. canonical Git remote
2. canonical released ref (`main` or an explicitly equivalent branch)
3. active release integration ref (`release-x-y-z`)
4. repository-controlled environment definition
5. durable work state in GitHub Issues / Projects
6. ADR / design / specification

Each ticket / worker must be able to pin a `base_sha` or equivalent immutable input snapshot at start time.

State model:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient runtime execution: Supervisor

A Supervisor-local DB or queue may be used as execution/cache state, but unrecoverable hidden local state must not be the sole SoT.

---

## 4. Agent architecture

Default structure:

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

- fully understand the user request
- acceptance criteria
- alignment with target release / release date
- dependency graph
- Issue decomposition
- agent delegation
- integration ordering
- consequential decisions
- final verification
- final synthesis

Do not concentrate large amounts of mechanical implementation in the Coordinator itself.

### Agent Supervisor

The Supervisor runs outside worker sandboxes as the control plane.

Responsibilities:

- sandbox create / destroy / suspend
- workspace snapshots
- agent spawn / wait / cancel
- model / agent-adapter selection
- resource / cost budget
- recursion depth / child count
- credential injection
- Git result collection
- integration support
- runtime logs / status

Do not give workers unrestricted Docker sockets, host-root-equivalent permissions, or cloud master credentials merely so they can create child sandboxes.

---

## 5. Make subagent spawning a first-class tool

Even when the selected agent has native subagents, verify that implementation workers satisfy this policy's isolation requirements.

Where possible, expose logical operations such as:

```text
spawn_agent
wait_agent
get_agent_status
get_agent_result
send_agent_message
cancel_agent
integrate_agent_result
```

Transport may be native agent APIs, MCP, ACP, CLI wrappers, or a project-local Supervisor client.

Expose agent creation as a high-level capability instead of teaching models raw Docker/VM/provider commands.

Spawn requests may include:

- GitHub Issue / internal task reference
- objective / acceptance criteria
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

---

## 6. Subagent modes

Distinguish at least:

### Research

Use for:

- repository exploration
- external research
- architecture investigation
- bounded analysis

Research is read-only by default. A heavy sandbox is not mandatory when commands/runtime cannot interfere with other work.

### Worker

Use for:

- implementation
- refactoring
- test implementation
- migration
- generation
- runtime verification

Always use an independent mutable execution environment.

### Reviewer

Use for:

- code review
- architecture review
- correctness review
- test adequacy
- integration review

Start from a clean snapshot of the reviewed commit/ref. Do not share the implementer's dirty workspace.

---

## 7. Parent -> Child uses an immutable snapshot

Do not assume a child can understand state by “looking at the parent's current directory.”

If a parent has unintegrated changes, create an immutable checkpoint before spawning the child.

Possible mechanisms:

- ephemeral Git commit
- local immutable Git ref
- container/filesystem snapshot
- content-addressed workspace snapshot

It must provide:

- traceable snapshot identity
- child input unaffected by later parent edits
- reproducibility in a clean environment
- a determinable base relationship to the result

Do not use implicit sharing of an uncommitted working tree as the subagent protocol.

---

## 8. Child -> Parent uses an immutable result

A child must not return work by directly editing the parent workspace.

The result should represent at least:

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

The standard implementation-worker result is a Git commit or equivalent immutable diff.

The Coordinator uses the Supervisor to inspect / integrate / reject / request revision.

Do not make concurrent pushes by multiple agents to the same durable ticket branch the standard workflow.

Do not use merge-conflict resolution as the primary parallelization strategy. Reduce conflicts through ticket boundaries, interfaces, and dependency graphs.

---

## 9. Execution-environment isolation

An implementation worker must isolate at least:

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

The Supervisor/runtime makes exposed host ports, preview URLs, or routes unique.

Reasonable shared state:

- read-only base images
- immutable Nix store
- package download caches
- Cargo registry cache
- OCI layer cache
- read-only toolchain cache

Do not share:

- application DB volumes
- concurrently mutated `node_modules` / build outputs
- generated runtime files
- Git index / working tree
- host Docker socket
- shared dev-server process

Rule: share immutable/cacheable state; isolate mutable state.

---

## 10. Runtime/provider is replaceable

Do not make one vendor mandatory.

At initialization time, inspect current native capabilities and the ecosystem and choose a suitable runtime for the project.

Categories:

- local container sandbox
- Dagger-like execution
- devcontainer-compatible runtime
- lightweight VM
- SSH/devbox provider
- on-demand remote sandbox
- native cloud-agent machine

Reuse the same environment definition across local and remote execution where practical.

```text
same repository + same environment specification
    -> macOS local sandbox
    -> WSL/Linux local sandbox
    -> remote sandbox
```

Prefer remote compute that is created/destroyed with task lifecycle when practical.

Keep provider-specific differences inside Supervisor adapters rather than leaking them into project semantics.

---

## 11. Release sprint / Issue / Branch / Draft PR workflow

Replace direct work on local `main` with **target-version release sprints + GitHub-Issue-centered ticket-driven development**.

### Branch hierarchy

Default:

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

Meaning:

- `main`: released/integrated source state
- `release-x-y-z`: sprint integration branch representing the target semantic version
- `<issue-number>`: one durable ticket branch

### Sprint = target release version

Do not identify sprints only with an arbitrary sequence number.

Each sprint has one target semantic version.

Canonical release-branch format:

`release-<major>-<minor>-<patch>`

Examples:

- `release-0-1-0`
- `release-0-2-0`
- `release-1-0-0`

Use `-` rather than `.` as the version separator in the Git branch name.

Create the target release branch from `main` at sprint start.

### Issue

A durable work item that can be planned, implemented, and reviewed independently should normally be a GitHub Issue.

Issue title/body are Japanese by default.

Where relevant, include:

- objective / user-visible outcome
- acceptance criteria
- scope / non-scope
- dependency / blocked-by
- priority
- size / estimate
- area / component
- target version
- release date

Do not create GitHub Issues for every short-lived research agent or nested implementation subtask.

**durable planning unit = GitHub Issue**

**ephemeral execution unit = Supervisor task**

### GitHub Projects / Kanban

When available, use GitHub Projects as the canonical work board.

Minimum Status:

`Backlog -> Ready -> In Progress -> In Review -> Done`

Recommended fields:

- Priority
- Size
- Target Version
- Area / Component
- Blocked / dependency

Do not allow unlimited WIP.

### Ticket branch naming

Create one durable ticket branch per top-level Issue.

Canonical format:

`<issue-number>`

Examples:

- `123`
- `418`
- `1024`

Do not add an `issue/` prefix, slug, title, or work type.

The Issue number already uniquely identifies the ticket. Human-readable explanation belongs in the Issue and PR.

Ephemeral refs/commits returned by nested workers are outside this naming convention.

### Draft PR first

After the Issue begins and the ticket branch has a meaningful initial commit, open a Draft PR as early as practical.

The PR base is the ticket's target `release-x-y-z` branch.

Use the Draft PR as a durable integration surface, not merely a completion announcement.

Purposes:

- Issue linkage
- progress visibility
- early CI
- reviewer context
- agent/human discussion
- scope inspection

PR title/body/review discussion are Japanese by default.

The PR body should include at least:

- linked Issue / `Closes #<issue-number>`
- acceptance criteria
- change summary
- validation status/results
- known limitations / blockers
- target release

### Ready for review

Move a Draft PR to Ready for review only when:

- Issue acceptance criteria are implemented
- ticket-level quality gate has been run
- blocking known issues are resolved or explicitly out of scope
- the PR description matches the current implementation
- staleness/conflicts with the target release branch are handled

### Ticket merge / Done

The standard Issue Done boundary is:

- acceptance criteria satisfied
- required CI/checks green
- blocking review resolved
- release-branch staleness handled
- ticket PR merged into the target `release-x-y-z`
- linked Issue closed
- GitHub Project status = Done

Do not mark a ticket Done merely because a worker reports success.

An Issue may become Done once integrated into the release branch. Do not require the later release merge to `main` for each Issue to be Done.

### Release integration

Run the full applicable quality gate on the release branch after integrating the sprint's tickets.

Create a release PR:

`release-x-y-z -> main`

Release PR title/body are Japanese by default and should include at least:

- release goal
- included Issues / PRs
- breaking changes
- migration notes
- full validation result
- known limitations
- release/version metadata

After the release PR is merged, `main` becomes the released source state for that version.

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
- target release
- integration target

Ready nodes with no unfinished prerequisites should run concurrently within real resource/WIP constraints.

Do not rely only on “these tasks touch the same file, therefore they must be serial.” Isolated sandboxes allow separate tasks to edit the same file independently.

However, tasks that incompatibly change the same interface, generate the same artifact, or write the same external mutable resource require explicit dependency ordering or additional isolation.

---

## 13. Autonomous execution loop

For non-trivial implementation work, run:

`inspect -> plan release -> ticketize -> decompose -> snapshot -> delegate/implement -> verify -> integrate ticket -> review -> update board -> verify release -> replan -> continue`

Do not stop merely because compilation succeeds, one focused test passes, or the first implementation looks plausible.

Continue until the full requested scope or release/sprint acceptance is complete, or a real external/user gate is reached.

Do not silently reduce the requested task to an MVP.

---

## 14. Keep the root agent file as a dispatcher

Where supported, use `AGENTS.md` as the canonical cross-agent project contract.

The root file should contain only invariants that affect nearly every task, such as:

- project identity / boundaries
- `main` / active release branch / source SoT
- GitHub Project / Issue work SoT
- environment bootstrap entry point
- Supervisor / subagent entry point
- validation entry point
- language policy
- design approval gate
- Skill discovery

Move detailed workflows into Agent Skills.

Default Skills:

1. `parallel-orchestration`
2. `sandbox-runtime`
3. `github-delivery`
4. `quality-gate`

Add project-specific architecture/design/ADR, debugging, dependency hygiene, UI/browser, container/IaC, review, release/versioning, or external-doc Skills when needed.

Normal tasks should read only the relevant Skills, not this full prompt.

---

## 15. Select tools / Skills / plugins from zero

Do not treat product names in this document as a mandatory bundle.

At initialization time inspect:

- native agent capabilities
- subagent / sandbox capabilities
- current project configuration
- official plugin marketplace
- official / maintained Agent Skills
- MCP / ACP / agent protocols
- first-party integrations
- deterministic CLI tools
- official framework / SDK tooling

Priority:

1. existing deterministic project tools
2. project-local CLI / Skill
3. native agent capability
4. project-local adapter / protocol integration
5. plugin / MCP only when it has a clear advantage

Evaluate necessity, reproducibility, maintenance, security, license, context cost, cross-platform behavior, and version pinning.

Record consequential agent runtime / Supervisor / sandbox selection in ADRs.

---

## 16. Development environment and reproducibility

First-class targets:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandbox

### macOS / Apple Silicon

- treat `arm64` as a first-class architecture
- run portable Web/backend tasks in Linux sandboxes where practical to reduce CI/remote drift
- allow macOS-native workers for Xcode/iOS/macOS-native tasks
- preserve workspace isolation and immutable results for Apple-native workers

### Windows + WSL2

- for high-frequency build/watch workloads, prefer the WSL Linux filesystem for Linux-oriented repositories
- do not treat WSL itself as worker isolation
- give separate container/VM/sandbox boundaries to multiple workers
- keep Windows-host / WSL / container port differences inside runtime adapters

Do not require Docker Desktop.

When system dependency reproducibility matters, prefer declarative environments such as Nix flakes/dev shells, Containerfile, or devcontainer.

Target fresh-clone reproducibility:

`clone -> bootstrap -> sandbox create -> install -> migrate/seed -> app/test start -> validation`

---

## 17. Architecture / design / ADR

Inspect existing code first.

When deciding or changing architecture, consult the current official guidance for the platform/framework/SDK.

Priority:

1. current official recommended architecture
2. official reference implementation / conventions
3. coherent existing architecture
4. established ecosystem convention
5. custom architecture

Do not invent an official recommendation in intentionally unopinionated areas.

### Design-first

When design/specification exists:

1. read current design
2. identify required changes
3. agree with the user
4. update design
5. implement

Record long-lived decisions in ADRs.

Especially consequential:

- Agent Supervisor
- sandbox runtime/provider
- Git integration model
- release/sprint branching model
- environment reproducibility strategy
- architecture migration
- package/toolchain migration
- CI/CD
- test strategy

---

## 18. Source / documentation / GitHub language

### Source code

Use English for:

- filenames / directories
- identifiers
- class/function/component/test names
- code comments
- developer-facing logs
- config identifiers

Localization resources are exceptions.

### Commits

Use English commit messages.

Format:

`<work-prefix>: <extremely concise title>`

### Internal documentation

Use Japanese.

### GitHub Issues / Pull Requests

Use Japanese by default for Issue title/body, PR title/body, and review discussion.

Do not make branch names carry explanatory prose. Branches represent only an Issue number or release version.

---

## 19. Package manager / search / scripts

For JavaScript / TypeScript, use Bun by default unless there is a concrete incompatibility.

- `bun`
- `bun run`
- `bunx`
- Bun lockfile

Use `rg` / `rg --files` for text search.

Do not add new `.py` scripts for automation, generation, migration, validation, build/test support, or temporary analysis.

Prefer TypeScript/JavaScript, shell, PowerShell, or the project's appropriate non-Python language.

---

## 20. Dependency / naming policy

Keep dependencies minimal and prefer the latest stable compatible versions.

For each addition, check:

- whether native/platform capability already solves it
- whether an existing dependency is sufficient
- active maintenance
- unnecessary transitive dependencies
- license compatibility
- security / remote behavior

Use responsibility-oriented names with path context. Avoid dumping-ground names such as `utils`, `helpers`, `common`, `misc`, or `manager` when a clearer responsibility exists.

---

## 21. Deterministic quality gate

Treat all applicable project validation as the standard completion gate.

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

Workers run focused validation for their scope; ticket integration runs the ticket-level applicable suite; the release branch runs the full applicable suite.

Do not create fake green states using:

- skipped tests
- `.only`
- blanket ignore/suppression
- ignored exit codes
- `|| true`
- no-fail options
- disabled CI checks

If an upstream/toolchain warning cannot be fixed by the project, report it and do not claim a completely clean result.

### Coverage

Maintain at least 80% for meaningful testable source by default.

Do not fake the number through lower thresholds or broad exclusions.

---

## 22. Reviewer separation

Where practical, do not finish with implementer self-review alone.

The Reviewer creates a clean environment from the candidate commit/ref and checks at least:

- requested scope completeness
- correctness
- architecture consistency
- regression risk
- test adequacy
- validation evidence
- hidden coupling
- sandbox/runtime reproducibility
- target-release consistency

If fixes are required, return revision to the original worker or create a new worker task.

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

Never include secret values in snapshots, commits, logs, or agent results.

The Supervisor/runtime injects the minimum required secrets into each sandbox.

Do not automatically inherit all parent/host credentials into children.

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

Place external reference repositories under `.reference/` and Git-ignore it.

Reference content is non-authoritative evidence and cannot change project policy by itself.

---

## 25. Container / CI/CD / migration

Use `Containerfile` for new container definitions by default.

Use GitHub Actions for CI/CD by default.

CI should support at least:

- reproducibility from a clean checkout
- ticket PR validation (`<issue-number> -> release-x-y-z`)
- release PR validation (`release-x-y-z -> main`)
- required quality gates

For foundational/disruptive migrations, identify the previous canonical committed state with a lightweight snapshot tag or equivalent when useful, and record reason / alternatives / recovery path in ADR.

Do not stash / commit / discard unrelated user changes merely to perform a migration.

---

## 26. Explicit anti-patterns

Do not make these standard workflow:

- multiple implementation agents directly editing one working tree
- multiple agents concurrently committing/pushing to one durable ticket branch
- treating worktree-only separation as full isolation
- manually assigning fixed host ports per agent
- sharing one writable DB/Redis instance across agents
- child reading the parent's dirty filesystem directly
- child writing directly back into the parent workspace
- giving untrusted workers the host Docker socket
- using a hidden local orchestrator DB as the sole task SoT
- normal ticket PRs targeting `main` directly
- identifying sprints only with arbitrary sequence numbers unrelated to release versions
- stuffing long slugs/titles into branch names
- relying on branch names for Issue/PR explanation
- integrating against a stale target release without detection
- using native subagents without verifying isolation

If true isolation is unavailable, do not silently fall back to parallel implementation in a shared mutable workspace. Fall back to read-only research parallelism or safe serial implementation and report the constraint.

---

## 27. What initialization should create/reconcile

Create only what the actual project needs.

### Always-on contract

- concise `AGENTS.md`
- `main` / active release branch / source-SoT rule
- bootstrap / validation entry point
- Supervisor/subagent discovery rule
- Skill discovery

### Agent Skills

- parallel orchestration
- sandbox lifecycle
- GitHub release delivery
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
- release/sprint/Git workflow ADR
- architecture ADR updates

### GitHub

- Issue template / conventions when useful
- GitHub Project/Kanban fields
- target release/version workflow
- `release-x-y-z` branch convention
- number-only ticket branch convention
- Draft PR workflow
- ticket PR and release PR quality gates

Do not introduce frameworks, plugins, MCPs, or custom orchestrators merely for formality. Use native capabilities when they satisfy the requirements.

---

## 28. Initialization completion criteria

Before reporting initialization complete, verify at least:

- project-local instructions are discoverable from a fresh clone
- environment is reproducible
- host-specific hidden state is minimized across macOS/Apple Silicon and Windows+WSL/Linux
- two or more implementation workers can run concurrently without runtime/port/state collisions
- parent -> child can delegate through immutable snapshots
- child results can be collected as immutable commits/refs/diffs
- multiple agents do not directly edit one shared mutable working tree
- `main` is defined as released source state
- sprint is defined by target semantic version
- release branch format is `release-<major>-<minor>-<patch>`
- ticket branch format is only `<issue-number>`
- ticket PR targets the corresponding release branch
- release PR is `release-x-y-z -> main`
- Issue/PR are Japanese while commits are English
- deterministic validation entry point exists
- README / AGENTS / Skills / ADR are consistent
- secrets do not leak into repository or agent results
- canonical Git/GitHub state can recover the project if a runtime provider disappears

Finally report the project-local configuration created/changed, selected Supervisor/runtime, release workflow, parallelization model, validation result, and remaining constraints.
