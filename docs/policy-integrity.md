# Policy migration integrity

このrepositoryのpolicyを大規模に再構成・統合・progressive disclosureへ移動する時、**文書量やsection数ではなくnormative operational semanticsを保存する**。

## Silent semantic deletion禁止

既存のnormative ruleを削除・短縮・別fileへ移動する変更では、merge前に各ruleを最低限次のいずれかへ分類する。

1. **Moved** — 同等以上のsemanticsを持つnew canonical locationが存在する
2. **Revised** — semanticsを意図的に変更し、ADRまたは同等のcanonical revision recordが存在する
3. **Intentionally removed** — rule自体が不要になった理由と影響をreview可能な形で記録する

どれにも該当せず、old canonical locationからruleだけが消える状態を許容しない。

「詳細はSkillへ移動した」と記述するだけではMovedにならない。実際のSkillにold ruleと同等以上のoperational contractが存在し、初期化/通常taskから発見可能であることを確認する。

## Large rewrite gate

次のいずれかを行う変更はlost-rule audit対象とする。

- full initialization promptの大規模rewrite
- 複数sectionの統合・削除
- root prompt -> Skills / ADR / docsへの大規模移動
- canonical Skillの責務再編
- quality / GitHub delivery / runtime / recovery modelの置換
- language/version/toolchain policyの大規模変更

merge前に:

1. replaced/removed sectionを列挙する
2. 各normative ruleのnew canonical locationを示す
3. semantic changeならADR/revision referenceを示す
4. intentional removalならreason / impactを示す
5. location/revision/removal recordのないruleをblockerとして扱う
6. `PROMPT.ja.md` / `PROMPT.en.md` のoperational semanticsを確認する
7. README / CONTRIBUTING / Skills / ADR / policy overviewとの矛盾を確認する
8. generated root contractやinitialization completion条件からdetailへのdiscovery pathを確認する

## Rule preservation is semantic, not textual

wording、section number、file pathを固定する必要はない。

- より明確なruleへ統合してよい
- task-specific detailをSkillへ移動してよい
- obsolete architectureをADRでrevisionしてよい
- framework/tool固有のfixed ruleをadaptive policyへ置換してよい

ただし、旧ruleが防いでいたfailure modeが新policyでも防がれることを説明できなければならない。

## Baseline audit

2026-09-09の初回lost-rule audit:

- [`audits/2026-09-09-lost-rule-audit.md`](./audits/2026-09-09-lost-rule-audit.md)

このauditは初期commit `06c99b1adb2ff8d1c5cd70028498ebe35e72f64a` と当時のcurrent policyを比較したbaselineである。

将来の大規模migrationでは、過去全文を機械的に復元するのではなく、直前canonical stateとcurrent baseline auditを使ってsemantic regressionを確認する。

## Canonical restored detail locations

2026-09-09 auditで復元したdetailは主に次へprogressive disclosureした。

- `skills/engineering-decisions/SKILL.md`
  - naming / responsibility / directory width
  - design-first detailed lifecycle
  - ADR lifecycle
  - early-stage compatibility boundary
  - dependency/tool/license adoption decision
  - mode / permission / trust boundary
- `skills/quality-gate/SKILL.md`
  - dependency/static-analysis goals
  - UI information architecture
  - rendered UI verification
  - build/container/deliverable verification
- `skills/onboarding/SKILL.md`
  - `.tmp/` temporary artifact contract
  - `.reference/` external reference contract
  - dotenv / `.gitignore` hygiene
  - fresh-clone audit
  - initialization completion report
- `skills/github-delivery/SKILL.md`
  - tag-triggered release version/SHA consistency

このmappingを変更する場合も同じintegrity gateを適用する。
