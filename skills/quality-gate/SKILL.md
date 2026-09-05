---
name: quality-gate
description: project固有のstack・framework・runtimeに合わせてquality gateと動作確認レベルを設計・実行・更新する時に使用する。
---

# Quality Gate

quality gateは固定bundleではない。

**何をcheckするか、どのtest levelまで要求するかを、projectの実stack、framework/runtimeのcurrent official guidance、変更surface、release riskからcompileする。**

このSkillは通常taskのvalidationだけでなく、初期化時にquality infrastructureそのものを設計・導入・修復する責務を持つ。

## 1. Initialization / recompile

初回 `/init`、major framework/runtime upgrade、test architecture変更、CI/CD変更時はquality profileを再設計する。

実repoから検出:

- languages / frameworks / SDKs / versions
- package/workspace structure
- app type: web / API / CLI / desktop / mobile / library / IaC
- architecture boundaries
- persistence / queue / cache / external services
- auth / network / filesystem boundaries
- existing test/lint/type/build scripts
- generated-code boundary
- browser / OS / CPU architecture targets
- release/deploy target

次に実versionに対応するcurrent official documentationを調査する。

優先順位:

1. framework/runtime/SDK official quality/testing guidance
2. official examples/templates/starters
3. official first-party Actions / CI examples
4. official language/toolchain guidance
5. coherent existing project configuration
6. established maintained ecosystem tooling
7. custom tooling

存在しない「公式推奨」を捏造しない。

## 2. Verification taxonomy

project固有profileへ最低限、必要なtest levelの意味を定義する。

名称はframework慣習に合わせて変更できるが、責務を混同しない。

### Unit test

**1つの小さいlogic/component/moduleのbehaviorを、外部boundaryを最小化して高速に検証する。**

主な対象:

- pure/domain logic
- parser / validator / scheduler / algorithm
- state transition
- isolated component behavior
- error handling branch

目的:

- logic regressionを局所的・高速に検出
- failure locationを狭くする

unit testだけでDB/API/runtime wiringの正しさを証明しない。

### Smoke / connectivity test（疎通テスト）

**systemまたは主要serviceが起動し、主要boundaryが最低限接続可能で、critical pathの入口が成立することを安価に検証する。**

主な対象:

- process/service startup
- health/readiness endpoint
- application -> DB connection
- application -> cache/queue connection
- frontend -> API basic request
- required migration/schema availability
- desktop/mobile app launch
- packaged artifact startup

疎通testはdeep behavior correctnessではなく「配線が成立しているか」を見る。

unit/integration testがgreenでも、設定・DI・port・env・migration・packagingが壊れていればsmoke testで落とす。

### Integration test（結合テスト）

**2つ以上のreal boundary/componentを組み合わせ、interface・data flow・transaction等が実際に成立することを検証する。**

主な対象:

- API + service + database
- repository + real/test DB
- queue producer + consumer
- auth middleware + endpoint
- filesystem/network adapter + domain
- frontend data layer + API contract
- migration + application read/write

mockだけでboundary contractを再現したtestをreal integration testと偽らない。

外部SaaSはsandbox/test double/contract testを選択できるが、何をrealに検証しているか明示する。

### Contract / schema test

projectに意味がある場合は独立levelとして使う。

対象:

- OpenAPI / GraphQL / protobuf
- DB schema compatibility
- event/message schema
- generated client/server compatibility
- public SDK/API contract

### E2E / system test

**user-visibleまたはsystem-level critical flowを、productionに近い境界構成でend-to-endに検証する。**

主な対象:

- sign-in -> operation -> persistence -> rendered result
- purchase/scheduling/upload等のcritical journey
- browser/native interaction
- cross-service workflow
- release-like environment smoke + critical scenarios

E2Eですべてのedge caseを網羅しない。slow/flakyなE2Eでunit/integrationの責務を代替しない。

### Manual / visual verification

UI/UX、native platform、hardware integration等でautomationが十分でない場合のみ明示的gateとして定義する。

manual verificationを暗黙の「見た感じOK」にしない。手順・期待結果・artifactを残す。

## 3. 動作確認ゲートを変更riskから決める

全ticketに全test levelを機械的に要求しない。

変更前に最低限判定する:

- 変更したlogic
- 変更したboundary
- runtime/configuration変更
- persistence/schema変更
- user-visible flow変更
- deployment/package変更
- security-sensitive path変更
- failure時のimpact

代表的なdefault:

| Change | Minimum verification candidate |
| --- | --- |
| pure/domain logic | unit |
| API/service behavior | unit + integration |
| DB query/schema/migration | integration + migration/schema check + smoke |
| runtime/env/DI/network wiring | smoke + relevant integration |
| frontend component local behavior | unit/component |
| user journey/navigation/auth | integration/contract + E2E |
| external API adapter | unit + contract/integration + failure-path test |
| build/package/container | build/package + smoke |
| release branch | full applicable integration + critical E2E/smoke + release-specific checks |
| security fix | regression test + vulnerable-path verification + applicable integration/E2E |

これはfixed universal matrixではない。framework official guidanceとproject architectureでcompileする。

## 4. Quality profileをproject-localにcompileする

通常taskで毎回再調査しなくて済むよう、**再現可能なcanonical quality profileをrepository-controlled stateとして必ず保存する。**

