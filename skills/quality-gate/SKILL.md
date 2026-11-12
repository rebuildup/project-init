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
- GitHub PR topology: independent / stacked / release trunk

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

### E2E / System test

**user-facingな主要journeyを、実環境または十分に近い環境でend-to-endに検証する。**

主な対象:

- critical user journey (login, checkout, submit, etc.)
- cross-service workflow
- multi-tenant隔離
- real browser / mobile device / desktop app

E2Eはcost/flakinessが高いため、critical pathのみに限定し、unit/integrationで吸収可能なものはE2Eに回さない。

### Platform / Native test

**target platform固有の挙動を実機で検証する。**

主な対象:

- iOS/Android実機: permission, background, push, biometrics, store review
- Windows/macOS/Linux desktop: installer, code-sign, sandbox, native API
- Web: cross-browser, accessibility, PWA, Service Worker

CI emulator/simulatorは補助。実機/実OSでの検証を代替しない。

### Performance / Load test

**SLA/latency/throughput境界を負荷下で検証する。**

主な対象:

- API p95/p99 latency
- DB connection pool saturation
- memory/CPU leak under sustained load
- cold start / scaling latency

baselineとのregression検出が目的。absolute数値の追求ではない。

### Contract test

**provider/consumer間のinterface契約を検証する。**

主な対象:

- API schema (OpenAPI, GraphQL, gRPC)
- message queue schema (Avro, Protobuf)
- database migration compatibility

breaking changeの早期検出。schema registryと併用推奨。

### Security / Supply chain test

**脆弱性・悪意ある依存関係・secret漏洩を検出する。**

主な対象:

- SAST / DAST / SCA
- dependency audit (CVEs, malicious packages)
- secret scanning (git history, CI logs, artifacts)
- SBOM generation/verification

false positiveを最小化し、actionable findingのみをgateする。

### Visual / Native review（人間判断が必要な領域）

**UI/UX、native platform、hardware integration等でautomationが十分でないmanual verificationを暗黙の「見た感じOK」にしない。手順・期待結果・artifactを残す。**

UI/native変更で人間レビューが必要な場合は [visual/native review handoff](references/visual-review-handoff.md) に従う。非視覚taskへ一律適用しない。

複数OSで動作する対象は [execution placement](../../organization/execution-placement.md) を適用し、実OS/deviceで検証する。WSL/Windows/macOSは互換ではない。

## 3. Verification Executor / native environment

verificationはimplementation workerと同じworkspace topologyを必須にしない。ADR-0020に従い、検証対象をimmutable candidate identityへpinし、environment identityとevidence provenanceを記録する。

### Verification Executor選択

| executor type | 適用条件 | 備考 |
|---|---|---|
| implementation worker | unit/integration/smoke | 同一workspace、同一toolchain |
| dedicated verification node | E2E/platform/native/contract | 実OS/device、実browser、独立runner |
| CI runner | contract/security/contract | 実network、外部service |

実行場所に関わらず、検証対象のcandidate SHA/build identity/environmentをimmutableに記録する。

## 4. Gate evaluation rules

### Pass条件

- 必要なtest level全てがgreen（required matrixからcompile）
- flaky testはgreen扱いしない（再実行で安定確認後のみ）
- skipped/neutral/staleはpass扱いしない
- 実OS/device未確認をCI emulator成功で代替しない

### Fail条件

- required testが1つでもfail
- flaky testの再現
- 実環境未確認のplatform/native claim
- coverage threshold低下や不当exclude
- predecessor変更後にold SHAのgreen resultを流用

## 5. Coverageは固定万能指標にしない

coverageは有用なtestable sourceでproject-specific policyとして利用する。

framework guidance、risk、code type、existing baselineを優先する。

coverageが適切でない領域では別のdeterministic signalへ置き換える。

## 6. Re-evaluation triggers

次の場合はquality profileを再compileする:

- framework/runtime upgrade
- official testing guidance変更
- architecture boundary変更
- new app/platform target
- CI workflow変更
- PR/stack/release integration model変更
- flaky/slow gateが開発速度を阻害
- Actions usage/costが想定baselineから大きく乖離
- included usage / runner billing model / repository visibility変更
- escaped regressionがgateの穴を示した
- release process変更

quality gate自体をversioned project configurationとして扱う。
