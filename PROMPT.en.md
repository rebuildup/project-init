# Project Initialization Policy for Parallel Multi-Agent Development

Initialize or reconcile the AI coding-agent environment for this repository.

This meta-prompt is intended to replace or strengthen a generic `/init`. Inspect the actual repository, technology stack, architecture, runtime, testing, quality, security, CI/CD, GitHub workflow, and documentation, then build a **project-local development environment where multiple AI agents can work safely in isolated environments and integrate deterministically into version-oriented release sprints**.

Do not load this entire document for every normal task. Read it only during first initialization or when reconstructing project-local Agent Skills, adapters, runtime, quality, or governance policy.

Do not copy this entire document into `AGENTS.md` or `CLAUDE.md`.

Core model:

> **Git is the canonical source-state SoT + GitHub Issues / Projects are the work-state SoT + 1 implementation worker = 1 isolated mutable runtime + parent/child delegation uses immutable snapshots/results + a Supervisor controls agent lifecycle + each sprint is a target release version + project-specific quality/security/governance profiles are compiled from current official guidance + project knowledge is persisted in repository-controlled documentation + progressive disclosure + maximum logically safe parallelism**

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

Git worktrees are not forbidden. They may be an implementation detail inside an already isolated sandbox, but a worktree alone does not isolate ports, processes, databases, or other runtime state.

---

## 2. `/init` is idempotent reconciliation

Do not assume initialization runs only once.

Inspect current state first and change only the delta to the desired state.

Inspect at least:

- root agent instructions
- Agent Skills / adapters
- plugin / MCP / ACP / protocol settings
- runtime / sandbox / devcontainer / Containerfile / Nix
- Supervisor integration
- language/framework/runtime/SDK versions
- manifests / lockfiles / workspace structure
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

No change is a valid successful result when the project is already correct.

---

## 3. Make Sources of Truth explicit

Canonical state should include at least:

1. canonical Git remote
2. released ref: `main` or project-defined equivalent
3. active release ref: `release-x-y-z`
4. repository-controlled environment definition
5. GitHub Issue / Project work state
6. project-wide policy / architecture / design / specification / ADR
7. repository-controlled operational documentation / Agent Skills

State model:

- released code/config/design: `main`
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues / Projects
- ticket review/integration: Pull Requests
- transient execution: Supervisor

Each ticket/worker must be able to track a `base_sha` or immutable input snapshot.

Do not make a local directory or unrecoverable Supervisor-local DB the only SoT.

---

## 4. Engineering decision precedence

Use this order for engineering decisions:

1. **project-wide policy / canonical architecture / invariants**
2. **design / specification / explicit task instruction**
3. **coherent existing implementation majority**
4. **current official framework/runtime/SDK guidance**
5. established ecosystem convention
6. local best judgment

Within the same level, prefer the more specific and newer canonical source.

Existing implementation is important evidence, but legacy or migration-in-progress code must not override newer canonical policy/design.

When inferring conventions, inspect multiple implementations with the same responsibility and exclude generated/vendor/example code and obsolete migration patterns. Do not treat the first file found as the project convention.

### Do not escalate self-evident decisions

Decide and continue when:

- precedence yields a unique or practically unique answer
- the choice is local and reversible
- acceptance criteria do not change
- no new public/external contract is established
- security/privacy/cost/release scope is not materially changed

Examples include naming/placement dictated by project convention, module placement dictated by canonical architecture, formatter output, test location matching the project test structure, and obvious lint/type fixes.

Do not ask the user “A or B?” when project evidence already answers it.

### Escalate only genuine decisions

Ask the user only when a real decision remains, such as:

- canonical sources conflict and product semantics change
- acceptance criteria have multiple user-visible interpretations
- irreversible/destructive operation
- public/external API contract decision
- security/privacy/compliance risk acceptance
- meaningful cost increase
- release scope/date change
- explicit design-first approval gate

Research all resolvable facts first; then present options, impact, and a recommendation.

