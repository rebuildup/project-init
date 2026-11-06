import { describe, expect, test } from "bun:test";
import {
  preflight,
  reviewRequirement,
  type AdmissionRequest,
  type HardLimits,
} from "./agent/preflight.ts";

const LIMITS: HardLimits = {
  maxWorkers: 4,
  maxCostUsd: 5,
  maxDurationMs: 600000,
  maxNetworkCalls: 100,
  maxExternalWrites: 10,
  allowNativeDelegation: false,
  allowSecretAccess: false,
  requireTrustedRepo: true,
};

const AUTHORITIES = ["agent-1"];

function baseRequest(): AdmissionRequest {
  return {
    task: { id: "T010", taskClass: "mechanical", durability: "observational" },
    principal: "agent-1",
    knownAuthorities: AUTHORITIES,
    workers: 1,
    estimatedCostUsd: 0,
    estimatedDurationMs: 60000,
    networkCalls: 0,
    externalWrites: 0,
    nativeDelegation: false,
    sandboxed: false,
    secretsGranted: false,
    repoTrusted: true,
  };
}

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

  test("rejects NaN cost (fail closed on unknown budget)", () => {
    const req = { ...baseRequest(), estimatedCostUsd: Number.NaN };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("budget-cost:"))).toBe(true);
  });

  test("rejects untrusted repo with external writes", () => {
    const req = { ...baseRequest(), repoTrusted: false, externalWrites: 1 };
    const d = preflight(req, LIMITS, AUTHORITIES);
    expect(d.admitted).toBe(false);
    expect(d.reasons.some((r) => r.startsWith("sandbox:"))).toBe(true);
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

  test("review matrix matches task class", () => {
    expect(reviewRequirement("mechanical").coldReview).toBe(false);
    expect(reviewRequirement("localized").coldReview).toBe(false);
    expect(reviewRequirement("cross-boundary").coldReview).toBe(true);
    expect(reviewRequirement("judgment-heavy").coldReview).toBe(true);
  });
});
