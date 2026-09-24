# Project Initialization Policy for Parallel Multi-Agent Development

Initialize or reconcile the AI coding-agent environment for this repository.

This meta-prompt is intended to replace or strengthen a generic `/init`. Inspect the actual repository, technology stack, architecture, runtime, testing, quality, security, CI/CD, delivery, and documentation, then build a **project-local development organization whose highest authority is a tool/provider-independent Constitution, allowing humans and AI agents to optimize the whole project within those constraints rather than mechanically preserving one procedure**.

Do not load this entire document for every normal task. Read it only during first initialization or when reconstructing project-local Agent Skills, adapters, runtime, quality, governance, or recovery policy.

Do not copy this entire document into `AGENTS.md` or `CLAUDE.md`.

Core model:

> **Identity Integrity + Authority Integrity + Evidence Integrity + Mutable Ownership Safety + Organizational Continuity + Canonical Consistency + Progress form the highest-level Constitution. Current Git / GitHub / Linear / release-branch / Worktrunk / mise / Supervisor / Skill choices are an Operating Model and Practices that implement the Constitution and may be replaced by mechanisms with equivalent or stronger guarantees. Optimize the whole project subject to the Constitution and explicit decisions; procedure compliance is not an objective by itself.**

The current default operating profile is defined in `organization/profiles/release-driven-solo.md`. Existing weekly release sprint / GitHub delivery / Linear / Worktrunk / mise behavior remains the current default, but it is not itself constitutional correctness.

---

## 1. Constitution and current operating profile

Treat `constitution/CONSTITUTION.md` as the highest-level contract.

- Do not silently substitute task / attempt / artifact / evidence / decision / authority identities.
- Do not commit a consequential decision on behalf of an actor that lacks authority for it.
- Do not represent stale, partial, unrelated, or unverifiable evidence as current proof.
- Do not create uncoordinated concurrent ownership of the same mutable state.
- Do not make one ephemeral actor/session/runtime/provider the sole holder of consequential organizational state.
- Do not maintain conflicting canonical authorities for the same fact without an explicit reconciliation rule.
- Do not preserve safety by permanently preventing valid work from progressing.
- Allow deviation from a current default when an alternative provides equivalent or stronger higher-level guarantees.

### Current release-driven defaults

The following rules are the current Operating Model / Practices. They implement the Constitution; tool names and procedures are not objectives in themselves unless an explicit project decision makes them so.

