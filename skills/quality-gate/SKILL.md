---
name: quality-gate
description: project固有のstack・framework・runtimeに合わせてquality gateを設計・実行・更新する時に使用する。
---

# Quality Gate

quality gateは固定bundleではない。

実装ticketの完了はdeterministic checksで判定するが、**何をcheckするかはprojectの実stack、framework/runtimeのcurrent official guidance、既存architecture、release riskからcompileする**。

## 1. Initialization / recompile

初回 `/init`、major framework/runtime upgrade、test architecture変更、CI/CD変更時はquality gateを再設計する。

最初に実repoから検出する:

- languages / frameworks / SDKs
- framework/runtime versions
- package/workspace structure
- official build/test/lint/type tooling
- existing scripts / configs / CI
- generated code boundaries
- app types: web / API / CLI / desktop / mobile / library / IaC
- persistence / external services
- architecture-sensitive targets: browser / OS / CPU architecture / database
- release/deploy targets

次に**実versionに対応するcurrent official documentation**を調査する。

優先順位:

1. framework/runtime/SDK official quality/testing guidance
2. framework/runtime official examples/templates/starters
3. official first-party Actions / CI examples
4. official language/toolchain guidance
5. coherent existing project configuration
6. established maintained ecosystem tooling
7. custom tooling

存在しない「公式推奨」を捏造しない。official guidanceが複数候補を並列提示する場合はproject要件から選択し、理由を残す。

## 2. Quality profileをproject-localにcompileする

調査結果を通常taskで再調査しなくて済む形へ落とす。

project-localに最低限、次を明確化する:

- fast worker gate
- integration gate
- release gate
- canonical validation entry point(s)
- required CI checks
- test types and ownership
- coverage policy when meaningful
- platform/browser/architecture matrix when required
- artifact/report paths
- failure policy

可能なら1つまたは少数のstable entry pointへ集約する。

例:

```text
validate:fast
validate:integration
validate:release
```

実際のcommand名はproject conventionsに合わせる。

AGENTS.mdにはcommandや不変条件への短いpointerだけを置き、詳細はこのSkillまたはproject-specific quality Skillへ分離する。

## 3. Framework-native checksを優先する

一般的なlint/test toolを機械的に追加する前に、framework/runtimeが持つ推奨・標準checkを確認する。

対象例:

- compiler / type checker
- formatter
- framework lint/static analysis
- unit/component/integration/E2E testing
- documentation tests
- platform-specific lint
- API/schema validation
- migration validation
- build/package verification
- accessibility checks
- browser/device tests
- native platform tests
- IaC validation

同じ責務のtoolを重複導入しない。

frameworkが特定領域をE2Eで検証することを推奨する等、test levelに公式制約がある場合はそれをgate設計へ反映する。

## 4. Agent Skills / toolingもstack-awareにする

quality gateに必要なspecialized workflowがある場合、現在利用可能なofficial / maintained Agent Skills、plugin、CLI、LSP、MCP等を調査する。

導入判断:

1. native agent capabilityで十分か
2. project既存CLIで十分か
3. framework official CLIで十分か
4. short project-local Skillで再現する方がよいか
5. plugin/MCPに明確な優位があるか

frameworkごとの操作・検証手順を巨大なroot instructionへ埋め込まず、必要なSkillへprogressive disclosureする。

## 5. GitHub Actionsをquality gateの実行基盤として設計する

GitHub Actionsを使用するprojectでは、local gateとCI gateを同じsemanticsへ揃える。

初期化時にcurrent official GitHub Actions guidanceと、framework/runtimeのofficial CI examplesを調査する。

検討対象:

- first-party setup actions
- framework/runtime official actions or workflows
- dependency/toolchain cache
- matrix testing
- service containers
- browser/device dependencies
- artifact / test report upload
- coverage reporting
- code scanning / dependency review when applicable
- concurrency / cancellation
- permissions minimization
- secrets handling
- action version/pinning policy
- trusted/untrusted PR behavior

cacheにはsecretを入れず、untrusted PRからのwriteやexecutable cache poisoning等のsecurity riskを考慮する。

Actionsを増やすこと自体を目的にしない。local deterministic commandを薄くCIから呼ぶ構成を優先し、CIだけに存在するhidden test logicを増やしすぎない。

## 6. Worker gate

workerは担当scopeで高速にfeedbackを得られるfocused validationを実行する。

project profileから必要なものだけ選ぶ。

例:

- formatter/check
- compiler/type-check
- framework lint/static analysis
- focused unit/component/integration tests
- changed package build
- schema/migration validation

Worker gateはIntegration gateの代替ではない。

## 7. Integration gate

Coordinatorまたは専用verification agentがclean integration candidateから、project profileで定義されたfull applicable suiteを実行する。

候補:

- formatter/check
- lint/static analysis
- compiler/type-check
- dependency analysis
- unit/component/integration/E2E tests
- documentation tests
- coverage
- production build/package
- container/IaC validation
- schema/migration compatibility
- security/dependency audit
- browser/device/OS matrix

「一般に良さそうだから全部」ではなく、project riskとofficial guidanceで適用範囲を決める。

## 8. Release gate

`release-x-y-z -> main` の前にはticket単位より広いrelease-level verificationを行う。

必要に応じて:

- full integration suite
- clean production build/package
- supported browser/device/OS matrix
- migration rehearsal
- packaging/signing/notarization verification
- deployment/IaC plan validation
- upgrade/backward-compatibility tests
- smoke/E2E against release-like environment

を実行する。

release gateはproject typeに合わせてcompileし、不要な項目を形式的に要求しない。

## 9. PR Done gate

- Issue acceptance criteriaを満たす。
- project-specific required CI/checksが成功する。
- Reviewerのblocking指摘が解消される。
- known limitationを隠さない。
- target `release-x-y-z` branchとのstalenessを確認する。

## 10. False green禁止

- skipped test
- `.only`
- blanket ignore/suppression
- ignored exit code
- `|| true`
- no-fail option
- CI check disabling
- broad generated-code excuse
- coverage threshold低下や不当なexclude

projectから修正不能なupstream warningが残る場合は明示し、完全cleanと表現しない。

## 11. Coverageは固定万能指標にしない

coverageは意味のあるtestable sourceに対して有用な場合にenforceする。

既定候補として80%を使用できるが、framework/runtimeのofficial guidance、code type、risk、existing baselineを優先してproject-specific thresholdを決める。

coverageを高く見せるためだけのtest、threshold低下、広範囲excludeは禁止する。

coverageが適切な品質指標でない領域では、別のdeterministic verificationへ置き換える。

## 12. Re-evaluation triggers

次の場合はquality profileを再compileする:

- framework/runtime major upgrade
- official recommended testing/tooling change
- new app target / platform追加
- architecture boundary変更
- CI provider/workflow変更
- flaky/slow gateが開発速度を阻害
- escaped regressionが既存gateの穴を示した
- release process変更

quality gate自体もstatic policyではなく、projectとframeworkの進化に追従するversioned project configurationとして扱う。
