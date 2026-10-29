# Delegated agent routing template

このテンプレートは、トップレベルの委譲先を決定し、Herdr の pane 内で dotfiles の `agent` ランチャーを使って起動する入口です。`agent` の provider/model/認証定義は `rebuildup/dotfiles/config/agents.toml` が正本です。テンプレートの JSON は**role → routeの選択**だけを保持します。記載された MiniMax/OpenRouter Free はサンプルであり、採用前に各ユーザーの設定と使用可能枠に合わせて変更してください。

1. `dispatch.mjs` / `layout.mjs` と、このサンプルを調整した `agent-routing.json` をプロジェクトへコピーします。後者を commit するなら非機密の route key のみ記述します。既存の AGENTS.md / CLAUDE.md に `dispatch.mjs` と `agent-routing.json` を参照する短い文を追加します。
2. `agent check` が成功し、`agent pi <provider>` が実行可能であることと、Herdr serverと pane detection が使えることを実機で確認します。Infisicalの secret値をこのファイルへ置かないでください。
3. `node dispatch.mjs plan --config agent-routing.json --role review` で選択を確認します。
4. mutable Workerの場合、Worktrunk等で独立 workspace/runtime を先に構築し、`node dispatch.mjs start --config agent-routing.json --role review --cwd /path/to/worktree --project-root /path/to/project --name review132` で起動します。返された pane ID と実行計画をログ/タスクに関連付けます。
5. `node dispatch.mjs prompt --config agent-routing.json --target w1:p2 --message-file /path/to/task.md` と `read` で監視・回収します。Herdr の `idle/done` は受入検証の代わりになりません。

`start` は Herdr の `agent start --kind pi` を使いません。それでは `agent pi openrouter-free` を実行したことにならないためです。`herdr api snapshot` で既存project workspace/役割タブを調べ、既存タブなら `pane split --cwd <worker-path>`、なければ `tab create` を使います。Workspaceがなければproject-rootに作り、最初のCtrlタブを基点として残します。`pane run`（既存unified launcher）→ `agent get/rename` で起動します。既存の実行中ペインを直接使い回しません。検出失敗・認証失敗・タイムアウトでは別providerやネイティブへ自動切替せず、paneを残して調査する必要があります。リトライする前に既存paneと作業の副作用を照合してください。

この entrypoint は **自発的な委譲選択の保証にはなりません**。生成した root contract と harness 側の tool permission/hook で、roleに対応しないネイティブ委譲を制限してください。CLIが存在しない環境やHerdrの検出に失敗した場合は `blocked` とし、ユーザーが認可していない代替経路を使用しないでください。

テスト: `node --test dispatch.test.mjs`。外部の認証・Herdr・Piを実際に動かすE2Eは対象マシンで別途実施し、通過するまで運用readyとはしません。
Claude Code でnative delegationを停止したい場合は、`claude-settings.example.json` の `hooks.PreToolUse` をproject-local `.claude/settings.json` へ競合なく統合し、`claude-guard.mjs` を指定した `scripts/agent-routing/` へ置いてください。このhookは `Agent` / `Task` 呼び出しのみ拒否し、任意のBash経由での別CLI起動は防げません。一般のread/searchやnative observational helperにも影響するため、project固有の許可境界と合わせて導入してください。実際のprojectへの自動配布はまだ未実装です。

## Role/function とレイアウト

論理的なactor role (Supervisor/Worker/Reviewer) と execution function (implement/refactor/review/verify/recover/reconcile/cleanup) は別です。前者の所有権・結果採用ルールは `organization/execution-roles.md`、機能間の衝突条件は `organization/execution-functions.md` を参照します。Herdrタブは表示用であり権限を与えません。role routeに任意の `function` を記述できます。例: `"function": "refactor"`。未知のfunctionはfail-closedです。

`layout` は `workspaceLabel` (短い表示名)、`preferredPanesPerTab` (既定4、最大6)、`maxTabsPerLane` (既定2)、`overflow` (`queue` / 明示的な `new-tab`) および表示専用 `functionTabs` を持ちます。既定は `Ctrl`・`Work`・`Device` を共有し、Review/Testを独立させる場合だけ `functionTabs` で変更します。

異なるGit worktreeのWorkerは `git rev-parse --git-common-dir` から共通のproject rootを自動検出します。非標準Git構成や明示的に指定する場合は **`--project-root` (共通のproject checkout) と `--cwd` (実装worker専用workspace) を分けて指定**してください。初期のCtrl shellをanchorとして保持し、同一プロジェクトのworkspaceを再利用します。project rootが不明、同名workspaceが曖昧、起動名が重複、pane inventoryが不整合なら新規作成せずblockします。必要なら `--workspace-id` を明示します。labelのみで別repoを同一視しません。

pane容量上限では既定でqueued/blockerとなり、新規tabを増やしません。`overflow: "new-tab"` を明示した場合だけ `Work2` 等を上限まで作成します。手動で配置したpaneの無断移動・削除・focus変更はしません。同時起動をserialiseするlocal lockが残った場合は古いagent/副作用を調べてから手動reconcileします。live resource leaseや複数hostのfencingはLayoutの外側で必須です。

`node --test layout.test.mjs dispatch.integration.test.mjs` でplannerとmock CLI lifecycleのregressionを確認します。Herdr実機・各OS/providerのE2E、既存repoへの自動展開はまだ未完了であり、実運用Readyとはしません。