- Do not treat a Git working tree as the execution-isolation boundary.
- Give every implementation worker an independent mutable runtime.
- Do not share mutable DB/cache/queue/process/generated state between workers.
- Parent -> child uses an immutable snapshot; child -> parent uses an immutable result.
- The Supervisor outside workers manages sandbox lifecycle.
- `main` represents released/integrated source state.
- Where GitHub protection capabilities are available, protect `main` with branch protection/rulesets and normally prohibit direct push, direct web edits, force pushes, and deletion.
- The canonical delivery path to `main` is only the current `release-x-y-z -> main`. If protection/rulesets cannot constrain PR head branches, do not invent a required status check; the merge executor / release automation must reject non-current-release sources.
- GitHub Pull Request landing uses merge commits only. Do not use squash merge or rebase merge. Standard repository settings are `allow_merge_commit=true`, `allow_squash_merge=false`, and `allow_rebase_merge=false`, and merge executors explicitly select `merge`.
- A normal sprint lasts one week and is represented by `release-<major>-<minor>-<patch>`.
- One week is a planning cadence, not a duration guarantee. For medium/long-term release, roadmap, or milestone estimates, use the `agent-delivery-estimation` Skill with Work Units, dependencies, observed throughput, human/CI/external waits, and usage limits; do not use the agent's subjective day/month estimate as evidence.
- Durable tickets and implementation/dependency state live in GitHub Issues. Linear is the standard release planning / health / portfolio control plane; GitHub Projects are not part of the standard workflow.
- The Issue dependency graph is the canonical dependency SoT. Do not manage dependency only through Git branch topology.
- Ticket branch names contain only the Issue number.
- One top-level Issue normally maps to one durable ticket branch and one ticket PR.
- Independent ticket PRs target the release branch. A same-release linear hard dependency may instead use the immediate predecessor ticket branch as the dependent PR base.
- Treat durable ticket branch creation -> first meaningful commit -> canonical remote publication -> remote head SHA verification -> immediate Draft PR as one start procedure. Do not continue active implementation without the published remote head and Draft PR.
- The publish + Draft PR rule applies equally to humans, Coordinators, workers, and subagents.
- At PR creation, correctly set and maintain linked Issue, assignee, reviewer/CODEOWNERS, repository-established labels, target release, stack context, and validation state where applicable.
- A stacked ticket is not Done after an intermediate predecessor-branch merge; its changes must land on the target release trunk, and the GitHub Issue must be explicitly closed. Linear does not mirror ticket status; Linear Project Completed/Doneness is reconciled only at release level.
- A zero-diff release branch is the only Draft-release-PR exception. After its first meaningful integrated difference, the release branch must have a Draft release PR.
- Bind validation results to the validated SHA/snapshot. Never reuse old green results for a different SHA after stack rebase/update.
- Quality gates are compiled per project rather than using one fixed bundle.
- Required verification levels are selected from change surface/risk.
- Continuously triage framework/runtime security information.
- For unknown source-code security defects, use `security-audit` to make principal / trust-boundary / entry-surface / attack-class coverage explicit, and confirm a finding only after a fresh verifier independent from the hunter has tried to refute it.
- For application/service secret values, use Infisical as the current default SoT unless encrypted secret-in-Git is an explicit requirement. The current default control plane is self-hosted `https://secrets.rebuildup.dev` (API: `https://secrets.rebuildup.dev/api`). Keep the secret schema / required keys / non-secret metadata repository-controlled, and keep the current-default provider endpoint plus applicable project ID / environment/path mapping discoverable in repository-controlled metadata. Prefer CLI-first runtime injection, make wrappers/CI select the endpoint explicitly rather than silently falling back to managed Infisical Cloud, and use OIDC + scoped Machine Identities on the self-hosted control plane for GitHub Actions when available. Progressively disclose the provider procedure through the `secrets-management` Skill.
- Persist project knowledge in repository-controlled docs rather than chat/private memory.
- Before creating or modifying persistent reader-facing prose such as README/documentation, ADRs, Issues, Pull Requests, commit messages, code comments, review comments, or release notes, load and apply `writing-discipline`. Do not serialize conversation, investigation, or execution context into persistent artifacts merely because it exists in the current context.
- Keep recovery/handoff operational state out of reader-facing prose and record it through the designated checkpoint/recovery mechanism. A reader-facing artifact is not a recovery journal.
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
- GitHub Actions / CI/CD / project-specific validation
- dependency/security tooling
- README / CONTRIBUTING / docs
- env schema / examples / `.gitignore` / secret-provider configuration / identity scope
- repository visibility
- public-repository `main` branch protection / rulesets / bypass state / release-source policy
- repository PR merge-method settings (`allow_merge_commit` / `allow_squash_merge` / `allow_rebase_merge`)
- GitHub Issues / dependency / PR / stacked PR / release workflow (release planning control plane must declare Linear as the sole plane — never both)
- current errors / warnings
- branch / remote / user uncommitted changes

Behavior:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

Agent Skills are also subject to this stale-state check. The mere presence of an installed Skill is not evidence that it is current. Unless an explicit version pin or freeze exists, inspect the canonical source/upstream current revision or content and update, reinstall, or reconcile the installed copy when it differs. Preserve and reconcile project-local customizations rather than overwriting them blindly. If source, revision, or freshness cannot be verified, do not autonomously conclude that the installed Skill should remain unchanged.

Do not regenerate correct state without reason. No change can be a successful result.

If a public repository lacks the required `main` protection and the initializer has permission, create or repair it during initialization. If permissions are insufficient, report the missing protection as a blocker rather than silently accepting it.

Regardless of repository visibility, inspect PR merge-method settings during initialization. Reconcile to `allow_merge_commit=true`, `allow_squash_merge=false`, and `allow_rebase_merge=false` when permissions allow. If permissions are insufficient, report the mismatch as a blocker or explicit configuration limitation rather than silently accepting method drift.

---

## 3. Make Sources of Truth explicit

Canonical state should be representable by at least:

1. canonical Git remote
2. released ref: `main` or an explicitly equivalent branch
3. active release ref: `release-x-y-z`
4. repository-controlled environment / secret schema + selected secret-value provider state
5. GitHub Issue work + dependency state (canonical SoT)
6. release planning control plane — Linear, declared as the sole plane
7. project-wide policy / architecture / design / specification / ADRs
8. repository-controlled operational documentation / Agent Skills
9. durable recovery checkpoints / immutable worker results

Source/work state:

- released code/config/design: `main`
- application/service secret values: selected secret provider (current default: Infisical). The repository canonically stores schema / required keys / non-secret metadata, not secret values
- active sprint integration: `release-x-y-z`
- ticket/priority/status/version/dependency: GitHub Issues (canonical SoT)
- release planning control plane: Linear, whichever the project declares — not a durable SoT
- ticket review/integration: Pull Requests
- PR ownership/review/classification: assignee / reviewer/CODEOWNERS / labels / PR metadata
- public `main` protection: branch protection/ruleset plus release-source policy when needed
- PR merge method: merge commit only; disable squash merge and rebase merge, and make merge executors explicitly select `merge`
- transient execution: Supervisor

