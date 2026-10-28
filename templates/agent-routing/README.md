# Delegated agent routing template

このテンプレートは、トップレベルの委譲先を決定し、Herdr の pane 内で dotfiles の `agent` ランチャーを使って起動する入口です。`agent` の provider/model/認証定義は `rebuildup/dotfiles/config/agents.toml` が正本です。テンプレートの JSON は**role → routeの選択**だけを保持します。記載された MiniMax/OpenRouter Free はサンプルであり、採用前に各ユーザーの設定と使用可能枠に合わせて変更してください。

1. `dispatch.mjs` と、このサンプルを調整した `agent-routing.json` をプロジェクトへコピーします。後者を commit するなら非機密の route key のみ記述します。既存の AGENTS.md / CLAUDE.md に `dispatch.mjs` と `agent-routing.json` を参照する短い文を追加します。
2. `agent check` が成功し、`agent pi <provider>` が実行可能であることと、Herdr serverと pane detection が使えることを実機で確認します。Infisicalの secret値をこのファイルへ置かないでください。
3. `node dispatch.mjs plan --config agent-routing.json --role review` で選択を確認します。
4. mutable Workerの場合、Worktrunk等で独立 workspace/runtime を先に構築し、`node dispatch.mjs start --config agent-routing.json --role review --cwd /path/to/worktree --name review132` で起動します。返された pane ID と実行計画をログ/タスクに関連付けます。
5. `node dispatch.mjs prompt --config agent-routing.json --target w1:p2 --message-file /path/to/task.md` と `read` で監視・回収します。Herdr の `idle/done` は受入検証の代わりになりません。

`start` は Herdr の `agent start --kind pi` を使いません。それでは `agent pi openrouter-free` を実行したことにならないためです。`workspace create` → `pane run`（既存 unified launcher）→ `agent get/rename` を使います。検出失敗・認証失敗・タイムアウトでは別providerやネイティブへ自動切替せず、paneを残して調査する必要があります。リトライする前に既存paneと作業の副作用を照合してください。

この entrypoint は **自発的な委譲選択の保証にはなりません**。生成した root contract と harness 側の tool permission/hook で、roleに対応しないネイティブ委譲を制限してください。CLIが存在しない環境やHerdrの検出に失敗した場合は `blocked` とし、ユーザーが認可していない代替経路を使用しないでください。

テスト: `node --test dispatch.test.mjs`。外部の認証・Herdr・Piを実際に動かすE2Eは対象マシンで別途実施し、通過するまで運用readyとはしません。
Claude Code でnative delegationを停止したい場合は、`claude-settings.example.json` の `hooks.PreToolUse` をproject-local `.claude/settings.json` へ競合なく統合し、`claude-guard.mjs` を指定した `scripts/agent-routing/` へ置いてください。このhookは `Agent` / `Task` 呼び出しのみ拒否し、任意のBash経由での別CLI起動は防げません。一般のread/searchやnative observational helperにも影響するため、project固有の許可境界と合わせて導入してください。実際のprojectへの自動配布はまだ未実装です。
