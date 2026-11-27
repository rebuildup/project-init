# Design-Discipline Dispatch & Trigger-Collision Scenario

このシナリオは `project-init#129` の採用ゲートとして、`visual-design-foundation`（`design-discipline`）の早期ルーティング導入前後における 4 ケースの dispatch 精度と trigger 非衝突、および dangling pointer 防止契約を検証する。

## 対象 4 ケース

- **Case A (`case_a_new_ui`)**: 新規の 2D 視覚成果物・UI 設計（または大幅再構成）。
  - 期待: レイアウトやコード生成より **前に** 導入済みの `design-discipline` を起動し、その後必要に応じて視覚方向・brief 固定を `design-intent` へ引き継ぐ（`idea-discovery` とは衝突させない）。
  - 失敗: `design-discipline` を呼ばない、またはレイアウト実装後に事後適用する。
- **Case B (`case_b_css_fix`)**: 変更内容が既に確定している小規模 CSS / token 修正（例: 特定ボタンの背景色 hex 変更）。
  - 期待: `design-discipline` / `design-intent` / `design-refinement` / `idea-discovery` を発火させず、最小差分で直接修正する（比例性の維持）。
  - 失敗: 確定済みの局所修正に `design-discipline` や再設計プロセスを起動する。
- **Case C (`case_c_writing_only`)**: 視覚成果物を含まない文章のみのタスク（例: README / ADR / PR 本文の作成・改訂）。
  - 期待: `writing-discipline` のみを適用し、`design-discipline` や `design-intent` を発火させない。
  - 失敗: 文章のみのタスクへ視覚設計 Skill が誤発火する。
- **Case D (`case_d_mixed_product_ui`)**: 未確定の製品仕様・要件整理と新規 UI 設計が混在するタスク。
  - 期待: `design-refinement`（要件・事実・未決定事項の整理）→ `design-discipline`（配置前の意味再構成・媒体選択・空間構成）→ `design-intent`（視覚方向・brief 固定）の順で責務分離して連携し、根本的発想転換が明示要求されていない限り `idea-discovery` と衝突させない。
  - 失敗: `design-refinement` と `design-discipline` の責務を混同する、または `idea-discovery` を無断で割り込ませる。

## 共通境界契約

- **`pointer_guard`**: root contract の早期ルーティング pointer は、対象 repo に実 file が存在する導入済み Skill に限定し、未導入 Skill への dangling pointer を置かない（`installed-file-only`）。
- **`scope`**: 2D 視覚成果物・UI を扱う該当 project にのみ適用し、非視覚（backend / CLI / infra 専用）project へ一律適用しない（`applicable-2d-visual-projects-only`）。

## 出力形式

次の 6 行をこの順で出力する（余分な行・空行なし）:

```text
case_a_new_ui=design-discipline-before-layout
case_b_css_fix=none-direct-edit
case_c_writing_only=writing-discipline-only
case_d_mixed_product_ui=design-refinement-then-design-discipline-then-design-intent
pointer_guard=installed-file-only
scope=applicable-2d-visual-projects-only
```
