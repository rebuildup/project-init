# Project-local AI Agent Initialization Policy

Initialize or reconcile the AI coding-agent environment for this repository.

This prompt is intended to supplement or replace a generic `/init` operation. Its purpose is to inspect the actual repository, technology stack, architecture, runtime, tests, CI/CD, and development workflow, then construct a **minimal, reproducible, project-scoped AI agent environment**.

Do not copy this entire document into `AGENTS.md` or `CLAUDE.md`.

Follow these principles:

1. Inspect the existing repository first.
2. Select only the rules, Skills, plugins, and tools the project actually needs.
3. Keep only true always-on invariants in root agent instructions.
4. Move conditional and specialized procedures into Agent Skills.
5. Persist long-lived decisions such as plugin/tool selection and foundational migrations in ADRs.
6. Make the environment reproducible from project-local state.
7. Run deterministic verification to completion for implementation tasks.
8. Support both fresh clones and repeated `/init` runs.

Core principle:

> **minimum hidden state + minimum dependencies + maximum deterministic verification + project-local reproducibility + progressive disclosure + maximum logically safe parallelism**

---

## 1. Idempotent `/init`

Do not assume initialization runs only once.

Inspect the current repository and reconcile only the difference between the current and desired states.

Inspect at least:

- `AGENTS.md`
- agent-specific adapters
- Agent Skills
- project-local plugin configuration
- agent/toolchain ADRs
- architecture ADRs
- README / development documentation
- package/tool versions
- lockfiles
- CI/CD
- test / coverage configuration
- environment examples
- `.gitignore`
- validation commands
- `.tmp/` and `.reference/` policy

Intended behavior:

`initialize if missing -> repair if incomplete -> update if stale -> verify if already correct`

Do not regenerate or rewrite valid configuration without a reason.

Add missing items, repair incomplete ones, update stale ones, merge duplication, and remove obsolete items only after updating the corresponding decision record.

**No changes may be the correct result.**

---

## 2. Existing codebase first

When an existing codebase is present, inspect it before deciding architecture, naming, plugins, Skills, tools, dependencies, tests, or CI/CD.

Inspect at least:

- languages / frameworks / SDKs
- runtime versions
- package manager
- manifests / lockfiles
- workspace / monorepo structure
- directory / module structure
- architecture / dependency direction
- naming conventions
- current agent instructions
- current Agent Skills
- project-local agent/plugin configuration
- designs / specifications
- ADRs
- formatter / lint / type checking
- dependency analysis
- unit / integration / E2E tests
- coverage
- build
- CI/CD
- containers / IaC
- generated-code boundaries
- existing errors / warnings
- skips / ignores / suppressions / exclusions
- stale / duplicate dependencies and tools
- existing user changes in the working tree

Prefer evidence from the repository over generic conventions.

Do not replace a coherent existing approach merely because another approach is fashionable.

---

## 3. Project scope only

Keep AI-agent configuration project-scoped.

Do not:

- install plugins at user/global scope,
- store project-specific rules in the user's home directory,
- use global agent memory as project truth,
- depend on undocumented machine-specific state,
- silently modify global agent configuration.

Commit reproducible configuration whenever the tool supports it.

Examples:

- `AGENTS.md`
- Agent Skills
- project-local plugin declarations
- project-local agent settings
- bootstrap / validation scripts
- Nix configuration
- CI/CD
- test / coverage configuration
- tool version / lock information

Credentials, authentication, trust decisions, and secret values are exceptions where repository storage is inappropriate.

Project truth belongs in repository-controlled files, not implicit memory.

---

## 4. Root agent files are dispatchers

Use `AGENTS.md` as the canonical cross-agent project contract where supported.

Keep it concise.

It is a dispatcher, not a rule dump.

Only include invariants that affect nearly every task, such as:

- project identity / boundaries
- basic toolchain
- source language policy
- internal documentation language
- task-scope policy
- design approval gate
- validation entry point
- Skill discovery
- branch / worktree policy
- mode / permission policy

Move detailed procedures into Agent Skills, including:

- debugging
- testing / quality gates
- dependency hygiene
- architecture
- design-first workflow
- UI/browser verification
- container/IaC verification
- Git workflow
- parallel/subagent orchestration
- release/versioning
- external documentation retrieval
- code review

Use each agent's supported project-local mechanism for agent-specific paths, configuration formats, Skills, and plugins.

Avoid manually duplicating the same full instruction set across agents. Prefer one canonical source with thin adapters where practical.

---

## 5. Agent Skills are the unit of detailed behavior

Use Agent Skills for detailed conditional workflows.

Do not mechanically create one Skill for every bullet in this document.

Split or merge Skills based on:

- activation condition
- responsibility
- required tools
- context cost

Merge rules with essentially identical triggers.

Split them when unrelated instructions would enter context together.

Prefer Skills with:

- short descriptions
- explicit triggers
- one primary responsibility
- deterministic tool invocation
- references loaded only when needed
- scripts executed only when needed

Prefer progressive disclosure.

---

## 6. Select plugins, Skills, and tools from first principles

Do not restrict discovery to products named in this prompt.

At initialization time, inspect current information for:

- agent-native capabilities
- existing project configuration
- official plugin marketplaces
- official / maintained Agent Skills
- first-party integrations
- current ecosystem tools
- official framework / SDK tooling

For every candidate, determine whether the capability is:

1. already sufficiently native,
2. already available in project tooling,
3. better implemented as a Skill,
4. better implemented as a deterministic CLI,
5. materially improved by a plugin or MCP server.

Do not add overlapping implementations without a concrete reason.

Selection criteria:

### Need
Does it close a demonstrated capability gap?

### Reproducibility
Can project-local configuration, versioning, and bootstrap information be preserved?

### Maintenance
Prefer:

1. official / first-party,
2. actively maintained established projects,
3. community alternatives only when they provide a clear benefit.

### Context cost
Avoid unnecessary always-on schema, descriptions, memory, or tool-result overhead.

### Determinism
For deterministic local operations, generally prefer:

1. existing project CLI,
2. dedicated CLI + Skill,
3. native agent integration,
4. plugin / MCP only when it provides a material advantage.

### Security
Inspect source, maintainer, permissions, remote communication, secret requirements, and executable behavior.

### License
Inspect license type, project compatibility, redistribution, attribution, and source-copy restrictions.

### Cross-platform behavior
Verify operation in the supported Windows/WSL Containers and NixOS environments.

### Version
Prefer the latest stable compatible version and pin/lock it when reproducibility requires it.

---

## 7. Persist plugin/tool decisions in ADRs

Do not leave major AI-agent toolchain decisions only in conversation history.

Create or update an agent-toolchain ADR when appropriate.

Record at least:

- investigation date
- status
- capability being addressed
- selected plugin / Skill / CLI / LSP
- selection reason
- alternatives considered
- rejection reasons
- native-capability overlap
- context cost
- maintenance state
- security considerations
- license
- version / pinning
- project-local reproduction method
- re-evaluation conditions

Where supported, preserve selected plugins/Skills through project-local declarations, configuration, version/lock information, or vendored Skill/plugin content so the repository can reproduce them.

Do not make an undocumented global installation a project requirement.

---

## 8. Capability candidates

These are discovery seeds, not a mandatory bundle.

### Code intelligence

Ensure semantic code navigation and diagnostics for the languages in use.

Candidates include:

- TypeScript / JavaScript language tooling
- rust-analyzer
- Kotlin language tooling
- clangd
- C# language tooling
- LSPs for other detected languages

Do not duplicate reliable native LSP functionality without evidence of benefit.

For large or complex repositories, evaluate symbol-level tools such as Serena.

For repeated structural queries or transformations, evaluate tools such as `ast-grep`.

Use `ripgrep` as the default textual search tool.

### Browser / UI

Prefer Playwright-based tooling for web projects.

For ordinary coding-agent browser work, prefer CLI + Skill workflows. Use heavier persistent browser/MCP integration only when it provides a real advantage such as persistent interactive state.

### Documentation

Use this retrieval priority:

