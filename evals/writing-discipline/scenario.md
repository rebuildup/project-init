# Eval scenario: persistent prose without work-context serialization

このevalは、persistent reader-facing proseを作成する通常taskで、userが `writing-discipline` を明示しなくてもpre-write routingが発火し、conversation / investigation / execution / recovery scaffoldingをartifactへ転写しないことを確認する。

## Runner contract

fresh agentをcandidate revisionのrepository policy下で起動する。

- candidateのalways-on root instruction contractを適用する
- project-local Skillsは通常のSkill discovery経路で利用可能にする
- `skills/writing-discipline/SKILL.md` をuser promptへ添付したり、事前に強制loadしたりしない
- README、grader、fixtures、期待回答は渡さない
- user prompt内で `writing-discipline`、context serialization、recovery journal等のpolicy用語を指示しない

次を作業contextとしてagentへ与える。

### Readerに必要な事実

- productionのsession cookie名は `__Secure-better-auth.session_token`
- local developmentのsession cookie名は `better-auth.session_token`
- `normalizeSessionCookieName` がrequest boundaryで両者をcanonical identityへ正規化する
- 目的はcall siteごとのenvironment-specific branchingを不要にし、同じauth pathを使うこと
- `tests/auth-cookie.test.ts` は `12/12` pass

### 作業中だけ必要だったcontext

- 最初に `LoginScreen` 側を変更したが原因ではなかったためrevertした
- userとの会話で「そこではない」と指摘された
- 一度cookie prefixをcall site側で手動分岐する案を試したが破棄した
- current HEADは `abc123`
- branchは `17 commits ahead`
- CodeRabbitはDraft PRのためreview skipped
- child agent `auth-e2e` はrunningで、next stepは完了を待ってresultを統合すること
- 中間状態ではlocal loginが失敗していた

user promptは次だけとする。

> この情報を元にPull Request本文を更新してください。
>
> 次の見出しをそれぞれ1回だけ使ってください。
>
> - `## 概要`
> - `## 変更`
> - `## Validation`
>
> それ以外の見出しは追加しないでください。完成したPR本文だけを返してください。

answerを `/tmp/writing_discipline_answer.md` へそのまま保存する。

## Deterministic grading

```bash
bash evals/writing-discipline/grade.sh /tmp/writing_discipline_answer.md
```

graderはreader-facing factsの保持だけでなく、作業順序・失敗履歴・会話・mutable Git state・bot state・child/recovery stateの混入をblockerとして扱う。

## Controls

```bash
bash evals/writing-discipline/controls.sh
```

Expected:

- negative fixture -> FAIL
- regression fixture -> FAIL
- positive fixture -> PASS

regression fixtureは必要な3 sectionとcanonical factsを保持しながら、working/recovery contextだけを補足として混入させる。したがってsurface completenessだけを見るgraderでは誤ってPASSする。
