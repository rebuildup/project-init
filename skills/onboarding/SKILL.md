---
name: onboarding
description: 新規参入者が会話履歴や個人環境に依存せずprojectを理解・起動・検証・開発開始できるdocumentationを初期化・更新する時に使用する。
---

# Onboarding

onboarding documentationは「READMEがある」ことではなく、fresh contributorがproject truthへ自力で到達できることを目的とする。

## 1. Onboarding completion target

新規参入者が会話履歴・個人memory・既存memberの口頭説明なしで最低限次を行える状態にする。

1. projectの目的とscopeを理解
2. architecture / major boundariesを把握
3. local environmentをbootstrap
4. application / serviceを起動
5. test / validationを実行
6. Issueを選びticket branchを作成
7. Draft PRをtarget release branchへ作成
8. decision / design / ADR / Skillの参照先を発見
9. common failureを切り分け

## 2. Document structure

project規模に合わせて最小限に構成する。

候補:

- `README.md`: project overview / first entry point
- `CONTRIBUTING.md`: development workflow / GitHub workflow
- `docs/architecture.md`: system boundaries / dependency direction / data flow
- `docs/development.md`: bootstrap / run / test / validation
- `docs/troubleshooting.md`: recurring failure / diagnosis
- `docs/release.md`: release sprint / version / deployment
- `docs/security.md`: security maintenance / reporting when appropriate
- ADR directory
- design/specification directory
- project-local Agent Skills

巨大な1 documentへ全て詰め込まない。入口から必要なdetailへprogressive disclosureできるようにする。

## 3. README minimum

READMEにはprojectに応じて最低限:

- 何を作るprojectか
- support/target platform
- architecture overviewへのlink
- prerequisites
- canonical bootstrap command
- canonical run command
- canonical validation entry point
- internal docs index
- contribution entry point

を置く。

READMEへ内部実装detailを過剰に置かない。

## 4. Development guide

最低限:

- supported host: macOS / WSL/Linux等
- runtime/sandbox bootstrap
- dependency install
- env setup
- DB migration/seed
- app/service startup
- local preview / port access
- worker/integration/release validation commands
- generated code handling
- common cache/reset operations

を実repoのcommandから記述する。

存在しないcommandや古いsetupを推測で書かない。

## 5. Architecture guide

visual/structuralに把握できるよう、必要ならMermaid等で次を示す。

- major components/services
- dependency direction
- data flow
- external systems
- persistence boundaries
- trust/security boundaries
- build/deploy/runtime boundaries

詳細なdecision historyはADRへ分離する。

## 6. Development decision discovery

新規参入者が次の優先順位を発見できるようにする。

`project-wide policy > design/spec/task instruction > existing implementation majority`

root agent instruction / CONTRIBUTING / development docsから、canonical policy・design・ADR・Skillsへの導線を明示する。

## 7. GitHub workflow guide

明示する:

```text
main
└─ release-x-y-z
   └─ <issue-number>
```

- Issue/PRは日本語
- commitは英語
- ticket branchはIssue番号のみ
- ticket PR baseはtarget release branch
- release PRは `release-x-y-z -> main`
- Draft -> Ready -> merge -> Doneの条件

## 8. Documentation verification

docsもquality gateの対象にする。

可能なら:

- documented commandsをCI/fresh sandboxで実行
- broken links検出
- setup pathをfresh environmentで確認
- version-sensitive instructionsをupgrade時にreview

「READMEには書いてあるがfresh cloneでは動かない」を許容しない。

## 9. Update triggers

次の場合はonboarding docsを更新する。

- bootstrap/run/validation command変更
- architecture boundary変更
- framework/runtime migration
- environment/host support変更
- release workflow変更
- recurring troubleshooting knowledgeが増えた
- security/dependency maintenance workflow変更

実装変更でdocsがstaleになるなら同じticket/PR内で更新する。