1. repository design / docs
2. repository source
3. installed dependency source / types / schemas / local docs
4. official documentation matching the actual version
5. project-local reference Skills
6. Context7 or equivalent external documentation retrieval
7. general web search

Do not prioritize generic documentation services over project-local knowledge.

### Context management

Evaluate context-mode or current alternatives only when large repositories, logs, documentation, tool output, or long sessions create an observed context problem.

### Workflow frameworks

Evaluate Superpowers or similar collections by capability / Skill rather than blindly installing the entire methodology.

### CLI output compression

Evaluate RTK or alternatives only when actual CLI output is a demonstrated problem and measurement shows the extra layer is useful.

### Persistent memory

Do not enable claude-mem or equivalent implicit persistent memory by default.

Repository documentation, design, ADRs, and Skills remain the source of truth.

---

## 9. Development environments

Primary target environments:

- Windows with WSL Containers (`wslc`)
- NixOS under WSL
- NixOS in containers
- native Linux / NixOS where appropriate

Do not assume Docker Desktop.

Inspect the actual container runtime and supported commands before relying on Docker-compatible behavior.

Prefer declarative environments such as Nix flakes/dev shells when they materially improve reproducibility of system dependencies.

Do not introduce Nix merely for ceremony.

---

## 10. Package manager, search, and scripts

For JavaScript / TypeScript, use Bun as the default package manager.

Prefer:

- `bun`
- `bun run`
- `bunx`
- the Bun lockfile

Do not introduce npm, Yarn, pnpm, or `npx` without a concrete incompatibility.

For an existing project using another package manager, inspect the migration. If migration to Bun is justified, record the decision in an ADR and migrate cleanly.

Do not leave unnecessary mixed-package-manager state.

Use:

- `rg`
- `rg --files`

for textual search.

Use LSP, semantic, or structural search when text search is insufficient.

### Python script prohibition

Do not create new `.py` scripts.

Strongly prohibit new Python scripts for:

- automation
- generation
- migration
- validation
- build support
- test support
- maintenance
- temporary analysis
- repository scripts

Prefer TypeScript, JavaScript, shell, PowerShell for genuinely Windows-specific work, or another appropriate non-Python project language.

---

## 11. Source-code and documentation languages

### Source code

Source code must use English.

This includes:

- filenames
- directory names
- identifiers
- classes / functions / variables
- components / hooks
- test names
- developer-facing log/event identifiers
- code comments
- source-code documentation
- configuration identifiers

Other languages should normally appear only in locale/localization resources.

### Internal development documentation

Internal development documentation must be written in Japanese.

Examples:

- architecture documents
- designs
- specifications
- ADRs
- internal runbooks
- implementation documentation
- project Agent Skills
- project agent instructions

Exceptions include public-facing README files, LICENSE files, public API documentation, and ecosystem-standard files for which another language is appropriate.

### Git / GitHub

Always write these in English:

- commit messages
- GitHub Issues
- Pull Requests
- GitHub review messages
- release communication produced through Git/GitHub workflows

---

## 12. Prioritize official recommended architecture

Whenever architecture is created or changed, **research the current official documentation for the actual platform, framework, and SDK first.**

Do not decide architecture solely from model knowledge or generic habits.

Use this priority:

1. current official recommended architecture / architecture guidance
2. current official reference implementation / sample
3. current official project structure / conventions
4. coherent existing project architecture
5. established ecosystem conventions
6. custom architecture

When official documentation explicitly marks architectural guidance as:

- Recommended
- Strongly recommended
- Best practice
- Preferred
- Standard architecture

**follow it by default unless it conflicts with a concrete project requirement.**

Do not treat explicit first-party architecture guidance as optional background while arbitrarily choosing another design.

Architecture includes at least:

- directory / module structure
- dependency direction
- data flow
- state ownership
- component design / responsibilities
- domain boundaries
- persistence boundaries
- side-effect boundaries
- UI architecture
- error handling
- naming
- modularization
- testing boundaries
- recommended framework/runtime primitives

When deviating from explicit official guidance, record in an ADR:

- why the guidance does not fit
- the concrete conflicting requirement
- benefits and liabilities of the alternative
- conditions for re-evaluation

