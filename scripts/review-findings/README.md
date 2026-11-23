# Review Finding Ledger (#123)

GitHub への Issue / PR review 投稿が権限・rate-limit・validation・own-PR `REQUEST_CHANGES` 制約・network 障害で失敗した場合でも finding を失わず、重複起票防止・exact-head 解消検証・再発検出・原子的ファイル永続化を行う専用台帳モジュールおよび CLI。

共通 Skill 本文へ実装詳細を詰め込まず、データスキーマ・状態遷移・CLI の所有権をこのディレクトリへ分離している。

## 状態と契約

- **複合キー**: すべての状態遷移（`fail` / `mark-posted` / `resolve` / `approve-scope` / `plan-retry`）は `(repository, findingId)` で一意に識別し、未登録キーに対しては黙って no-op せず明示的に失敗する。
- **`postingState`**: `pending` / `posted` / `not-posted`（失敗時は `failureReason` に `permission` / `rate-limit` / `validation` / `own-pr-request-changes` / `network` を記録）。`own-pr-request-changes` 時は `plan-retry` が `REQUEST_CHANGES` の無限リトライを避けて `post-comment-fallback` を返す。
- **`recurrenceClass`**: `one-off` / `recurring` / `systemic`。未解消（`open`）の finding を再観測しても `one-off` を維持し、一度 `resolved` になった finding が再出現した場合にのみ `verificationStatus: "recurred"` / `recurrenceClass: "recurring"` へ遷移する。
- **`verificationStatus`**: `open` / `resolved`（40 桁 exact head SHA + 検証コマンド必須、同一 `sourceSha` での解消は `resolutionKind: "false-positive" | "waived"` 以外は拒否）/ `recurred`。`recurred` が既存 `OPEN` Issue に一致する場合は黙って `link-existing` せず `comment-recurrence` を返し、`CLOSED` Issue 後に新規起票された場合は旧 URL を `priorIssueUrls` に保持する。
- **重複検出**: 既存 GitHub レコードに `findingId` がある場合は一致しない限り即不一致とし、`findingId` がない場合も `file` + `category` のみでは抑制せず、`fingerprint`・`symbol`・`line`（±5 行）の精密ロケータを要求する。
- **`actionClass`**: 客観的欠陥の自動起票候補（`objective-finding`）と、人間承認が必要な scope/target 変更（`scope-change-requires-owner-approval`）を分離。承認前は `hold-owner-approval`、`approve-scope` で承認 URL を記録して初めて進行する。
- **永続化と秘匿**: `saveLedger` は親ディレクトリ自動作成 + 一時ファイルからの原子的 `rename` を行い、`ghp_` / `github_pat_` / `Bearer` トークンを `[REDACTED]` へ置換してディスクへの漏洩を防ぐ。`loadLedger` は不正 JSON / 不正スキーマを黙殺せずエラーで拒否する。

## CLI の使い方

終了コード: `0` 正常、`1` 台帳/状態/スキーマエラー、`2` 引数誤り。

```bash
# 1. finding を記録（ファイル未作成時は自動初期化）
node scripts/review-findings/cli.mts record \
  --ledger .tmp/findings.json \
  --repo rebuildup/project-init \
  --finding-id project-init:auth-redaction \
  --file src/logger.ts --line 42 --sha 1111111111111111111111111111111111111111 \
  --severity P1 --category security-logging --evidence "raw token logged"

# 2. 投稿失敗を記録
node scripts/review-findings/cli.mts fail \
  --ledger .tmp/findings.json \
  --repo rebuildup/project-init --finding-id project-init:auth-redaction \
  --reason own-pr-request-changes

# 3. リトライ・重複・フォールバック・再発コメントを計画（--write で link-existing を反映）
node scripts/review-findings/cli.mts plan-retry \
  --ledger .tmp/findings.json --existing .tmp/open-issues.json --write

# 4. 投稿完了を記録
node scripts/review-findings/cli.mts mark-posted \
  --ledger .tmp/findings.json \
  --repo rebuildup/project-init --finding-id project-init:auth-redaction \
  --url https://github.com/rebuildup/project-init/issues/999

# 5. exact head SHA と検証コマンドで解消
node scripts/review-findings/cli.mts resolve \
  --ledger .tmp/findings.json \
  --repo rebuildup/project-init --finding-id project-init:auth-redaction \
  --sha 2222222222222222222222222222222222222222 \
  --command "bun test src/logger.test.ts"

# 6. scope 変更のオーナー承認を記録
node scripts/review-findings/cli.mts approve-scope \
  --ledger .tmp/findings.json \
  --repo rebuildup/project-init --finding-id scope:retarget-release \
  --approver rebuildup --evidence-url https://github.com/rebuildup/project-init/issues/141#issuecomment-1

# 7. 台帳サマリを表示
node scripts/review-findings/cli.mts summary --ledger .tmp/findings.json
```

## テスト

```bash
bun run test:review-findings
```
