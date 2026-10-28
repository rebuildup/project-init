# project-init 初期化プロンプト

このリポジトリのAIエージェント開発環境を初期化、または再整備してください。通常の `/init` の代わり、または補強として使います。

このpromptが持つのは**初期化の手順と、詳細ruleの正本へのrouting**だけです。ruleの中身はここに書き写さず、下の正本を読んで適用してください。

- 最上位contract: `constitution/CONSTITUTION.md`
- 現在の標準Operating Model: `organization/profiles/release-driven-solo.md`
- 判断や手順の詳細: `skills/*/SKILL.md`
- 決定の経緯: `docs/adr/`

このpromptを読むのは、初回の初期化と、project-localのagent構成を組み直す時だけです。全文を `AGENTS.md` や `CLAUDE.md` へコピーしないでください。日常のtaskは、生成した短いroot contractと必要なSkillだけで回る状態がゴールです。

profileはdefaultであって目的ではありません。Constitutionのguaranteeを同等以上に満たす、より良い方法があるなら、profileからdeviateして構いません（手続きはConstitutionの Deviation 節）。

---

## 1. 調査する

変更の前に、現状を実際に確認してください。推測で埋めず、確認できなかったことは「未確認」として扱います。

- agent関連の設定: root instructions、既存のAgent Skills、plugin / MCP設定
- 技術stack: language / framework / runtime / SDKの実version、manifest / lockfile、workspace構成
- 開発環境: devcontainer / Containerfile / Nix / `mise.toml`、host（macOS / WSL / Linux）差の扱い
- 品質: test / lint / type / build、smoke・integration・E2Eの基盤、CI（GitHub Actions）
- security: dependency / secret scanning、secret providerの設定、env schemaとexample
- delivery: repository visibility、`main` の保護設定、PR merge method設定、Issue / PR / release branchの運用状況
- docs: README / CONTRIBUTING / architecture / ADR
- 現在のerror / warning、branch、remote、userの未commit変更

## 2. 差分だけをreconcileする

初期化は何度でも実行される前提で、理想状態との差分だけを変更してください。

`missing → initialize` / `incomplete → repair` / `stale → update` / `correct → verify only`

- 正しい状態を作り直さない。変更不要も成功です。
- userの未commit変更や、project-localにcustomizeされた内容を上書きしない。差分は統合します。
- 既存のAgent Skillは、同名で存在するだけでは最新とみなさない。version pinがない限り配布元のcurrent revisionと比較し、差分があればcustomizationを保持して更新します。配布元を確認できない場合も、独断で据え置きにはしません。
- repository設定（`main` 保護、merge method）が期待と違い、変更権限があれば修復する。権限がなければblockerとして報告します。期待値はprofileと `github-delivery` にあります。

## 3. 何をどこへ反映するか

profileとSkillを読み、project固有の事情に合わせてmaterializeしてください。下の表は、project-initが持つ領域ごとの正本です。

| 領域 | 正本 |
| --- | --- |
| 実装判断の優先順位、userへ返す判断と返さない判断、設計・ADR・tool選定 | `engineering-decisions` |
| 非自明なfeature / architecture / product designの実装前整理 | `design-refinement` |
| Issue / ticket branch / PR lifecycle / stacked PR / release PR / `main` 保護 / merge method | `github-delivery`、profile |
| release planning（Linearを採用する場合） | `linear-release-control` |
| 中長期の見積もり | `agent-delivery-estimation` |
| subagentの分解・委譲・immutable snapshot / result・並列化 | `parallel-orchestration` |
| Herdrを使うSupervisor運用 | `herdr-runtime` |
| top-level委譲時のharness/provider経路選択と強制 | `parallel-orchestration`、`herdr-runtime`、`templates/agent-routing/` |
| workerごとの独立runtime、host / provider差の吸収 | `sandbox-runtime` |
| Worktrunk、Rust / Cargoのbuild cache、frontendに依存しないworktree lifecycle | `worktree-workflow` |
| Orcaをfrontendとして併用する場合 | `orca-frontend` |
| quality gate、verification level、CI | `quality-gate` |
| 不変条件と最小十分な保証手段 | `correctness-assurance` |
| 脆弱性情報の取り込みと優先度 | `security-maintenance` |
| 未知のsecurity defectの能動探索 | `security-audit` |
| secret value（Infisical） | `secrets-management` |
| 中断からの復旧、checkpoint、fencing、外部side effect | `agent-recovery` |
| fresh contributorが会話履歴なしで始められるdocs、`.tmp/` `.reference/` dotenv | `onboarding` |
| README / ADR / Issue / PR / commit等、残る文章を書く時 | `writing-discipline`（rebuildup/writing-skills） |
| userとのやりとり、質問の絞り方、blockerの見せ方 | `interaction-discipline` |
| policy自体の評価、context budget | `policy-evaluation` |
| 既存の延長ではない発想を求められた時 | `idea-discovery` |
| 導入するSkillの選定（外部Skillを含む） | `skill-selection` |

