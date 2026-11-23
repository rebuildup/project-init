# Gate Honesty — Actual Execution vs Reported Claim (#97)

gate・CI・コードコメントが「実際に検証していないもの」を成功・保証済みと誤認させる欠陥クラスの整理と再発防止契約。

## Fail-closed と Silent pass の区別（必須）

| 分類 | 実例 | 実測挙動 | リスク |
| --- | --- | --- | --- |
| **Fail-closed（安全に停止）** | `u-sekai #78` | 0 file 収集 → `exit 1`（Vitest `passWithNoTests: false` 既定） | 検証不能だが偽の green は作らない |
| **Silent pass（最も危険）** | `ty-plus #179` | file 収集あり・`-t` 不一致や `describe.skip` で実行 0 件 → `exit 0` / `success: true` | aggregate gate が「検証済み」と誤認する |

`passWithNoTests: false` は「収集 file 0 件」しか防がない。各 partition について **`numPassedTests >= 1`（実行・通過件数の下限）** を必須検証する。

## 3 つの欠陥担い手と対比表

| 担い手 | 実例 | 主張していた保証 | 実際の挙動 | 機械的対策 |
| --- | --- | --- | --- | --- |
| 1. CI event/ref/tree 不一致 | `my-web-2026 #260`, `u-sekai #75` | PR 対象ブランチの版整合を検証 | `pull_request` で merge tree を checkout しつつ `GITHUB_HEAD_REF` を参照・不活性 no-op | `actions/checkout` に明示 `ref` 指定、workflow 静的検査 |
| 2. 結果の正しさ ≠ 検証済み | `ty-plus #175`, `ty-plus #179`, `readmark #72` | Windows gate 通過 / unit 通過 / indexed read | SKIP で exit 0 / 実行 0 件で exit 0 / 存在しない index で full table scan fallback | partition 通過下限・SKIP 非通過・fallback 検出 |
| 3. Prose / comment の虚偽 invariant | `readmark #76`, `u-sekai #76` | 定数が CSS padding と一致必須 | 一致する selector が存在せず、値は正しいがコメントが誤り | mirror 主張は実値照合、意図的余白は独立 token 名で表現 |

## 実行入口

```bash
bun run test:gate-honesty
node scripts/quality/check-gate-honesty.mts workflow .github/workflows/eval-controls.yml
```
