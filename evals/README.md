# Organization / Agent Policy Evals

このdirectoryは、Constitution / Operating Model / Practice / Skillが「存在する」だけでなく、resulting organizationが必要なinvariant/outcomeを維持し、fresh agentがcold contextから必要なjudgmentを再現できるかを検証するrepository-controlled evalを管理します。

## Model

policy verificationを2つに分けます。

- **deterministic checks**: command / config / file / schema / metadata / exact relationship等、同じinputなら同じ結果を要求できるもの
- **latent evals**: prioritization / decomposition / escalation / review / refinement等、agentがpolicyを読んで判断する必要があるもの
- **formal model**: concurrency / identity / authority / progress等のabstract organizational semanticsについてcounterexampleを探索するもの

latent evalのmodel invocation自体はprovider固有runnerへ固定しません。scenarioとgrader / controlsをrepositoryへ保持し、manual runner / CI service / local agentのどれからでも同じanswer artifactを採点できるようにします。

## Comparative latent evaluation

baseline / candidateのlatent behaviorを比較する場合は、paired comparisonを優先します。

- cases / prompts / model / material generation settings / trials / rubric / tool environmentをcondition間でそろえる
- runnerをuser-level Skills / plugins / hooks / memory / output style / global config等から隔離する
- model / runner / cases / rubric / policy revisionをpinまたはresultへ記録する
- graderへcondition名を見せる必要がなければopaque labelへblindし、per-groupのlabel orderはdeterministicに入れ替える
- same case / trialのconditionsを同じjudge callまたは同じbatchで比較する
- blockerをhard failureとし、correctness / safety等のcritical dimensionはweighted totalで相殺しない
- paid evalにはbudget guardを置き、completed `(case, trial, condition, runner)` を再実行せずresumeできるresult formatを優先する

比較条件が一致しないscoreを直接比較しない。provider-specific runnerはcanonical dependencyにしません。

## Required controls

graderをquality evidenceとして使う前に、最低限次を確認します。

1. negative controlがFAILする
2.過去のbroken behaviorを表すregression controlがFAILする
3. current valid behaviorを表すpositive controlがPASSする

表面shapeが正しくてもcritical invariantを破るanswerはFAILさせます。

## Current evals

