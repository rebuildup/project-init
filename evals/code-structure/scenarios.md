# Code structure: cold evaluation cases

目的: 命名だけを後から直すのではなく、**最初の実装と毎回の変更時点**で既存コードの責務・階層・参照との整合を完成させられるかを、成果物で評価する。

## 方法

fresh agentへ対象root contract、適用Skill、各caseの初期ソースと新要求を与え、実際の完成diff・tree・利用側の結果を採点する。以下の判定例やgraderをbuilderへ渡さない。baseline/candidateは同一のmodel・runtime・tool条件・ケース・trial数で比較し、`policy-evaluation` のblind comparative rubricを使う。**これは実行用仕様であり、modelを使ったcold evalの実施証跡ではない**。

## Case A: 同階層の相似ファイル増殖（regression）

初期tree:

```text
src/workspace/
  WorkspaceGrid.tsx
  WorkspaceGridHeader.tsx
  WorkspaceGridHeaderActions.tsx
  WorkspaceGridHeaderActionsMenu.tsx
  WorkspaceGridSettings.tsx
  WorkspaceGridSettingsPanel.tsx
  WorkspaceGridUtils.ts
  WorkspaceGridHelpers.ts
```

`WorkspaceGridHeaderActions.tsx` はactionの表示・選択を所有する。新要求: disabled actionに理由を表示する。

- FAIL: `WorkspaceGridHeaderActionsDisabledReason.tsx` を追加するだけで、既存owner・利用側・隣接責務を調べない。
- FAIL: 直下entry数を減らす目的だけで中間directoryを挿入する。
- PASS候補: 実在するaction定義と参照箇所を読んで既存ownerを適切に拡張する。境界が混在していると確認できれば、意味のある責務境界へ再配置しimportも更新する。どちらを選ぶかは現物の振る舞いで判断する。

## Case B: 状態の追加で旧コードを放置（regression）

```ts
// src/orders/orderStatus.ts
export type OrderStatus = "pending" | "paid";
export function isSettled(status: OrderStatus) { return status === "paid"; }
// src/orders/orderStatusUtils.ts
export function toBadge(status: "pending" | "paid") { return status === "paid" ? "done" : "waiting"; }
```

新要求: `refunded` を追加する。

- FAIL: `orderStatusRefundUtils.ts` のみ追加し、元の状態型やbadgeと利用側を矛盾したまま残す。
- PASS候補: 状態の所有者とconsumerを調べ、型・導出・処理・テストを整合する。新ファイル自体を無条件で禁止しない。

## Case C: 名前短縮が実際の利用箇所を壊す（negative control）

```ts
import { create as createUser } from "./users";
import { create as createTeam } from "./teams";
```

- FAIL: `create` に機械的統一して2つの操作を区別できなくする。
- PASS候補: namespaceやimport aliasを含む実際の参照箇所で曖昧さを排除する。短い名前を一律禁止しない。

## Case D: 12個でも妥当な兄弟entry（positive control）

```text
src/commands/
  add.ts  delete.ts  get.ts  list.ts  move.ts  rename.ts
  reset.ts  search.ts  show.ts  sync.ts  test.ts  verify.ts
```

各entryは異なる公開CLI commandを所有し、呼出側と1:1で対応する。

- FAIL: 「10件超だから」だけで数合わせの階層変更や改名を行う。
- PASS: 責務とAPIの整合が保たれているなら構造を変更しない。

## 評価基準

すべてのcaseで、実コードに基づく所有責務・同階層と参照箇所の確認、変更後の既存側の移行、明確な識別子、外部/保存契約の保護、言語・framework規約、対象testの整合を確認する。A/Bの先送り、Cの曖昧化、Dの不要な改変はcritical failure。単にSkillを読んだとの報告は採点しない。

meaningfulなcold evalを実行できた場合だけ、model・runner・policy SHA・case revision・trial・completed diffとgradeを別のevidenceへ記録する。現時点では**NOT_RUN**。
