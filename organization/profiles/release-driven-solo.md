# Release-driven solo development profile

- Status: Current default
- Constitutional authority: none; this profile must refine the Constitution
- Related: ADR-0004, ADR-0008, ADR-0012, ADR-0013, ADR-0016

## Purpose

現在のsolo / small-project release-driven developmentで使用する標準Operating Modelを定義します。

このprofileはproject-initの唯一の正しいorganization topologyではありません。別profileまたはproject-specific modelがConstitutionを満たす場合は置換できます。

## Current topology

### Source and implementation state

- Git: source stateのcanonical authority
- GitHub Issues: durable implementation scope / acceptance criteria / dependency state
- GitHub Pull Requests: review / candidate integration / validation evidence
- `main`: released/integrated source state
- `release-x-y-z`: current release integration line

### Release planning

- Linear Projects / Initiatives: release goal / target date / health / portfolio view
- GitHub IssueをLinear Issueへ全面mirrorしない
- implementation/dependency factsはGitHub側のownershipを維持する

### Delivery defaults

- normal sprint cadence: 1 week
- production/stable release intent: major bump default
- normal sprint release intent: minor bump default
- within-sprint / post-introduction adjustment: patch bump default
- top-level durable work: GitHub Issue
- ticket branch: Issue number only
- independent ticket PR: target release branch
- hard dependency stack: immediate predecessor branchをbaseにできる
- first meaningful durable commit後はcanonical remote publication + Draft PRを行う
- release branchにmeaningful differenceが入ったらDraft release PRを維持する
- `main`へのnormal integrationはcurrent release branchからのrelease PRだけ
- merge/landingはADR-0012のexplicit authorization boundaryを維持する

### Workspace/runtime defaults

- WSL/Linux worktree frontend: Worktrunk
- Worktrunk unavailable/incompatible時: native Git worktree fallback
- worktree自体をruntime isolation proofとして扱わない
- implementation workerのmutable runtimeは適切に分離する
- parent/child handoffはimmutable identityへpinする

### Quality / evidence

- project-specific adaptive quality profileをcompileする
- validation evidenceをcurrent artifact/SHAへbindする
- worker / integration / release gateの責務を分ける
- fixed universal required status check名は前提にしない

## Constitutional mapping

### Identity Integrity

- resolved immutable SHAへsnapshot/result/validationをpin
- predecessor change後にaffected validationを再実行
- execution generation/fencingでstale continuationを区別

### Authority Integrity

- PR readinessとmerge authorizationを分離
- release/product/irreversible decisionは定義済みauthority boundaryへ従う

### Evidence Integrity

- current SHAのvalidation evidenceを使用
- false greenを禁止
- PR/release readinessはapplicable evidenceへ基づく

### Mutable Ownership Safety

- worktree-only isolationを認めない
- concurrent implementation workerはmutable runtimeを安全に分離
- DB/Redis/queue/port等のshared mutable stateを別途調停

### Organizational Continuity

- Issue / PR / Git ref / committed docs / immutable resultをdurable recovery sourceにする
- native conversation resumeをcanonical recovery stateにしない

### Canonical Consistency

- source / implementation / review / release-planning responsibilityをfield ownershipで分離
-同一factの二重canonical化を避ける

### Progress

-自明なimplementation decisionを不要にoperatorへ返さない
- review/validation完了後はauthorization等の実blockerがなければ次stateへ進める
- safety mechanismがdelivery deadlockを作る場合はOperating Modelをre-evaluateする

## Deviation

このprofileの具体的なtool/cadence/topologyから外れる場合でも、該当するConstitutional guaranteeを維持できれば許容します。

explicit user/project decisionとして固定されたrelease scope/version/public contract等は、単なるdefaultとは区別します。

## Re-evaluate / remove

次の場合はprofile全体または一部を見直します。

- agent/runtimeが同等以上のisolation/recovery/review semanticsをより単純に提供する
- GitHub/Linear/Worktrunkの役割を別systemが置換する
- release branch modelがcontinuous delivery等に対して逆効果になる
- weekly cadenceがproject objectiveへ合わない
- eval/実績から特定procedureの追加価値が消えた
