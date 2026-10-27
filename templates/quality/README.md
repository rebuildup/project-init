# 適応的テストスケジューラー

既存のテストコマンドを置き換えず、開発中の任意検証の実行頻度だけを調整する。adaptive-tests.mjs は Node.js 22 で動作する、依存パッケージ不要の参照実装。各プロジェクトのランナーとGit入力を確認して導入する。

## 導入

1. adaptive-tests.mjs を scripts/adaptive-tests.mjs へコピーし、構成例を quality/adaptive-tests.json へコピーする。
2. 既存の実行コマンドを引数配列で指定し、関連する入力ファイルのGit pathspecと最大実行間隔を設定する。
3. 各checkの `required` を明示する。必須のcheckは `required: true, allowDefer: false` とし、延期を許可しない。全入力と環境を追跡でき、成功終了が実際のテスト成功（0件成功を含まない）を表す任意checkに限り `required: false, allowDefer: true` にする。外部サービス、時刻、GUI、実機、共有DBなど非決定的な入力を持つチェックは原則対象外。
4. .tmp/ を .gitignore に登録し、延期可能なworker実行では必ず `--state` でそのworker専用の状態ファイルを渡す（同一worktreeの並列worker間でも共有しない）。非適応実行には既定のstate pathを使用できる。
5. 必須の validate:fast / validate:integration / validate:release 相当のコマンドは変更せず、反復最適化用のコマンドは別名で公開する。

    node scripts/adaptive-tests.mjs --config quality/adaptive-tests.json --check unit --context worker --environment local-dev-v1 --state .tmp/adaptive-tests/worker-local-1.json

必ず実行して検証するとき:

    node scripts/adaptive-tests.mjs --config quality/adaptive-tests.json --check unit --context integration --force

context=worker、environment識別子、`required: false`、`allowDefer: true` の全てが揃い、CI環境変数が未設定の場合だけ延期を許す。

| 終了コード | 意味 |
| --- | --- |
| 0 | テストを実行し、成功を観測した |
| 78 | テストを延期した。成功証拠ではない |
| その他 | テスト・設定・実行環境の失敗 |

延期を成功として表示・記録・PR判定に流用しない。エージェントは78を想定内の延期として扱い、required gateでは必ず必要なテストを実行する。

## 動作と制約

成功時の実行間隔は1→2→4→8…回に増え、maxIntervalで頭打ちになる。失敗、入力内容の変化、環境ID・コマンドの変化、状態ファイル欠損/破損、Gitや入力読み取りの問題がある場合は実行する。force、integration/release、CIでは延期しない。

各必須Git pathspecを個別に解決し、1つでも一致するファイルがなければ必ず実行する。入力をoptionalにする設計はなく、不要な入力は明示して除外する。判定は解決済み入力ファイルの内容ハッシュで行う。git ls-filesの対象外となるignored/generated data、未宣言の外部状態、secretや環境変数の変化は自動検出できない。変更時にenvironment識別子を更新するかforceで再実行し、不確実なチェックではallowDeferを無効化する。

この実装の単位はチェック/スイートであり、ケース単位のRTSや依存関係自動推定は行わない。既にNx/Turborepo/Vitest等の適切なキャッシュ・テスト選択がある場合は先にその機能を使い、同じ責務を重複させない。実測で再実行削減と欠陥検出への影響を比較し、効果がなければ撤去する。
