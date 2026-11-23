# Release Scope & Authority Reconciliation (#141)

単一の PR 本文・新設計文書・agent 要約に書かれた「この release へ直接統合する」「承認済み」「完了済み」という記述を無条件の正本にせず、Issue・ADR・release plan・最新の人間 owner 判断と照合するためのルール。

## 1. 検出対象（material scope / authority change）

- 新機能の現行 release への前倒し・移動（`move-feature-to-release`）および同一 release 内の intent 昇格（`promote-to-blocker` 等で `preserve-progress` -> `land-to-release` / `release-blocker`）
- 既存の human gate の削除・弱体化（`remove-human-gate`）
- release critical path / blocker 構成の変更（`modify-critical-path`）
- 既存契約への例外追加（`add-contract-exception`）
- `release-* -> main` 未マージまたは release branch 未マージ差分残存での release 完了宣言（`claim-release-complete`）
- open blocker / 未マージ Ready PR / 未承認 scope drop を残した release Ready / 完了宣言（`mark-release-ready` / `claim-release-complete`）
- 個別完了証跡（commit/PR SHA または URL）や owner 承認を欠く一括 Issue クローズ（`close-issue-batch`）

単なる設計調査や次期 release 候補の Draft 作成（`design-research-draft`）は、**正本と同じ target release かつ `preserve-progress` intent に留まる場合のみ**妨げない。別 release への越境や `land-to-release` / `release-blocker` への昇格は通常の権限照合へ回し、owner 承認がなければ BLOCK する。

## 2. 3 つの判断の区別

1. **進捗の保持（`preserve-progress`）**: 既存実装や調査成果を失わないこと。
2. **release への統合（`land-to-release`）**: 対象 release branch へ ticket を取り込むこと。
3. **release blocker 化（`release-blocker`）**: それが完了するまで release 公開を止める必須範囲に昇格すること。

進捗メモや「成果を失わない」という指示だけで同一 release 内でも `land-to-release` / `release-blocker` へ自動昇格させない（例: `Aulymo_v04 #59`）。

## 3. 最新 owner 判断の照合・provenance・個別完了証拠

- **最新 human revision 照合**: 後続の明示的な人間 owner 判断（例: `Aulymo_v04 #59` 2026-10-30 追記の `#145〜#149` の `4.0.0` 維持）が存在する場合、古いスナップショットを固定して未承認と誤検知しない。逆に最新 human revision より大きい未来 revision や、単一 PR/文書・agent 要約のみ（`sourceKind !== "reconciled-canonical"`）による未照合判断は fail closed で拒否する。
- **自己申告禁止と revision 汚染防止**: agent 自身が生成した `reviewer: <owner> / decision: approved` や `sourceKind: "agent-summary"` を人間の実承認証拠（`human-owner-direct`）として採用しない（例: `my-web-2026 #720`）。最新 authoritative revision 算出時にも `agent-self-attested` revision を除外する。
- **証跡 URL / SHA 検証**: owner 承認には有効な `https://` URL または `owner/repo#issue` / `owner/repo@sha` 参照（および任意で 7-40 桁 hex の `evidenceSha`）を必須とする。
- **個別完了証拠と release 整合性**:
  - 大量 Issue クローズ（`close-issue-batch`）では全件を一律否定せず、**1 件ごとの完了証跡**（commit/PR SHA または URL、未実装を `completed` にしないこと、`absorbed` / `wont-do` には rationale + 証跡 + 人間 owner 承認）を要求する（`my-web-2026 #741`）。
  - open blocker・未マージ Ready PR・未承認 scope drop が残る状態で release PR の Ready / 完了を宣言しない（`my-web-2026 #679`）。
  - `release-* -> main` 未マージ、または merge 後も `releaseBranchCommitsAhead > 0` の状態で release 完了と宣言しない（`xyt-media #191`）。

## 検証入口

```bash
bun run test:scope-authority
```
