# Project Initialization Policy for Parallel Multi-Agent Development

Initialize or reconcile the AI coding-agent environment for this repository.

This meta-prompt is intended to replace or strengthen a generic `/init`. Inspect the actual repository, technology stack, architecture, runtime, testing, quality, security, CI/CD, GitHub workflow, and documentation, then build a **project-local development environment where multiple AI agents can work safely in isolated environments, recover from interruption/context loss/sandbox loss, and integrate deterministically into version-oriented release sprints**.

Do not load this entire document for every normal task. Read it only during first initialization or when reconstructing project-local Agent Skills, adapters, runtime, quality, governance, or recovery policy.

Do not copy this entire document into `AGENTS.md` or `CLAUDE.md`.

Core model:

> **Git is the canonical source-state SoT + GitHub Issues / Projects are the work-state SoT + 1 implementation worker = 1 isolated mutable runtime + parent/child delegation uses immutable snapshots/results + a Supervisor controls agent lifecycle + fresh agents can recover from durable checkpoints without conversation history + each sprint is a target release version + project-specific quality/security/governance profiles are compiled from current official guidance + project knowledge is persisted in repository-controlled documentation + progressive disclosure + maximum logically safe parallelism**

---

## 1. Highest-priority invariants

- Do not treat a Git working tree as the execution-isolation boundary.
- Give every implementation worker an independent mutable runtime.
- Do not share mutable DB/cache/queue/process/generated state between workers.
- Parent -> child uses an immutable snapshot; child -> parent uses an immutable result.
- The Supervisor outside workers manages sandbox lifecycle.
- `main` represents released/integrated source state.
- The active sprint is represented by `release-<major>-<minor>-<patch>`.
- Durable tickets are GitHub Issues; durable work state is GitHub Projects.
- Ticket branch names contain only the Issue number.
- Quality gates are compiled per project rather than using one fixed bundle.
- Required verification levels are selected from change surface/risk.
- Continuously triage framework/runtime security information.
- Persist project knowledge in repository-controlled docs rather than chat/private memory.
- Do not escalate self-evident decisions that project evidence already resolves.
- Do not make native session/thread resume the only recovery mechanism.
- A fresh agent must be able to reconstruct unfinished work without conversation history.

Git worktrees are not forbidden. They may be an implementation detail inside an already isolated sandbox, but a worktree alone does not isolate ports, processes, databases, or other runtime state.

---

## 2. `/init` is idempotent reconciliation

Do not assume initialization runs only once.

Inspect current state first and change only what differs from the desired state.

At minimum inspect:

- root agent instructions
- Agent Skills / adapters
- plugin / MCP / ACP / protocol settings
- runtime / sandbox / devcontainer / Containerfile / Nix
- Supervisor integration / execution-state model
- recovery checkpoint / lease / fencing model
- language/framework/runtime/SDK versions
- manifest / lockfile / workspace structure
- architecture / design / ADRs
- test / lint / type / build / coverage configuration
- smoke/integration/E2E infrastructure
- GitHub Actions / CI/CD / required checks
- dependency/security tooling
- README / CONTRIBUTING / docs
- env examples / `.gitignore`
- GitHub Issues / Projects / PR / release workflow
- current errors / warnings
- branch / remote / user uncommitted changes

Behavior:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

Do not regenerate correct state without reason. No change can be a successful result.

---

## 3. Make Sources of Truth explicit

Canonical state should be representable by at least:

1. canonical Git remote
2. released ref: `main` or an explicitly equivalent branch
3. active release ref: `release-x-y-z`
4. repository-controlled environment definition
5. GitHub Issue / Project work state
6. project-wide policy / architecture / design / specification / ADRs
7. repository-controlled operational documentation / Agent Skills
8. durable recovery checkpoints / immutable worker results

Source/work state:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient execution: Supervisor

Each ticket/worker should have a traceable `base_sha` or immutable input snapshot.