mise・Cloudflare CLI（`cf`）・secret providerなどのtool defaultはprofileに定義されています。そのprojectで実際に意味がある場合だけ導入してください。使っていないtoolをpolicy上の形式だけで追加しないでください。

### 導入するSkillを選ぶ

上の表はproject-initの自作Skillだけです。debugging、TDD、platform固有の知識、日本語の文章、visual designなどは、外部や別repositoryのSkillが担当する方が良い場合があります。

導入するSkillは `skill-selection` の手順で選んでください。手順の要点は次のとおりです。

- 必要な能力を `catalog/capabilities.tsv` の条件でprojectごとに判定します。
- 候補を `catalog/candidates.tsv` と外部の探索から集めて評価し、能力ごとに担当を決めます。
- 外部packの入口（router）は入れず、個別のSkillだけを入れます。
- project-localに `--copy` で導入し、Skillのfileと `skills-lock.json` をcommitします。

`candidates.tsv` は許可リストではありません。記録にないSkillも評価して構いません。project固有でない評価結果は、project-initへPRとして戻してください。

## 4. root contractを生成する

`AGENTS.md`（必要なら `CLAUDE.md` などのadapter）は**dispatcher**です。毎回読まれる前提で短く保ち、詳細はSkillへのpointerにしてください。

root contractに書くもの:

- projectの目的と境界
- source / workの正本: released state（`main`）、active release branch、Issue、secret providerがそれぞれどこか
- bootstrapとvalidationの入口になるcommand（`mise install`、test / lint / buildのentry point等）
- 作業開始の約束: Issue番号だけのbranch → 最初のmeaningful commit → push → すぐPR、という流れ。詳細は `github-delivery` へのpointerにする
- userへ判断を返す条件は `engineering-decisions` にある、というpointer
- 文章を残す前には `writing-discipline` を使う、というpointer
- 復旧の入口: 会話履歴ではなくIssue / PR / branch / checkpointから再開する。詳細は `agent-recovery`
- top-level agent委譲を行うprojectでは、`templates/agent-routing/` のroute契約と起動CLIをproject-localにmaterializeする。runtime / provider を同じroot contractへ直接hardcodeせず、task roleと設定ファイルへのpointerだけを記す。無断provider fallbackやnative subagent置換を禁止する境界も指す
- worktreeを使うprojectでは、作成・削除時の処理の入口（`mise run worktree:setup` / `worktree:teardown`）。project-initの `scripts/worktree/`、`.config/wt.toml`、`orca.yaml` を写して調整する（`worktree-workflow`）
- 下のhouse ruleのうち、そのprojectに該当するもの
- 能力ごとの担当表：採用したSkill（外部Skillを含む）と使う場面。手動起動のSkillはpathも書く

### House rule

profileやSkillに正本がない、このorganization共通の約束です。該当するものをroot contractへ転記してください。

- 言語: source code（identifier、comment、developer向けlogを含む）とcommit messageは英語、internal documentation・Issue・PR・review discussionは日本語。localization resourceは例外です。
- commit messageの形式: `<work-prefix>: <ごく短いtitle>`
- JavaScript / TypeScriptのpackage managerはBun。具体的な非互換がある場合だけ別のものを使います。
- text searchは `rg` / `rg --files`
- 新しいscriptを `.py` で追加しない。projectの言語かshellを使います。TypeScript projectではscriptもTypeScriptで書き、JavaScriptはtoolがTypeScriptを受け付けない等の技術的な理由がある時だけ使います。
- 新しいcontainer definitionは `Containerfile`
- project固有のruleを、global設定・home directory・agentの私的memoryにだけ置かない。repositoryに残します。

## 5. 完了を確認する

次を実際に確かめてから完了としてください。確かめられなかった項目は、理由とあわせて報告します。

- fresh cloneから、root contractを入口に必要なSkillへたどり着ける
- documentedなbootstrap / validation commandが実際に通る（可能ならfresh sandboxかCIで）
- 2つ以上のworkerを同時に動かしても、port / DB / build outputなどのmutable stateが衝突しない設計になっている
- delivery設定がprofileどおりになっている、またはずれがblockerとして明示されている
- secretがrepository・checkpoint・agent resultに入らない
- 導入したSkillのfileと `skills-lock.json` がcommitされ、fresh cloneにSkillが揃っている
- `single` の能力ごとに担当が1つで、外部packのrouterが入っていない
- README / AGENTS / Skills / ADRの間に矛盾がない
- `evals/` 等、policyを検査する仕組みがprojectにあれば通っている

最後に、変更したもの、変更不要と判断したもの、profileからdeviateした点とその理由、残っている制約やblockerを短く報告してください。
