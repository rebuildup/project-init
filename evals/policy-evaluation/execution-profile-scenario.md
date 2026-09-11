# Eval scenario: execution profile routing, read cold

このevalは `skills/policy-evaluation/SKILL.md` のexecution profile、deterministic / latent分離、cold review contractがfresh agentから利用可能かを確認します。

## Latent half

fresh agentへ **`skills/policy-evaluation/SKILL.md` だけ**を渡してください。README、grader、fixture、作成経緯、期待回答は渡しません。

次をpromptします。

> Read the project policy supplied to you. Classify the following four tasks using that policy.
>
> A. README内の1文字のtypoだけを修正する。意味・リンク・構造は変わらない。
> B. Public APIのfieldを変更し、DB schema、server handler、generated client、Web UIが同時に影響を受ける。
> C. 新規user向けonboarding flowをゼロから設計する。product semanticsとUX trade-offが中心で、reference/rubricはまだない。
> D. 毎回同じinput schemaから同じGitHub metadata JSONへ正規化する作業を、複数ticketで繰り返している。
>
> Write exactly these six lines to `/tmp/policy_eval_answer.txt`:
>
> ```text
> A profile=<profile> space=<space> execution=<execution> review=<review>
> B profile=<profile> space=<space> execution=<execution> review=<review>
> C profile=<profile> space=<space> execution=<execution> review=<review>
> D profile=<profile> space=<space> execution=<execution> review=<review>
> reviewer_context=<value>
> self_rating=<value>
> ```
>
> Use only these values:
>
> - profile: `mechanical|localized|cross-boundary|judgment-heavy`
> - space: `deterministic|latent|mixed`
> - execution: `solo|decompose|evidence-first|codify`
> - review: `none|cold`
> - reviewer_context: `artifact-only|builder-reasoning`
> - self_rating: `not-a-gate|score`
>
> Do not execute commands. Do not explain the answer outside the file.

## Deterministic half

```bash
bash evals/policy-evaluation/grade.sh /tmp/policy_eval_answer.txt
```

The grader checks both routing shape and safety invariants. Correct profile names alone are insufficient.

## Controls

Before trusting a score:

```bash
bash evals/policy-evaluation/controls.sh
```

Expected:

- negative fixture -> FAIL
- regression fixture -> FAIL
- positive fixture -> PASS

The regression fixture intentionally keeps much of the superficial routing shape correct while leaking builder reasoning into review, using self-rating as a gate, and failing to codify repeated deterministic work.
