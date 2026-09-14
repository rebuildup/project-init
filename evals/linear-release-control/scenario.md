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

出力は説明を付けず、次のkeyを1行ずつ `key=value` 形式で返してください。graderとの曖昧さを避けるため、valueは次のcanonical vocabularyだけを使用してください。

```text
implementation_sot=github_issue
dependency_sot=github_issue
release_planning_control=linear_project
mirror_all_github_issues=no
default_linear_cycle=no
implementation_worker_linear_access=none_or_readonly
linear_coding_sessions_baseline=no
linear_project_mapping=one_release_train
```

`implementation_worker_linear_access=none_or_readonly` は、implementation workerがLinearを必要としないことを既定とし、必要な場合でもread-only accessまでに制限するpolicyを表すcanonical valueです。