Each ticket/worker should have a traceable `base_sha` or immutable input snapshot.
For stack-ready dependent work, also record the predecessor Issue/PR identity and exact predecessor commit SHA / immutable snapshot.
For durable ticket branches, publish the first meaningful state to the canonical remote and make the remote head SHA and Draft PR identity traceable.

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
- target release / one-week sprint window / release date
- dependency graph / Issue decomposition / stack candidates
- delegation / integration ordering
- PR ownership/reviewer/metadata consistency
- public-repository main-protection / release-only integration consistency
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
- durable branch remote publication / Draft PR lifecycle coordination
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
- target release
- dependency / predecessor Issue or PR
- immutable input snapshot / predecessor snapshot
- immediate PR base
- durable branch identity / expected Draft PR identity when applicable
- assignee / reviewer / label expectations when applicable
- role
- allowed tools
- filesystem/network policy
- budget / timeout / maximum depth
- expected result format
- parent fencing identity / execution generation when the current implementation uses generation-based fencing

If a subagent/worker is allowed to create a durable branch, that authority includes remote publication, Draft PR creation, and metadata maintenance. GitHub must be able to resolve the remote head and the head must differ from its base, so after branch creation the worker must immediately create the first meaningful commit, publish it to the canonical remote, verify that the remote branch head SHA matches that commit SHA, and then immediately create the Draft PR.

If the worker lacks remote-publication or PR-mutation permission, it must hand control back to the Coordinator/Supervisor immediately after the first meaningful commit. The Coordinator/Supervisor must publish the commit, verify the remote head SHA, and create the Draft PR before further implementation continues.

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
target_release
base_snapshot
predecessor_snapshot
fencing_identity_or_execution_generation
attempt_class
result_commit_or_ref
draft_pr_identity
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

### Project toolchain / bootstrap default

In the current release-driven profile, use mise as the default Practice for project-local runtimes and development CLI bootstrap.

- when mise can manage a runtime or development CLI prerequisite usefully, commit a root `mise.toml` as repository-controlled configuration
- use `mise install` as the standard fresh-clone / CI / agent tool bootstrap; when a committed mise lockfile is the reproducibility mechanism, require `mise install --locked`
- do not depend on interactive shell activation for correctness; automation, CI, and agents should normally use `mise exec -- <command>` or `mise run <task>`
- do not use `latest` as the only reproducibility contract for a required tool; use an exact pin, a bounded version request plus a committed mise lockfile, or an ecosystem-native canonical version source
- if a canonical version source such as `rust-toolchain.toml` or package-manager metadata already exists, do not add an independent conflicting mise pin; consume/respect the native source where supported or document authority plus divergence checks
- do not reinterpret compatibility floors such as `engines >=...` as the development version pin
- mise tasks may wrap canonical build/test/lint scripts, but must not duplicate quality-gate or dependency-manager ownership
- for external/untrusted PR checkouts, an agent must not run `mise install`, `mise exec`, or `mise run` against repository-controlled mise configuration/tasks without a documented trust review or a bounded sandbox; prefer `MISE_SAFE=1` for supported inspection-only operations before trust is established, and never treat mise itself as an isolation boundary
- mise does not replace OS packages/system libraries, Nix/NixOS host provisioning, containers/sandboxes, Worktrunk, secret management, or worker isolation
- on a host where mise is unsupported or incompatible, use an explicit fallback with equivalent version/reproducibility guarantees; never silently fall back to arbitrary host-global tools
- mise is a Practice, not a Constitutional invariant, and may be replaced under ADR-0017 refinement when another mechanism preserves or strengthens the guarantees

Do not add empty mise configuration merely for policy compliance when the project has no meaningful runtime or CLI prerequisite for it to manage.

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

Keep the root agent file as a dispatcher containing only broad invariants and pointers, including:

- project identity / boundaries
- source/work SoT
- weekly active release rule
- dependency / remote-publication / Draft PR lifecycle pointer
- public-main-protection pointer when applicable
- decision-precedence pointer
- project toolchain declaration / mise bootstrap
- environment bootstrap
- Supervisor/subagent/recovery entry point
- validation entry point
- language policy
- persistent-prose write boundary: load/apply `writing-discipline` before creating or modifying reader-facing prose, do not unconditionally serialize conversation/investigation/execution scaffolding, and route recovery state to the designated checkpoint mechanism
- Skill discovery

Default Skills:

