# Domain Candidates & Catalog Reference

このreferenceは `skill-selection` 本文から分離した領域別の優先候補ルール、lock hash仕様、`candidates.tsv` 列定義である。

## 領域別の優先候補と責務分離

- **Web (`web-platform`)**: HTML/CSS・DOM・Web UI・client-side JSを扱うprojectは `web-platform` を初回判定し、`GoogleChrome/modern-web-guidance` を優先評価する。framework・デザイン・品質のSkillとは別担当。backend・infra・CLI専用には不要。上流の広いMANDATORY triggerを組織共通routerとして流用しない。例: `bunx skills add GoogleChrome/modern-web-guidance --skill modern-web-guidance --copy`（revision・license・ブラウザ対応方針を確認）。
- **Lean 4 (`lean4-proof` / `mathlib-build`)**: Lean 4で定理・補題の証明を作成・修正する場合は `lean4-proof` を判定し、公式 `leanprover/skills` の `lean-proof` を優先評価する。`mathlib-build` はMathlib本体をビルド・修正する場合に限定し、Mathlibを依存利用するだけのprojectには導入しない。保証対象とruntime modelの対応は引き続き `correctness-assurance` が設計する。`lean-proof` は作業中の `sorry` を認めているが、未解決の証明を完了扱いにしてはならない。
- **視覚・UI設計およびレビューの能力分離**:
  - `visual-design-foundation`: 配置前の上流設計基盤（仕様構造から独立した意味再構成・表現媒体選択・空間構成・実物探索。`design-discipline` を `design-skills v0.7.0 (3d1480e7)` 公開版で `default` 採用。`design-skills#170`・`#205` Experiment 1A（`first-write` 交絡除去 2-0 および比例性検証）・`#209` 候補検証（`claude-sonnet-5-5-medium` 受動 0/1 → 早期ルーティング 2/2、GPT-6 盲検 `first-write` 4/4・`final` 勝利）と `project-init#129` の `policy-evaluation` 4ケース実測・trigger 非衝突確認を通過。導入・更新は `bunx skills add https://github.com/rebuildup/design-skills/tree/v0.7.0 --skill design-discipline --copy` で tag pin し、`skills-lock.json` の `computedHash` を検証する。2D視覚成果物・UIを新規設計または大きく再構成する該当projectにのみ導入し、未導入 repo へ dangling pointer を置かず、確定済みCSS修正や文章のみのtaskへ発火させない。時間軸成果物と独立人間評価は未実施であり、実証済み静止画2D/UIの適用条件とは分離記録する）
  - `visual-design`: 視覚方向・brief の固定と視覚制作（`design-intent`）
  - `visual-composition-audit`: 完成画面・ページ全体の構図原則監査（`composition-review`）
  - `visual-review`: rendered screenshot の回帰・coherence・first-encounter レビュー（`design-skills v0.7.0 (3d1480e7)` で `#200` ハーネス連携と `#210` Experiment 1B Quality Floor 4層分離を公開済み。実project継続昇格trial待ちのため `watch` 維持。局所レビューと freeze 後包括レビューは `quality-gate` の visual review handoff に従う）
  - `functional-ui-review`: Web / application UI で代表タスクの操作発見・情報優先順位・摩擦・一貫性・feedback / recovery を監査する能力
  - これら5能力を曖昧に統合しない。単にUIを変更しただけで毎ticketに全画面・大規模レビューや人間確認を追加せず、変更領域の局所レビューとRCの広い確認を区別する。
  - `functional-aesthetics-review` は設計元が未release・実成果物trial未完了の間は `watch` に留め、`default` / 自動配布済み / 効果実証済みとして扱わない。上流の正式release / tagとtask-based real-artifact trialが揃った後に `reviewed_rev` と証跡を更新して `default` 昇格を検討する。既存の `visual-review` 等に同能力があると推定して置換しない。

## `skills-lock.json` の `computedHash` と検証

導入した複製は直接編集せず、内容が `computedHash` と一致し続ける状態を維持する。

- **version 1**: `.git` と `node_modules` を除いた各fileの相対pathと中身を、pathの大文字小文字を区別しない順に連結したsha256。
- **version 2（skills CLI 1.9以降）**: CLIの `hashSkillFiles` と同じ byte-wise path sort・`path NUL length NUL content` framing・CRLF正規化（NUL byte を含む binary file は正規化せずそのまま hash）・`metadata.json`/cache dir（`.git`, `__pycache__`, `__pypackages__`）除外のsha256。
- aude-skillsの `evals/policy-evaluation/vendored-skills-contract.mts` と同じ検査をprojectのquality gateに入れる。修正が必要なら正本へPRを出す。

## `candidates.tsv` の列の値

- `status`: `default`（その能力の標準担当）、`alternative`（代替。併用しない）、`reference`（導入せず考え方のみ参照）、`watch`（評価・改善中）、`excluded`（導入しない）
- `review_depth`: `listed`（存在と説明のみ確認）、`skimmed`（主要部分を読んだ）、`read`（全体を読んだ）、`evaluated`（比較評価まで実施）
- `invocation`: `auto`（descriptionで自動起動）、`manual`（明示呼出しまたはroot contractからのpath指定）
- `skill` 列の `*` はpackage全体や複数Skillのまとめ記録を表し、`default` には使えない。
