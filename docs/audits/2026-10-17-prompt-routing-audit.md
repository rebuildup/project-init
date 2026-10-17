# Prompt routing audit — 2026-10-17

## 目的

ADR-0028で `PROMPT.ja.md` を初期化手順とroutingに縮約し、`PROMPT.en.md` を削除した。この変更は `docs/policy-integrity.md` のlarge rewrite gateに当たるため、旧promptの各sectionにあったnormative ruleが、現在のcanonical locationに残っているかを監査する。

- 比較元：`release-0-5-0` 時点の `PROMPT.ja.md`（30 section、約79KB）
- 比較先：ADR-0028適用後の `PROMPT.ja.md`、Constitution、`organization/profiles/release-driven-solo.md`、各Skill、ADR、CONTRIBUTING
- `PROMPT.en.md` は `PROMPT.ja.md` と同じoperational semanticsを定義していたため、個別には監査しない

## 分類

- **Moved**：同等以上のcontractがcanonical locationにある
- **Moved (restored)**：正本がなかったため、今回の変更でcanonical locationへ移した
- **Revised**：ADR-0028により意図的に形を変えた
- **Intentionally removed**：rule自体を不要とした

## 結論

すべてのruleに、移動先、revision、または削除の記録がある。正本がなかったruleは、移動先のSkillへ書き戻した。

- 同じfileを触ること自体は直列化の理由にならない
- 要求scopeを独断で縮めない、compile成功を完了としない
- reviewerの確認観点（runtime再現性、PR metadata / Issue linkage、recovery / checkpoint整合を含む）
- spawnの深さと数の上限
- runtime / provider比較時のsnapshot永続性・suspend / resume・provider喪失時の復旧
- CIの有無に応じたrelease PRのevidence
- platformのpreview featureに依存しない
- 言語、Bun、`rg`、`.py` script禁止、TypeScript script、`Containerfile`（promptのHouse ruleとしてroot contractへ転記）

## Section-by-section audit

