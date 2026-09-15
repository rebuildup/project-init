# Eval scenario: comparative latent evaluation, read cold

このevalは `skills/policy-evaluation/SKILL.md` のcomparative latent evaluation contractをfresh agentが利用できるか確認します。

## Latent half

fresh agentへ **`skills/policy-evaluation/SKILL.md` だけ**を渡してください。README、grader、fixtures、作成経緯、期待回答は渡しません。

次をpromptします。

> You are designing an evaluation that compares a baseline agent policy with a candidate policy.
>
> Constraints:
> - Both conditions can run the same task set.
> - The operator has user-global plugins, hooks, memory, and output-style settings enabled.
> - The CLI default model may change between machines or releases.
> - A judge can score both conditions.
> - The provider is paid and may fail partway through a long run.
>
> Return exactly these seven lines as your entire response:
>
> ```text
> parity=<parity>
> runner=<runner>
> identity=<identity>
> judge=<judge>
> labels=<labels>
> gate=<gate>
> run=<run>
> ```
>
> Use only these values:
>
> - parity: `same-cases-model-trials-rubric|different-conditions`
> - runner: `isolated|ambient-user-config`
> - identity: `pin-or-record|implicit-default`
> - judge: `blind-paired|named-separate`
> - labels: `deterministic-per-group|fixed-position`
> - gate: `critical-nonregression|weighted-total-only`
> - run: `budgeted-resumable|unbounded-restart`
>
> Do not execute commands or write files. Do not add explanation.

The eval runner must capture those seven response lines verbatim into `/tmp/comparative_policy_eval_answer.txt`.

## Deterministic half

```bash
bash evals/policy-evaluation/comparative-grade.sh /tmp/comparative_policy_eval_answer.txt
```

## Controls

```bash
bash evals/policy-evaluation/comparative-controls.sh
```

Expected:

- comparative negative fixture -> FAIL
- comparative regression fixture -> FAIL
- comparative positive fixture -> PASS

The regression fixture intentionally keeps condition parity and identity recording while allowing ambient user configuration, named/separate judging, fixed-position labels, weighted-total-only gating, and unbounded restart behavior.
