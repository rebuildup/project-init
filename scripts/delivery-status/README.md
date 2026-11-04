# Delivery status（横断レポート）

Issue → PR → release branch → `main` の経路で滞留している作業を、複数リポジトリについて読み取り専用で一覧する。Issue rebuildup/project-init#150 の実装。

検出対象:

- open PR: CI の最新結果（head commit の check rollup）、CONFLICTING、base が default branch に統合済みの STALE-BASE、draft 状態、最終更新からの経過日数
- `release-*` ブランチ: default branch より先行する commit 数、対応する open release PR の有無（無ければ UNRELEASED-COMMITS）、default branch に完全に含まれる残存ブランチ（MERGED-STALE-BASE）

## 使い方

```sh
node scripts/delivery-status/delivery-status.mts                      # 既定の3リポジトリ
node scripts/delivery-status/delivery-status.mts --repo owner/name    # 対象を指定（繰り返し可）
node scripts/delivery-status/delivery-status.mts --json               # JSON 出力
```

既定の対象は `rebuildup/pc-setup`、`rebuildup/dotfiles`、`rebuildup/project-init`。前提は `gh` CLI の認証済みであること。判定ロジックのテストは `bun run test:delivery-status`（`classify.mts` の純粋関数のみを検証する。ネットワーク不要）。

終了コード: `0` 正常、`1` いずれかのリポジトリを評価できなかった（レポートの Errors 節に記載）、`2` 引数誤り。

## フラグ

| フラグ | 意味 |
| --- | --- |
| `CI-FAIL` | head commit の check が失敗（FAILURE / ERROR）。失敗した check 名を併記する |
| `CONFLICTING` | merge conflict（mergeable = CONFLICTING または mergeStateStatus = DIRTY） |
| `STALE-BASE` | base branch が default branch より先行する commit を持たない（統合済み） |
| `BASE-UNKNOWN` | base と default branch の比較に失敗したため判定できない |
| `NO-PR-BODY-CHECKS` | head commit に check rollup が無く、CI 結果を判定できない。緑とは扱わない |
| `UNRELEASED-COMMITS` | `release-*` が default branch より先行し、対応する open release PR が無い |
| `MERGED-STALE-BASE` | `release-*` が default branch に完全に含まれ、ブランチが削除されていない。新規に切ったばかりの zero-diff ブランチも同じ条件になるため、`MERGED_PRS` 列（マージ済み PR 数）と併せて読む |
| `BRANCH-UNKNOWN` | release branch と default branch の比較に失敗した |

不明な状態は必ず `UNKNOWN` / `*-UNKNOWN` として表示し、緑や clean とは推定しない。

## 安全性と権限

- 読み取り専用。merge・comment・label・branch 削除などの変更操作は一切行わない。GitHub API へは GraphQL の query と REST の GET のみを発行する。
- 認証は `gh` に委譲し、token を読み取らず表示もしない。出力に現れうる token 形式の文字列は `[REDACTED]` に置換する。出力は Issue に貼り付けても安全な内容に限定している。
- merge 権限・review 承認は現状のまま。本レポートは検出と可視化のみを行い、github-delivery Skill の authorization boundary を変更しない。

## 定期実行

定期実行は人間が手動で行うか、既存の CI から呼び出す。本スクリプトに自動 merge・自動 close・自律的な scheduler は持たせない。