| 旧section | 分類 | canonical location | 補足 |
| --- | --- | --- | --- |
| 前文（全文をrootへcopyしない、通常taskで再読しない） | Moved | `PROMPT.ja.md` 冒頭、ADR-0002 | |
| 1. Constitutionとcurrent profile | Moved | `constitution/CONSTITUTION.md`、profile | promptはpointerだけを持つ |
| 1. Current release-driven defaults | Moved | profile（Delivery / Workspace / Secret / Quality defaults）、`github-delivery`、`secrets-management`、`writing-discipline` | |
| 1. Git worktreeはisolationではない | Moved | profile、`sandbox-runtime`、`worktree-workflow` | |
| 2. idempotent reconciliation | Moved | `PROMPT.ja.md` §1–§2 | 調査項目は領域単位に集約した |
| 2. Skillのfreshness確認 | Moved | `PROMPT.ja.md` §2、`skill-selection` | |
| 2. `main` 保護の修復 / blocker報告 | Moved | `PROMPT.ja.md` §2、`github-delivery` | |
| 3. Source of Truth | Moved | profile（Source topology）、`github-delivery`、`parallel-orchestration`（`base_sha`） | 会話履歴等をSoTにしない点は `agent-recovery` |
| 4. Engineering decision precedence / escalation | Moved | `engineering-decisions` §1–§4 | |
| 5. Root Coordinator / Supervisorの責務 | Moved | `organization/execution-roles.md`、`parallel-orchestration`、ADR-0019 | |
| 5. workerにhost Docker socket等を渡さない | Moved | `sandbox-runtime`、ADR-0003 | |
| 6. spawn capability / spawn request | Moved | `parallel-orchestration`（spawn contract） | tool名の一覧は特定transportに依存するため、contractのfieldとして持つ |
| 6. publish権限のないworkerのhandoff | Moved | `parallel-orchestration`、`github-delivery` | |
| 6. fork bomb / unbounded cost防止 | Moved (restored) | `parallel-orchestration`（`budget` に深さと数の上限） | |
| 7. Research / Worker / Reviewer、immutable transfer | Moved | `parallel-orchestration`、ADR-0003 | |
| 8. Execution environment isolation | Moved | `sandbox-runtime`、ADR-0003 / ADR-0004 | |
| 8. Rust / Cargo build cache | Moved | `worktree-workflow`、ADR-0024 | |
| 9. Runtime / host portability | Moved | `sandbox-runtime`、ADR-0004 | |
| 9. runtime / provider選定の評価軸 | Moved (restored) | `sandbox-runtime`（Refinement criteria） | |
| 9. Adaptive agent orchestration | Moved | `parallel-orchestration`、`herdr-runtime`、ADR-0025 | |
| 9. mise | Moved | profile、`onboarding`、ADR-0022 | |
| 9. Cloudflare CLI | Moved | profile、ADR-0026 | |
| 10. project-local原則 | Moved | `PROMPT.ja.md` House rule | |
| 10. root contractに置くもの | Moved | `PROMPT.ja.md` §4 | |
| 10. 標準Skill候補 / Skills CLI | Revised | `PROMPT.ja.md` §3の対応表、`skill-selection` | 固定の候補一覧ではなく、能力ごとの選定にした（ADR-0029） |
| 11. Weekly sprint / version bump | Moved | profile、`github-delivery` | |
| 11. main protection / merge method | Moved | profile、`github-delivery`、ADR-0016 / ADR-0018 | |
| 11. Issue dependency SoT / Linear | Moved | `github-delivery`、`linear-release-control` | |
| 12. Ticket branch / PR state lifecycle / stacked PR | Moved | `github-delivery`、ADR-0008 / ADR-0027 | |
| 12. PR metadata / Draft→Ready / landing | Moved | `github-delivery`、`quality-gate` | |
| 13. Release integration / release PR | Moved | `github-delivery`、ADR-0012 / ADR-0027 | |
| 13. CIの有無に応じたrelease evidence | Moved (restored) | `github-delivery`（Release integration） | |
| 14. Task graph / 最大安全並列化 | Moved | `parallel-orchestration` | |
| 14. 同じfileを触ること自体は直列化の理由にならない | Moved (restored) | `parallel-orchestration`（Fallback） | |
| 15. 自律実行ループ / design-refinement | Moved | `design-refinement`、`engineering-decisions`、`interaction-discipline` | |
| 15. scopeをMVPへ縮めない、compile成功を完了としない | Moved (restored) | `engineering-decisions` §5 | |
| 16. Agent interruption recovery（failure model、sources、checkpoint、trigger、algorithm） | Moved | `agent-recovery`、ADR-0007 | |
| 17. Parent / child recovery、split-brain、fencing | Moved | `agent-recovery`、`parallel-orchestration`、ADR-0019 | |
| 18. External side effects / idempotency | Moved | `agent-recovery` | |
| 19. Tool / Skill / pluginのゼロベース選定 | Moved | `engineering-decisions` §11、`skill-selection` | |
| 19. preview featureに依存しない | Moved (restored) | `github-delivery` | |
| 20. Architecture / design / ADR | Moved | `engineering-decisions` §8–§9、ADR-0001 | |
| 20. ADR対象の一覧 | Revised | `engineering-decisions` §9、`CONTRIBUTING.md`（ADR対象） | 列挙ではなく、long-lived decision全般を対象とする基準にした |
| 21. Adaptive quality profile | Moved | `quality-gate`、ADR-0005 | |
| 22. Verification taxonomy | Moved | `quality-gate` | |
| 23. Worker / integration / stack / release gate、false green禁止 | Moved | `quality-gate` | |
| 24. GitHub Actions / CI | Moved | `quality-gate` §8、ADR-0009 | |
| 25. Security maintenance / active source audit | Moved | `security-maintenance`、`security-audit` | |
| 26. Reviewer separation / reviewer確認観点 | Moved (restored) | `github-delivery`（reviewer metadata）、`parallel-orchestration`（Review handoff） | |
| 27. Onboarding / repository-controlled knowledge | Moved | `onboarding` | |
| 28. Source / doc / GitHub language、commit format | Moved | `PROMPT.ja.md` House rule、`github-delivery`、ADR-0004 | |
| 29. Bun / `rg` / `.py` / TypeScript script / `Containerfile` | Moved (restored) | `PROMPT.ja.md` House rule | root contractへ転記される |
| 29. dotenv / `.tmp/` / `.reference/` / secretを残さない | Moved | `onboarding`、`secrets-management`、`agent-recovery` | |
| 30. Context handoff / recovery drill | Moved | `agent-recovery` | |
| 30. 初期化完了条件 | Revised | `PROMPT.ja.md` §5 | 各Skillの不変条件の再掲をやめ、確認項目を絞った。詳細な不変条件は各Skillとevalが持つ |
| 最終報告の内容 | Moved | `PROMPT.ja.md` §5 | |

## 確認方法

- 移動先は、旧ruleの中心となる語句でcanonical locationを検索し、内容を読んで同等以上のcontractがあることを確かめた。
- promptからcanonical locationへのroutingは、`evals/policy-evaluation/*-contract.sh` が、該当するroutingの行を検査する。
