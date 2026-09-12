# Agent Policy Evals

このdirectoryは、Agent policy / Skillが「存在する」だけでなく、fresh agentがcold contextから意図したbehaviorを再現できるかを検証するためのrepository-controlled evalを管理します。

## Model

policy verificationを2つに分けます。

- **deterministic checks**: command / config / file / schema / metadata / exact relationship等、同じinputなら同じ結果を要求できるもの
- **latent evals**: prioritization / decomposition / escalation / review等、agentがpolicyを読んで判断する必要があるもの

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

- `policy-evaluation/execution-profile-scenario.md` — execution profile / deterministic-latent separation / cold review routing
- `policy-evaluation/comparative-scenario.md` — condition parity / runner isolation / identity pinning / blind paired judging / release gate / budgeted resumability
- `policy-evaluation/context-budget.sh` — root / always-on instructionsと各conditional Skillをchecked-in baselineに対して測定するdeterministic regression check

controls:

```bash
bash evals/policy-evaluation/controls.sh
bash evals/policy-evaluation/comparative-controls.sh
bash evals/policy-evaluation/context-budget.sh
```

fresh agentのanswerを採点:

```bash
bash evals/policy-evaluation/grade.sh /path/to/execution-profile-answer.txt
bash evals/policy-evaluation/comparative-grade.sh /path/to/comparative-answer.txt
```
