---
name: orca-frontend
description: Orca（stablyai/orca）をworktreeとagent terminalのfrontendとして使うprojectで、Orcaを導入・設定する時、またはOrca上でworktreeを作る・消す・agentを並列に動かす時に使用する。Orcaを使わないprojectでは使わない。
---

# Orca Frontend

Layer: **Practice**

Orcaは、並列worktreeの一覧、agent terminal、diff review、mobileからの通知と操作を一つの画面にまとめるfrontendとして使える。ただし、projectの正しさはOrcaに依存させない。Orcaを閉じても、別のmachineでOrcaがなくても、Worktrunkかplain gitで同じ状態を作れることを保つ。

worktreeのlifecycleの正本は `worktree-workflow` である。このSkillは、その上にOrcaを載せる時の扱いだけを書く。

## Orcaに持たせないもの

- **worktreeのsetup / teardown**：処理は `worktree-workflow` のrepository-controlledな入口に置き、`orca.yaml` からはそれを呼ぶだけにする。
- **作業の正本**：Issue、branch、PRがcanonical stateである。Orcaのworkspace名、親子関係、sidebarの状態はUIの状態として扱う。
- **orchestrationの状態**：Orcaの Run / Task / Dispatch / 完了通知はtelemetryとして扱う。taskの完了やresultの採否は、GitHub IssueとPR、検証結果で判断する（`parallel-orchestration`）。
- **共有されるmutable state**：`worktree.sharedDirectories` とWorktree Shared Pathsはsymlinkで共有する。build outputや、書き込まれる `node_modules` のように並行して変わるpathには使わない（Mutable Ownership Safety）。

## 設定

`orca.yaml` は `worktree-workflow` と同じ入口を呼ぶ。

```yaml
# orca.yaml
scripts:
  setup: |
    mise run worktree:setup
  archive: |
    mise run worktree:teardown
```

- `.worktreeinclude` はWorktrunkとOrcaの両方が読む。literalなpathだけで書き、承認済みのnon-secret pathに限る。`.env` やcredentialは入れず、secretは `secrets-management` のruntime injectionで渡す。
- worktreeの作成にはWorktrunk（`wt switch --create <issue-number> --base=release-x-y-z`）を使ってよい。Orcaの Settings → General → Workspace で、Worktrunkのworktree置き場を外部worktreeの置き場として登録すると、Orcaのsidebarに表示できる。
- Orcaからworktreeを作る場合は、Advancedでbranch名をIssue番号にする。Orcaが作業名から派生させるbranch名は、ticket branchの命名規則に合わない。
- Orca同梱のSkill（`orca-cli` 等）は、Orcaの実行中だけ動くdiscovery stubで、Orcaのbuildと版を合わせる必要がある。machine単位のglobal配置はOrcaのupdaterに任せてよい（updaterは実行中のbuildのcommitにpinして入れ直す）。projectの `skills-lock.json` には入れず、projectの正しさをこれらのstubに依存させない。

## 操作の注意

- Linuxでは、Orcaのterminal外で `orca` と打つとGNOMEのscreen readerが起動することがある。Orcaのterminal外では `orca-ide` を使うか、`ORCA_CLI_COMMAND` が設定されていればその値を使う。
- 外部で作ったworktreeをOrcaから削除する場合も、teardownが動いたかを確認する。入口は何度実行しても同じ状態になるので、迷ったら手動で再実行してよい。
- Orcaのorchestrationはexperimental扱いである。Herdr等ほかのSupervisorと同時に、同じworkerを管理させない。

## 外す時

Orcaをやめる時に移行作業が要らないことが、この扱いの目的である。次がOrca以外の場所にあれば、Orcaのuninstallだけで済む。

- worktreeのsetup / teardownとport決定（repositoryの入口）
- branch、Issue、PR、検証結果（GitHub）
- `.worktreeinclude` と、Orcaを使わない場合の作り方（`worktree-workflow`）
