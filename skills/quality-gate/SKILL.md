---
name: quality-gate
description: worker resultやPRをDone判定する前にdeterministic validationを実行・評価する時に使用する。
---

# Quality Gate

実装ticketの完了は主観ではなくprojectのdeterministic checksで判定する。

## Worker gate

担当scopeで必要なfocused validationを実行する。

例:

- formatter/check
- lint
- type-check
- focused unit/integration tests
- changed package build

## Integration gate

Coordinatorまたは専用verification agentがclean integration candidateからfull applicable suiteを実行する。

例:

- formatter/check
- lint
- type-check
- dependency/static analysis
- unit/component/integration/E2E tests
- coverage
- build
- container/IaC validation
- dependency/security audit

## PR Done gate

- Issue acceptance criteriaを満たす。
- required CI/checksが成功する。
- Reviewerのblocking指摘が解消される。
- known limitationを隠さない。
- base stalenessを確認する。

## False green禁止

- skipped test
- `.only`
- blanket ignore/suppression
- ignored exit code
- `|| true`
- no-fail option
- CI check disabling
- coverage threshold低下や不当なexclude

projectから修正不能なupstream warningが残る場合は明示し、完全cleanと表現しない。

meaningful testable sourceのcoverageは原則80%以上を維持する。
