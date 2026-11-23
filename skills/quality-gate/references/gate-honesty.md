# Gate Honesty — Actual Execution vs Reported Claim (#97)

gate・CI・コードコメントが「実際に検証していないもの」を成功・保証済みと誤認させる欠陥クラスの整理と再発防止契約。

## Fail-closed と Silent pass の区別（必須）

| 分類 | 実例 | 実測挙動 | リスク |
| --- | --- | --- | --- |
| **Fail-closed（安全に停止）** | `u-sekai #78` | `--dir` が `root` を上書きし 0 file 収集 → `exit 1`（Vitest `passWithNoTests: false` 既定） | 検証不能（noise）だが偽の green は作らない |
| **Silent pass（最も危険）** | `ty-plus #179` | file 収集あり・`-t` 不一致や `describe.skip` で実行 0 件 → `exit 0` / `success: true` | aggregate gate が「検証済み」と誤認する |

`passWithNoTests: false` は「収集 file 0 件」しか防がない。各 partition について **`numPassedTests >= 1`（実行・通過件数の下限）**、**`exitCode === 0` 時の `numFailedTests === 0 && reportedSuccess === true`**、および不変条件（負数・件数矛盾・不正 floor の拒否）を実ランナー出力（TAP / Vitest JSON）から直接検証する。

## 記録済み事例の監査対比表

| 担い手クラス | 実例 | 主張していた保証 | 実際の挙動 | 機械的対策 |
| --- | --- | --- | --- | --- |
| 1. CI event / ref / tree 不一致 | `my-web-2026 #260` | PR で release branch の版整合を検証 | `pull_request` で `GITHUB_HEAD_REF` が ticket branch・`GITHUB_REF_NAME` が `<pr>/merge` のため no-op 化し、#248–#251 が red trunk へ merge | event/ref 前提を自己検証し、inactive 時は fail closed |
| 1. CI event / ref / tree 不一致 | `u-sekai #75` | head ブランチの `package.json` 版整合を検証 | `actions/checkout` に `ref:` 未指定で merge tree を取得しつつ `GITHUB_HEAD_REF` を渡し、比較対象と基準が別 tree 由来 | `pull_request` で `ref: ${{ github.event.pull_request.head.sha }}` を明示、`workflow --workflows-dir` で全 workflow を検査 |
| 1. CI event / ref / tree 不一致（fail-closed 側） | `u-sekai #78` | `test:unit` / `test:integration` / `test:e2e` で既存 test を実行 | `--dir` が `root` を上書きして 0 file 収集 → `exit 1`（fail-closed、偽の green なし） | `passWithNoTests: false` 維持に加え、実行件数下限で 0 件実行と区別 |
| 2. 結果の正しさ ≠ 検証済み | `ty-plus #175` | Windows-only release gate を通過 | Windows check が SKIP で `exit 0` し、release gate が未検証のまま緑化 | SKIP された必須 partition・空の `requiredPartitions`・重複 partition 上書きを拒否 |
| 2. 結果の正しさ ≠ 検証済み | `ty-plus PR #176` | 新規 `windows-release-gate` owner が Windows 検証責務を履行 | Playwright Chromium 未導入で `browserType.launch` 失敗（PR 自身の ADR「an owner that cannot discharge its responsibility is not an owner」に反し未解決で出荷） | owner 実稼働と実ランナー通過件数 (`numPassedTests >= 1`) の両方を gate 必須化 |
| 2. 結果の正しさ ≠ 検証済み | `ty-plus #179` | unit partition がテストを実行して通過 | file は収集されるが `-t` 不一致 / `describe.skip` で実行 0 件のまま `exit 0` / `success: true` | `parseNodeTestTap` / `parseVitestJson` + `run-and-verify --floor 1` で実実行件数を強制検証 |
| 2. 結果の正しさ ≠ 検証済み | `readmark #72` | `listBookmarks` / `listHighlights` が `[documentId+sourceFingerprint]` で indexed read | schema 宣言は `+pageIndex` のみで Dexie が例外を出さず full table scan へ silent fallback | `verifySchemaIndexes` で SQL DDL / Dexie schema 宣言と主張 query 列（左端一致）を機械照合 |
| 3. Prose / comment の虚偽 invariant | `readmark #76` | `FIT_WIDTH_PADDING_PX = 48` は `.rm-reader-scroll` / `.rm-reader-pages` の CSS padding と一致必須 | CSS の水平 padding は `0` / 未定義。値は意図的余白として正しいがコメントが不変条件を誤記 | `verifyCssMirror` で実 stylesheet の selector/property/value を照合、意図的余白は独立 token 名で表現 |
| 3. Prose / comment の虚偽 invariant | `u-sekai #76`, `ty-plus B1/B6` (`ci.yml:355`) | コメント・prose が gate 実装の検証範囲や不変条件を説明 | コメント記述と実際の workflow / gate 挙動が乖離し、レビューが未検証状態を誤認 | prose 主張を boolean 自己申告にせず、workflow 静的検査と決定論的 verifier に接続 |

## 実行入口

```bash
# 実 node --test TAP 出力の実行件数 >= 1 を検証（negative/positive controls 含む）
bun run test:gate-honesty

# .github/workflows 配下の全 YAML を一括検査（空/壊れた YAML は fail closed）
bun run quality:workflow-honesty

# 任意コマンドの TAP / Vitest JSON 出力を直接検証
node scripts/gate-honesty/cli.mts verify-tap - --floor 1
node scripts/gate-honesty/cli.mts verify-vitest-json report.json --floor 1
node scripts/gate-honesty/cli.mts verify-css-mirror spec.json
node scripts/gate-honesty/cli.mts verify-schema-index spec.json
```
