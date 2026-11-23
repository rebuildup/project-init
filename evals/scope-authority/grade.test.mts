import assert from "node:assert/strict";
import test from "node:test";
import { evaluateScopeAuthority, type OwnerDecision } from "./grade.mts";

const AULYMO_OCT30_OWNER_DECISION: OwnerDecision = {
  revision: 2,
  decidedAt: "2026-10-30",
  actor: "rebuildup",
  provenance: "human-owner-direct",
  targetRelease: "release-4-0-0",
  allowedIntent: "land-to-release",
  evidenceUrl: "https://github.com/rebuildup/Aulymo_v04/issues/59",
  items: ["#145", "#146", "#147", "#148", "#149"],
};

test("negative: Aulymo #108/#59/#102 vs PR #137/#136 single-PR unapproved landing into 4.0.0 is blocked", () => {
  const res = evaluateScopeAuthority({
    id: "aulymo-pr-137-drift",
    item: "#109",
    changeClass: "move-feature-to-release",
    requestedTargetRelease: "release-4-0-0",
    canonicalTargetRelease: "release-4-1-0",
    requestedIntent: "land-to-release",
    sourceKind: "single-pr-or-doc",
    evaluatedDecisionRevision: 1,
  });
  assert.equal(res.status, "BLOCK");
  assert.equal(res.findings[0]?.code, "UNAPPROVED_SCOPE_DRIFT");
});

test("positive: design research / 4.1.0 Draft PR passes without blocking discovery", () => {
  const res = evaluateScopeAuthority({
    id: "aulymo-4-1-0-draft",
    item: "#109",
    changeClass: "design-research-draft",
    requestedTargetRelease: "release-4-1-0",
    canonicalTargetRelease: "release-4-1-0",
    requestedIntent: "preserve-progress",
    sourceKind: "single-pr-or-doc",
    evaluatedDecisionRevision: 1,
  });
  assert.equal(res.status, "PASS");
});

test("negative stale-snapshot trap: ignoring Aulymo #59 follow-up owner decision on #145-#149 fails freshness check", () => {
  const res = evaluateScopeAuthority({
    id: "aulymo-stale-snapshot",
    item: "#145",
    changeClass: "move-feature-to-release",
    requestedTargetRelease: "release-4-0-0",
    canonicalTargetRelease: "release-4-1-0",
    requestedIntent: "land-to-release",
    sourceKind: "reconciled-canonical",
    evaluatedDecisionRevision: 1,
    latestOwnerDecision: AULYMO_OCT30_OWNER_DECISION,
  });
  assert.equal(res.status, "BLOCK");
  assert.ok(res.findings.some((f) => f.code === "STALE_OWNER_DECISION_SNAPSHOT"));
});

test("positive: reconciled owner decision rev 2 approving #145 in 4.0.0 passes", () => {
  const res = evaluateScopeAuthority({
    id: "aulymo-reconciled-owner-decision",
    item: "#145",
    changeClass: "move-feature-to-release",
    requestedTargetRelease: "release-4-0-0",
    canonicalTargetRelease: "release-4-1-0",
    requestedIntent: "land-to-release",
    sourceKind: "reconciled-canonical",
    evaluatedDecisionRevision: 2,
    latestOwnerDecision: AULYMO_OCT30_OWNER_DECISION,
  });
  assert.equal(res.status, "PASS");
});

test("negative: Aulymo #59 preserve-progress note for #112 cannot auto-promote to 4.0.0 release blocker", () => {
  const res = evaluateScopeAuthority({
    id: "aulymo-progress-to-blocker",
    item: "#112",
    changeClass: "modify-critical-path",
    requestedTargetRelease: "release-4-0-0",
    canonicalTargetRelease: "release-4-0-0",
    requestedIntent: "release-blocker",
    sourceKind: "single-pr-or-doc",
    evaluatedDecisionRevision: 2,
    latestOwnerDecision: {
      revision: 2,
      decidedAt: "2026-10-30",
      actor: "rebuildup",
      provenance: "human-owner-direct",
      targetRelease: "release-4-0-0",
      allowedIntent: "preserve-progress",
      evidenceUrl: "https://github.com/rebuildup/Aulymo_v04/issues/59",
      items: ["#108", "#109", "#112"],
    },
  });
  assert.equal(res.status, "BLOCK");
  assert.equal(res.findings[0]?.code, "PROGRESS_CONFLATED_WITH_BLOCKER");
});

test("negative: my-web-2026 #720 agent self-attested owner approval is rejected", () => {
  const res = evaluateScopeAuthority({
    id: "my-web-self-attested-approval",
    item: "#720",
    changeClass: "remove-human-gate",
    requestedTargetRelease: "release-0-8-0",
    canonicalTargetRelease: "release-0-8-0",
    requestedIntent: "land-to-release",
    sourceKind: "single-pr-or-doc",
    evaluatedDecisionRevision: 1,
    latestOwnerDecision: {
      revision: 1,
      decidedAt: "2026-10-31",
      actor: "agent-writing-as-rebuildup",
      provenance: "agent-self-attested",
      targetRelease: "release-0-8-0",
      allowedIntent: "land-to-release",
      evidenceUrl: "https://github.com/rebuildup/my-web-2026/issues/720",
      items: ["#720"],
    },
  });
  assert.equal(res.status, "BLOCK");
  assert.equal(res.findings[0]?.code, "SELF_ATTESTED_OWNER_APPROVAL");
});

test("negative: xyt-media #191 claiming release complete while release->main PR is open is blocked", () => {
  const res = evaluateScopeAuthority({
    id: "xyt-release-branch-vs-main",
    item: "release-0-4-0",
    changeClass: "claim-release-complete",
    requestedTargetRelease: "release-0-4-0",
    canonicalTargetRelease: "release-0-4-0",
    requestedIntent: "land-to-release",
    sourceKind: "single-pr-or-doc",
    evaluatedDecisionRevision: 1,
    releasePrToMainMerged: false,
    releaseBranchCommitsAhead: 633,
  });
  assert.equal(res.status, "BLOCK");
  assert.equal(res.findings[0]?.code, "RELEASE_BRANCH_CONFLATED_WITH_MAIN");
});
