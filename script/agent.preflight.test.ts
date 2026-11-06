import { describe, expect, test } from "bun:test";
import {
  preflight,
  reviewRequirement,
  type AdmissionRequest,
  type HardLimits,
} from "./agent/preflight.ts";
import { ContractError } from "./agent/contract.ts";

const LIMITS: HardLimits = {
  maxWorkers: 4,
  maxCostUsd: 5,
  maxDurationMs: 600000,
  maxNetworkCalls: 100,
  maxExternalWrites: 10,
  maxSpawnDepth: 3,
  allowNativeDelegation: false,
  allowSecretAccess: false,
  requireTrustedRepo: true,
};

const AUTHORITIES = ["agent-1"];

function baseRequest(): AdmissionRequest {
  return {
    task: { id: "T010", taskClass: "mechanical", durability: "observational" },
    principal: "agent-1",
    workers: 1,
    estimatedCostUsd: 0,
    estimatedDurationMs: 60000,
    networkCalls: 0,
    externalWrites: 0,
    spawnDepth: 0,
    nativeDelegation: false,
    sandboxed: false,
    secretsGranted: false,
    repoTrusted: true,
    landingClass: "ticket",
    targetBranch: "release-0-4-0",
    dependencyDagPresent: false,
    reviewer: null,
    authorizedByUser: false,
  };
}

// -- admission and core budget ----------------------------------------------