If a framework intentionally leaves an area unopinionated, as Next.js does for broad project organization, do not invent an "official recommended architecture."

Distinguish what official documentation prescribes from what it intentionally leaves unspecified. Design the unspecified part from repository evidence, use cases, and established ecosystem conventions.

For existing projects, still compare against current official guidance. Do not mechanically rewrite a coherent architecture when the migration benefit is negligible.

Record material architectural migrations in ADRs.

---

## 13. Naming and responsibility

Names must reflect the responsibility owned by the item.

Treat ancestor paths, namespaces, and owners as part of the effective name.

Do not repeat meaning already supplied by parent scopes.

A path such as:

`Viewer/ViewerWorkspaceGrid/WorkspaceGrid.tsx`

is suspicious because the same conceptual responsibility appears repeatedly from leaf to root.

Do not solve this merely by abbreviating words. Re-evaluate which level owns each responsibility.

Prefer short, precise names that become clear from path context.

Avoid vague dumping-ground names when a precise responsibility exists, including:

- `utils`
- `helpers`
- `common`
- `misc`
- `manager`

### Directory width

Strongly prefer approximately 10 or fewer sibling files/directories at the same directory level.

This is not a mechanical hard limit.

When a directory substantially exceeds this size, inspect whether multiple responsibilities should become meaningful subdirectories based on domain, feature, responsibility, lifecycle, or another real boundary.

Do not create meaningless grouping directories solely to satisfy the number.

---

## 14. Design-first development

When design or specification files exist, development is design-first.

Before implementing behavior covered by a design:

1. inspect the current design,
2. identify required design changes,
3. discuss them with the user,
4. reach agreement,
5. update/finalize the design,
6. then implement.

If requirements change after implementation begins, return to the design and redesign first.

Design documents represent the **desired final state**.

Do not use them as:

- chronological notes
- implementation diaries
- temporary TODO lists
- abandoned-idea archives

Use ADRs for decision history.

---

## 15. ADR lifecycle

ADRs must preserve explicit relationships between decisions.

When a later ADR supersedes, revises, deprecates, replaces, or invalidates an earlier ADR:

- the new ADR references the previous ADR,
- the previous ADR references the new ADR.

Mark obsolete ADRs clearly and leave a direct reference to the currently valid decision.

Apply this lifecycle not only to architecture but also to:

- agent tooling
- plugin selection
- package-manager migrations
- dependency strategy
- container strategy
- test strategy
- CI/CD
- infrastructure
- major toolchain changes

---

## 16. Early-development compatibility

Unless the user explicitly states otherwise, assume the application is in early development.

Do not spend effort preserving:

- backward compatibility
- obsolete internal APIs
- deprecated schemas
- old behavior
- historical data migrations
- compatibility shims

Move directly toward the intended design.

Do not retain compatibility layers "just in case."

Explicitly identified stable external contracts are exceptions.

---

## 17. Do not narrow task scope

Never silently reduce the requested task into an independently invented MVP.

Do not omit difficult portions because a smaller result is easier.

Internal decomposition is encouraged, but the external requested scope must remain intact.

A task is complete only when the requested scope is complete.

---

## 18. Autonomous execution loop

For non-trivial implementation tasks, automatically use:

`inspect -> plan -> implement -> verify -> rubber-duck -> replan -> continue`

At each loop:

- articulate the concrete current problem,
- inspect evidence,
- identify assumptions,
- choose the smallest useful next action,
- implement,
- verify,
- compare against acceptance criteria,
- replan.

Do not stop merely because:

- compilation succeeds,
- one test succeeds,
- the happy path works,
- the first implementation appears plausible.

Continue until the full requested task is complete or a genuine external/user gate is reached.

---

## 19. Maximum logically executable subagents

For substantial tasks, automatically use the **maximum logically executable number of subagents** without requiring the user to ask.

Treat work as a dependency graph.

Parallel execution requires at least:

- no unfinished prerequisite dependency
- no concurrent edits to the same file
- no overlapping generated outputs
- no conflicting shared mutable state
- no incompatible concurrent shared-interface changes
- clear ownership
- no racing Git index / HEAD operations
- availability within agent/tool concurrency limits
- model availability
- available rate limit / quota
- no immediate resource exhaustion