- `parallel-orchestration`
- `sandbox-runtime`
- `github-delivery`
- `agent-delivery-estimation`
- `quality-gate`
- `engineering-decisions`
- `security-audit`
- `secrets-management`
- `security-maintenance`
- `onboarding`
- `agent-recovery`
- `correctness-assurance` — preconditions for producing correct answers / extraction of invariants and pre/post-conditions / minimal-sufficient assurance mechanism design drawn from types, static analysis, runtime assertion, tests, property/differential testing, formal verification, and review
- `policy-evaluation` — execution profile / cold review / deterministic vs latent eval / context-budget model / policy regression guard
- `design-refinement` — pre-implementation evidence-first design / unknown decomposition / scope-risk adjustment / trade-off documentation
- `writing-discipline` — reader-oriented writing / reconstruction into standalone artifacts decoupled from working context / Select-Compose-Reread pipeline
- `interaction-discipline` — agent ownership / blocker presentation / one-question escalation / tangent defer / persistent prose routing
- `linear-release-control` — Linear as optional release planning / health / portfolio control plane contract (only when adopted)
- `worktree-workflow` — Worktrunk as WSL/Linux worktree operations layer / branch base / port allocation contract

Agent Skills may be discovered and installed with the Skills CLI. Prefer `bunx skills` when Bun is available; Node.js/npm environments can use the same arguments with `npx skills`. Use `bunx skills add <source> --list` to inspect available Skills and `bunx skills add <source>` or `--skill <name>` for project-local installation. Inspect existing project-local `skills/` and repository policy first, evaluate source trust, maintenance, reproducibility, and versioning, and install only the Skills actually needed. When an existing Skill is found, do not skip it merely because it is present; unless it is explicitly pinned or frozen, verify source freshness and reconcile any differences. Do not make `--global` the default.

Normal tasks should load only the Skills they need, not this full prompt.

---

## 11. Weekly release sprint / GitHub workflow

Development uses normal one-week target-version release sprints centered on GitHub Issues.

Independent tickets:

```text
main
└─ release-0-2-0
   ├─ 123
   ├─ 124
   └─ 125
```

Hard-dependency stack:

```text
main
└─ release-0-2-0
   └─ 123
      └─ 124
         └─ 125
```

### Sprint = one week + target release version

A normal sprint lasts **one week**.
One sprint maps 1:1 to one target semantic version and one release integration branch.

This one-week window is a planning cadence, not evidence that the selected scope will finish within one week. When estimating release dates, roadmaps, milestones, capacity, or the benefit of changing agent count, use the `agent-delivery-estimation` Skill. Do not fill material unknowns with arbitrary conservative multipliers; return complete / conditional / unavailable as appropriate.

Release branch:

`release-<major>-<minor>-<patch>`

Create it from `main` at sprint start.

Emergency patches or another explicit release-scope/date decision may use a different duration, but normal planning cadence remains one week. Even emergency fixes use a patch release branch and release PR rather than modifying `main` directly.

### Public repository main protection

Inspect repository visibility. In public repositories, protect `main` with GitHub branch protection or a branch ruleset.

At minimum:

- normally prohibit direct push, direct web edits, force pushes, and deletion
- require a Pull Request to change `main`
- require conversation resolution before merge; use zero required approvals by default and do not configure guessed/fixed required status-check names
- do not make routine admin/automation bypass the normal delivery path
- make `release-x-y-z -> main` the only canonical delivery path to `main`

If branch protection/rulesets cannot constrain the PR head branch pattern, do not invent a required CI/status-check name. The merge executor or release automation must reject `base == main` merges unless the head is the current `release-*` branch.

If required protection is missing and the initializer has permission, create or repair it. If permissions are insufficient, report the unprotected state as a blocker.

### GitHub Issues / dependency SoT

Substantial work that can be independently planned, implemented, and reviewed should normally be an Issue.

Issue title/body are Japanese.

Include purpose, acceptance criteria, scope/non-scope, dependency, priority, size, area/component, target version, release date, and accountable assignee when relevant.

GitHub Issue dependency state is the canonical dependency SoT. Do not encode dependency only through branch parentage. Linear is the release planning / health / portfolio control plane and is not the canonical source of implementation dependency metadata.

Short-lived nested subtasks may remain Supervisor tasks.

### Linear release planning

Manage release goal, target date, health, and portfolio in Linear Projects / Initiatives. Do not create, require, or synchronize GitHub Projects as part of the standard workflow.

Do not fully mirror GitHub Issues into Linear Issues. Limit Linear Issues to release-level coordination such as cross-repository blockers, external dependencies, release decisions, signing/distribution, and other non-code deliverables.

When useful distinguish dependency execution state as:

- `blocked`: no usable prerequisite snapshot exists yet
- `stack-ready`: a reviewable immutable predecessor snapshot exists, so dependent work may start
- `integrated`: the ticket's changes have landed on the target release trunk

---

## 12. Ticket branch / mandatory Draft PR / stacked PR

Create one durable ticket branch for each top-level Issue.

Branch name:

`<issue-number>`

Do not add an `issue/` prefix, slug, title, or work type. Descriptive responsibility belongs in the Issue/PR.