---

## 5. Agent architecture

Default structure:

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

### Root Coordinator

Responsibilities:

- user request / acceptance criteria
- target release / release date
- dependency graph / Issue decomposition
- delegation / integration ordering
- consequential decisions
- final verification / synthesis

Do not concentrate bulk mechanical implementation in the Coordinator.

### Agent Supervisor

Responsibilities:

- sandbox create/destroy/suspend
- workspace snapshots
- agent spawn/wait/cancel
- agent/model adapter selection
- resource/cost/WIP/recursion budgets
- credential injection
- Git result collection/integration
- logs/status/preview routing

Do not give workers host Docker sockets, root-equivalent capability, or master cloud credentials merely to create child sandboxes.

---

## 6. Make subagent spawning a first-class capability

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

Models should not need provider-specific Docker/VM commands.

Spawn requests may include:

- Issue / internal task reference
- objective / acceptance criteria
- role
- immutable input snapshot
- allowed tools
- filesystem/network policy
- budget / timeout / maximum depth
- expected result format

Prevent fork bombs and unbounded cost.

---

## 7. Subagent modes and immutable transfer

Distinguish at least:

### Research

Repository exploration, external research, architecture investigation. Read-only by default.

### Worker

Implementation, refactoring, tests, migrations, generation, runtime verification. Must use an independent mutable environment.

### Reviewer

Code, architecture, correctness, test adequacy, and integration review. Start from a clean snapshot, not the implementer's dirty workspace.

### Parent -> Child

When a parent has unintegrated changes, create an immutable checkpoint before spawning a child.

Possible mechanisms:

- ephemeral Git commit
- immutable Git ref
- filesystem/container snapshot
- content-addressed workspace snapshot

It must be identifiable, reproducible, stable after spawn, and related to the returned result.

### Child -> Parent

Children must not directly edit the parent workspace.

Result shape may include:

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

The Coordinator/Supervisor inspects, integrates, rejects, or requests revision.

---

## 8. Execution-environment isolation

Isolate at least:

- checkout / writable workspace
- process boundary
- network namespace or port mapping
- database state
- Redis/cache/queue state
- application-local state
- test artifacts
- mutable build output

Internal ports may be reused across sandboxes.

Good candidates for sharing:

- read-only base images
- immutable Nix store
- package-download caches
- Cargo registry cache
- OCI layers
- read-only toolchain cache

Do not share:

- writable application DBs
- concurrently mutated dependency/build directories
- generated runtime files
- Git index / working tree
- host Docker socket
- shared dev-server process

Share immutable/cacheable state; isolate mutable state.

---

## 9. Runtime / host / provider portability

Do not mandate a specific vendor.

First-class local targets:

- macOS / Apple Silicon
- Windows 11 + WSL2 / WSL Containers
- Linux / NixOS
- remote Linux sandboxes

For portable web/backend work, reuse the same Linux-oriented sandbox definition where practical and hide host differences behind the Supervisor/runtime adapter.

Treat Apple Silicon `arm64` as first-class and validate relevant differences from x86_64 CI/remote environments.

WSL itself is not worker isolation. For high-frequency Linux builds/watchers, prefer the WSL Linux filesystem over Windows-mounted paths.

Do not require Docker Desktop.

Provider categories may include local containers, Dagger-like runtimes, devcontainer-compatible runtimes, lightweight VMs, SSH/devboxes, on-demand remote sandboxes, or native cloud-agent machines.

Target:

```text
same repository + same environment specification
    -> macOS local sandbox
    -> WSL/Linux local sandbox
    -> CI
    -> remote sandbox
```

---

## 10. Project-local progressive disclosure

AI-agent configuration is project-local by default.

Do not make global plugin/config, home-directory project rules, implicit persistent memory, or undocumented machine state the project truth.

Keep root agent instructions as a dispatcher.

Root should contain only:

