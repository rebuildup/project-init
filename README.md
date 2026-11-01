# dotfiles

Personal user-level configuration for my development machines.

Machine/package provisioning belongs in [`rebuildup/pc-setup`](https://github.com/rebuildup/pc-setup). This repository owns the user configuration that is linked into `$HOME`, portable agent configuration composition, and Infisical runtime integration.

This is not a reusable dotfiles template.


## Setup

Fresh machineでは `pc-setup` をentrypointにする。OS package managerやInfisical/GitHub CLIの個別導入手順はこのrepositoryでは持たない。

### NixOS / NixOS-WSL

```bash
nix run 'github:rebuildup/pc-setup?dir=platforms/nixos'
```

Nix/Flakeとmachine-global mise baselineが必要toolを用意し、`~/.dotfiles` をcloneして `script/bootstrap` まで進める。

### Ubuntu / Ubuntu WSL

```bash
curl -fsSL https://raw.githubusercontent.com/rebuildup/pc-setup/main/bootstrap.sh | bash
```

### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/rebuildup/pc-setup/main/bootstrap.sh | bash
```

Ubuntu/macOSではpc-setupがGit + miseを最小bootstrapし、その後miseが `~/.dotfiles` checkout、GitHub CLI、Infisical等を用意してこのrepositoryのbootstrapへhandoffする。

### Windows 11

```powershell
irm https://raw.githubusercontent.com/rebuildup/pc-setup/main/bootstrap.ps1 | iex
```

Windows machineのtool/application setupはmise + WinGetで進める。

Windows nativeのdotfilesは `script/link.ps1` で**既存環境を壊さずに採用**する。Unix用 `script/link` の移植ではなく、既存の `.gitconfig` などを置換しない adoption-first の adapter:

```powershell
pwsh -NoProfile -File script/link.ps1          # plan のみ。何も変更しない
pwsh -NoProfile -File script/link.ps1 -Apply   # target が存在しない entry だけ symlink
```

- 既存ファイルは置換・移動・削除しない。内容が同一なら `identical`、異なる/別先を指す symlink は `conflict` として手動マージ対象に残す(`-Apply` は conflict が残ると終了コード 1)。
- symlink 権限が無い場合 (Developer Mode / 管理者が必要) は copy にフォールバックせず `error` を報告する。
- symlink entry は git index (mode 120000) から読む。`core.symlinks=false` では plain file として checkout されるため。
- 未初期化 submodule の unit (`.dsh`) と POSIX 専用 entry (`.local/bin/agent`, `.claude/statusline-command.sh`) は理由付きで skip する。Windows の agent は `script/agent.ps1` と `agent shortcuts create` を使う。

### Direct dotfiles recovery

pc-setupを使わずこのrepositoryだけを復旧する場合は、先に `git`、`gh`、`infisical` が利用可能な状態を作る。

その後:

```bash
git clone https://github.com/rebuildup/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
./script/bootstrap
```

初回cloneでは `--recurse-submodules` を付けない。private agent config repositoryは、bootstrapがGitHub認証を済ませてからpinされたcommitを取得する。

既存の `~/.gitconfig` / `~/.config/git/ignore` がある場合、bootstrapは元ファイルを `.pre-dotfiles` backupとして残した上で、user-owned Git設定や追加ignore patternをmachine-local stateへ移行してからmanaged symlinkへ切り替える。

bootstrap中に未設定のものだけ要求される:

- Git identity
- GitHub browser login
- Infisical self-host login

Infisicalは `https://secrets.rebuildup.dev` のself-hosted instanceを使用する。WSLではSecret Service / D-Busに依存しないようInfisicalの`file` vault backendを使用し、backend切替でsessionが失効した場合はbootstrapが再ログインへ進む。bootstrapは必要時に:

```bash
infisical login --domain=https://secrets.rebuildup.dev
```

相当のloginを行う。`.infisical.json` はcommit済みなので、projectの再選択は発生しない。

### Verify

```bash
cd ~/.dotfiles
./script/check
./script/secrets-doctor
git submodule status --recursive
```

`git submodule status --recursive` の各行の先頭に `-`、`+`、`U` がなく、`script/check` と `script/secrets-doctor` が成功すればdotfiles bootstrap完了。

## Principles

- Keep only configuration that I actually use or need to reproduce.
- `home/` mirrors `$HOME`; managed files are linked individually into the real home directory. An entry may be a regular file or a symlink into an agent submodule.
- Linking is idempotent and non-destructive. `script/link` never overwrites unmanaged targets; `script/bootstrap` only adopts known legacy Git targets after preserving backups and migrating user-owned state.
- Secret values are not Git state. The self-hosted Infisical instance at `https://secrets.rebuildup.dev` is the canonical secret source of truth.
- Prefer process-scoped `infisical run` injection over global exports or persistent plaintext `.env` files.
- Git identity is machine/user-local state in `~/.gitconfig.local`; do not write it into the managed `~/.gitconfig`.
- GitHub HTTPS authentication uses GitHub CLI as Git's credential helper rather than account-password authentication.
- Local machines use Infisical user login; automated workloads use dedicated Machine Identities and short-lived platform/OIDC authentication where possible.
- Prefer common configuration. Add platform-specific structure only after a real platform difference appears.

## Layout

```text
.
├── .infisical.json       # tracked self-host project binding
├── config/
│   ├── infisical.sh      # non-secret self-host site/API/project metadata
│   └── agent-init.bash   # interactive-shell delegation to a provider entrypoint
├── agents/               # pinned private agent-config submodules
│   ├── claude/
│   ├── codex/
│   └── opencode/
├── home/                 # files/symlinks that mirror paths below $HOME
├── script/
│   ├── bootstrap         # fresh-machine identity/auth/project bootstrap
│   ├── agent/            # per-provider process-scoped runtime entrypoints
│   ├── link              # create missing symlinks
│   ├── check             # detect missing/drifted symlinks
│   ├── test              # isolated symlink behavior test
│   ├── test-workflow     # bootstrap / Infisical regression test
│   ├── secrets-doctor    # validate Infisical project access
│   ├── with-secrets      # process-scoped Infisical runtime injection
│   └── check-secrets     # reject secret material / legacy SOPS state in Git
├── docs/
│   ├── adr/
│   └── research/
└── AGENTS.md
```

`.infisical.json` and `config/infisical.sh` are committed non-secret metadata.

Canonical binding:

- site: `https://secrets.rebuildup.dev`
- API: `https://secrets.rebuildup.dev/api`
- project: `d4c2fc09-a923-4a38-9cf4-b51769aadb76`
- environment: `dev`

A new machine reuses this binding. Normal setup only needs user authentication against the self-hosted instance; `infisical init` is not part of the normal bootstrap.

## Agent launcher (`agent`)

The native `claude` command keeps the official Claude Code login and is never wrapped, aliased or overridden. Routes to other API providers (OpenRouter, DeepSeek, MiniMax, OpenCode Zen) are explicit and opt-in through the unified `agent` launcher: one declarative config (`config/agents.toml`), one thin Bun/TypeScript implementation (`script/agent.ts`, linked to `~/.local/bin/agent` by `script/link`; PowerShell entry `script/agent.ps1` on Windows) that reads the TOML with `Bun.TOML.parse()`, builds a filtered process-scoped environment through the existing Infisical wrapper (`script/with-secrets`, or `script/with-secrets.ps1` on Windows) and starts the native harness CLI. Short `<harness>-<provider>` commands (e.g. `opencode-zen`) derive from the same routes.

See [agent launcher](docs/agent-launcher.md). For example `agent list`, `agent claude deepseek -- -p 'say ok'`, `agent opencode zen` or plain `agent claude` (native mode: no provider, no injection).

## Agent configuration

Global Claude Code, Codex, and OpenCode repositories are pinned as sibling submodules under `agents/`. A fresh clone does not need `--recurse-submodules`: `script/bootstrap` authenticates GitHub, stores the GitHub credential helper in machine-local `~/.gitconfig.local`, links the stable global Git config, then initializes the exact commits recorded by the parent repository.

The Claude submodule is **active**: `home/.claude/settings.json` is a tracked symlink into `agents/claude/settings.json`, and `script/link` publishes it at `~/.claude/settings.json`. `home/` therefore contains both regular managed files and symlinks into the agent submodules, and `script/link` / `script/check` traverse both.

`~/.claude/settings.json` is generated, not a symlink: `script/claude-settings.ts` composes the shared `agents/claude/settings.json` with the machine-local overlay at `~/.config/dotfiles/claude/settings.local.json` (Herdr's hook lives there). Live-only values are imported into the overlay and the previous file is backed up before regeneration. See ADR-0010.

The Codex and OpenCode submodules are fetched but **not yet linked into active agent config paths**. Each remaining child repository must first be made cross-platform. Activation before that cleanup would make the same dotfiles commit behave differently across operating systems.

The composition is:

```text
agents/
├── common/      # future shared global instructions / Agent Skills
├── claude/      # Claude-specific settings
├── codex/       # Codex-specific settings
└── opencode/    # OpenCode-specific settings
```

The future common repository will own only tool-neutral Markdown instructions, Agent Skills, and genuinely portable supporting assets. Product-specific permission/provider/plugin formats stay in their product repositories.

One common global instruction source will be linked to:

- `~/.claude/CLAUDE.md`
- `~/.codex/AGENTS.md`
- `~/.config/opencode/AGENTS.md`

See [ADR-0005](docs/adr/ADR-0005.md). Global Skills that an app installs and updates itself, such as Orca's stubs, stay owned by that app ([ADR-0011](docs/adr/ADR-0011.md)).

## Secret model

The self-hosted Infisical instance at `https://secrets.rebuildup.dev` owns secret values, versions, access policy, audit history, and rotation. The repository does not contain encrypted secret payloads either.

Local development uses an Infisical CLI user session authenticated against `https://secrets.rebuildup.dev`. Automated workloads use dedicated Machine Identities on the same instance, scoped to the project they need; prefer OIDC or platform-native workload identity over long-lived static credentials.

The following must never be committed:

- `INFISICAL_TOKEN`
- Universal Auth client secrets
- user/session credentials
- Infisical local credential/cache files
- plaintext `.env`
- private SSH or age keys
- SOPS payloads/config from the superseded design

### Updating secrets

A secret update is **not a Git operation**.

Use the self-hosted dashboard at `https://secrets.rebuildup.dev` or the Infisical CLI to create/update/delete values. There is no dotfiles commit or push after a value change; Infisical provides its own version and audit history.

Avoid putting secret values directly into reusable shell history. For interactive manual edits, the dashboard is the default path unless a purpose-built non-history CLI flow is required.

### Using secrets

Run a command with the secrets from the bound dotfiles Infisical project injected into only that process:

```bash
./script/with-secrets command arg1 arg2
```

There is no runtime environment/path selector at call time. The dotfiles secret project uses the canonical `dev` environment. `config/infisical.sh` pins the API URL, project ID, and environment, and `with-secrets` delegates with explicit `--projectId` and `--env=dev`. The wrapper does not narrow secrets by path.

Project-specific secrets belong to that project's own Infisical project and `.infisical.json`. If secret sets become too broad, split the ownership at the project boundary instead of adding a secret-selection step to every command.

## SOPS migration history

SOPS + age was replaced by Infisical in 0.1.1. Active SOPS configuration and encrypted payloads are no longer part of the current tree.

Historical ciphertext remains in Git history. Migrated credentials should be rotated when practical if they are still valid.

## Add a dotfile

Place the source at the same relative path under `home/` that it should have below `$HOME`, then run:

```bash
./script/link
./script/check
./script/test
./script/test-workflow
./script/check-secrets
```

Do not add package installation commands here. If a CLI tool must be installed before its configuration can be used, install/document that dependency in `pc-setup`.

## Current configuration

The current common Git baseline includes:

- default branch: `main`
- prune deleted remote refs on fetch
- global ignore via `~/.config/git/ignore`
- machine/user-local `~/.gitconfig.local`

The editor baseline is shared between Vim and Neovim:

- `~/vimfiles/shared/base.vim` — the single source of truth for both editors (encoding, `~/.cache/vim` backup/swap/undo, display, folding, search, indent, statusline, `list`, window/tab/normal/insert/visual mappings, transparent background). Sourced by Vim's `_vimrc` and by Neovim's `init.lua`.
- `~/vimfiles/keymap/onishi.vim` — 大西配列 key placement; sourced last from `base.vim` so it overrides the defaults above.
- `%LOCALAPPDATA%\Programs\Vim\_vimrc` and `%LOCALAPPDATA%\nvim\` (Neovim config, lockfiles, `scripts/`, `snippets/`) mirror their real Windows locations under `home/AppData/Local/` so neither editor needs an environment variable to find its config.

`set background=transparent` is rejected with E474 by both Vim and Neovim, so transparency is applied as `guibg=NONE` on `Normal` / `NormalNC` / `SignColumn` / `EndOfBuffer`, re-applied on `ColorScheme`.

## Decisions and research

- [`ADR-0001`](docs/adr/ADR-0001.md) — plain symlink home-mirror deployment
- [`ADR-0002`](docs/adr/ADR-0002.md) — minimal common-first configuration and `pc-setup` boundary
- [`ADR-0003`](docs/adr/ADR-0003.md) — superseded SOPS + age design
- [`ADR-0004`](docs/adr/ADR-0004.md) — Infisical secret source of truth
- [`ADR-0005`](docs/adr/ADR-0005.md) — sibling agent-config submodules and shared portable assets
- [`ADR-0006`](docs/adr/ADR-0006.md) — self-hosted Infisical control plane
- [`ADR-0007`](docs/adr/ADR-0007.md) — WSL Infisical file-vault / bounded runtime validation
- [`ADR-0008`](docs/adr/ADR-0008.md) — provider-neutral Claude common configuration / isolated providers
- [`ADR-0009`](docs/adr/ADR-0009.md) — agent launcher in Bun + TypeScript (`agent <harness> <provider>`)
- [`ADR-0010`](docs/adr/ADR-0010.md) — effective Claude settings composed from the shared submodule baseline and a machine-local overlay
- [`ADR-0011`](docs/adr/ADR-0011.md) — one owner per global Agent Skill placement (dotfiles, app updaters, projects)
- [`dotfiles survey`](docs/research/dotfiles-survey.md)

### デバイスへの SSH / Herdr 接続

接続先の正本は self-hosted Infisical の dotfiles project / `dev` / `/devices`。
各端末で Infisical にユーザーログインして利用する。取得対象はこのフォルダーのみで、
アプリケーション secret の全注入・秘密鍵配布はしない。

```sh
devices list                 # Infisical の同じ論理ノード一覧
devices sync                 # SSH設定と公式Herdr machine登録を同期
devices check wsl            # host key + OS/user/instance を照合
devices ssh wsl              # 標準SSH
devices herdr wsl            # Herdr公式remoteで既存sessionへ
```

Unix は `script/link` で `devices` を配置。Windows は
`script\devices.ps1` または `script\devices.cmd` を使う。
全プラットフォームで `bun script/devices.ts ...` も同じ入口。
`devices sync` 後は、普段の `herdr` の machine 一覧から各ノードを選べる。
同一 session 内の全 workspace/tab は Herdr 自身が共有し、複製しない。
自身のノードは Local を使用する。名前付き session は default とは別物なので明示する。

新規端末では `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_devices` で
**その端末だけの鍵**を作り、公開鍵を許可する相手の SSH に登録する。
現在の入口は `IdentityAgent none` を明示するため、無人の machine 接続では
端末のファイル権限で保護したパスフレーズなしの専用鍵が必要。
個人の既存鍵を置換・共有せず、接続先の公開鍵認可は別途管理する。
OS側のSSH/経路セットアップは `pc-setup` が所有する。

登録・更新は接続対象上または信頼済みの管理経路で instance ID とホスト公開鍵を
取得し、次の形式のファイルを `devices register NODE.json` に渡す。
値を Git に置く必要はなく、このファイルを正本として使い続けない。

```json
{
  "id": "lab-windows",
  "label": "Lab Windows",
  "os": "windows",
  "instanceId": "REPLACE-WITH-MACHINE-GUID",
  "host": "lab-pc.example.internal",
  "port": 22,
  "user": "researcher",
  "hostKey": "ssh-ed25519 REPLACE_WITH_VERIFIED_PUBLIC_HOST_KEY",
  "session": "default"
}
```

`os` は `linux` / `macos` / `windows`。
instance ID は Linux `/etc/machine-id`、macOS `IOPlatformUUID`、
Windows `HKLM:\SOFTWARE\Microsoft\Cryptography` の `MachineGuid`。
ホスト鍵は ed25519 公開鍵の先頭2フィールド。未知のネットワークから取得した
`ssh-keyscan` の結果だけを信頼しない。register は構文を検査して発行し、
同期・接続時に実体を検査する。ノードごとに `DEVICE_<ID>` を shared secret として保存する。
同じ ID の register はそのエントリだけを更新する。同一 ID の同時編集は避ける。

WSL 作成・再作成時は新しい instance ID、SSH host key、到達可能な host/port を
同じ論理 ID で register する。旧秘密鍵/host key を新インスタンスへ複製しない。
削除時は `devices forget wsl`、その後各端末で `devices sync`。
停止だけなら定義を残してよい。停止中は接続失敗となり、起動後に同じ対象へ再接続する。
新規登録には対象の Herdr session が既に稼働していることが必要で、
この入口はリモートから管理者権限で server を勝手に起動しない。

同期は手動実行。Infisical の変更を常駐監視する独自プロセスは作らない。
接続コマンドも最新定義を取得する。Herdr が既に開いている間の保存済み接続は
最後に同期した定義を使うため、変更・削除後は各端末で同期する。
自分が作成した profile だけを追跡し、変更・削除時に再調整する。
既存の別名 profile を勝手に採用・削除せず、同名衝突はエラーにする。
接続不能な他ノードがあっても、照合できた対象への明示接続は可能。
同期状態は `~/.local/state/dotfiles/devices`、SSH生成物は
`~/.ssh/devices.conf` と `~/.ssh/devices_known_hosts`。これらは正本ではない。

#### Git と Infisical の更新順

Git で配布するのは `script/devices*`、入口、検証、手順だけ。
実ノードのアドレス・instance ID・host key・session は Infisical に置き、
`home/` やローカル JSON を第二の正本にしない。`profiles.json` は生成物の所有記録であり、
接続コマンドは毎回 Infisical を読む。秘密鍵とログイン情報は Git に追加しない。

実装更新は各 checkout で `git pull --ff-only`（作業中の変更は保持して先に確認）。
その後 `devices sync`、Windows は通常権限の PowerShell から
`& "$HOME\.dotfiles-devices\script\devices.ps1" sync` を実行する。
Windows の SSH ログオンは通常ログオンの資格情報ストアを開けないことがあるため、
認証情報をコピーせず通常ログオンから同期する。
専用 checkout を使う場合も `main` を追跡し、手作業でスクリプトをコピーし続けない。
