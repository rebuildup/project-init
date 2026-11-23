# Release Scope & Authority Reconciliation (#141)

単一の PR 本文や新設計文書に書かれた「この release へ直接統合する」という記述を無条件の正本にせず、Issue・ADR・release plan・最新の owner 判断と照合するためのルール。

## 1. 検出対象（material scope / authority change）

- 新機能の現行 release への前倒し・移動（`move-feature-to-release`）
- 既存の human gate の削除・弱体化（`remove-human-gate`）
- release critical path / blocker 構成の変更（`modify-critical-path`）
- 既存契約への例外追加（`add-contract-exception`）
- `release-* -> main` 未マージでの release 完了宣言（`claim-release-complete`）

単なる設計調査や次期 release 候補の Draft 作成は妨げない。

## 2. 3 つの判断の区別

1. **進捗の保持（`preserve-progress`）**: 既存実装や調査成果を失わないこと。
2. **release への統合（`land-to-release`）**: 対象 release branch へ ticket を取り込むこと。
3. **release blocker 化（`release-blocker`）**: それが完了するまで release 公開を止める必須範囲に昇格すること。

進捗メモや「成果を失わない」という指示だけで release blocker や全面必須 scope へ自動昇格させない（例: `Aulymo_v04 #59`）。

## 3. 最新 owner 判断の照合と自己申告の禁止

- **最新 revision 照合**: 後続の明示的な owner 判断（例: `Aulymo_v04 #59` 2026-10-30 追記の `#145〜#149` の `4.0.0` 維持）が存在する場合、古いスナップショットを固定して未承認と誤検知しない。承認主体・日付・対象 release・scope revision・証跡 URL を照合して Issue / PR / release plan を整合させる。
- **自己申告禁止**: agent 自身が生成した `reviewer: <owner> / decision: approved` 等のテキスト記録を、人間の実承認証拠（`human-owner-direct`）として採用しない（例: `my-web-2026 #720`）。
- **個別完了証拠**: 大量クローズや release PR の Ready 状態だけで個別 Issue の完了・release 統合完了を推定しない（`my-web-2026 #741/#679`, `xyt-media #191`）。

## 検証入口

```bash
bun run test:scope-authority
```
