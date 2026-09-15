# Lost-rule audit — 2026-09-09

## 目的

初期commit `06c99b1adb2ff8d1c5cd70028498ebe35e72f64a` の `PROMPT.ja.md` をbaselineとし、現行 `main` のPROMPT / Skills / ADR / CONTRIBUTING / policy overview全体に同等のoperational contractが残っているかを監査する。

この監査は単純なtext diffではない。ruleが別fileへ移動した場合はlossとみなさず、ADRで明示的にrevisionされた旧ruleも復活させない。

## 分類

- **Preserved**: 現行repositoryに同等以上のcanonical contractがある。
- **Moved**: promptからSkill / ADR / docsへ移動したがsemanticsは維持されている。
- **Revised intentionally**: ADR等で明示的に置換・revisionされている。旧ruleは復活させない。
- **Lost / weakened**: 同等contractがない、または名称だけ残り重要なoperational semanticsが失われている。

## 結論

2026-09-05のmulti-agent / release sprint型への再編は、execution isolation、GitHub delivery、quality、security、recovery、onboardingを大幅に強化した。一方、初期PROMPTにあった低レイヤのrepository hygiene / design / dependency / UI / trust ruleの一部が圧縮され、canonical contractとして弱くなった。

特に `.tmp/` と `.reference/` は現行でも名称は残るが、初期版にあった「何を置くか」「rootへ置かない」「commitしない」「build/runtime dependencyにしない」「fresh clone必須条件にしない」といった意味が失われていた。

今回の復元では、初期PROMPTを再び巨大化させるのではなく、現行のprogressive-disclosure architectureに従って詳細contractを標準Skillsへ戻し、repository自身のpolicy migration integrity guardを追加する。

## Section-by-section audit

