# Agent Policy Evals

このdirectoryは、Agent policy / Skillが「存在する」だけでなく、fresh agentがcold contextから意図したbehaviorを再現できるかを検証するためのrepository-controlled evalを管理します。

## Model

policy verificationを2つに分けます。

- **deterministic checks**: command / config / file / schema / metadata / exact relationship等、同じinputなら同じ結果を要求できるもの
- **latent evals**: prioritization / decomposition / escalation / review等、agentがpolicyを読んで判断する必要があるもの

latent evalのmodel invocation自体はprovider固有runnerへ固定しません。scenarioとgrader / controlsをrepositoryへ保持し、manual runner / CI service / local agentのどれからでも同じanswer artifactを採点できるようにします。

## Required controls

graderをquality evidenceとして使う前に、最低限次を確認します。

1. negative controlがFAILする
2.過去のbroken behaviorを表すregression controlがFAILする
3. current valid behaviorを表すpositive controlがPASSする

表面shapeが正しくてもcritical invariantを破るanswerはFAILさせます。

## Current evals

- `policy-evaluation/execution-profile-scenario.md` — execution profile / deterministic-latent separation / cold review routing

controls:

```bash
bash evals/policy-evaluation/controls.sh
```

fresh agentのanswerを採点:

```bash
bash evals/policy-evaluation/grade.sh /path/to/answer.txt
```
