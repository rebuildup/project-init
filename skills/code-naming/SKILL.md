---
name: code-naming
description: 新規コードの実装・追加・変更・命名・リネーム時に使用する。最初から責務と階層と名前を設計し、追加後も既存コード・参照箇所・外部契約に整合させる。文章の推敲には使用しない。
---

# Code Naming

名前の目的は、利用者が対象を正しく識別できることである。最短の名前や、宣言元でだけ自然な名前を目標にしない。**実際の参照箇所で必要な意味を保ち、そこですでに明らかな語だけを削る。**

## 1. 追加する前に既存の構造を調べる

新規ファイルやシンボルを作る前に、影響する実コードの責務・同階層・利用側を読む。既存の所有者への統合や境界の再配置を先に評価し、似た名前のファイルを横へ増やしてからリファクタリングする進め方を完成としない。

新規実装・追加・変更・レビュー・リネームでは、判断に必要な範囲で確認する。

- repositoryの既存規約、対象言語・frameworkの命名制約、隣接する名前
- 対象の責務・実際の値や振る舞い・同階層で区別すべき概念と既存の所有者
- 変更するdirectoryの兄弟entry、近接する階層、似た名前と責務の重複・細片化
- 宣言元だけでなく、representativeな参照箇所とimport / export形態
- 公開API、schema、永続化データ、CLI、file pathなど、名前が外部契約になっているか

## 2. 名前を評価する

以下を満たす最小限の情報で命名する。

- **意味**: 動作、役割、ドメイン概念が分かる。抽象語だけで意味を覆い隠さない
- **区別**: 同じscopeや利用場面にある別の対象と誤認しない
- **重複**: 使用箇所のnamespace、receiver、型、pathなどから自明な情報を繰り返さない。ただし宣言元のpathが参照箇所でも見えると仮定しない
- **一貫性**: 同じ概念には同じ語を使い、case、複数形、略語、suffixはrepository・言語の慣習に合わせる
- **安定性**: 一時的な実装手段や配置場所ではなく、維持すべき責務に基づいて命名する

短縮した結果、読み手が型、実装元、会話履歴をたどる必要が増えるなら短縮しない。短いlocal変数は文脈で一意ならよいが、公開名は単体でも理解できるようにする。

## 3. 対象別に判断する

- **階層全体**: 類似名の兄弟が増える、別責務が同階層へ混在する、親・子・leafが責務語を反復する場合は統合・再配置を検討する。entry数は調査契機であり合否条件ではない。数合わせの中間directoryを作らない
- **ファイル・ディレクトリ**: 親pathから分かる語は省けるが、隣接要素との区別と移動後の可読性を保つ。言語・frameworkが規定する `page.tsx`、`route.ts`、`mod.rs` 等は任意に変更しない
- **関数・メソッド**: 実際の操作・変換・副作用を表し、receiverやnamespaceが意味を補う場合は重ねない。曖昧な `process` / `handle` を機械的に許容しない
- **型・定数・変数**: 役割と意味上の区別を優先する。`data` / `manager` / `util` / 型名suffixを機械的に削除・禁止しない
- **action・schema・serialization key**: 内部の識別子と外部から参照・保存される名前を区別する。後者は変更するとcontract変更になる

## 4. 反例で判断を補正する

`src/workspace/background.ts` 内の `workspaceBackgroundToGridStyle` は重複候補だが、常に `toGridStyle` がよいわけではない。

```ts
// 名前空間が参照箇所で見えるなら短くできる
background.toGridStyle(input);

// 名前空間なしの直接importでは意味を残す
backgroundToGridStyle(input);
```

一方、`createUser` を `create` にすると複数の生成処理と区別できない場合がある。短縮を見送るのが正解になるケースを必ず考える。

## 5. 既存構造と名前を更新するとき

1. 変更する名前と実参照を列挙する。新しい要求によって既存側が不整合になるなら同じ変更で統合・移動・削除する。今回生んだ不整合を後日に先送りしない。無関係な一括短縮をしない
2. 言語サーバー等のsymbol-aware renameを優先し、曖昧な文字列置換を避ける。path変更ではimport、case-sensitive / insensitive filesystem、build設定を確認する
3. 型・schema・test・fixture・doc・生成物のsourceなど影響する参照を整合させる。`rg` 等による文字列検索は探索と残存確認に用い、参照網羅の唯一の根拠にしない
4. 公開API、persisted key、DB、event、外部連携の名前は原則維持する。変更が必要なら利用者・既存データへの影響を調べ、明示的な移行・alias・codec等で互換性を扱う。内部識別子の短縮に伴ってwire nameまで変えない
5. 変更に応じたformatter / typecheck / lint / test / contract検証をprojectの定義から選び、対象の参照箇所で名前が改善したことを読み直す

## 完了条件

- 新規と既存の責務・名前・階層が整合し、似た名前の兄弟entryを惰性で増やしていない
- 参照箇所で曖昧さが減り、必要な区別が失われていない
- 参照と名前の不整合・取り残しがない
- external / persisted contractが維持されたか、変更と移行が明示されている
- 変更規模に応じたverification evidenceがある

改善を説明できないリネームは行わない。報告は主要な変更、互換性への影響、検証結果に絞る。

## 補助資料

言語ごとの詳細規約は当該projectの採用言語・frameworkを優先する。参考:
- [Google TypeScript Style Guide — Naming](https://google.github.io/styleguide/tsguide.html#naming): 型に含まれる情報の重複、識別子の明確さ
- [Google Go Style — Naming](https://google.github.io/styleguide/go/decisions.html#naming): 利用scopeと周辺文脈による情報量の調整
- [Rust API Guidelines — Naming](https://rust-lang.github.io/api-guidelines/naming.html): Rustの命名規約・変換の意味を表す語