If quota, rate limits, runtime constraints, or model availability prevent another agent from running, it is not logically executable at that moment.

Do not impose an arbitrary low cap merely because the resulting agent count is large.

Sequentialize dependent phases and maximize safe parallelism within each phase.

---

## 20. Codex role allocation — August 2026

This section is a **time-bound operating policy for August 2026**.

Re-evaluate it when Codex models, pricing, availability, subagent behavior, or model routing changes.

These are project roles based on current model characteristics, not official job descriptions assigned by OpenAI.

### Sol — coordinator / supervisor

Primary responsibilities:

- complete user-request understanding
- architecture-level reasoning
- dependency graph construction
- task decomposition
- subagent orchestration
- ownership boundaries
- consequential decisions
- difficult problem solving
- integration
- final verification
- final synthesis

Avoid concentrating large amounts of routine implementation work in Sol.

### Terra — independent reviewer

Primary responsibilities:

- implementation review
- architecture review
- correctness review
- integration review
- test adequacy review
- failure analysis
- independent second opinion

Where practical, do not let the implementing agent's self-review be the only review.

### Luna — primary implementation worker

Primary responsibilities:

- code implementation
- mechanical refactoring
- test implementation
- repository exploration
- bounded investigation
- repetitive changes
- deterministic tool execution
- independent implementation units

Delegate safely separable implementation work to Luna where practical and use its current speed/cost characteristics to scale throughput.

This does not permit sacrificing correctness for cost.

Escalate high-difficulty or high-consequence judgment to Terra or Sol.

At runtime, verify whether the effective subagent model can actually be selected and observed. Never falsely claim a model was used when it cannot be verified.

If explicit model routing is unavailable, preserve the logical coordinator / reviewer / implementer roles using the best available mechanism.

---

## 21. Git branch and worktree policy

Unless explicitly overridden by the user:

- work only on the local `main` branch,
- do not create feature branches,
- do not create temporary branches,
- do not create Git worktrees.

If an agent/team mechanism requires worktrees, do not use that mechanism.

Use a non-worktree subagent mechanism.

If a unit of work can only be parallelized through a worktree-required mechanism, treat it as non-parallelizable and execute it sequentially as needed.

Before starting, inspect the current branch, working tree, and existing uncommitted user changes.

Never overwrite, stage, or commit unrelated user work.

---

## 22. Subagent file ownership and commits

Assign disjoint file ownership before parallel implementation.

Do not let multiple agents edit the same file concurrently.

When two tasks require the same file:

- combine them into one ownership unit, or
- sequence the relevant phases.

Do not use merge-conflict cleanup as the normal parallelization strategy.

Each subagent's completed work must produce a dedicated commit containing only its owned changes.

Because the shared local `main` working tree is used, serialize commit operations.

For each agent:

1. finish owned implementation,
2. finish relevant validation,
3. inspect its diff,
4. stage only owned files,
5. create the dedicated commit,
6. continue to the next commit operation.

Use separate commits for logically distinct orchestrator changes as well.

---

## 23. Git and GitHub message format

All Git and GitHub messages must be in English.

Commit messages should use:

`<work-prefix>: <extremely concise title>`

Then a blank line and concise bullets such as:

- main change
- relevant supporting change
- validation/result when useful

Add detail only when needed.

Typical prefixes:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `build`
- `ci`
- `chore`
- `perf`

Use similarly concise English titles and structured summaries for Issues and Pull Requests.

---

## 24. Foundational or disruptive migrations

Foundational migrations may be performed automatically when justified, including:

- npm / pnpm / Yarn -> Bun
- Dockerfile -> Containerfile
- test-framework replacement
- lint / formatter / toolchain changes
- CI/CD changes
- directory architecture changes
- agent-tooling replacement

Do not require a mechanical user-confirmation gate merely because a migration is large.

It must have a concrete project reason.

For such migrations:

1. inspect current state,
2. define the reason,
3. compare alternatives,
4. create/update the ADR,
5. migrate,
6. run the full quality gate,
7. remove obsolete configuration,
8. verify fresh-clone reproducibility.

