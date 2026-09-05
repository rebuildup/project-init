# Codexの役割分担 — 2026年8月時点

この文書は**2026年8月時点の暫定運用方針**です。

Codexのmodel、pricing、availability、subagent behavior、model routing、native sandbox capabilityが変わった場合は再調査し、必要ならADRを更新してください。

これはOpenAIが各modelに公式に割り当てた職務ではなく、project側のlogical role policyです。

実行isolation、snapshot/result protocol、Git integrationについては `ADR-0003` とproject-local parallel-orchestration Skillをcanonical sourceとしてください。

## Sol — coordinator / supervisor role

主な責務:

- complete user request理解
- acceptance criteria
- architecture-level reasoning
- dependency graph
- task decomposition
- subagent orchestration
- snapshot / integration ordering
- consequential decisions
- difficult problem solving
- final verification
- final synthesis

重要:

- Sol自身がhost-level sandbox managerになるという意味ではありません。
- sandbox create/destroy、credential injection、child lifecycle等は外部Agent Supervisor/control planeへ委譲してください。
- worker結果はimmutable commit/diff、または記録済みcommit SHA/content digestへpinされたnever-moved refとして統合してください。
- integration時にmutable branch/ref名を再解決せず、記録済みimmutable identityを使用し、ref移動を検出した場合は拒否してください。
- shared mutable working treeへ複数agentを直接配置しないでください。

機械的な大量実装をSol自身へ集中させないでください。

## Terra — independent reviewer role

主な責務:

- implementation review
- architecture review
- correctness review
- integration review
- test adequacy review
- failure analysis
- independent second opinion
- sandbox/runtime reproducibility review

可能な場合、implementer自身のself-reviewだけで完了させないでください。

Reviewerはmutable refやimplementerのdirty workspaceではなく、integration candidateのcommit SHA/content digestへpinされたclean snapshotから開始してください。

## Luna — primary implementation worker role

主な責務:

- code implementation
- mechanical refactoring
- test implementation
- repository exploration
- bounded investigation
- repetitive changes
- deterministic tool execution
- independent implementation units

implementation workerとして使う場合は、**workerごとのisolated mutable execution environment**で実行してください。

worker inputはresolved commit SHA/content digestへpinされたimmutable snapshot、worker outputはimmutable commit/diffまたは記録済みimmutable identityへpinされたnever-moved refを標準とします。

安全に分離できる実装は可能な限りworkerへ委譲してthroughputを拡大してください。品質よりcostを優先するという意味ではありません。

高難度・高影響判断はreviewer/coordinatorへ昇格してください。

実行時にsubagent modelを指定・確認できるか確認し、実際に確認できないmodelを使用したと虚偽に報告してはいけません。

明示model routingが利用不能でも、coordinator / reviewer / implementerというlogical roleとADR-0003のisolation semanticsは維持してください。