### Branch start contract

**Every active durable ticket branch must have a published remote head and Draft PR.**

GitHub must be able to resolve the remote head and head/base must differ, so the canonical start procedure is:

1. create the durable branch
2. immediately create the first meaningful commit
3. publish that commit to the canonical remote
4. verify the remote branch head SHA equals the first meaningful commit SHA
5. immediately create the Draft PR
6. set Issue linkage / assignee / reviewer/CODEOWNERS / repository-established labels / target release / stack context
7. continue implementation

Do not defer publication/PR creation until implementation completion, and do not keep the first meaningful commit only locally while continuing implementation. This applies to humans, Coordinators, implementation workers, and subagents.

If a worker lacks remote-publication or PR-mutation permission, it must hand off immediately after the first meaningful commit. The Coordinator/Supervisor must publish the commit, verify the remote head SHA, and create the Draft PR before further implementation continues.

### Independent ticket

A ticket with no hard predecessor uses the target release branch as direct base.

`123 -> release-x-y-z`

### Dependency-aware stacked PR

For a real linear hard dependency within the same repository and same target release, a dependent ticket PR may use its immediate predecessor ticket branch as base.

Example:

- `123 -> release-x-y-z`
- `124 -> 123`
- `125 -> 124`

All stack members share the same target release branch as the stack trunk.

Use a stack only when:

- same repository
- same target release
- real hard dependency
- the stacked segment is representable as an ordered chain
- the predecessor has a reviewable immutable commit/snapshot

Do not force a branching dependency DAG into one linear stack. A PR stack is only the execution/integration projection of a linear path in the canonical Issue dependency graph.

Do not use stacking merely to split one Issue into multiple durable PRs.

### Stack-ready execution

A dependent worker may start before predecessor merge if a reviewable immutable predecessor snapshot exists.

Record predecessor Issue/PR identity, exact predecessor SHA/snapshot, common target release, and immediate PR base at start.

If predecessor review changes the downstream branch through rebase/update, rerun all affected required validation for the new SHA. Never reuse old green results.

### PR metadata

At PR creation evaluate and set, where applicable:

- linked Issue
- accountable assignee
- requested reviewer / CODEOWNERS-derived reviewer
- repository-established labels
- acceptance criteria
- implementation summary
- validation results/status
- known blockers/limitations
- target release
- stack trunk / immediate predecessor / successor context

Do not invent labels, request unrelated reviewers, or assign the author as a meaningless self-reviewer just to fill fields. If no meaningful reviewer exists, that fact and the alternate review path (configured review automation, CI, or explicit final review) are recorded in the PR body **only when the reviewer's absence affects review/merge semantics**, not as a routine serialization. Per `github-delivery` / `writing-discipline`, limit such notes to operations-driven necessity.

PR title/body/review discussion are Japanese.

Draft -> Ready requires:

- acceptance criteria implemented
- ticket integration gate passed for the current SHA
- blockers resolved or explicitly out of scope
- PR description / assignee / labels / reviewer metadata match current implementation
- required reviewer requested. Recording the absence of a meaningful reviewer is required only when the absence affects review/merge semantics; limit such notes to operations-driven necessity and avoid unconditionally serializing mutable state per `github-delivery` / `writing-discipline`
- target release or immediate predecessor staleness/conflicts handled
- downstream reconciliation/revalidation completed after predecessor changes
- latest durable checkpoint is consistent with branch state

Ticket Done requires:

- project-specific applicable validation has run for the current landing candidate with no known failure left unresolved
- blocking review / unresolved conversations are cleared
- ticket changes have landed on the target release trunk
- Issue explicitly closed only after successful target-release-trunk landing
- Linear does not mirror ticket status; reconcile Linear only at release level.

For native stacked PRs, only tickets included in a contiguous landing to the target release trunk become Done. In an ordinary nested-PR fallback, an intermediate merge such as `124 -> 123` must not close Issue #124 or mark it Done until #124's changes actually reach `release-x-y-z`.

Do not rely only on closing keywords for non-default-branch integration.

---

## 13. Release integration

Create the release branch at sprint start.

GitHub cannot create a PR while the release branch is identical to `main`, so a zero-diff release branch is the explicit exception to the Draft-release-PR invariant. **Open a Draft release PR immediately after the first meaningful integrated release difference appears**.

Set assignee, reviewer, labels, release goal, and included Issues on the Draft release PR, and keep it as the durable release-level surface throughout the sprint. Validation evidence in the release PR body is handled **conditionally** on the repository's CI posture:

- **Repositories with native CI checks available (GitHub Actions / workflow runs)**: treat native checks as one source of validation evidence and verify that they refer to the current SHA and do not leave known failures unresolved. Do not make CI success or a particular check name a universal ready-to-merge requirement; evaluate the project-specific applicable validation as a whole. Do not make the validated SHA pinned reference or workflow-run status in the PR body a Draft -> Ready / merge-candidate mandatory rule; only transcribe them when a reader genuinely needs the pointer to re-fetch the evidence.
- **Repositories without CI (e.g. policy / docs-only)**: include the validated SHA pinned reference together with the current canonical control reproduction block from the `evals/` controls (re-fetched by a fresh agent / reviewer / CI runner on demand) as the release evidence.

In both cases, follow `writing-discipline` and avoid unconditionally serializing full validation snapshots in the PR body; let the reader re-fetch evidence on demand via the pointer in the body.

After sprint tickets are integrated, run the release gate on the release branch.

Release PR:

`release-x-y-z -> main`

Release PR title/body are Japanese and should summarize release goal, included Issues/PRs, breaking changes, migration notes, (CI-configured repos) an optional pointer to a validated SHA pinned reference and workflow run status when a reader needs to re-fetch the evidence (not a ready-to-merge mandatory rule), (no-CI repos) the validated SHA pinned reference plus the current canonical control reproduction block from `evals/`, known limitations, and version/release metadata.

In public repositories, protected `main` must not be changed through any path other than this release PR.

For every GitHub Pull Request landing in the current release-driven profile, use the merge-commit method. Keep merge commits enabled, disable squash merge and rebase merge, and make Agent/automation merge calls explicitly select `merge`. This restriction applies to PR rebase merge, not to branch-local `git rebase` used for stack maintenance or conflict resolution. If native stack landing cannot preserve merge-commit semantics, use an ordered merge-commit landing path instead.

PR merges that include `release-x-y-z -> main` sit behind the **explicit user authorization boundary** defined by ADR-0012. The default required approving review count is zero; blocking reviews and unresolved conversations must still be cleared. The actual merge authority is held by the **user**. The Agent drives the release forward through release-wide verification and the ready-to-merge state, then **stops at ready-to-merge and reports current state** (head SHA, validation evidence, outstanding review conversations). Do not ask additional questions solely to acquire merge authorization — the user fires the merge authorization explicitly. The Agent only executes the merge when the user has explicitly authorized it. When it does, it explicitly selects the `merge` method and verifies the resulting merge commit.

After merge, `main` represents the released state for that version.

---

## 14. Task graph and maximum safe parallelism

Decompose non-trivial Issues into the canonical dependency graph.

Each node may include:

- objective / acceptance criteria
- prerequisites
- target release
- input snapshot
- predecessor Issue/PR / predecessor snapshot
- immediate PR base
- output contract
- owner role
- branch / remote-publication / Draft PR contract
- integration target
- recovery/checkpoint policy

Run a node within resource/rate/quota/WIP/cost limits when either:

1. it is Ready with no unfinished prerequisite, or
2. it is stack-ready with a reviewable immutable predecessor snapshot even though the predecessor is not merged yet.

Do not serialize work solely because tasks touch the same file. Isolated sandboxes allow independent edits. Add dependencies or additional isolation when tasks incompatibly change the same interface, generated artifact, or external mutable resource.

If stacked delivery cannot be maintained safely, preserve the dependency SoT and fall back to the ordinary serial workflow that waits for predecessor merge.

---

## 15. Autonomous execution loop

For non-trivial tasks run:

`inspect -> design-refinement (only before planning for non-trivial feature / architecture / product design) -> plan weekly release -> ticketize/dependency -> decompose -> snapshot -> create branch + first commit + remote publish + head verify + Draft PR -> delegate/implement -> checkpoint -> verify worker -> reconcile stack -> verify target-release landing -> review -> update PR/board metadata -> verify release -> replan -> continue`

`design-refinement` is **mandatory before any non-trivial feature / architecture / product design reaches `plan weekly release`**. Trivial tasks (mechanical typos, localized bug fixes) may skip it; tasks whose scope touches an interface, data model, or public contract may not. Follow the `design-refinement` Skill: read the relevant repository / ADR / Skills / existing implementation / official guidance, separate facts from unresolved decisions, and only then enter planning.

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

1. GitHub Issue / dependency state (canonical SoT); Linear is the release planning / health / portfolio control plane
2. target release branch
3. ticket branch / remote commit graph
4. Draft/Ready PR / assignee / reviewer / labels / review / CI state
5. stack predecessor / pinned predecessor SHA when applicable
6. committed design / ADR / Skills / docs
7. immutable worker/subagent results
8. structured recovery checkpoints

Native conversation IDs, agent IDs, Supervisor-local DBs, shell history, and IDE state are transient optimizations.

If an active durable ticket branch has no published remote head + Draft PR, treat that as broken delivery state. Reconcile Issue/branch ownership, remote head, intended PR base, and repair the durable PR surface.