Do not keep old and new approaches in parallel without a real requirement.

Where design documents are involved, still obey the design-first user-agreement gate.

---

## 25. Dependency policy

Prefer the latest stable compatible package versions.

Keep dependencies minimal.

For each new dependency ask:

- Is it actually required?
- Is the capability already available in the platform/runtime/framework?
- Is it already provided by an existing dependency?
- Is there a smaller maintained alternative?
- Is it directly used?
- Does it add unnecessary transitive dependencies?
- Is it actively maintained?
- Is its license appropriate?

Do not add dependencies for trivial functionality that can be implemented clearly with existing primitives.

Do not keep libraries with overlapping responsibilities without justification.

Audit outdated, stale, and duplicate dependencies in existing repositories.

### License audit

When introducing a package, plugin, Skill, tool, or reference implementation, inspect at least:

- license type
- compatibility with the project license
- redistribution requirements
- attribution requirements
- restrictions relevant to copied source

Record material decisions in the relevant ADR.

---

## 26. Dependency and static analysis

For JavaScript / TypeScript, use Knip or a current superior equivalent where applicable.

Check at least:

- unused dependencies
- unlisted / missing dependencies
- unused exports
- unused files
- unresolved references
- configuration problems

Fix causes rather than broadening ignore patterns.

Biome may be preferred for formatting/linting where appropriate, while preserving a superior coherent existing or framework-specific setup when justified.

---

## 27. Automatic quality gate

The user should not need to repeatedly request:

> run Biome, type-check, Knip, build, and every package test with zero errors or warnings

Treat this as the standard completion criterion for implementation tasks.

Inspect actual package/workspace scripts and project tooling, then run all applicable non-destructive validation.

Examples:

- formatter/check
- Biome / lint
- type checking
- Knip / dependency analysis
- static analysis
- unit tests
- component tests
- integration tests
- E2E tests
- coverage
- build
- container/IaC validation
- dependency/security audit

Final validation must cover every applicable project/package validation and test suite, not merely the tests touched by the change.

Focused tests are acceptable during iteration.

Do not run destructive deployment or release scripts merely because they exist in a package manifest.

---

## 28. Genuine zero-error / zero-warning state

Required checks must finish without project-actionable errors or warnings.

Do not create false cleanliness through:

- skipped tests
- `.only`
- disabled suites
- blanket ignores
- blanket lint suppression
- blanket type suppression
- warning suppression
- broad coverage exclusions
- ignored exit codes
- `|| true`
- no-fail flags
- disabled CI checks

A narrow exclusion is allowed only when an item genuinely lies outside the meaningful validation domain, such as generated or vendor code.

Every exclusion must be specific, minimal, and justified.

If an upstream/toolchain warning cannot be fixed by the project, report it explicitly and do not call the state fully clean.

---

## 29. Tests and coverage

Use the current appropriate testing stack for each platform.

For JavaScript / TypeScript, prefer Vitest for unit/component tests unless the framework has a materially stronger standard.

For web E2E, prefer Playwright.

Preserve an existing high-quality testing stack rather than replacing it merely for uniformity.

Test behavior rather than private implementation details.

Tests must be isolated and reproducible.

### Coverage

Maintain at least 80% coverage for meaningful testable source.

For Vitest, enforce at least:

- lines >= 80%
- statements >= 80%
- functions >= 80%
- branches >= 80%

Do not allow unimported source files to disappear from coverage merely because no test touched them.

Do not lower thresholds or exclude difficult files merely to inflate the number.

---

## 30. `.tmp/`

All temporary development and verification artifacts belong under root-level:

`.tmp/`

Examples:

- test output
- raw logs
- screenshots
- traces
- diagnostic files
- temporary generated verification files
- temporary fixtures

Never place these directly in the repository root.

Git-ignore `.tmp/`.

Do not commit temporary artifacts unless a specific artifact is explicitly promoted into permanent documentation or test fixtures.

---

## 31. `.reference/`

External repositories used strictly as implementation/design/reference material may be cloned under root-level:

`.reference/`

Always Git-ignore `.reference/`.

Reference repositories are not part of the project.

Do not:

- integrate them directly into the source tree,
- make them implicit build dependencies,
- make them implicit runtime dependencies,
- commit their changes as project changes,
- require them for fresh-clone operation.

Clone them only when useful and keep the actual project functional without them.

Inspect licenses before using or copying their implementation. Any copied code must comply with license and attribution requirements.

---

## 32. Dotenv and GitHub Secrets

The only dotenv files allowed to contain actual environment values are:

- `.env`
- `.env.development`
- `.env.production`

Git-ignore them.

Do not use:

- `.env.local`
- `.env.test`
- arbitrary real-value `.env.*` variants

### Example files

The following are allowed and must be committed:

- `.env.example`
- `.env.development.example`
- `.env.production.example`

Treat them as the environment-variable schema.

Variables corresponding to GitHub Secrets must appear in the appropriate example file.

For secrets:

`SECRET_NAME=`

For safe public configuration, a real default/example may be used:

`PUBLIC_VALUE=safe-example`

Never place actual credentials, tokens, private keys, or secret values in example files.

Keep local and GitHub variable names aligned where practical.

For environments that require a GitHub Actions secret locally, keep the corresponding value in the appropriate ignored actual env file.

Do not assume GitHub can reveal stored secret values later.

---

## 33. `.gitignore`

Maintain `.gitignore` according to the actual stack.

At minimum consider:

- `.tmp/`
- `.reference/`
- actual dotenv files
- dependency directories
- build outputs
- generated caches
- test / coverage output
- tool caches
- OS temporary files
- editor temporary files
- local secret artifacts

Do not accidentally ignore:

- source
- lockfiles
- reproducibility configuration
- Agent Skills
- project agent configuration
- CI/CD configuration
- committed env examples

Keep rules organized instead of accumulating redundant patterns.

### Pre-commit hooks

Do not create pre-commit hooks solely as part of this initialization policy.

Prefer checks that can be reproduced through project scripts and CI/CD.

---

## 34. CI/CD

Use GitHub Actions for CI/CD unless the user explicitly requires another platform.

CI must execute the applicable quality gate.

Avoid maintaining separate duplicate local and CI validation logic. Prefer project scripts that both environments invoke.

Expose environment differences instead of hiding them.

---

## 35. Versioning and release

Use Semantic Versioning:

`MAJOR.MINOR.PATCH`

Examples:

- `1.0.0`
- `2.4.1`

Do not use shortened forms such as `1` or `1.2` without a concrete ecosystem requirement.

### Tag-triggered releases

When a tag push triggers a release, synchronize the tag version and authoritative project/package version.

Example:

- tag: `v1.4.2`
- project version: `1.4.2`

Fail the release on a mismatch instead of silently correcting it.

At minimum:

1. validate tag format,
2. extract semantic version,
3. compare against the authoritative version,
4. run the full quality gate,
5. build release artifacts,
6. publish/release only after validation succeeds.

For multiple released packages, define the authoritative version or validate each release unit according to an explicit policy.

---

## 36. Containers and IaC

Use `Containerfile`, not `Dockerfile`, for new container definitions.

When tooling defaults to `Dockerfile`, explicitly point it to `Containerfile`.

For an existing Dockerfile, migrate to Containerfile when justified and record the foundational decision in an ADR.

When the repository contains Containerfiles, Compose, Kubernetes, Terraform, CloudFormation, Helm, or other IaC, select the smallest useful validation toolset.

Candidates include:

- Hadolint-compatible linting
- Trivy
- platform-native validators
- image scanners
- IaC validators

Do not install every scanner automatically.

Do not make scans pass through broad ignores.

When a container image is a deliverable, validate the built image where practical.

---

## 37. UI architecture

Do not mechanically expose data-model properties as UI.

Derive information architecture from:

1. data model,
2. use cases,
3. user goals,
4. information priority,
5. interaction timing.

Determine:

- what is visible,
- when it is visible,
- what remains implicit,
- what belongs together,
- primary actions,
- progressive disclosure.

