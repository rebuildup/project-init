# Contributing

このrepositoryはAI coding agent初期化ポリシーそのものを管理します。

## 基本方針

変更時は `PROMPT.ja.md` と `PROMPT.en.md` の意味を一致させてください。

日本語版をprimary specificationとして扱って構いませんが、release/merge前に英語版へ同じ意味を反映してください。

単なる直訳より、両言語で同じoperational semanticsになることを優先してください。

## 変更時に確認すること

- project-local原則を弱めていないか
- root agent fileへ詳細ルールを詰め込む方向へ戻っていないか
- Skillによるprogressive disclosureを維持しているか
- deterministic verificationを主観的判断へ置き換えていないか
- official architecture guidance優先を弱めていないか
- user-requested scopeを独自MVPへ縮小する余地を増やしていないか
- hidden state / global dependencyを増やしていないか
- Windows/WSL ContainersとNixOSの前提を壊していないか
- `.env` / `.tmp/` / `.reference/` のpolicyと矛盾しないか
- Git main-only / no-worktree policyと矛盾しないか
- subagent file ownership / serialized commit policyと矛盾しないか

## Time-sensitive rules

次のような内容は時点依存です。

- Codex model lineup / pricing / role allocation
- plugin / MCP / Agent Skills ecosystem
- framework recommended architecture
- testing / linting / dependency-analysis tools

更新時は現在のofficial sourceを確認してください。

特にCodexのSol / Terra / Luna方針は2026年8月時点のpolicyです。

状況が変わった場合は、単にprompt本文だけを書き換えるのではなく、必要に応じて新ADRを作成し、旧ADRとのforward/backward referenceを維持してください。

## ADR

長期的な設計思想を変える変更はADR対象です。

例:

- project-local以外のscopeを許可する
- worktree禁止を変更する
- source/document language policyを変更する
- Python script禁止を変更する
- standard quality gateを緩和する
- coverage thresholdを変更する
- Codex model-role strategyを変更する
- Agent Skills以外を主要なdetail-disclosure mechanismに変更する

既存ADRをsupersedeする場合:

- 新ADRから旧ADRを参照
- 旧ADRから新ADRを参照
- 旧ADRのstatusを明示的に更新

してください。

## Git messages

このrepository自体でもGit / GitHub messageは英語を使用してください。

commit format:

`<prefix>: <very concise title>`

空行の後に必要なsummary bulletを置いてください。

例:

```text
docs: refine architecture policy

- prioritize explicit first-party architecture guidance
- clarify unopinionated framework handling
```

## Pull Requests

PRには最低限:

- change summary
- motivation
- semantic differences between JP/EN, if any
- affected ADRs
- time-sensitive sources checked, when applicable

を記載してください。

## Validation

変更後は最低限:

- `PROMPT.ja.md` と `PROMPT.en.md` のmajor section対応
- broken Markdown structureがないこと
- conflicting rulesがないこと
- ADR reference整合性
- READMEの説明とprompt本体の一致

を確認してください。