A release branch is exempt only while it is zero-diff from `main`. Once the first meaningful integrated difference exists, a missing Draft release PR is broken delivery state and must be repaired.

### Structured recovery checkpoint

Do not persist private chain-of-thought. Persist only externally usable operational state.

Candidate schema:

```text
schema_version
issue_id
target_release
ticket_branch
pr_number
immediate_pr_base
predecessor_issue_or_pr
predecessor_sha
base_sha
checkpoint_sha_or_snapshot
fencing_identity_or_execution_generation
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
- hard checkpoint: provider/sandbox-loss boundary where meaningful code/work state remains reachable from durable remote infrastructure. For durable tickets, the recorded commit must be reachable on the canonical remote and the remote-head identity/Draft PR must be traceable. A release branch needs no Draft release PR only while zero-diff; after its first difference, the Draft release PR must exist.

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

1. identify Issue / PR / target release / dependency
2. fetch ticket/release branch / remote commit graph / stack relation
3. for durable tickets, verify/repair published remote head + Draft PR / metadata; for release branches, verify the zero-diff exception or first-difference Draft release PR
4. read latest valid checkpoint
5. inspect canonical policy/design/decision refs
6. rediscover active children through the Supervisor
7. recreate workspace from checkpoint
8. reevaluate completed/pending validation
9. inspect actual remote state of external side effects
10. check stale base / predecessor / integration conflicts
11. reconstruct the remaining plan
12. run minimal safe verification to trust reconstructed state
13. atomically reacquire or advance the applicable fencing identity and continue

Even after native resume succeeds, reconcile it with branch/PR/checkpoint state before continuing.

---

## 17. Parent/child recovery and split-brain prevention

Child lifecycle belongs to the Supervisor/control plane, not the parent model process.

Do not automatically cancel safe children just because the parent dies.

A recovered parent/coordinator should:

- rediscover children
- verify input snapshot / predecessor snapshot / applicable current fencing identity
- classify running/completed/failed/orphaned
- collect completed immutable results
- reconcile published remote head / Draft PR identity / metadata for durable-branch children
- avoid auto-integrating stale results
- retry/resume/re-spawn where needed

Assume an old agent and a recovered agent can overlap after a network partition or timeout.

Give each task a lease or fencing identity.

- on recovery/reassignment, atomically acquire a new fencing identity from the observed current identity
- if the current implementation uses generation-based fencing, advance `execution_generation` as part of that identity transition
- attach the applicable fencing identity to worker results
- reject branch integration / external writes from stale fencing identities
- do not interpret heartbeat loss as permission to blindly repeat side effects

Do not normally allow multiple fencing identities to push the same ticket branch concurrently.

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
- current GitHub PR / stacked PR / review / branch-protection / ruleset capabilities

Priority:

1. existing deterministic project tools
2. project-local CLI / Skill
3. native agent capabilities
4. project-local adapter / protocol integration
5. plugin / MCP only for a clear benefit

Evaluate need, reproducibility, maintenance, security, license, context cost, cross-platform behavior, and version pinning.

Native GitHub stacked-PR features may be used as an implementation mechanism when available, but policy semantics must not depend on temporary preview-specific behavior.

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

Persist consequential long-lived decisions in ADRs, especially:

- Agent Supervisor
- sandbox runtime/provider
- Git integration / recovery checkpoint model
- execution fencing / side-effect reconciliation
- release/sprint branching model / weekly sprint cadence
- dependency-aware stacked PR model
- durable branch / remote-publication / Draft PR / PR metadata lifecycle
- public-repository main protection / release-only main integration
- environment reproducibility
- architecture migration
- package/toolchain migration
- CI/CD / quality model
- security priority model
- onboarding strategy

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

Do not stop at recommendations. Add/repair formatter, lint/static analysis, compiler/type checking, test infrastructure, GitHub Actions, and specialized Skills when needed. Keep project-specific validation strict, but do not make a fixed required-status-check name part of the default `main` protection baseline; configure one only when the repository has an explicit, real, stable requirement for it.

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

### Stack reconciliation gate

If predecessor changes, rebase, stack push, or equivalent operations change a downstream head SHA, rerun affected required validation for the new SHA.

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
- configured CI/check semantics for stacked PRs / non-default bases
- release-source policy for public-repository PRs with `base == main`

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

Convert meaningful advisories into GitHub Issues and assign a target release. A critical exposed vulnerability may justify interrupting the current sprint for a patch release, but in public repositories do not modify `main` directly; use a patch release branch and release PR.

When appropriate add/repair dependency review, code scanning, secret scanning, container scanning, SBOM, or equivalent controls.

### Active source audit

For projects that require active discovery of unknown security defects, install the `security-audit` Skill and derive coverage units from source-visible principals, trust boundaries, entry surfaces, and applicable attack classes. A hunter never confirms its own candidate: use a fresh verifier, and when a decisive deployment/provider/runtime fact is not source-visible, retain `needs_validation` instead of guessing. Target-controlled audit execution must use bounded local isolation from `sandbox-runtime`; confirmed findings flow through `security-maintenance` for project-aware priority and then through the ordinary Issue / remediation / quality / release workflow.

---

## 26. Reviewer separation

When possible, do not finish solely with implementer self-review.

At PR creation, resolve meaningful reviewers / CODEOWNERS from repository ownership and request them.

If no meaningful separate reviewer exists, do not request the author merely to fill the reviewer field. Record that fact in the PR body together with the alternate review path such as configured review automation, CI, or explicit final review.

Reviewers start from a clean integration candidate and inspect at least:

- requested scope completeness
- decision-precedence consistency
- correctness / architecture consistency
- regression risk
- test adequacy / required verification level
- validation evidence
- hidden coupling
- runtime reproducibility
- target-release / stack-predecessor consistency
- PR metadata / Issue-linkage consistency
- recovery/checkpoint consistency where relevant

---

## 27. Onboarding / repository-controlled knowledge

A fresh contributor or fresh agent must be able to start development and recover work without chat history/private memory.

Repository-controlled docs should lead to at least:

- project purpose / scope
- architecture / dependency direction / data flow / trust boundaries
- bootstrap / run / migrate / seed
- worker/integration/release validation
- one-week sprint / target release / Issue dependency workflow
- ticket branch / first meaningful commit / remote publication / remote-head verification / immediate Draft PR workflow
- PR assignee / reviewer / labels / Issue linkage / stack context
- independent-PR / stacked-PR base rules
- target-release-trunk landing as the stacked-ticket Done boundary
- public-repository main protection / release-only main integration
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
4. reconstruct branch/remote-head/PR/stack/children/validation/side-effect journal
5. verify the zero-diff release-branch Draft-PR exception or the first-difference Draft release PR
6. continue without duplicate mutation

### Initialization completion criteria

Verify at least:

- fresh clone discovers project-local instructions
- environment is reproducible
- hidden host state is minimized across macOS/Apple Silicon and Windows+WSL/Linux
- multiple implementation workers can run without runtime/port/state collision
- parent -> child immutable snapshots and child -> parent immutable results are supported
- `main` = released state, `release-x-y-z` = weekly sprint integration, ticket branch = Issue number only
- public repositories have effective `main` protection/rulesets that prohibit normal direct push/edit and make release PRs the canonical update path
- where protection cannot constrain PR source branches, a release-source policy exists
- repository merge settings are `allow_merge_commit=true`, `allow_squash_merge=false`, and `allow_rebase_merge=false`, and PR landing uses merge commits
- normal sprint cadence = one week, and one sprint = one target semantic version
- medium/long-term release forecasting uses the evidence-based `agent-delivery-estimation` policy rather than subjective calendar estimates or linear agent scaling
- Issue dependency graph is the canonical dependency SoT
- independent tickets use release base, and same-release linear hard dependencies may use stacked PRs
- every active durable ticket branch publishes its first meaningful commit to the canonical remote, verifies the remote-head SHA, and immediately gets a Draft PR, including worker/subagent branches
- PR creation sets Issue linkage / assignee / reviewer/CODEOWNERS / established labels / target release / stack context
- stacked-ticket Done is defined by target-release-trunk landing, not an intermediate predecessor merge
- a release branch is exempt from Draft release PR only while zero-diff, and gets a Draft release PR after its first meaningful integrated difference
- Issues/PRs are Japanese; commits/source code are English
- decision precedence and user-escalation boundaries are explicit
- unit/smoke/integration/contract/E2E responsibilities and required-verification policy are explicit
- current-SHA revalidation after stack updates is explicit
- a stack-aware quality profile and deterministic validation entry points exist
- framework/runtime security-advisory intake/prioritization exists
- projects using active source audit define coverage-ledger / structured-verdict / independent-verifier / delivery-handoff semantics
- fresh-contributor/new-agent documentation exists
- after session/context loss, a fresh agent can recover the task from Issue/PR/Git/checkpoint state
- a hard-checkpoint boundary exists for provider/sandbox loss
- fencing identity prevents duplicate continuation
- child state/results remain discoverable after parent loss
- side-effect journaling/idempotency prevents ambiguous retries
- partial/stale validation is not reused as a full pass
- secrets do not leak into repository/checkpoints/results
- README / AGENTS / Skills / ADRs do not conflict

Finally report the project-local configuration created/changed, selected Supervisor/runtime, weekly release workflow, stacked-PR/dependency model, public-main protection, parallelization model, quality/security/recovery profiles, validation results, and remaining constraints.
