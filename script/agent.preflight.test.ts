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

describe("preflight", () => {
  test("admits a minimal in-budget request", () => {
    const d = preflight(baseRequest(), LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  test("rejects an unknown principal", () => {
    const req = { ...baseRequest(), principal: "ghost" };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("authority:"))).toBe(true);
  });

  test("rejects over-budget cost", () => {
    const req = { ...baseRequest(), estimatedCostUsd: 6 };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-cost:"))).toBe(true);
  });

  test("rejects over-budget workers", () => {
    const req = { ...baseRequest(), workers: 5 };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-workers:"))).toBe(true);
  });

  test("rejects over-budget duration", () => {
    const req = { ...baseRequest(), estimatedDurationMs: 600001 };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-duration:"))).toBe(true);
  });

  test("rejects over-budget network calls", () => {
    const req = { ...baseRequest(), networkCalls: 101 };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-network:"))).toBe(true);
  });

  test("rejects NaN cost (fail closed on unknown budget)", () => {
    const req = { ...baseRequest(), estimatedCostUsd: Number.NaN };
    expect(() => preflight(req, LIMITS, ["agent-1"])).toThrow(ContractError);
  });

  test("rejects forbidden native delegation", () => {
    const req = { ...baseRequest(), nativeDelegation: true };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("delegation:"))).toBe(true);
  });

  test("rejects ungranted secret access", () => {
    const req = { ...baseRequest(), secretsGranted: true };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("secrets:"))).toBe(true);
  });

  test("admits granted secret access when policy allows", () => {
    const limits = { ...LIMITS, allowSecretAccess: true };
    const req = { ...baseRequest(), secretsGranted: true };
    const d = preflight(req, limits, ["agent-1"]);
    expect(d.admitted).toBe(true);
  });

  // -- solo fan-out --------------------------------------------------------

  test("mechanical tasks cannot fan out beyond one worker", () => {
    const req = { ...baseRequest(), workers: 2 };
    const d = preflight(req, LIMITS, ["agent-1"]);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-workers:"))).toBe(true);
  });

  // -- invalid task class --------------------------------------------------

  test("throws on unknown taskClass", () => {
    const req = {
      ...baseRequest(),
      task: { id: "T010", taskClass: "vibes", durability: "mutable" },
    };
    expect(() => preflight(req as unknown as AdmissionRequest, LIMITS, ["agent-1"])).toThrow(
      ContractError,
    );
  });

  // -- malformed limits ----------------------------------------------------

  test("throws on non-finite limit values", () => {
    const limits = { ...LIMITS, maxCostUsd: Number.POSITIVE_INFINITY };
    expect(() => preflight(baseRequest(), limits, ["agent-1"])).toThrow(ContractError);
  });

  test("throws on null request", () => {
    expect(() =>
      preflight(null as unknown as AdmissionRequest, LIMITS, ["agent-1"]),
    ).toThrow(ContractError);
  });

  // -- cross-boundary preconditions -----------------------------------------

  test("cross-boundary work requires a DAG node and an independent reviewer", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T011", taskClass: "cross-boundary", durability: "durable" },
      dependencyDagPresent: true,
      reviewer: "cold-reviewer-1",
    };
    expect(preflight(req, LIMITS, ["agent-1"]).admitted).toBe(true);

    const noDag = { ...req, dependencyDagPresent: false };
    expect(preflight(noDag, LIMITS, ["agent-1"]).admitted).toBe(false);

    const selfReviewed = { ...req, reviewer: "agent-1" };
    expect(preflight(selfReviewed, LIMITS, ["agent-1"]).admitted).toBe(false);
  });

  test("judgment-heavy work requires a named reviewer distinct from the author", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      task: { id: "T012", taskClass: "judgment-heavy", durability: "durable" },
      dependencyDagPresent: true,
      reviewer: "cold-reviewer-1",
    };
    expect(preflight(req, LIMITS, ["agent-1"]).admitted).toBe(true);

    const selfReviewed = { ...req, reviewer: "agent-1" };
    expect(preflight(selfReviewed, LIMITS, ["agent-1"]).admitted).toBe(false);
  });

  // -- release-line integrity ------------------------------------------------

  test("main-bound landings require release class and explicit user authorization", () => {
    const req: AdmissionRequest = {
      ...baseRequest(),
      landingClass: "ticket",
      targetBranch: "main",
    };
    expect(preflight(req, LIMITS, ["agent-1"]).admitted).toBe(false);

    const unauthorizedRelease = { ...req, landingClass: "release" as const };
    expect(preflight(unauthorizedRelease, LIMITS, ["agent-1"]).admitted).toBe(false);

    const authorized = {
      ...unauthorizedRelease,
      authorizedByUser: true,
    };
    expect(preflight(authorized, LIMITS, ["agent-1"]).admitted).toBe(true);
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