| Initial section | Status | Current equivalent / finding | Action |
| --- | --- | --- | --- |
| 1. `/init` 冪等性 | Preserved + partially weakened | current PROMPT §2でreconciliationは維持。旧版の「不要rule削除前にADR decisionを更新」のguardは弱い | policy migration/deletion guardとして復元 |
| 2. 既存コードベース最優先 | Moved / partially weakened | engineering-decisions / quality-gateへ分散。generated boundary等は維持されるがdependency hygiene checklistは弱い | dependency ruleで補完 |
| 3. project-localのみ | Preserved | current PROMPT §10、ADR-0001 | none |
| 4. root agent fileはdispatcher | Preserved | current PROMPT §10、ADR-0001 | none |
| 5. Agent Skillsを詳細ruleの基本単位にする | Lost / weakened | standard Skill一覧はあるが、trigger/responsibility/tool/context costによるsplit/merge基準と「1 bullet = 1 Skill禁止」が消失 | `engineering-decisions`へSkill design contractを復元 |
| 6. plugin / Skill / toolをゼロベース選定 | Preserved + weakened detail | current PROMPT §19に原則あり。source/maintainer/permission/license/version等のevaluation detailが圧縮 | `engineering-decisions`へevaluation criteriaを復元 |
| 7. plugin / tool選定をADRへ残す | Lost / weakened | ADR対象とはされるが、capability / alternatives / rejection / context cost / security / license / pin / re-evaluation等のrecord contractが消失 | `engineering-decisions`へtoolchain ADR minimum fieldsを復元 |
| 8. capability candidates | Partially moved / pruned | named productsはmandatoryでなく、固定候補の削除自体は問題ではない。durable principlesはcurrent stack-aware selectionへ統合 | product名の固定bundleは復活させない |
| 9. 開発環境 | Revised / strengthened | current runtime portability + isolated sandbox modelへ強化 | none |
| 10. package manager / search / script | Preserved + minor weakening | Bun / rg / Python禁止はcurrent PROMPT §29 / ADR-0001に残る。mixed package-manager cleanup detailはdependency/tool hygieneで扱う | existing decision維持 |
| 11. source/document/Git言語 | Revised intentionally | ADR-0004でGitHub Issue/PRを日本語へrevision。source/commit英語、internal docs日本語は維持 | old GitHub-English ruleを復活させない |
| 12. 公式推奨architecture | Moved / preserved | current PROMPT §20、engineering-decisions、ADR-0001 | none |
| 13. naming / responsibility / directory width | Lost | responsibility naming、ancestor context、dumping-ground名回避、directory width heuristicがrepo全体から消失 | `engineering-decisions`へ復元 |
| 14. design-first | Preserved + weakened detail | current PROMPT §20 / ADR-0001にgateは残るが、read -> propose -> agree -> update design -> implementとdesign doc final-state ruleのdetailが薄い | `engineering-decisions`へworkflow detailを復元 |
| 15. ADR lifecycle | Lost / weakened | existing ADR自体にはrevision referenceがあるが、future changesへ双方向reference/status更新を要求するgeneral ruleが弱い | `engineering-decisions`へ復元 |
| 16. 初期開発段階のcompatibility | Lost | 「念のためのcompatibility shimを残さない」が消失 | `engineering-decisions`へevidence-based early-stage policyとして安全化して復元 |
| 17. task scopeを狭めない | Preserved | current PROMPT §15 | none |
| 18. autonomous execution loop | Preserved / revised | current PROMPT §15にrelease-aware loopとして強化 | none |
| 19. 最大数subagent | Revised intentionally | isolated runtime / dependency graph / WIP/resource-aware parallelismへrevision | old shared-tree constraintsを復活させない |
| 20. Codex role allocation | Moved | ADR-0001 + `docs/roles/CODEX_ROLES.*` | none |
| 21. local main / no-worktree | Revised intentionally | ADR-0003/0004/0008でisolated runtime + release/ticket branchへ置換 | old ruleを復活させない |
| 22. subagent file ownership / commit | Revised intentionally | shared working-tree isolationを廃止しimmutable result integrationへ変更 | old shared-index/file-lock ruleを復活させない |
| 23. Git/GitHub message format | Revised / preserved | commit format維持、Issue/PR languageはADR-0004で日本語化、PR metadataは強化 | none |
| 24. foundation migration | Moved / preserved | ADR-0001 §14 + engineering decisions | none |
| 25. dependency policy / license audit | Lost / weakened | security dependency handlingは強化されたが、minimum dependency、native/existing alternative確認、duplicate responsibility禁止、maintenance/license/redistribution/attribution auditが消失 | `engineering-decisions`へ復元 |
| 26. dependency/static analysis | Lost / weakened | quality-gateにgeneric static analysisはあるが、unused/missing dependency/export/file等のgoalが明示されない | `quality-gate`へtool-neutral goalとして復元 |
| 27. automatic quality gate fixed bundle | Revised intentionally | ADR-0005 adaptive quality profileへrevision | Knip/Biome等fixed bundleを復活させない |
| 28. false green / warning suppression禁止 | Moved / preserved | quality-gate §14、current PROMPT §23 | none |
| 29. tests / coverage fixed defaults | Revised intentionally | ADR-0005。verification taxonomyは大幅強化、80% universal hard ruleは廃止 | old thresholdを復活させない |
| 30. `.tmp/` | Lost / weakened | path名 + Git ignoreだけ残る。artifact種類、root直置き禁止、commit禁止が消失 | `onboarding`へ詳細contractを復元 |
| 31. `.reference/` | Lost / weakened | path名 + Git ignoreだけ残る。source/build/runtime dependency禁止、fresh-clone必須化禁止、license確認が消失 | `onboarding`へ詳細contractを復元 |
| 32. dotenv / GitHub Secrets | Lost / weakened | allowed actual/example namesは残るが、example-as-schema、GitHub Secrets variable mapping、secret readback非依存等が圧縮 | `onboarding`へ詳細contractを復元 |
| 33. `.gitignore` / pre-commit | Lost / weakened | pre-commitを標準化しないdecisionはADR-0001に残るが、ignore検討対象/commit対象のchecklistが消失 | `onboarding`へhygiene ruleを復元 |
| 34. CI/CD | Preserved / strengthened | current PROMPT §24 + quality-gate | none |
| 35. version / release | Partially revised + lost conditional rule | weekly semantic-version release sprintは強化。tag-triggered releaseでtagとauthoritative versionを一致させfail-fastするconditional ruleは消失 | `github-delivery`へconditional tag-release contractを復元 |
| 36. Container / IaC | Preserved + weakened detail | Containerfile、adaptive validation/scanningは残る。built deliverable verificationのdetailが弱い | `quality-gate`へadaptive deliverable gateとして補完 |
| 37. UI architecture | Lost | data modelをそのまま並べずuse case/user goal/information priority/timingからIAを設計、不要chromeを増やさないruleが消失 | `quality-gate`へUI IA gateとして復元 |
| 38. UI verification | Lost / weakened | manual/visual gateはquality-gateにあるが、rendered result必須、viewport/state/overflow/console/network確認、artifact `.tmp/` placementが消失 | `quality-gate`へ復元 |
| 39. mode / permission / trust | Lost | capability制限時にbypass/迂回/validation弱化をせず正規のuser gateとして扱うruleが消失 | `engineering-decisions`へ復元 |
| 40. deterministic verification | Preserved / strengthened | quality-gate、current PROMPT §§21–23 | none |
| 41. fresh-clone audit | Lost / weakened | current initialization completionは強いが、global software/env/example/`.tmp`/`.reference`/local-CI consistencyのhygiene checklistが一部抜ける | `onboarding`へchecklistを復元 |
| 42. initialization outputs | Preserved / generalized | onboarding/completion modelへ統合 | none |
| 43. completion report | Lost / weakened | current final reportが概括のみ。selected/rejected tools、ADR、validation entry point、env/trust/quality debt/unreproducible item等のreport contractが消失 | `onboarding`へ復元 |
| Standard implementation behavior | Revised / preserved | release-aware ticket/branch/stack/quality/recovery loopへ置換 | old branch/worktree mechanics以外はcurrent modelを維持 |