describe("preflight", () => {
  test("admits a minimal in-budget request", () => {
    const d = preflight(baseRequest(), LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  test("rejects an unknown principal", () => {
    const req = { ...baseRequest(), principal: "ghost" };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("authority:"))).toBe(true);
  });

  test("rejects over-budget cost", () => {
    const req = { ...baseRequest(), estimatedCostUsd: 6 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-cost:"))).toBe(true);
  });

  test("rejects over-budget workers", () => {
    const req = { ...baseRequest(), workers: 5 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-workers:"))).toBe(true);
  });

  test("rejects over-budget duration", () => {
    const req = { ...baseRequest(), estimatedDurationMs: 600001 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-duration:"))).toBe(true);
  });

  test("rejects over-budget network calls", () => {
    const req = { ...baseRequest(), networkCalls: 101 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-network:"))).toBe(true);
  });

  test("rejects forbidden native delegation", () => {
    const req = { ...baseRequest(), nativeDelegation: true };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("delegation:"))).toBe(true);
  });

  test("rejects ungranted secret access", () => {
    const req = { ...baseRequest(), secretsGranted: true };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("secrets:"))).toBe(true);
  });

  test("admits granted secret access when policy allows", () => {
    const limits = { ...LIMITS, allowSecretAccess: true };
    const req = { ...baseRequest(), secretsGranted: true };
    const d = preflight(req, limits, AUTHORITIES);
    expect(d.admitted).toBe(true);
  });

  // -- solo fan-out (item 1 / localized fan-out) ------------------------------

  test("mechanical tasks cannot fan out beyond one worker", () => {
    const req = { ...baseRequest(), workers: 2 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-workers:"))).toBe(true);
  });

  test("localized tasks cannot fan out beyond one worker", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T013", taskClass: "localized", durability: "mutable" },
      workers: 3,
    };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-workers:"))).toBe(true);
  });

  // -- spawn depth (item 1) ---------------------------------------------------

  test("rejects spawnDepth above maxSpawnDepth", () => {
    const req = { ...baseRequest(), spawnDepth: 4 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-spawn-depth:"))).toBe(true);
  });

  test("throws on missing spawnDepth", () => {
    const req = baseRequest() as Record<string, unknown>;
    delete req.spawnDepth;
    expect(() => preflight(req as unknown as AdmissionRequest, LIMITS, AUTHORITIES)).toThrow(
      ContractError,
    );
  });

  // -- repo trust (item 2) ----------------------------------------------------

  test("untrusted repo rejected when requireTrustedRepo, even if sandboxed", () => {
    const req = { ...baseRequest(), repoTrusted: false, sandboxed: true };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("repo-trust:"))).toBe(true);
  });

  test("untrusted repo admitted when policy does not require trust and sandboxed", () => {
    const limits = { ...LIMITS, requireTrustedRepo: false };
    const req = { ...baseRequest(), repoTrusted: false, sandboxed: true };
    const d = preflight(req, limits, AUTHORITIES);
    expect(d.admitted).toBe(true);
  });

  // -- unsandboxed network (item 3) --------------------------------------------

  test("unsandboxed network calls rejected", () => {
    const req = { ...baseRequest(), sandboxed: false, networkCalls: 1 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("sandbox:"))).toBe(true);
  });

  test("sandboxed network calls admitted", () => {
    const req = { ...baseRequest(), sandboxed: true, networkCalls: 5 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(true);
  });

  // -- allowlist and identity validation (item 4) ------------------------------

  test("throws on empty knownAuthorities array", () => {
    expect(() => preflight(baseRequest(), LIMITS, [])).toThrow(ContractError);
  });

  test("throws on non-array knownAuthorities", () => {
    expect(() =>
      preflight(baseRequest(), LIMITS, "agent-1" as unknown as readonly string[]),
    ).toThrow(ContractError);
  });

  test("throws on whitespace-only entry in knownAuthorities", () => {
    expect(() => preflight(baseRequest(), LIMITS, ["agent-1", "   "])).toThrow(ContractError);
  });

  test("throws on empty principal", () => {
    const req = { ...baseRequest(), principal: "" };
    expect(() => preflight(req, LIMITS, AUTHORITIES)).toThrow(ContractError);
  });

  test("throws on whitespace-only principal", () => {
    const req = { ...baseRequest(), principal: "   " };
    expect(() => preflight(req, LIMITS, AUTHORITIES)).toThrow(ContractError);
  });

  test("throws on non-string principal", () => {
    const req = { ...baseRequest(), principal: 42 };
    expect(() => preflight(req as unknown as AdmissionRequest, LIMITS, AUTHORITIES)).toThrow(
      ContractError,
    );
  });

  test("throws on whitespace-only reviewer", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T012", taskClass: "judgment-heavy", durability: "durable" },
      reviewer: "  ",
    };
    expect(() => preflight(req, LIMITS, AUTHORITIES)).toThrow(ContractError);
  });

  test("reviewer vs principal compared case-insensitively after trim", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T012", taskClass: "judgment-heavy", durability: "durable" },
      dependencyDagPresent: true,
      reviewer: " Agent-1 ",
    };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("reviewer:"))).toBe(true);
  });

  // -- target branch validation (item 5) ----------------------------------------

  test("throws on malformed targetBranch values", () => {
    for (const bad of ["MAIN", "main ", "refs/heads/main", "origin/main", "release-0-4", "x"]) {
      const req = { ...baseRequest(), targetBranch: bad };
      expect(() => preflight(req, LIMITS, AUTHORITIES)).toThrow(ContractError);
    }
  });

  test("throws on undefined targetBranch", () => {
    const req = baseRequest() as Record<string, unknown>;
    delete req.targetBranch;
    expect(() => preflight(req as unknown as AdmissionRequest, LIMITS, AUTHORITIES)).toThrow(
      ContractError,
    );
  });

  test("admits valid targetBranch forms", () => {
    for (const branch of ["main", "release-0-4-0", "96"]) {
      const req: AdmissionRequest = {
        ...baseRequest(),
        targetBranch: branch,
        landingClass: branch === "main" ? "release" : "ticket",
        authorizedByUser: branch === "main",
      };
      expect(preflight(req, LIMITS, AUTHORITIES).admitted).toBe(true);
    }
  });

  // -- landing class integrity (items 5/6) --------------------------------------

  test("main-bound landing requires release class and explicit user authorization", () => {
    const ticketToMain = { ...baseRequest(), targetBranch: "main" };
    expect(preflight(ticketToMain, LIMITS, AUTHORITIES).admitted).toBe(false);

    const unauthorizedRelease = {
      ...baseRequest(),
      targetBranch: "main",
      landingClass: "release" as const,
    };
    expect(preflight(unauthorizedRelease, LIMITS, AUTHORITIES).admitted).toBe(false);

    const authorized = { ...unauthorizedRelease, authorizedByUser: true };
    expect(preflight(authorized, LIMITS, AUTHORITIES).admitted).toBe(true);
  });

  test("release-class landing on a non-main target requires user authorization", () => {
    const req = {
      ...baseRequest(),
      targetBranch: "release-0-4-0",
      landingClass: "release" as const,
    };
    expect(preflight(req, LIMITS, AUTHORITIES).admitted).toBe(false);

    const authorized = { ...req, authorizedByUser: true };
    expect(preflight(authorized, LIMITS, AUTHORITIES).admitted).toBe(true);
  });

  test("throws on unknown landingClass value", () => {
    const req = { ...baseRequest(), landingClass: "hotfix" };
    expect(() => preflight(req as unknown as AdmissionRequest, LIMITS, AUTHORITIES)).toThrow(
      ContractError,
    );
  });

  // -- boolean type strictness (item 6) ------------------------------------------

  test("throws on truthy impostors for boolean fields", () => {
    for (const key of [
      "authorizedByUser",
      "sandboxed",
      "nativeDelegation",
      "dependencyDagPresent",
      "secretsGranted",
      "repoTrusted",
    ] as const) {
      const asYes = { ...baseRequest(), [key]: "yes" };
      expect(() => preflight(asYes as unknown as AdmissionRequest, LIMITS, AUTHORITIES)).toThrow(
        ContractError,
      );
      const asUndefined = { ...baseRequest(), [key]: undefined };
      expect(() =>
        preflight(asUndefined as unknown as AdmissionRequest, LIMITS, AUTHORITIES),
      ).toThrow(ContractError);
    }
  });

  // -- limits validation (items 7/8) ----------------------------------------------

  test("throws on null limits", () => {
    expect(() => preflight(baseRequest(), null, AUTHORITIES)).toThrow(ContractError);
  });

  test("throws on non-object limits", () => {
    expect(() => preflight(baseRequest(), 42, AUTHORITIES)).toThrow(ContractError);
  });

  test("throws on negative limit values", () => {
    const limits = { ...LIMITS, maxWorkers: -1 };
    expect(() => preflight(baseRequest(), limits, AUTHORITIES)).toThrow(ContractError);
  });

  test("throws on non-integer count/duration limits", () => {
    const limits = { ...LIMITS, maxDurationMs: 1.5 };
    expect(() => preflight(baseRequest(), limits, AUTHORITIES)).toThrow(ContractError);
  });

  test("cost is a finite non-negative number: fractional ok, NaN/Infinity/negative throw", () => {
    expect(
      preflight({ ...baseRequest(), estimatedCostUsd: 0.25 }, { ...LIMITS, maxCostUsd: 1.5 }, AUTHORITIES)
        .admitted,
    ).toBe(true);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => preflight({ ...baseRequest(), estimatedCostUsd: bad }, LIMITS, AUTHORITIES)).toThrow(
        ContractError,
      );
      expect(() => preflight(baseRequest(), { ...LIMITS, maxCostUsd: bad }, AUTHORITIES)).toThrow(
        ContractError,
      );
    }
  });

  test("authority allowlist entries are compared after trim", () => {
    expect(preflight(baseRequest(), LIMITS, [" agent-1 "]).admitted).toBe(true);
  });

  test("issue-branch target must be a ticket-class landing", () => {
    const ok = { ...baseRequest(), targetBranch: "96" };
    expect(preflight(ok, LIMITS, AUTHORITIES).admitted).toBe(true);
    const bad = { ...ok, landingClass: "release" as const, authorizedByUser: true };
    const d = preflight(bad, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("landing:"))).toBe(true);
  });

  test("throws on non-boolean limit values", () => {
    const limits = { ...LIMITS, requireTrustedRepo: "yes" };
    expect(() => preflight(baseRequest(), limits as unknown as HardLimits, AUTHORITIES)).toThrow(
      ContractError,
    );
  });

  test("throws on zero or negative workers", () => {
    for (const workers of [0, -1]) {
      const req = { ...baseRequest(), workers };
      expect(() => preflight(req, LIMITS, AUTHORITIES)).toThrow(ContractError);
    }
  });

  test("throws on empty task.id", () => {
    const req = { ...baseRequest(), task: { ...baseRequest().task, id: "" } };
    expect(() => preflight(req, LIMITS, AUTHORITIES)).toThrow(ContractError);
  });

  // -- malformed request (item 7) --------------------------------------------------

  test("throws on null request", () => {
    expect(() => preflight(null, LIMITS, AUTHORITIES)).toThrow(ContractError);
  });

  test("throws on unknown taskClass", () => {
    const req = {
      ...baseRequest(),
      task: { id: "T010", taskClass: "vibes", durability: "mutable" },
    };
    expect(() => preflight(req as unknown as AdmissionRequest, LIMITS, AUTHORITIES)).toThrow(
      ContractError,
    );
  });

  // -- cross-boundary preconditions --------------------------------------------------

  test("cross-boundary work requires a DAG node and an independent reviewer", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T011", taskClass: "cross-boundary", durability: "durable" },
      dependencyDagPresent: true,
      reviewer: "cold-reviewer-1",
    };
    expect(preflight(req, LIMITS, AUTHORITIES).admitted).toBe(true);

    const noDag = { ...req, dependencyDagPresent: false };
    expect(preflight(noDag, LIMITS, AUTHORITIES).admitted).toBe(false);

    const selfReviewed = { ...req, reviewer: "agent-1" };
    expect(preflight(selfReviewed, LIMITS, AUTHORITIES).admitted).toBe(false);
  });

  test("judgment-heavy work requires a named reviewer distinct from the author", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T012", taskClass: "judgment-heavy", durability: "durable" },
      dependencyDagPresent: true,
      reviewer: "cold-reviewer-1",
    };
    expect(preflight(req, LIMITS, AUTHORITIES).admitted).toBe(true);

    const selfReviewed = { ...req, reviewer: "agent-1" };
    expect(preflight(selfReviewed, LIMITS, AUTHORITIES).admitted).toBe(false);
  });

  // -- review requirement matrix ----------------------------------------------

  test("review matrix matches task class", () => {
    expect(reviewRequirement("mechanical").coldReview).toBe(false);
    expect(reviewRequirement("localized").coldReview).toBe(false);
    expect(reviewRequirement("cross-boundary").coldReview).toBe(true);
    expect(reviewRequirement("cross-boundary").dagCoordination).toBe(true);
    expect(reviewRequirement("judgment-heavy").coldReview).toBe(true);
    expect(reviewRequirement("judgment-heavy").dagCoordination).toBe(false);
  });
});
