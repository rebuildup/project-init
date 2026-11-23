# New Python Introduction Guard (ADR-0001 §11)

`docs/adr/ADR-0001.md` §11（`new Python scripts: prohibited`）の下流 PR での再導入を検出する軽量 PR gate 契約。

## 対象と境界

- **検出対象**: PR 差分で **新規追加（`A` / `C`）** された `.py` / `.pyw` / `.pyi` ファイル、Python shebang（`#!/usr/bin/env ... python*` / `pypy*` / `python3.13t`、BOM・環境変数代入・`-S` 等の `env` フラグを含む）を持つ新規ファイル、および非 Python ファイルから Python ファイル／Python shebang へリネーム（`R`）されたファイル。
- **非対象（誤検知禁止）**: 既存 Python ファイルの単純変更（`M`）、既存 Python ファイル同士のリネーム（`R`: `.py -> .py` や既存 Python shebang 間の移動）、ファイル名に `python` を含む非 Python ファイル（例: Markdown 文書）。既存 Python の全面撤去は本 gate の責務外。
- **Tree 一貫性と fail-closed**: 差分・先頭行（最大 4 KiB ストリーミング読取）・例外マニフェスト・参照 ADR はすべて `--head` で指定された Git tree から直接読み取る（working tree を参照しない）。非 ASCII パスも `-z` + `core.quotePath=false` で扱い、Git エラーは黙って skip せず終了コード 2 で fail-closed する。
- **導入先の既存方針優先**: 対象リポジトリに、より厳しい方針またはプロジェクト固有の根拠 ADR がある場合は `--policy <reference>` で明示して優先する。

## 例外の承認条件（fail-closed）

OS 初期化時の循環依存（Bun 未導入等）で例外が不可避な場合のみ、`--head` tree 上の project-local 例外マニフェスト（既定 `.config/python-exceptions.json`）で以下すべてを明示したものだけを許可する。

- `paths`: 許可対象の正確な repo-relative パス一覧（絶対パス・`..` 禁止）
- `adr`: `docs/adr/*.md`（または `adr/*.md`）配下に実在する通常ファイルであり、ヘッダに承認済みステータス（`Status: Accepted` / `Status: Approved` / `ステータス: 承認済み` 等）を持つ project-local ADR パス（`Draft` / `Proposed` / `README.md` / symlink / traversal は拒否）
- `reason`: 例外が不可避な技術的根拠
- `alternatives`: 検討した代替手段と不採用理由
- `sunsetCondition`: 例外を解除する条件

マニフェストの形式不正・必須項目欠落・未承認または不在の ADR 参照はいずれも fail-closed とし、検査を黙って skip しない。

## 実行入口

```bash
node scripts/quality/check-new-python.mts --base <base-ref> --head <head-ref> [--exceptions .config/python-exceptions.json] [--policy docs/adr/ADR-0001.md#11-tooling-conventions]
bun run test:new-python
```

## 下流リポジトリでの opt-in 導入例

既存の Python コードベースを壊さず新規導入だけを制限するため、導入を選択した下流リポジトリの PR workflow に以下を追加する（既存 Python の変更や承認済み `.config/python-exceptions.json` は通過する）。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- name: Reject newly added Python scripts on PR diff
  if: github.event_name == 'pull_request'
  run: |
    node scripts/quality/check-new-python.mts \
      --base "${{ github.event.pull_request.base.sha }}" \
      --head HEAD \
      --exceptions ".config/python-exceptions.json" \
      --policy "docs/adr/ADR-0001.md#11-tooling-conventions"
```