Do not make a local directory, conversation history, native session ID, or unrecoverable Supervisor-local database the only source of truth.

---

## 4. Engineering decision precedence

Use this order by default when making development decisions:

1. **project-wide policy / canonical architecture / invariant**
2. **design / specification / explicit task instruction**
3. **coherent existing implementation majority**
4. **current official framework/runtime/SDK guidance**
5. established ecosystem convention
6. local best judgment

When sources conflict at the same level, prefer the more specific and newer canonical source.

Existing implementation is important evidence, but an old pattern or migration-in-progress majority must not override newer canonical design/policy.

When determining convention, inspect multiple implementations with the same responsibility. Exclude generated/vendor/example code and obsolete migration patterns. Do not treat the first file found as project convention.

### Do not ask the user about self-evident choices

Proceed autonomously when:

- precedence yields one or effectively one answer
- the decision is reversible and local
- acceptance criteria do not change
- no new public/external contract is being established
- security/privacy/cost/release scope is not materially changed

Do not ask “A or B?” when project evidence already resolves it.

### Escalate only real decisions

Ask the user when a genuine unresolved decision remains, such as:

- canonical sources conflict and product semantics change
- acceptance criteria allow materially different user-visible behavior
- irreversible/destructive operations
- public/external API contract decisions
- security/privacy/compliance risk acceptance
- meaningful cost increase
- release scope/date change
- an explicit design-first approval gate

Investigate discoverable facts first, then present options, impact, and a recommendation.

---

## 5. Agent architecture

```text
Human / caller
    │
    ▼
Root Coordinator
    │ high-level agent tools
    ▼
Agent Supervisor / Control Plane
    ├─ Sandbox A -> Worker A
    ├─ Sandbox B -> Worker B
    ├─ Sandbox C -> Reviewer C
    └─ Sandbox D -> Child Worker D
```

### Root Coordinator responsibilities

- user request / acceptance criteria
- target release / release date
- dependency graph / Issue decomposition
- delegation / integration ordering
- consequential decisions
- final verification / synthesis

Do not concentrate large amounts of mechanical implementation in the Coordinator.

### Agent Supervisor responsibilities

- sandbox create / destroy / suspend / recreate
- workspace snapshots / recovery checkpoints
- agent spawn / wait / cancel / resume / replace
- agent/model adapter selection
- resource / cost / WIP / recursion budgets
- credential injection
- execution lease / generation / fencing
- child discovery / orphan reconciliation
- Git result collection / integration
- logs / status / preview routing

Do not give workers host Docker sockets, root-equivalent host capability, or cloud master credentials just so they can create sandboxes.

---

## 6. Make subagent spawn a first-class tool

Where possible expose high-level capabilities to the Coordinator and permitted parent agents:

```text
spawn_agent
wait_agent
get_agent_status
get_agent_result
send_agent_message
cancel_agent
resume_or_replace_agent
integrate_agent_result
checkpoint_agent
recover_task
```

The transport may be a native agent API, MCP, ACP, CLI wrapper, or project-local Supervisor client.

Expose agent creation/recovery as high-level tools rather than making models reason directly about Docker/VM/provider commands.

Spawn input may include:

- Issue / internal task reference
- objective / acceptance criteria
- role
- immutable input snapshot
- allowed tools
- filesystem/network policy
- budget / timeout / maximum depth
- expected result format
- parent execution generation

Prevent fork bombs and unbounded cost.

---

## 7. Subagent modes / immutable transfer

At minimum distinguish:

### Research

Repository exploration, external research, architecture investigation. Read-only by default.

### Worker

Implementation, refactoring, tests, migration, generation, runtime verification. Always use an independent mutable environment.

### Reviewer

Code, architecture, correctness, test adequacy, and integration review. Start from a clean snapshot, not the implementer's dirty workspace.

### Parent -> Child

If a parent has unintegrated work, create an immutable checkpoint before spawning the child.

Possible representations:

- ephemeral Git commit
- immutable Git ref
- filesystem/container snapshot
- content-addressed workspace snapshot

Requirements:

- snapshot identity is traceable
- parent changes after spawn do not alter child input
- it can be reproduced in a clean environment
- its relationship to the child result is known

### Child -> Parent

Children must not directly edit the parent workspace as their result channel.

A result should be able to carry:

```text
agent_id
issue_or_task_id
base_snapshot
execution_generation
result_commit_or_ref
summary
validation_results
artifacts
known_issues
```

The Coordinator/Supervisor inspects, integrates, rejects, or requests revision.

---

## 8. Execution environment isolation

For implementation workers isolate at least:

- checkout / writable workspace
- process boundary
- network namespace or port mapping
- database state
- Redis/cache/queue state
- application local state
- test artifacts
- mutable build output

The same internal ports may be reused across sandboxes.

Reasonable shared state includes immutable/read-only base images, Nix store, package download caches, Cargo registry cache, OCI layer cache, and read-only toolchain caches.

Do not share writable application DBs, concurrently-mutated dependency/build directories, generated runtime state, Git index/working tree, host Docker socket, or a shared dev-server process.

Principle: **share only immutable/cacheable state; isolate mutable state**.

---

## 9. Runtime / host / provider portability

Do not make one vendor mandatory.

First-class local targets:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandbox

For portable web/backend work, reuse the same Linux sandbox definition where practical and hide host differences behind Supervisor/runtime adapters.

Treat Apple Silicon `arm64` as first class and validate differences from x86_64 CI/remote where relevant.

Do not treat WSL itself as worker isolation. Prefer the WSL Linux filesystem for high-frequency Linux-oriented build/watch workloads.

Do not require Docker Desktop by policy.

When choosing providers, evaluate not only create/destroy cost but snapshot persistence, suspend/resume behavior, provider-loss recovery, and remote artifact durability.

---

## 10. Project-local / progressive disclosure

Agent configuration should be project-local by default.

Do not:

- make global plugin/config state project truth
- depend on project-specific hidden rules in home directories
- use implicit persistent memory as canonical truth
- depend on undocumented machine-specific state

Keep the root agent file as a dispatcher containing only broad invariants and pointers.