- project identity / boundaries
- source/work SoT
- active release rule
- decision-precedence pointer
- environment bootstrap
- Supervisor/subagent entry point
- validation entry point
- language policy
- Skill discovery

Default Skill candidates:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `quality-gate`
- `engineering-decisions`
- `security-maintenance`
- `onboarding`

Normal tasks should read only the Skills they need, not this full prompt.

---

## 11. Release sprint / GitHub workflow

Development uses target-version release sprints centered on GitHub Issues.

Default branch hierarchy:

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

Create it from `main` when the sprint starts.

### GitHub Issues

Substantial independently plan-able/reviewable work should normally be an Issue.

Issue title/body are Japanese by default.

Where useful include objective/outcome, acceptance criteria, scope/non-scope, dependencies, priority/size, area/component, target version, and release date.

Short-lived nested subtasks may remain Supervisor tasks.

### GitHub Projects / Kanban

Minimum status model:

`Backlog -> Ready -> In Progress -> In Review -> Done`

Suggested fields:

- Priority
- Size
- Target Version
- Area / Component
- Blocked / dependency

Bound WIP by real capacity.

---

## 12. Ticket branch / Draft PR / release integration

Use one durable ticket branch per top-level Issue.

Branch name:

`<issue-number>`

Do not add `issue/`, slugs, titles, or work types. Descriptions belong in Issues/PRs.

After a meaningful first commit, open a Draft PR from the ticket branch to its target `release-x-y-z` branch as early as practical.

PR title/body/review discussion are Japanese by default.

Draft -> Ready requires:

- acceptance criteria implemented
- required ticket verification passed
- blockers resolved or explicitly out of scope
- PR description matches current implementation
- staleness/conflicts against release branch handled

Ticket Done requires required checks green, blocking review resolved, PR merged into target release branch, Issue closed, and Project status Done.

After the release branch passes its full release gate, create:

`release-x-y-z -> main`

The release PR should summarize release goal, included Issues/PRs, breaking changes, migrations, full validation result, known limitations, and version metadata.

---

## 13. Task graph and maximum safe parallelism

Decompose non-trivial Issues into a dependency graph.

Run Ready dependency-cleared nodes concurrently within real resource/rate/quota/WIP/cost limits.

Do not serialize work merely because isolated tasks touch the same file. However, incompatible changes to the same interface, the same generated artifact, or the same external mutable resource require dependency ordering or stronger isolation.

---

## 14. Architecture / design / ADR

Inspect existing code first. When deciding or changing architecture, verify current official guidance for the relevant platform/framework/SDK.

Priority:

1. current official recommended architecture
2. official reference implementation/convention
3. project-wide canonical architecture/design
4. coherent existing architecture
5. ecosystem convention
6. custom architecture

Do not invent official guidance in intentionally unopinionated areas.

### Design-first

When a design/spec exists:

1. read current design
2. identify required design changes
3. obtain user approval if project policy explicitly requires it
4. update design
5. implement

Persist significant decisions in ADRs. Do not use design docs as chronological diaries.

---

## 15. Adaptive quality-profile compiler

Quality is not one fixed check list.

During initialization detect:

- languages / frameworks / SDKs / versions
- app type / workspace structure
- architecture boundaries
- persistence / queue / cache / external services
- auth/network/filesystem boundaries
- existing test/lint/type/build config
- browser / OS / CPU architecture targets
- release/deploy target

Then review current official documentation matching the actual versions.

Priority:

1. framework/runtime/SDK official quality/testing guidance
2. official examples/templates/starters
3. official first-party Actions / CI examples
4. official language/toolchain guidance
5. coherent existing configuration
6. maintained ecosystem tooling
7. custom tooling

Do not stop at recommendations. Add/repair when needed:

- formatter / lint / static analysis
- compiler / type check
- test infrastructure
- framework/platform-specific checks
- schema/migration validation
- browser/device/OS matrices
- build/package checks
- specialized project-local Skills
- `.github/workflows/*`
- required CI checks

