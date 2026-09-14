# Linear release control cold eval

あなたは、project-initを採用した既存repositoryへLinear profileを導入するfresh agentです。

Repositoryは次の状態です。

- GitHub Issue #123 にimplementation scope、acceptance criteria、hard dependencyが記録されている
- `release-0-7-0` branchとDraft release PRが存在する
- 通常のplanning cadenceはweekly release sprint
- Linear workspaceとofficial remote MCPが利用できる
- userは「Linearも使ってrelease管理を分かりやすくしたい」と依頼した
- userはGitHub execution workflowを廃止するとは言っていない

`linear-release-control` と `github-delivery` のpolicyに従い、次の8項目を決定してください。

出力は説明を付けず、次のkeyを1行ずつ `key=value` 形式で返してください。valueはpolicyから自分で決定してください。

```text
implementation_sot=
dependency_sot=
release_planning_control=
mirror_all_github_issues=
default_linear_cycle=
implementation_worker_linear_access=
linear_coding_sessions_baseline=
linear_project_mapping=
```