- `policy-evaluation/text-contracts.mts constitutional-contract` — Constitutionの必須property / layer separation / formal model wiringを確認するdeterministic check
- `policy-evaluation/text-contracts.mts merge-method-contract` — current release-driven profileのPR landingがmerge commit onlyで、squash/rebase merge無効化とexecutorの`merge`明示が維持されることを確認するdeterministic check
- `policy-evaluation/text-contracts.mts mise-toolchain-contract` — miseがproject-local toolchain/bootstrap Practiceとしてprofile / onboardingに定義され、promptからprofileへroutingされ、Constitutionへtool名が漏れず、native version authority・fallback境界が維持されることを確認するdeterministic check
- `policy-evaluation/text-contracts.mts herdr-orchestration-contract` — adaptive fan-out / fan-in、Herdr Supervisor routing、telemetry/admission境界、Constitution layer separationを確認するdeterministic check
- `policy-evaluation/worktree-lifecycle-contract.sh` — Worktrunk（`.config/wt.toml`）とOrca（`orca.yaml`）が同じ `mise run worktree:*` を呼ぶこと、frontend固有のtemplateや `.worktreeinclude` のglobを使わないこと、`scripts/worktree/` がbranchごとに決まった値を返し何度実行しても同じ状態になることを確認するdeterministic check
- `policy-evaluation/vendored-skills-contract.mts` — `skills-lock.json` で導入した外部Skillのfileがcommitされ、内容がlockの `computedHash` と一致し、`skills/` で同名を公開していないことを確認するdeterministic check。`writing-discipline` のevalは正本の rebuildup/writing-skills にある
- `policy-evaluation/skill-catalog-contract.sh` — `catalog/` の能力一覧と候補記録の形式、single能力の担当が1つであること、routerを担当にしないこと、自作Skillの記録漏れ、promptから `skill-selection` へのroutingを確認するdeterministic check
- `policy-evaluation/text-contracts.mts cloudflare-cli-contract` — Cloudflare projectで`cf` primary / Wrangler explicit fallbackがprofile / ADRに定義され、promptからprofileへroutingされ、provider-specific tool名がConstitutionへ漏れないことを確認するdeterministic check
- `policy-evaluation/constitutional-refinement-scenario.md` — current Practiceより強いnative mechanismをtool-name complianceで拒否せず、上位guaranteeからrefinement判断できるかを確認するcold scenario
- `policy-evaluation/execution-profile-scenario.md` — execution profile / deterministic-latent separation / cold review routing
- `interaction-discipline/scenario.md` — agent ownership / blocker presentation / user escalation / tangent / persistent-writing routing
- `policy-evaluation/comparative-scenario.md` — condition parity / runner isolation / identity pinning / blind paired judging / release gate / budgeted resumability
- `skills-cli-materialization/scenario.md` — Skills CLIによるproject-local Agent Skillのmaterialization contract（discovery / install / frontmatter parseability / global install禁止 / provenance / generated linkの二重追跡防止 / reference完全性）。deterministic check + live end-to-end
- `linear-release-control/scenario.md` — GitHub / Linear間のsource-of-truth / mirror / worker access / coding session baseline / project mappingのcanonical rule
- `release-batching/controls.mts` — 週次計画と可変releaseの判断記録を検査するstructural grader。hold / frozen candidate / release authorizedのpositiveと、未承認release・古いSHAのgate・freeze中landing・ファイル数だけの判断等のnegativeを実行する。これはinput evidenceの真実性やrelease価値の優劣を証明しない。
- `policy-evaluation/context-budget.sh` — root / always-on instructionsと各conditional Skillをchecked-in baselineに対して測定するdeterministic regression check

controls:

```bash
bun evals/policy-evaluation/text-contracts.mts constitutional-contract
bun evals/policy-evaluation/text-contracts.mts merge-method-contract
bun evals/policy-evaluation/text-contracts.mts mise-toolchain-contract
bun evals/policy-evaluation/text-contracts.mts herdr-orchestration-contract
bun evals/policy-evaluation/text-contracts.mts cloudflare-cli-contract
bash evals/policy-evaluation/skill-catalog-contract.sh
bun evals/policy-evaluation/vendored-skills-contract.mts
bash evals/policy-evaluation/worktree-lifecycle-contract.sh
bash evals/policy-evaluation/constitutional-refinement-controls.sh
bash evals/policy-evaluation/controls.sh
bun evals/interaction-discipline/controls.mts
bash evals/policy-evaluation/comparative-controls.sh
bun evals/linear-release-control/controls.mts
bun evals/release-batching/controls.mts
bash evals/skills-cli-materialization/controls.sh
bash evals/policy-evaluation/context-budget.sh
```

fresh agentのanswerを採点:

```bash
bash evals/policy-evaluation/grade.sh /path/to/execution-profile-answer.txt
bash evals/policy-evaluation/constitutional-refinement-grade.sh /tmp/constitutional_refinement_answer.txt
bun evals/interaction-discipline/grade.mts /path/to/interaction-answer.txt
bash evals/policy-evaluation/comparative-grade.sh /path/to/comparative-answer.txt
bun evals/linear-release-control/grade.mts /path/to/linear-release-answer.txt
```


### Constitutional refinement result artifact

For `constitutional-refinement-scenario.md`, run a fresh agent with only the scenario and the minimum referenced policy required to interpret the layer/refinement contract. Capture the ten response lines verbatim at:

```text
/tmp/constitutional_refinement_answer.txt
```

Then run:

```bash
bash evals/policy-evaluation/constitutional-refinement-grade.sh /tmp/constitutional_refinement_answer.txt
```

The checked-in negative/regression/positive fixtures are exercised by `constitutional-refinement-controls.sh`.