Expose a small stable set of project-local validation entry points where practical, such as:

```text
validate:fast
validate:integration
validate:release
```

Use project conventions for actual command names.

---

## 16. Verification taxonomy

Distinguish at least these responsibilities.

### Unit test

Fast local behavior of a small logic/component/module with external boundaries minimized.

### Smoke / connectivity test

Cheaply verifies that the system/service starts, major boundaries connect, and the entry to a critical path works.

Examples:

- startup
- health/readiness
- app -> DB/cache/queue
- frontend -> basic API request
- required migration/schema availability
- desktop/mobile/package launch

### Integration test

Combines multiple real components/boundaries and verifies interface/data-flow/transaction behavior.

Do not report a mock-only boundary test as a real integration test.

### Contract / schema test

Use when API/event/DB/generated interface compatibility matters: OpenAPI, GraphQL, protobuf, DB schema, event schema, generated clients/servers, etc.

### E2E / system test

Verifies user-visible or system-level critical flows through production-like boundaries.

### Manual / visual verification

Use only as an explicit gate where automation is insufficient, such as UI/UX, native platforms, or hardware. Record procedure, expected result, and artifacts.

---

## 17. Select verification gates from change risk

Do not run every test level for every ticket mechanically.

Typical defaults:

| Change | Minimum verification candidate |
| --- | --- |
| pure/domain logic | unit |
| API/service behavior | unit + integration |
| DB/schema/migration | integration + schema/migration + smoke |
| runtime/env/DI/network | smoke + relevant integration |
| frontend local component | unit/component |
| user journey/auth/navigation | integration/contract + E2E |
| external API adapter | unit + contract/integration + failure path |
| build/package/container | build/package + smoke |
| security fix | regression + vulnerable-path verification + applicable integration/E2E |
| release | full applicable integration + critical E2E/smoke + release checks |

Compile the actual profile from framework official guidance and project architecture.

Gate layers:

- worker gate: focused fast feedback
- ticket integration gate: full applicable validation for `<issue-number> -> release-x-y-z`
- release gate: release-wide verification before `release-x-y-z -> main`

Use coverage where meaningful as a project-specific signal; do not treat one universal threshold as a universal quality rule.

False green is prohibited: skipped tests, `.only`, blanket suppression, ignored exit codes, `|| true`, reporting mock-only tests as real integration, claiming unperformed manual checks, or manipulating coverage.

---

## 18. GitHub Actions / CI

For projects using GitHub Actions, align local and CI gate semantics.

During initialization inspect current official GitHub Actions guidance and framework/runtime official CI examples.

Consider:

- first-party setup actions
- dependency/toolchain cache
- matrix testing
- service containers
- browser/device dependencies
- artifact/report upload
- code/dependency/security checks
- concurrency/cancellation
- least-privilege permissions
- secrets handling
- action version/pinning
- trusted/untrusted PR behavior

Do not add Actions for their own sake. Prefer CI that invokes project-local deterministic validation commands instead of hiding validation logic only in YAML.

---

## 19. Security maintenance

Continuously collect security information for the actual framework/runtime/SDK/dependency versions and prioritize it by project impact.

Source priority:

1. official framework/runtime/SDK security advisories
2. official release/security announcements
3. ecosystem official advisory sources
4. GitHub Security Advisories / dependency alerts
5. maintainer patch information
6. trusted secondary sources

Security inventory should cover direct dependencies, security-sensitive transitive dependencies, framework/runtime/SDK versions, container/base images, relevant OS/runtime packages, build/deploy toolchain, externally exposed services/endpoints, and auth/session/crypto/storage/network boundaries.

Priority considers:

- exploitability / exploit maturity
- project reachability
- external exposure
- pre-auth reachability
- confidentiality/integrity/availability impact
- required privilege
- affected scope
- fix availability
- workaround quality
- regression/migration risk
- release timing

Conceptual priority:

- P0/Critical: active exploitation or directly exposed; immediate response / patch-release candidate
- P1/High: reachable with major impact and a fix; current-release blocking candidate
- P2/Medium: conditional reachability or limited impact; plan into a near release
- P3/Low: non-reachable/defense-in-depth; maintenance work

Turn meaningful advisories into GitHub Issues and assign target releases.

Where useful, add/repair dependency vulnerability scans, dependency review, code scanning/SAST, secret scanning, container scanning, SBOM generation, etc.

Do not make uncontrolled false-positive noise blocking by default.

---

## 20. Onboarding / project knowledge

Initialization is incomplete unless a fresh contributor/new agent can work without chat history, private memory, or oral explanation.

They should be able to:

1. understand project purpose/scope
2. understand architecture/major boundaries
3. bootstrap the local environment
4. start the app/services
5. run validation
6. select an Issue/create a ticket branch
7. open a Draft PR to the target release branch
8. discover policy/design/ADRs/Skills
9. troubleshoot common failures
10. understand release/security workflows

Use progressive documentation appropriate to project size, such as:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/troubleshooting.md`
- `docs/release.md`
- `docs/security.md`
- ADR/design/Skill directories

Where useful, visualize major components, dependency direction, data flow, external systems, persistence, trust/security boundaries, and runtime/deploy boundaries with Mermaid or an equivalent repository-friendly format.

Where practical, execute documented commands in fresh sandboxes/CI. Do not accept “the README says it works” when a fresh clone cannot run it.

Update docs in the same ticket when bootstrap/run/validation commands, architecture, framework/runtime, host support, release workflow, or security workflow changes.

---

## 21. Tool / Skill / plugin selection

Research the current ecosystem during initialization.

Priority:

1. existing deterministic project CLI
2. framework/runtime official tooling
3. project-local Skill
4. native agent capability
5. first-party integration
6. plugin/MCP only when clearly superior

Evaluate necessity, reproducibility, maintenance, security, license, context cost, cross-platform support, and version pinning.

Do not introduce overlapping tools without a reason.

---

## 22. Package / search / script policy

For JavaScript/TypeScript, use Bun by default unless there is a concrete incompatibility.

Use `rg` / `rg --files` for text search.

Do not add new `.py` scripts for automation, generation, migration, validation, build/test support, or temporary analysis.

Prefer TypeScript/JavaScript, shell, PowerShell, or the project's appropriate non-Python language.

If an existing project consistently uses another package manager/toolchain, investigate the real benefit before migrating it.

---

## 23. Dependency / naming policy

Keep dependencies minimal and prefer latest stable compatible versions.

For new dependencies check whether platform/native/existing dependencies already solve the problem, maintenance state, transitive cost, license compatibility, and security/remote behavior.

Names should express responsibility in path context. Avoid dumping-ground names such as `utils`, `helpers`, `common`, `misc`, or `manager` when a clear responsibility exists.

---

## 24. Environment / secret policy

Allowed actual dotenv files:

- `.env`
- `.env.development`
- `.env.production`

Git-ignore them.

Committed examples may include:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

Do not place secret values in snapshots, commits, logs, agent results, or caches.

The Supervisor/runtime injects only the minimum required secrets into sandboxes.

---

## 25. Temporary / reference / container / CI artifacts

Put temporary artifacts under root `.tmp/` and Git-ignore it.

Put external reference repositories under `.reference/` and Git-ignore it.

Reference content is non-authoritative evidence.

Use `Containerfile` by default for new container definitions.

Use GitHub Actions by default for CI/CD and verify reproducibility from a clean checkout.

---

## 26. Reviewer separation / autonomous loop

Where practical, do not finish with implementer self-review alone.

A Reviewer on a clean integration candidate checks:

- requested scope completeness
- correctness
- architecture consistency
- regression risk
- required verification level
- test adequacy
- security impact
- validation evidence
- hidden coupling
- runtime reproducibility
- target-release alignment

For non-trivial work run:

`inspect -> resolve decision context -> plan release -> ticketize -> decompose -> snapshot -> delegate/implement -> verify worker -> integrate ticket -> verify integration -> review -> update board -> verify release -> replan -> continue`

Do not finish merely because compilation succeeds, one unit test passes, or the first implementation looks plausible.

Do not silently reduce requested scope to an MVP.

---

## 27. Explicit anti-patterns

Do not make these normal behavior:

- multiple agents editing one working tree/branch concurrently
- treating a worktree as runtime isolation
- shared writable DB/cache/dev server
- implicit parent dirty-filesystem sharing
- worker access to host Docker socket/root-equivalent credentials
- ticket PRs targeting `main` directly
- long slugs/titles in branch names
- asking users about implementation choices already resolved by project evidence
- treating the first implementation found as convention
- claiming unit tests prove integration/smoke behavior
- calling mock-only tests real integration tests
- claiming manual verification that was not performed
- prioritizing vulnerabilities only by CVSS/severity
- blocking generic security alerts without project-reachability analysis
- generating setup docs without verifying them
- making hidden chat memory the only project-knowledge source
- treating stale official guidance as current
- blanket ignore/suppression to make quality gates green

---

## 28. What initialization should create/reconcile

Create only what the actual project needs.

### Always-on contract

- concise root `AGENTS.md` or equivalent
- source/work SoT
- active-release rule
- decision-precedence pointer
- bootstrap / Supervisor / validation / Skill discovery

### Standard operational Skills

- parallel orchestration
- sandbox runtime
- GitHub delivery
- quality gate
- engineering decisions
- security maintenance
- onboarding

Use thin agent-specific adapters from canonical sources.

### Quality / CI

- project-specific verification taxonomy
- change-risk -> required-verification mapping
- worker / integration / release commands
- test/lint/type/build/security tooling
- GitHub Actions / required checks

### Runtime

- declarative environment definition
- dependency/tool versions
- sandbox bootstrap
- service/migration/seed bootstrap
- preview routing

### Documentation

- README entry point
- contribution/development workflow
- architecture/data-flow/trust-boundary guide when useful
- troubleshooting
- release/security docs when applicable
- ADR/design index

### Durable decisions/workflow

- relevant ADRs
- GitHub Issue/Project fields
- release-branch convention
- number-only ticket branch
- Draft PR workflow
- vulnerability Issue/release policy

Do not introduce frameworks/plugins/custom orchestrators merely to satisfy formality.

---

## 29. Initialization completion criteria

Before reporting completion, verify at least:

- a fresh clone can discover project-local instructions
- a fresh contributor can bootstrap/run/validate without hidden context
- decision precedence is discoverable from root instructions/Skills/docs
- self-evident decisions resolved by project evidence are not user-escalation cases
- environment strategy is reproducible across macOS/Apple Silicon and Windows+WSL/Linux
- at least two implementation workers can run without runtime/port/state collisions by design
- parent -> child immutable snapshots and child -> parent immutable results are supported
- `main` is released state
- sprint maps to target semantic version
- release branch follows `release-x-y-z`
- ticket branch is Issue number only
- ticket PR targets release branch; release PR targets `main`
- project-specific quality profile reflects current official guidance for actual versions
- unit/smoke/integration/contract/E2E responsibilities and required-verification mapping are defined
- local validation and CI semantics align
- required Actions/Skills/tooling were implemented, not merely recommended
- security advisory source/priority/Issue workflow is defined
- relevant security automation matches project risk
- onboarding/architecture/development docs match a fresh environment
- Issues/PRs are Japanese; commits/source code are English
- secrets do not leak into repository/log/cache/results
- README/root instructions/Skills/ADRs/design do not conflict
- loss of a provider does not destroy canonical Git/GitHub/documented project state

Finally report the generated/changed configuration, chosen runtime/Supervisor, release workflow, verification profile, security profile, onboarding docs, validation results, and remaining constraints concisely.