Avoid unnecessary cards, wrappers, panels, borders, and visual chrome that do not improve information architecture.

### UI libraries

Where appropriate, prefer headless UI primitives as the foundation of UI systems.

Separate behavior/accessibility primitives from project-specific presentation.

Preserve coherent existing design systems and platform-native guidance when they are more appropriate.

---

## 38. UI verification

Any task changing visible UI must verify the actual rendered result.

Do not judge UI correctness from source alone.

For web projects, use Playwright or the selected browser tooling.

Where relevant, inspect:

- screenshots
- desktop/mobile viewports
- loading states
- empty states
- error states
- interaction states
- overflow
- visibility
- console errors
- network failures

Store verification artifacts under `.tmp/`.

Continue implementation if the rendered result does not satisfy the design.

---

## 39. Mode, permission, and trust restrictions

Respect the active agent execution mode.

If a required capability is intentionally unavailable because of the current mode:

- do not search for a bypass,
- do not tunnel through unrelated tooling,
- do not weaken validation.

Ask the user to switch to an appropriate mode.

Treat permission, trust, and authentication gates similarly as legitimate user gates.

---

## 40. Prefer deterministic verification

Use deterministic tools for facts that can be mechanically checked.

Examples:

- compiler / type checker
- formatter
- Biome / linter
- Knip
- test runner
- coverage
- Playwright
- container/IaC scanners
- dependency audit

The agent interprets these results; it must not replace them with intuition.

Inspect existing skips, ignores, suppressions, and deprecated tools. Do not blindly preserve or delete them. Prefer fixing root causes.

---

## 41. Fresh-clone audit

Before finishing initialization, evaluate the result as a fresh clone.

Ask:

- Which files define agent behavior?
- Where are the Skills?
- Are plugins project-local?
- Which binaries are required?
- How are binaries provisioned?
- Is global software implicitly required?
- Which environment variables are required?
- How are secrets supplied?
- Does Windows/WSLC work?
- Does NixOS work?
- Does it depend on home-directory configuration?
- Does it depend on implicit persistent memory?
- Are `.tmp/` and `.reference/` ignored?
- Are actual env files ignored?
- Are env examples committed?
- Do local and CI validation share the same logic?

Eliminate accidental hidden dependencies.

---

## 42. Initialization outputs

Create only infrastructure justified by the actual project.

Possible outputs:

- concise `AGENTS.md`
- thin agent-specific adapters
- Agent Skills
- project-local plugin configuration
- agent/toolchain ADRs
- architecture ADRs
- development dependencies
- Nix/dev environment
- validation scripts
- test / coverage configuration
- `.gitignore`
- GitHub Actions
- release/version validation
- env examples
- README / development documentation

Do not create empty boilerplate Skills or directories.

Do not install a plugin merely because it is named in this policy.

---

## 43. Completion report

At completion, report concisely:

- detected stack
- detected architecture
- official architecture guidance investigated
- existing agent configuration
- files created/changed
- Skills and activation conditions
- plugins/tools considered
- selected plugins/tools
- rejected candidates and reasons
- ADRs created/updated
- canonical validation command
- test / coverage configuration
- CI/CD configuration
- environment configuration
- remaining trust/authentication steps
- existing quality debt
- unreproducible items, if any

Keep rejected candidates and reasons visible so tool selection is demonstrably intentional.

---

# Standard behavior for implementation tasks

After initialization, non-trivial implementation tasks should automatically:

1. inspect the repository and relevant design,
2. check current official architecture guidance when relevant,
3. preserve the full user-requested scope,
4. construct a dependency graph,
5. use the maximum logically safe number of subagents,
6. work only on local `main`,
7. never create worktrees,
8. assign disjoint file ownership,
9. serialize commit operations,
10. commit each agent's owned logical work separately,
11. run all applicable formatter / Biome / type-check / Knip / build / test / coverage / validation checks,
12. leave no actionable errors, warnings, unjustified skips, ignores, or suppressions,
13. verify the rendered result for UI changes,
14. inspect the final diff,
15. rubber-duck and replan if anything remains,
16. continue until the complete requested task is finished.