## Restoration mapping

復元は「初期PROMPTをそのまま再挿入」ではなく、current full promptのdispatcher + standard Skillsというprogressive-disclosure architectureを維持する。

### `skills/engineering-decisions/SKILL.md`

- Agent Skill split/merge criteria
- naming / responsibility / directory width
- detailed design-first lifecycle
- ADR bidirectional lifecycle
- evidence-based early-stage compatibility policy
- dependency / tool / license adoption criteria
- toolchain ADR minimum fields
- mode / permission / trust boundary

### `skills/quality-gate/SKILL.md`

- dependency / static-analysis goals
- UI information architecture gate
- rendered UI verification
- `.tmp/`へのverification artifact placement
- build / container / deliverable verification

### `skills/onboarding/SKILL.md`

- `.tmp/` temporary artifact contract
- `.reference/` external repository contract
- dotenv examples as environment schema
- `.gitignore` hygiene / pre-commit non-default
- fresh-clone audit
- initialization completion report

### `skills/github-delivery/SKILL.md`

- conditional tag-triggered release version / authoritative version / SHA consistency

### Repository governance

- `docs/policy-integrity.md` にlarge rewrite / section consolidation / progressive-disclosure migration向けsemantic-loss guardを追加
- READMEからauditとrestored canonical locationsを発見可能にする
- 将来、CONTRIBUTINGを含むrepository governanceを再構成する場合も同じguardを適用する

## Explicit non-restoration

次は意図的revisionとして旧semanticsを復活させない。

1. local `main` only / no feature branch / no worktree
2. shared working treeのdisjoint-file ownershipをisolation mechanismにすること
3. universal 80% coverage hard threshold
4. Biome / Knip / Vitest / Playwright等を全projectへ固定bundle化すること
5. GitHub Issue / PR communicationを英語へ戻すこと
6. ticket PRを必ずrelease branchへ直接向け、hard dependency stackを禁止すること

## Regression prevention

今後、policyの大規模restructureでline countが増えていてもrule lossは起こり得る。したがって「文書量」ではなくnormative semanticsを監査対象にする。

large rewriteのmerge前には最低限:

1. replaced/removed sectionを列挙する
2. 各normative ruleのnew canonical locationを示す
3. semantic changeならADR/revisionを示す
4. intentional removalならreason / impactを示す
5. location/revision/removal recordのないruleはlossとしてblockする
6. JP/EN semanticsとREADME/CONTRIBUTING/Skills/ADRの整合を確認する

詳細gateは [`../policy-integrity.md`](../policy-integrity.md) をcanonical sourceとする。

このaudit自体を将来のpolicy migration regression testのbaselineとして利用する。
