# Review Finding Ledger (#123)

GitHub への Issue / PR review 投稿が権限・rate-limit・validation・own-PR `REQUEST_CHANGES` 制約・network 障害で失敗した場合でも finding を失わず、重複起票防止・exact-head 解消検証・再発検出を行う専用台帳モジュール。

共通 Skill 本文へ実装詳細を詰め込まず、データスキーマと状態遷移の所有権をこのディレクトリへ分離している。

## 状態と契約

- `postingState`: `pending` / `posted` / `not-posted`（失敗時は `failureReason` に `permission` / `rate-limit` / `validation` / `own-pr-request-changes` / `network` を記録）
- `recurrenceClass`: `one-off` / `recurring` / `systemic`
- `verificationStatus`: `open` / `resolved`（40 桁 exact head SHA + 検証コマンド必須）/ `recurred`
- `actionClass`: 客観的欠陥の自動起票候補（`objective-finding`）と、人間承認が必要な scope/target 変更（`scope-change-requires-owner-approval`）を分離。

## テスト

```bash
bun run test:review-findings
```
