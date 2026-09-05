# Contributing

このrepositoryはAI coding agent初期化ポリシーそのものを管理します。

## 基本方針

変更時は `PROMPT.ja.md` と `PROMPT.en.md` のoperational semanticsを一致させてください。

日本語版をprimary specificationとして扱って構いませんが、release/merge前に英語版へ同じ意味を反映してください。

`CODEX_ROLES.ja.md` と `CODEX_ROLES.en.md` もrole policyを変更する場合は同一変更で同期してください。

## 変更時に確認すること

- project-local原則を弱めていないか
- root agent fileへ詳細ルールを詰め込む方向へ戻っていないか
- Skillによるprogressive disclosureを維持しているか
- deterministic verificationを主観的判断へ置き換えていないか
- official architecture guidance優先を弱めていないか
- user-requested scopeを独自MVPへ縮小する余地を増やしていないか
- hidden state / unrecoverable local stateを増やしていないか
- Windows/WSL ContainersとNixOSの前提を壊していないか
- `.env` / `.tmp/` / `.reference/` のpolicyと矛盾しないか
- canonical Git remote/refをSoTとして維持しているか
- implementation workerごとのexecution isolationを弱めていないか
- worktree単体をisolation boundaryとして再導入していないか
- parent/child delegationがimmutable snapshot/resultで表現できるか
- Supervisor外のworkerへhost-level sandbox管理権限を渡していないか
- top-level PR integrationとbranch ownershipが曖昧になっていないか
- multi-agent parallelismがdependency graphとresource limitsに基づいているか

## Multi-agent policy invariants

現在のcanonical multi-agent modelはADR-0003です。

主要不変条件:

- Git remote / canonical refがproject SoT
- 1 implementation worker = 1 isolated mutable runtime
- worktree-only isolationは禁止
- immutable/cacheable stateのみ共有し、mutable runtime stateは隔離
- parent -> childはimmutable snapshot
- child -> parentはimmutable commit/ref/diff
- Supervisorがsandbox/agent lifecycle、budget、credential、integrationを管理
- workerが同じworking tree / Git index / branchを同時更新しない
- top-level taskはindependent integration branch / PR
- nested workerはephemeral refs/commitsで統合可能

これらを変更する場合はADRを追加してください。

## Time-sensitive rules

次は時点依存です。

- Codex model lineup / pricing / role allocation
- native subagent / sandbox behavior
- plugin / MCP / ACP / Agent Skills ecosystem
- sandbox/runtime/provider ecosystem
- framework recommended architecture
- testing / linting / dependency-analysis tools

更新時はcurrent official sourceを確認してください。

Codex role policyの時点表記が古くなった場合は `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` を同期更新し、decision自体が変わる場合は必要に応じて新ADRを作成してください。

## ADR

長期的な設計思想を変える変更はADR対象です。

例:

- project-local以外のscopeを標準化
- canonical Git SoT modelを変更
- worktree-only isolationを許可
- Supervisor architectureを変更
- immutable snapshot/result protocolを変更
- source/document language policyを変更
- Python script禁止を変更
- standard quality gateを緩和
- coverage thresholdを変更
- Codex model-role strategyを変更
- Agent Skills以外を主要detail-disclosure mechanismに変更

以前のADRをrevise / supersedeする場合:

- 新ADRから旧ADRを参照
- 旧ADRから新ADRを参照
- 変更されたdecision範囲を明示

してください。

## Git messages

このrepository自体でもGit / GitHub messageは英語を使用してください。

commit format:

`<prefix>: <very concise title>`

空行の後に必要なsummary bulletを置いてください。

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
- role policy変更時の `CODEX_ROLES.ja.md` / `CODEX_ROLES.en.md` 意味同値性
- broken Markdown structureがないこと
- conflicting rulesがないこと
- ADR reference整合性
- READMEの説明とprompt本体の一致
- old shared-main / worktree-only assumptionsが残っていないこと
- parent/child snapshot/result semanticsが一貫していること

を確認してください。
