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


## Policy layer migration

ADR-0017以降、normative ruleの移動では内容だけでなく**抽象layer**も確認する。

- Constitution: tool/provider-independentで長寿命なorganizational property
- Operating Model: 現在採用するorganization topology
- Practice: replaceable tool/workflow implementation
- Skill: context-dependent judgment/playbook

具体的なtool/cadence/branch shapeを、単に広く使っているという理由でConstitutionへ昇格させない。

逆に、複数Practiceへ共通して必要なfailure-prevention propertyが見つかった場合は、tool名を除いた最小semantic propertyとして上位layerへの昇格を検討する。

## Policy decay / de-institutionalization

semantic preservationと同じく、obsolete ruleの意図的な削除もpolicy integrityの一部とする。

non-constitutional ruleは、可能な範囲で次を追跡する。

- why: どのfailure/riskを防ぐため導入したか
- parent obligation: どの上位property/decisionを実現するか
- evidence: ruleの有効性を何で判断するか
- re-evaluate when: どの変化で見直すか
- remove when: どの条件なら降格/削除できるか

次の場合は削除・降格candidateとする。

1. original failure modeが現在のsupported environmentでmaterialでなくなった
2. 新しいagent/runtime/toolが同等以上のguaranteeを提供する
3. 上位propertyの重複記述で、追加のoperational valueがない
4. controlled evalでrule有無によるmeaningful outcome差が消えた
5. context / coordination / maintenance costがdemonstrated valueを上回る

「これまで問題が起きなかった」は単独ではpreservation理由にしない。ruleが問題を防いだ可能性と、ruleなしでも能力向上によって防げる可能性をcomparative evidenceで区別する。

## Proof-carrying deviation

defaultからのdeviationは、old procedureを文字通り保存する必要はない。

**materialなdeviation** では、必要な粒度で次の5項目をすべて明示する。

1. applicable higher-level obligation
2. alternative mechanism
3. equivalent-or-stronger guarantee
4. known limits / unresolved risk
5. verification/eval evidence

materialとは、canonical responsibility、delivery/recovery/security boundary、public/external contract、persistent state、authority、または複数actorへ影響するorganization semanticsを変えるdeviationを指す。

consequential organizational boundaryを変更する場合は、上記refinement evidenceに加えて、該当decisionとevidenceをADR / canonical profile / Practice contract等のdurable recordへ残す。これはすべてのdeviationへhuman approvalを要求する規則ではなく、Authority Integrity上の既存authority boundaryが別途適用される。

spelling、reader-facing表現、同一guarantee内のreversibleな局所implementation detail等、上位obligationやorganizational boundaryを変えないinconsequential changeでは、5項目を独立artifactとして残す必要はない。

このrefinement evidenceが十分なら、procedure差分そのものをregressionとして扱わない。
