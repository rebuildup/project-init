# New Python Introduction Guard (ADR-0001 §11)

`docs/adr/ADR-0001.md` §11（`new Python scripts: prohibited`）の下流 PR での再導入を検出する軽量 PR gate 契約。

## 対象と境界

- **検出対象**: PR 差分で **新規追加（`A` / `C`）** された `.py` / `.pyw` / `.pyi` ファイル、および Python shebang（`#!/usr/bin/env python*`, `#!/usr/bin/python*`）を持つ新規ファイル。
- **非対象（誤検知禁止）**: 既存 Python ファイルの単純変更（`M`）、ファイル名に `python` を含む非 Python ファイル（例: Markdown 文書）。既存 Python の全面撤去は本 gate の責務外。
- **導入先の既存方針優先**: 対象リポジトリに、より厳しい方針またはプロジェクト固有の言語例外がある場合はそちらを優先する。

## 例外の承認条件（fail-closed）

OS 初期化時の循環依存（Bun 未導入等）で例外が不可避な場合のみ、project-local の例外マニフェスト（既定 `.config/python-exceptions.json`）で以下すべてを明示したものだけを許可する。

- `paths`: 許可対象の正確な相対パス一覧
- `adr`: 実在する project-local ADR ファイルへのパス
- `reason`: 例外が不可避な技術的根拠
- `alternatives`: 検討した代替手段と不採用理由
- `sunsetCondition`: 例外を解除する条件

マニフェストの形式不正・必須項目欠落・参照 ADR 不在はいずれも fail-closed とし、検査を黙って skip しない。

## 実行入口

```bash
node scripts/quality/check-new-python.mts --base <base-ref> --head <head-ref>
bun run test:new-python
```