Default Skills:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`
- `engineering-decisions`
- `security-maintenance`
- `onboarding`
- `agent-recovery`

Agent Skills may be discovered and installed with the Skills CLI. Prefer `bunx skills` when Bun is available; Node.js/npm environments can use the same arguments with `npx skills`. Use `bunx skills add <source> --list` to inspect available Skills and `bunx skills add <source>` or `--skill <name>` for project-local installation. Inspect existing project-local `skills/` and repository policy first, evaluate source trust, maintenance, reproducibility, and versioning, and install only the Skills actually needed. Do not make `--global` the default.

Normal tasks should load only the Skills they need, not this full prompt.

---

## 11. Release sprint / GitHub workflow

Development uses target-version release sprints centered on GitHub Issues.

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

### Sprint = target release version

One sprint maps to one target semantic version.

Release branch:

`release-<major>-<minor>-<patch>`

Create it from `main` at sprint start.

### GitHub Issues

Substantial work that can be independently planned, implemented, and reviewed should normally be an Issue.

Issue title/body are Japanese.

Include purpose, acceptance criteria, scope/non-scope, dependencies, priority, size, area/component, target version, and release date when relevant.

Short-lived nested subtasks may remain Supervisor tasks.

### GitHub Projects / Kanban

Minimum status model:

`Backlog -> Ready -> In Progress -> In Review -> Done`

Recommended fields include Priority, Size, Target Version, Area/Component, and Blocked/dependency.

Bound WIP by real capacity.

---

## 12. Ticket branch / Draft PR

Create one durable ticket branch for each top-level Issue.

Branch name:

`<issue-number>`

Do not add an `issue/` prefix, slug, title, or work type. Descriptive responsibility belongs in the Issue/PR.

After the first meaningful commit, open a Draft PR from the ticket branch to its target `release-x-y-z` branch early.

PR title/body/review discussion are Japanese.

Draft -> Ready requires:

- acceptance criteria implemented
- ticket integration gate passed
- blockers resolved or explicitly out of scope
- PR description matches current implementation
- release branch staleness/conflicts handled
- latest durable checkpoint is consistent with branch state

Ticket Done requires required CI/checks green, blocking review resolved, PR merged into the target release branch, Issue closed, and Project status Done.

---

## 13. Release integration

After sprint tickets are integrated, run the release gate on the release branch.

Release PR:

`release-x-y-z -> main`

Release PR title/body are Japanese and should summarize release goal, included Issues/PRs, breaking changes, migration notes, full validation results, known limitations, and version/release metadata.

After merge, `main` represents the released state for that version.

---

## 14. Task graph and maximum safe parallelism

Decompose non-trivial Issues into dependency graphs.

Each node may include:

- objective / acceptance criteria
- prerequisites
- input snapshot
- output contract
- owner role
- target release
- integration target
- recovery/checkpoint policy

Run Ready dependency-cleared nodes concurrently within resource/rate/quota/WIP/cost limits.

Do not serialize work solely because tasks touch the same file. Isolated sandboxes allow independent edits. Add dependencies or additional isolation when tasks incompatibly change the same interface, generated artifact, or external mutable resource.

---

## 15. Autonomous execution loop

For non-trivial tasks run:

`inspect -> plan release -> ticketize -> decompose -> snapshot -> delegate/implement -> checkpoint -> verify worker -> integrate ticket -> verify integration -> review -> update board -> verify release -> replan -> continue`

Do not stop merely because compilation succeeds, one focused test passes, or the first implementation appears plausible.

Do not silently reduce requested scope to an MVP.

---

## 16. Agent interruption recovery

AI-agent recovery must not depend on resuming the same conversation.

Native session/thread/subagent resume may be used as a fast path, but the canonical path is **reconstruction by a fresh agent from durable project state**.

### Failure model

At minimum account for:

- model/session context loss
- agent process crash / cancellation
- IDE/terminal restart
- parent agent crash while children continue
- child/subagent crash
- sandbox/container/VM recreation
- Supervisor restart
- transient network/provider failure
- host reboot
- context-window exhaustion

Define RPO/RTO up to machine/provider loss when project/provider requirements justify it.

### Durable recovery sources

Prefer:

1. GitHub Issue / Project
2. target release branch
3. ticket branch / commit graph
4. Draft/Ready PR / review / CI state
5. committed design / ADR / Skills / docs
6. immutable worker/subagent results
7. structured recovery checkpoints

Native conversation IDs, agent IDs, Supervisor-local DBs, shell history, and IDE state are transient optimizations.

### Structured recovery checkpoint

Do not persist private chain-of-thought. Persist only externally usable operational state.

Candidate schema:

```text
schema_version
issue_id
target_release
ticket_branch
pr_number
base_sha
checkpoint_sha_or_snapshot
execution_generation
status
completed_steps
next_steps
pending_validation
active_children
integrated_child_results
external_side_effects
blockers
decision_refs
artifact_refs
updated_at
```

Do not depend on secrets, machine-specific absolute paths, or private reasoning.

### Soft vs hard checkpoints

- soft checkpoint: same-host/same-sandbox recovery, using local immutable refs, filesystem snapshots, Supervisor journal, native session state, etc.
- hard checkpoint: provider/sandbox-loss boundary where meaningful code/work state remains reachable from durable remote infrastructure.

Do not remote-commit every trivial edit merely for checkpointing. Choose frequency from project RPO, task duration, and provider TTL.

### Checkpoint triggers

Consider checkpoints around:

- meaningful implementation milestones
- risky refactor/migration
- child spawn
- child-result integration
- long validation
- external side effects
- waiting for user/external input
- provider TTL/shutdown approaching
- graceful cancellation/shutdown
- context-window limit approaching

### Recovery algorithm

A fresh agent must not guess what the previous agent was thinking.

1. identify Issue / PR / target release
2. fetch ticket branch / remote commit graph
3. read latest valid checkpoint
4. inspect canonical policy/design/decision refs
5. rediscover active children through the Supervisor
6. recreate workspace from checkpoint
7. reevaluate completed/pending validation
8. inspect actual remote state of external side effects
9. check stale base / integration conflicts
10. reconstruct the remaining plan
11. run minimal safe verification to trust reconstructed state
12. advance execution lease/generation and continue

Even after native resume succeeds, reconcile it with branch/PR/checkpoint state before continuing.

---

## 17. Parent/child recovery and split-brain prevention

Child lifecycle belongs to the Supervisor/control plane, not the parent model process.

Do not automatically cancel safe children just because the parent dies.

A recovered parent/coordinator should:

- rediscover children
- verify input snapshot / execution generation
- classify running/completed/failed/orphaned
- collect completed immutable results
- avoid auto-integrating stale results
- retry/resume/re-spawn where needed

Assume an old agent and a recovered agent can overlap after a network partition or timeout.

Give each task a lease or execution generation/fencing token.

- advance `execution_generation` on recovery
- attach generation to worker results
- reject branch integration / external writes from stale generations
- do not interpret heartbeat loss as permission to blindly repeat side effects

Do not normally allow multiple generations to push the same ticket branch concurrently.

---

## 18. External side effects / idempotency

Operations outside Git are especially dangerous during recovery.

Examples:

- production/staging deploy
- DB migration
- package publish
- release/tag creation
- cloud resource mutation
- notification/email/comment creation
- billing/cost-producing operations

Use idempotency keys when supported.

Record durable intent before consequential side effects and result/remote identifiers after them. On recovery, inspect actual remote state before retrying.

Do not assume `command returned no response = operation did not happen`.

Apply engineering-decision escalation rules to irreversible/destructive operations.

---

## 19. Select tools / Skills / plugins from zero

At initialization inspect:

- native agent capabilities / resume behavior
- official / maintained Agent Skills
- deterministic project CLI
- framework/runtime/SDK official tooling
- first-party integrations
- LSP / MCP / ACP / plugins
- recovery/snapshot/provider persistence capabilities

Priority:

1. existing deterministic project tools
2. project-local CLI / Skill
3. native agent capabilities
4. project-local adapter / protocol integration
5. plugin / MCP only for a clear benefit

Evaluate need, reproducibility, maintenance, security, license, context cost, cross-platform behavior, and version pinning.

---

## 20. Architecture / design / ADRs

When deciding or changing architecture, inspect current official platform/framework/SDK guidance.

Priority:

1. current official recommended architecture
2. official reference implementation / conventions
3. coherent existing architecture
4. established ecosystem convention
5. custom architecture

Do not invent official recommendations in intentionally unopinionated areas.

Respect any design-first approval gate before implementation.

Persist consequential long-lived decisions in ADRs, especially Supervisor, sandbox provider, Git/recovery model, execution fencing, side-effect reconciliation, release branching, reproducible environments, architecture/toolchain migration, CI/quality, security priority, and onboarding strategy.

---

## 21. Adaptive quality profile

Quality gates are not a universal fixed bundle.

Detect actual languages, frameworks, runtimes, SDKs, app targets, persistence, and release targets, then inspect **current official guidance for the versions actually used**.

Priority:

1. framework/runtime/SDK official quality/testing guidance
2. official examples/templates/starters
3. official first-party CI / GitHub Actions guidance
4. official language/toolchain guidance
5. coherent existing configuration
6. maintained ecosystem tooling
7. custom tooling

Do not stop at recommendations. Add/repair formatter, lint/static analysis, compiler/type checking, test infrastructure, GitHub Actions, required checks, and specialized Skills when needed.

Local and CI gates should call the same deterministic entry points where practical.

---

## 22. Verification taxonomy and functional gate selection

Distinguish at least:

### Unit

Local logic/component behavior. It does not prove real external-boundary integration.

### Smoke / connectivity

Cheaply verifies startup, wiring, dependency injection, DB/API connectivity, and entry into critical paths.

### Integration

Verifies data flow, transaction behavior, persistence, and service interaction across multiple real components/boundaries.

### Contract / schema

Verifies compatibility of APIs, events, DB schemas, generated interfaces, and similar contracts.

### E2E / system

Verifies critical user/system flows across release-like boundaries.

### Manual / visual

Use explicitly only where automation is insufficient, such as some UI/native/hardware work.

Select required verification from change surface/risk.

Examples:

- pure logic -> unit
- API/service -> unit + integration
- DB/schema/migration -> integration + schema/migration + smoke
- runtime/env/network/DI -> smoke + relevant integration
- user journey/auth/navigation -> integration/contract + E2E
- build/package/container -> build/package + smoke
- release -> full applicable integration + critical E2E/smoke + release checks

Do not claim smoke/integration correctness from unit tests alone.

---

## 23. Worker / integration / release gates

### Worker gate

Run fast focused validation for the worker's scope.

### Ticket integration gate

Run the full applicable ticket suite from a clean integration candidate.

### Release gate

Before `release-x-y-z -> main`, run release-wide verification.

As applicable include full integration, critical E2E/smoke, production build/package, browser/device/OS matrix, migration rehearsal, signing/notarization, deployment/IaC plans, etc.

If validation is interrupted, partial green is not a full pass. Bind results to a code snapshot and do not reuse stale success after code changes.

Use coverage where it is a meaningful project-specific signal; do not blindly enforce one universal threshold.

False greens are prohibited: skipped tests, `.only`, ignored exit codes, `|| true`, blanket suppressions, disabled CI, and similar bypasses.

---

## 24. GitHub Actions / CI

Use GitHub Actions by default for CI/CD.

At initialization inspect current official GitHub Actions guidance and framework/runtime official CI examples.

Consider:

- first-party setup actions
- dependency/toolchain caches
- matrix testing
- service containers
- browser/device dependencies
- artifact/report upload
- code scanning / dependency review
- concurrency / cancellation
- least-privilege permissions
- secrets handling
- action pinning policy
- trusted/untrusted PR behavior

Prefer thin workflows that invoke project-local deterministic commands rather than hiding extensive validation logic only in CI YAML.

---

## 25. Security maintenance

Continuously track framework/runtime/SDK/dependency security information against versions actually used by the project.

Source priority:

1. official framework/runtime/SDK security advisories
2. official release/security announcements
3. ecosystem official advisory source
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary sources

Prioritize not only by severity, but exploitability, project reachability, external exposure, required privilege, impact, fix availability, workaround quality, regression risk, and release timing.

Convert meaningful advisories into GitHub Issues and assign a target release. A critical exposed vulnerability may justify interrupting the current sprint for a patch release.

When appropriate add/repair dependency review, code scanning, secret scanning, container scanning, SBOM, or equivalent controls.

---

## 26. Reviewer separation

When possible, do not finish solely with implementer self-review.

Reviewers start from a clean integration candidate and inspect at least requested scope completeness, decision-precedence consistency, correctness, architecture consistency, regression risk, test adequacy, required verification level, validation evidence, hidden coupling, runtime reproducibility, target-release consistency, and recovery/checkpoint consistency where relevant.

---

## 27. Onboarding / repository-controlled knowledge

A fresh contributor or fresh agent must be able to start development and recover work without chat history/private memory.

Repository-controlled docs should lead to at least:

- project purpose / scope
- architecture / dependency direction / data flow / trust boundaries
- bootstrap / run / migrate / seed
- worker/integration/release validation
- Issue / release branch / ticket branch / Draft PR workflow
- decision precedence
- ADRs / design / Agent Skills
- troubleshooting
- release/security/recovery workflow

Use progressive disclosure across README, CONTRIBUTING, `docs/architecture.md`, `docs/development.md`, `docs/troubleshooting.md`, `docs/release.md`, `docs/security.md`, etc. according to project size.

Use Mermaid or similar diagrams when they improve architecture/data-flow/trust-boundary understanding.

Validate documented commands in a fresh sandbox/CI where practical.

Update related documentation in the same ticket when architecture/runtime/workflow changes.

---

## 28. Source / documentation / GitHub language

### Source code

Use English for filenames, identifiers, comments, developer-facing logs, config identifiers, etc. Localization resources are exempt.

### Commits

Use English commit messages:

`<work-prefix>: <extremely concise title>`

### Internal documentation

Use Japanese.

### GitHub Issue / Pull Request

Use Japanese for Issue title/body, PR title/body, and review discussion.

Branch names carry only Issue numbers or release versions, not descriptions.

---

## 29. Package / search / scripts / secrets / temporary policy

For JavaScript/TypeScript, prefer Bun unless there is a concrete incompatibility.

Use `rg` / `rg --files` for text search.

Do not add new `.py` scripts for automation, generation, migration, validation, build/test support, or temporary analysis. Use the project's appropriate language, TypeScript/JavaScript, shell, PowerShell, etc.

Actual dotenv files allowed:

- `.env`
- `.env.development`
- `.env.production`

Git-ignore them.

Committed examples:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

Do not place secrets in snapshots, checkpoints, commits, logs, or agent results.

Keep temporary artifacts under `.tmp/` and external reference repositories under `.reference/`, both ignored by Git.

Use `Containerfile` by default for new container definitions.

---

## 30. Recovery testing / context handoff / initialization completion

### Context handoff

Treat approaching context limits as a planned handoff event, not an unexpected failure.

Before running out of context, externalize:

- current objective
- accepted decisions
- relevant refs/files
- completed work
- current diff/checkpoint
- pending work
- validation state
- active children
- external side effects
- blockers

Store reproducible operational state, not long conversational summaries or private reasoning.

### Recovery drill

Where practical periodically:

1. checkpoint ticket work
2. intentionally stop the agent/sandbox
3. recover from a fresh agent/sandbox
4. reconstruct branch/children/validation/side-effect journal
5. continue without duplicate mutation

### Initialization completion criteria

Verify at least:

- fresh clone discovers project-local instructions
- environment is reproducible
- hidden host state is minimized across macOS/Apple Silicon and Windows+WSL/Linux
- multiple implementation workers can run without runtime/port/state collision
- parent -> child immutable snapshots and child -> parent immutable results are supported
- `main` = released state, `release-x-y-z` = sprint integration, ticket branch = Issue number only
- Issues/PRs are Japanese; commits/source code are English
- decision precedence and user-escalation boundaries are explicit
- unit/smoke/integration/contract/E2E responsibilities and required-verification policy are explicit
- a stack-aware quality profile and deterministic validation entry points exist
- framework/runtime security-advisory intake/prioritization exists
- fresh-contributor/new-agent documentation exists
- after session/context loss, a fresh agent can recover the task from Issue/PR/Git/checkpoint state
- a hard-checkpoint boundary exists for provider/sandbox loss
- execution generation/fencing prevents duplicate continuation
- child state/results remain discoverable after parent loss
- side-effect journaling/idempotency prevents ambiguous retries
- partial/stale validation is not reused as a full pass
- secrets do not leak into repository/checkpoints/results
- README / AGENTS / Skills / ADRs do not conflict

Finally report the project-local configuration created/changed, selected Supervisor/runtime, release workflow, parallelization model, quality/security/recovery profiles, validation results, and remaining constraints.
