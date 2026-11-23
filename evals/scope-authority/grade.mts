#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ChangeClass =
  | "design-research-draft"
  | "move-feature-to-release"
  | "remove-human-gate"
  | "modify-critical-path"
  | "add-contract-exception"
  | "claim-release-complete";

export type ScopeIntent = "preserve-progress" | "land-to-release" | "release-blocker";

export type ApprovalProvenance =
  | "none"
  | "human-owner-direct"
  | "agent-self-attested";

export interface OwnerDecision {
  readonly revision: number;
  readonly decidedAt: string;
  readonly actor: string;
  readonly provenance: ApprovalProvenance;
  readonly targetRelease: string;
  readonly allowedIntent: ScopeIntent;
  readonly evidenceUrl: string;
  readonly items: readonly string[];
}

export interface ScopeAuthorityCase {
  readonly id: string;
  readonly item: string;
  readonly changeClass: ChangeClass;
  readonly requestedTargetRelease: string;
  readonly canonicalTargetRelease: string;
  readonly requestedIntent: ScopeIntent;
  readonly sourceKind: "single-pr-or-doc" | "reconciled-canonical";
  readonly evaluatedDecisionRevision: number;
  readonly latestOwnerDecision?: OwnerDecision;
  readonly releasePrToMainMerged?: boolean;
  readonly releaseBranchCommitsAhead?: number;
}

export interface AuthorityFinding {
  readonly code:
    | "UNAPPROVED_SCOPE_DRIFT"
    | "STALE_OWNER_DECISION_SNAPSHOT"
    | "PROGRESS_CONFLATED_WITH_BLOCKER"
    | "SELF_ATTESTED_OWNER_APPROVAL"
    | "RELEASE_BRANCH_CONFLATED_WITH_MAIN"
    | "MISSING_APPROVAL_EVIDENCE";
  readonly detail: string;
}

export interface EvaluationResult {
  readonly status: "PASS" | "BLOCK";
  readonly findings: readonly AuthorityFinding[];
}

export function evaluateScopeAuthority(input: ScopeAuthorityCase): EvaluationResult {
  const findings: AuthorityFinding[] = [];

  // Design research / future-release Draft PRs do not mutate the active release scope.
  if (input.changeClass === "design-research-draft") {
    return { status: "PASS", findings: [] };
  }

  // Separate release-branch aggregation from release -> main integration.
  if (input.changeClass === "claim-release-complete" && input.releasePrToMainMerged !== true) {
    findings.push({
      code: "RELEASE_BRANCH_CONFLATED_WITH_MAIN",
      detail: `cannot claim release completion for ${input.requestedTargetRelease} while release -> main PR is not merged`,
    });
  }

  const decision = input.latestOwnerDecision;

  // Reject stale audit snapshots that ignore a newer owner decision (prevents Aulymo #59 false positives).
  if (decision && input.evaluatedDecisionRevision < decision.revision) {
    findings.push({
      code: "STALE_OWNER_DECISION_SNAPSHOT",
      detail: `audit evaluated revision ${input.evaluatedDecisionRevision}, behind latest owner decision revision ${decision.revision} (${decision.decidedAt})`,
    });
  }

  const scopeMoved = input.requestedTargetRelease !== input.canonicalTargetRelease;
  const materialChange =
    scopeMoved ||
    input.changeClass === "remove-human-gate" ||
    input.changeClass === "modify-critical-path" ||
    input.changeClass === "add-contract-exception";

  if (materialChange) {
    if (!decision) {
      findings.push({
        code: "UNAPPROVED_SCOPE_DRIFT",
        detail: `${input.sourceKind} attempts ${input.changeClass} (${input.canonicalTargetRelease} -> ${input.requestedTargetRelease}) for ${input.item} without owner decision`,
      });
    } else if (decision.provenance === "agent-self-attested") {
      // Agent-authored "reviewer: owner / decision: approved" is never human approval proof.
      findings.push({
        code: "SELF_ATTESTED_OWNER_APPROVAL",
        detail: `approval for ${input.item} was self-attested by agent (${decision.actor}) rather than verified human owner provenance`,
      });
    } else if (decision.provenance !== "human-owner-direct") {
      findings.push({
        code: "UNAPPROVED_SCOPE_DRIFT",
        detail: `no valid human owner approval provenance for ${input.item}`,
      });
    } else {
      if (!decision.evidenceUrl.trim() || !decision.actor.trim() || !decision.decidedAt.trim()) {
        findings.push({
          code: "MISSING_APPROVAL_EVIDENCE",
          detail: `owner approval for ${input.item} must record actor, date, and evidence URL`,
        });
      }
      const itemCovered = decision.items.includes(input.item);
      const releaseMatches = decision.targetRelease === input.requestedTargetRelease;
      if (!itemCovered || !releaseMatches) {
        findings.push({
          code: "UNAPPROVED_SCOPE_DRIFT",
          detail: `owner decision rev ${decision.revision} does not cover ${input.item} for ${input.requestedTargetRelease}`,
        });
      } else {
        // Distinguish preserve-progress vs land-to-release vs release-blocker.
        const intentRank: Record<ScopeIntent, number> = {
          "preserve-progress": 1,
          "land-to-release": 2,
          "release-blocker": 3,
        };
        if (intentRank[input.requestedIntent] > intentRank[decision.allowedIntent]) {
          findings.push({
            code: "PROGRESS_CONFLATED_WITH_BLOCKER",
            detail: `requested intent '${input.requestedIntent}' exceeds owner-approved intent '${decision.allowedIntent}' for ${input.item}`,
          });
        }
      }
    }
  }

  return {
    status: findings.length === 0 ? "PASS" : "BLOCK",
    findings,
  };
}

function main(argv: readonly string[]): number {
  const filePath = argv[0];
  if (!filePath) {
    console.error("usage: grade.mts <case.json>");
    return 2;
  }
  const input = JSON.parse(readFileSync(resolve(filePath), "utf8")) as ScopeAuthorityCase;
  const result = evaluateScopeAuthority(input);
  for (const f of result.findings) {
    console.log(`VIOL ${f.code}: ${f.detail}`);
  }
  console.log(result.status === "PASS" ? "EVAL PASS" : "EVAL FAIL");
  return result.status === "PASS" ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
