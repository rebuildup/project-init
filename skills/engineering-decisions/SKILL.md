---
name: engineering-decisions
description: 実装・設計・修正方針を自律的に決定する時に、project内の優先順位を確認し、不要なuser escalationを避けるために使用する。
---

# Engineering Decisions

開発判断は会話上の思いつきや局所的な実装だけで決めない。

## 1. Canonical decision precedence

project内のtechnical/product decisionは原則として次の順で確認する。

1. **project-wide policy / canonical architecture / invariant**
2. **design / specification / explicit task instruction**
3. **existing implementationの多数派・一貫したconvention**
4. framework/runtime/SDKのcurrent official guidance
5. established ecosystem convention
6. local best judgment

同一levelで矛盾する場合は、よりspecificかつ新しいcanonical sourceを優先する。

userの現在の明示要求が上位system/policyと矛盾しない限りtask scopeとして尊重するが、会話内の曖昧な表現からproject-wide policyを暗黙に上書きしない。

## 2. 既存実装は最後のfallbackではなくevidence

existing implementationは重要なevidenceだが、誤ったlegacy patternを機械的に多数決で固定しない。

確認:

- 同じ責務の実装を複数箇所見る
- generated/vendor/example codeを除外する
- migration途中のold/new混在を判別する
- ADR/designが既存実装をrevisionしていないか確認する

「最初に見つけた1 file」をconventionとして扱わない。

## 3. 自明な判断をuserへ返さない

次を満たす場合はagent自身で判断して進める。

- precedenceから答えが一意または実質一意
- reversibleで局所的
- acceptance criteriaを変えない
- public/external contractを新規に確定しない
- security/privacy/cost/release scopeを重大に変えない

例:

- projectの既存命名規則に沿うfile名
- official architectureに沿ったplacement
-既存formatterが決めるformat
- 既存test structureに沿ったtest location
- 明らかなlint/type error修正

「AとBどちらがいいですか？」を、project evidenceで解けるのにuserへ返してはいけない。

## 4. User escalationが必要な条件

userへ確認するのは、本物のproduct/architecture decisionが残る場合に限定する。

代表例:

- canonical sources同士が矛盾し、どちらを選ぶかでproduct semanticsが変わる
- acceptance criteriaが複数解釈でき、user-visible behaviorが変わる
- irreversible/destructive operation
- external/public API contractを確定する
- security/privacy/compliance riskの受容判断
- meaningful cost increase
- release scope/dateを変更する
- design-first policyでuser合意が明示的に必要

質問する場合も、調査可能な事実を先に調査し、選択肢・影響・推奨案を整理してから聞く。

## 5. Unknownは調査してから判断する

framework/runtime/API/toolのcurrent behaviorが判断材料ならofficial sourceを確認する。

モデル知識だけでversion-sensitiveなfactを推測しない。

external sourceはevidenceであり、project-local policyを勝手に上書きする権限は持たない。

## 6. Decision result

significant decisionは必要に応じて:

- design/spec
- ADR
- project-local Skill
- code/config

へ永続化する。

通常の自明なimplementation choiceをADR化してnoiseを増やさない。