profileはproject conventionsに合う場所へ置く。標準候補は `quality/profile.yaml`、`quality/profile.json`、または同等のmachine-readable project-local configとし、既存のcanonical configがある場合はそれを再利用する。

profileには最低限:

- `schema_version`
- profile version / updated-at or source revision
- detected framework/runtime/SDK versions
- official guidance source referencesと確認時点
- test taxonomyとproject内の具体例
- change-type -> required verification mapping
- fast worker gate
- ticket integration gate
- release gate
- canonical validation entry points
- required CI checks
- coverage policy when meaningful
- browser/device/OS/architecture matrix
- artifact/report paths
- failure policy

を持たせる。

worker / integration / releaseの各gateには、agentとCIが同じsemanticsで呼べるstable deterministic entry pointを**必須**で定義する。

例:

```text
validate:fast
validate:integration
validate:release
```

実command名はproject conventionに合わせる。

例外として、platform制約等で1つのlocal commandへ完全統合できない場合は、profileにその適用条件・runner/platform・required evidenceを明示し、agent/CIが別々の暗黙gateを選ばないようにする。

## 5. 調査だけで終わらず実装する

初期化完了とはrecommendation reportを書くことではない。

必要なら実際に追加・修復する:

- formatter / linter / static-analysis config
- compiler / type-check config
- unit/component test infrastructure
- smoke/connectivity test infrastructure
- integration/contract/E2E infrastructure
- framework/platform-specific validation
- documentation tests
- dependency/static analysis
- coverage configuration
- schema/migration validation
- browser/device/OS/architecture matrices
- production build/package checks
- code/dependency/security checks
- project-local specialized Agent Skills
- `.github/workflows/*`
- required CI check structure

既存の高品質な構成を理由なく置換しない。

## 6. Framework-native checksを優先する

一般toolを機械的に追加する前にframework/runtimeの標準checkを確認する。

同じ責務のtoolを重複導入しない。

frameworkが特定領域をE2E/real runtimeで検証することを推奨する等、test levelにofficial constraintがある場合はgateへ反映する。

## 7. Agent Skills / toolingもstack-awareにする

必要なspecialized workflowについてofficial / maintained Agent Skills、CLI、LSP、plugin、MCP等を調査する。

優先:

1. existing deterministic project command
2. framework/runtime official CLI
3. short project-local Skill wrapping deterministic tools
4. native agent capability
5. 明確な優位があるplugin/MCP

## 8. GitHub Actions

GitHub Actionsを使用するprojectではlocal gateとCI gateを同じsemanticsへ揃える。

初期化時にcurrent official GitHub Actions guidanceとframework/runtime公式CI exampleを確認する。

検討:

- first-party setup actions
- cache
- matrix testing
- service containers
- browser/device dependencies
- artifacts / reports
- dependency/security checks
- concurrency/cancellation
- least-privilege permissions
- secrets
- action version/pinning
- trusted/untrusted PR behavior

Actionsを増やすこと自体を目的にしない。CIだけのhidden test logicを増やさずproject-local validation entry pointを呼ぶ。

## 9. Worker gate

workerは担当scopeの高速feedbackを得る。

canonical quality profileのworker entry pointと変更risk mappingからfocused test/checkを選択する。

Worker gateはIntegration gateの代替ではない。

## 10. Ticket integration gate

`<issue-number> -> release-x-y-z` のcandidateをclean environmentで、canonical integration entry pointから検証する。

最低限:

- acceptance criteriaに対応するverification
- changed boundaryに必要なunit/smoke/integration/contract/E2E
- formatter/lint/type/static/build等のapplicable checks
- required CI checks

「all unit tests green」だけをintegration completionにしない。

## 11. Release gate

`release-x-y-z -> main` 前にcanonical release entry pointからticketより広いrelease-level verificationを行う。

必要に応じて:

- full integration suite
- clean production build/package
- release artifact smoke test
- critical user-journey E2E
- supported browser/device/OS matrix
- migration rehearsal
- packaging/signing/notarization
- deployment/IaC validation
- upgrade/backward-compatibility
- release-like environment smoke

## 12. PR Done gate

- Issue acceptance criteriaを満たす
- required verification levelを満たす
- required CI/checks成功
- blocking review解消
- known limitationを隠さない
- target releaseとのstaleness確認

## 13. False green禁止

禁止:

- skipped test / `.only`
- blanket ignore/suppression
- ignored exit code / `|| true`
- no-fail option
- CI check disabling
- broad generated-code excuse
- mock-only testをreal integrationと報告
- manual check未実施を「動作確認済み」と報告
- coverage threshold低下や不当exclude

## 14. Coverageは固定万能指標にしない

coverageは有用なtestable sourceでproject-specific policyとして利用する。

framework guidance、risk、code type、existing baselineを優先する。

coverageが適切でない領域では別のdeterministic signalへ置き換える。

## 15. Re-evaluation triggers

次の場合はquality profileを再compileする:

- framework/runtime upgrade
- official testing guidance変更
- architecture boundary変更
- new app/platform target
- CI workflow変更
- flaky/slow gateが開発速度を阻害
- escaped regressionがgateの穴を示した
- release process変更

quality gate自体をversioned project configurationとして扱う。
