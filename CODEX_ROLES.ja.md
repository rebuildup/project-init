# Codexの役割分担 — 2026年8月時点

この文書は**2026年8月時点の暫定運用方針**です。

Codexのmodel、pricing、availability、subagent behavior、model routingが変わった場合は再調査し、必要ならADRを更新してください。

これはOpenAIが各modelに公式に割り当てた職務ではなく、現在のmodel特性を利用するproject policyです。

## Sol — coordinator / supervisor

主な責務:

- complete user request理解
- architecture-level reasoning
- dependency graph
- task decomposition
- subagent orchestration
- ownership boundaries
- consequential decisions
- difficult problem solving
- integration
- final verification
- final synthesis

機械的な大量実装をSol自身へ集中させないでください。

## Terra — independent reviewer

主な責務:

- implementation review
- architecture review
- correctness review
- integration review
- test adequacy review
- failure analysis
- independent second opinion

可能な場合、implementer自身のself-reviewだけで完了させないでください。

## Luna — primary implementation worker

主な責務:

- code implementation
- mechanical refactoring
- test implementation
- repository exploration
- bounded investigation
- repetitive changes
- deterministic tool execution
- independent implementation units

安全に分離できる実装は可能な限りLunaへ委譲し、現在の高速・低コスト特性を利用してthroughputを拡大してください。

品質よりcostを優先するという意味ではありません。

高難度・高影響判断はTerraまたはSolへ昇格してください。

実行時にsubagent modelを指定・確認できるか確認し、実際に確認できないmodelを使用したと虚偽に報告してはいけません。

明示model routingが利用不能でも、coordinator / reviewer / implementerという論理的役割は維持してください。
