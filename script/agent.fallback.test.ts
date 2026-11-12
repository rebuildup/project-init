#!/usr/bin/env bun
/**
 * Tests for opt-in continuity profile (dotfiles#136, T020).
 */

import { describe, it, expect } from "bun:test";
import {
  parseFallbackProfile,
  listFallbackProfiles,
  resolveFallbackProfile,
  renderFallbackResolution,
  type FallbackProfile,
  type FallbackCandidate,
  type CatalogLike,
} from "./agent/fallback.ts";
import { ContractError } from "./agent/contract.ts";
import { attest, type Attested, type Evidence, type VerificationStatus, type Provenance, type EvidenceSource } from "./agent/contract.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_TOML = {
  fallback_profile: {
    "test-profile": {
      id: "test-profile",
      version: 1,
      description: "Test fallback for omp.mistral",
      primary_route: "omp.mistral",
      authorized_at: "2026-11-12T00:00:00Z",
      authorized_by: "test-user",
      expires_at: "2026-12-31T23:59:59Z",
      revoked: false,
      global_max_spend: 100,
      candidates: [
        {
          route: "omp.openrouter",
          model: "z-ai/glm-5.3-flash",
          billing: "metered",
          credential: "infisical",
          max_spend: 50,
          scope: "local-writes",
          note: "Primary paid fallback",
        },
        {
          route: "omp.openrouter-free",
          model: "nvidia/nemotron-3-ultra-550b-a55b:free",
          billing: "free",
          credential: "infisical",
          max_spend: 0,
          scope: "read-only",
          note: "Free tier fallback",
        },
      ],
    },
    "expired-profile": {
      id: "expired-profile",
      version: 1,
      description: "Expired profile",
      primary_route: "omp.deepseek",
      authorized_at: "2026-11-12T00:00:00Z",
      authorized_by: "test-user",
      expires_at: "2026-11-11T23:59:59Z", // yesterday
      revoked: false,
      candidates: [
        {
          route: "omp.openrouter",
          model: "z-ai/glm-5.3-flash",
          billing: "metered",
          credential: "infisical",
          scope: "full",
        },
      ],
    },
    "revoked-profile": {
      id: "revoked-profile",
      version: 1,
      description: "Revoked profile",
      primary_route: "omp.minimax",
      authorized_at: "2026-11-12T00:00:00Z",
      authorized_by: "test-user",
      revoked: true,
      candidates: [
        {
          route: "omp.openrouter",
          model: "z-ai/glm-5.3-flash",
          billing: "metered",
          credential: "infisical",
          scope: "full",
        },
      ],
    },
  },
};

const MOCK_CATALOG: CatalogLike = {
  routes: {
    "omp.mistral": { provider: "mistral", models: ["zai-glm-5-3-flash"], require_model: true },
    "omp.openrouter": { provider: "openrouter", models: ["z-ai/glm-5.3-flash"], require_model: false },
    "omp.openrouter-free": { provider: "openrouter", models: ["nvidia/nemotron-3-ultra-550b-a55b:free"], require_model: true },
    "omp.deepseek": { provider: "deepseek", models: ["deepseek-flash", "deepseek-v4-pro"] },
    "omp.minimax": { provider: "minimax", models: ["MiniMax-M3.1-Flash"] },
    "omp.opencode-go": { provider: "opencode-go", models: ["mimo-v2.6-flash", "deepseek-v4.1-flash"], require_infisical: true },
  },
  providers: {
    mistral: { models: ["zai-glm-5-3-flash", "deepseek-v4-1-flash-1017"], require_infisical: true },
    openrouter: { models: ["z-ai/glm-5.3-flash", "nvidia/nemotron-3-ultra-550b-a55b:free"] },
    deepseek: { models: ["deepseek-flash", "deepseek-v4-pro"] },
    minimax: { models: ["MiniMax-M3.1-Flash", "MiniMax-M3"] },
    "opencode-go": { models: ["mimo-v2.6-flash", "deepseek-v4.1-flash"], require_infisical: true },
  },
  harnesses: {
    omp: { adapter: "omp" },
  },
};

function makeAttestation(
  status: VerificationStatus,
  provenance: Provenance,
  source: EvidenceSource = "live-e2e"
): Attested<{ status: VerificationStatus; provenance: Provenance; evidence: Evidence }> {
  const evidence: Evidence = {
    at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    source,
    sha: "a".repeat(40),
  };
  return attest({
    value: { status, provenance, evidence },
    status: "verified-live",
    provenance: "measured",
    evidence,
  });
}

function makeStaleAttestation(
  status: VerificationStatus,
  provenance: Provenance
): Attested<{ status: VerificationStatus; provenance: Provenance; evidence: Evidence }> {
  const evidence: Evidence = {
    at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago (stale)
    source: "live-e2e",
    sha: "b".repeat(40),
  };
  return attest({
    value: { status, provenance, evidence },
    status: "verified-live",
    provenance: "measured",
    evidence,
  });
}

const MOCK_ATTESTATIONS = new Map<string, Attested<{ status: VerificationStatus; provenance: Provenance; evidence: Evidence }>>([
  ["omp.openrouter#z-ai/glm-5.3-flash", makeAttestation("verified-live", "measured")],
  ["omp.openrouter-free#nvidia/nemotron-3-ultra-550b-a55b:free", makeAttestation("verified-live", "measured")],
  ["omp.deepseek#deepseek-flash", makeAttestation("restricted", "measured")], // 402 restricted
  ["omp.minimax#MiniMax-M3.1-Flash", makeAttestation("unknown", "estimated")], // unknown
  ["omp.opencode-go#mimo-v2.6-flash", makeStaleAttestation("verified-live", "measured")], // stale
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseFallbackProfile", () => {
  it("parses a valid profile", () => {
    const profile = parseFallbackProfile(MOCK_TOML, "test-profile");
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe("test-profile");
    expect(profile!.version).toBe(1);
    expect(profile!.primaryRoute).toBe("omp.mistral");
    expect(profile!.candidates).toHaveLength(2);
    expect(profile!.candidates[0].route).toBe("omp.openrouter");
    expect(profile!.candidates[0].model).toBe("z-ai/glm-5.3-flash");
    expect(profile!.candidates[0].billing).toBe("metered");
    expect(profile!.candidates[0].credential).toBe("infisical");
    expect(profile!.candidates[0].maxSpend).toBe(50);
    expect(profile!.candidates[0].scope).toBe("local-writes");
  });

  it("returns null for non-existent profile", () => {
    const profile = parseFallbackProfile(MOCK_TOML, "non-existent");
    expect(profile).toBeNull();
  });

  it("rejects mismatched id", () => {
    const badToml = {
      fallback_profile: {
        bad: { ...MOCK_TOML.fallback_profile["test-profile"], id: "mismatch" },
      },
    };
    expect(() => parseFallbackProfile(badToml, "bad")).toThrow(ContractError);
  });

  it("rejects missing required fields", () => {
    const badToml = {
      fallback_profile: {
        incomplete: { id: "incomplete", version: 1 }, // missing primary_route, etc.
      },
    };
    expect(() => parseFallbackProfile(badToml, "incomplete")).toThrow(ContractError);
  });

  it("rejects invalid billing boundary", () => {
    const baseProfile = MOCK_TOML.fallback_profile["test-profile"];
    const badToml = {
      fallback_profile: {
        bad: {
          ...baseProfile,
          candidates: [{ ...baseProfile.candidates[0], billing: "invalid" }],
        },
      },
    };
    expect(() => parseFallbackProfile(badToml, "bad")).toThrow(ContractError);
  });

  it("rejects invalid credential source", () => {
    const baseProfile = MOCK_TOML.fallback_profile["test-profile"];
    const badToml = {
      fallback_profile: {
        bad: {
          ...baseProfile,
          candidates: [{ ...baseProfile.candidates[0], credential: "invalid" }],
        },
      },
    };
    expect(() => parseFallbackProfile(badToml, "bad")).toThrow(ContractError);
  });

  it("rejects invalid scope", () => {
    const baseProfile = MOCK_TOML.fallback_profile["test-profile"];
    const badToml = {
      fallback_profile: {
        bad: {
          ...baseProfile,
          candidates: [{ ...baseProfile.candidates[0], scope: "invalid" }],
        },
      },
    };
    expect(() => parseFallbackProfile(badToml, "bad")).toThrow(ContractError);
  });

  it("rejects empty candidates array", () => {
    const baseProfile = MOCK_TOML.fallback_profile["test-profile"];
    const badToml = {
      fallback_profile: {
        bad: { ...baseProfile, candidates: [] },
      },
    };
    expect(() => parseFallbackProfile(badToml, "bad")).toThrow(ContractError);
  });

  it("rejects negative max_spend", () => {
    const baseProfile = MOCK_TOML.fallback_profile["test-profile"];
    const badToml = {
      fallback_profile: {
        bad: {
          ...baseProfile,
          candidates: [{ ...baseProfile.candidates[0], max_spend: -1 }],
        },
      },
    };
    expect(() => parseFallbackProfile(badToml, "bad")).toThrow(ContractError);
  });
});

describe("listFallbackProfiles", () => {
  it("lists all profile IDs", () => {
    const ids = listFallbackProfiles(MOCK_TOML);
    expect(ids).toEqual(["expired-profile", "revoked-profile", "test-profile"]);
  });

  it("returns empty array for no profiles", () => {
    expect(listFallbackProfiles({})).toEqual([]);
  });
});

const BASE_PROFILE = parseFallbackProfile(MOCK_TOML, "test-profile")!;

describe("resolveFallbackProfile", () => {
  it("resolves a valid profile with usable candidates", () => {
    const resolution = resolveFallbackProfile(BASE_PROFILE, MOCK_CATALOG, MOCK_ATTESTATIONS, "mistral:infisical");

    expect(resolution.hasUsable).toBe(true);
    // Both candidates should be usable (different routes, valid attestations)
    expect(resolution.usable.length).toBeGreaterThanOrEqual(1);
    expect(resolution.usable[0].candidate.route).toBe("omp.openrouter");
    // Second candidate may be rejected if it shares quota scope with first (same provider)
    // but since primary is mistral, both openrouter candidates should pass quota check
  });

  it("rejects expired profile", () => {
    const profile = parseFallbackProfile(MOCK_TOML, "expired-profile")!;
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.hasUsable).toBe(false);
    expect(resolution.usable).toHaveLength(0);
    expect(resolution.rejected[0].reason).toBe("expired");
  });

  it("rejects revoked profile", () => {
    const profile = parseFallbackProfile(MOCK_TOML, "revoked-profile")!;
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.hasUsable).toBe(false);
    expect(resolution.rejected[0].reason).toBe("revoked");
  });

  it("rejects candidate with non-existent route", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.nonexistent" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("route-not-configured");
  });

  it("rejects candidate with disallowed model", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], model: "invalid-model" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("model-not-allowed");
  });

  it("rejects candidate with credential mismatch (requires infisical but not authorized)", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.opencode-go", model: "mimo-v2.6-flash", credential: "env-file" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("credential-mismatch");
  });

  it("rejects candidate sharing exhausted quota scope with primary", () => {
    // Add attestation for the mistral candidate
    const attestationsWithMistral = new Map(MOCK_ATTESTATIONS);
    attestationsWithMistral.set("omp.mistral#zai-glm-5-3-flash", makeAttestation("verified-live", "measured"));
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.mistral", model: "zai-glm-5-3-flash" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, attestationsWithMistral, "mistral:infisical");

    expect(resolution.rejected[0].reason).toBe("quota-exhausted-scope");
  });

  it("rejects candidate with restricted attestation (402/403/429)", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.deepseek", model: "deepseek-flash" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("attestation-restricted");
  });

  it("rejects candidate with unknown attestation", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.minimax", model: "MiniMax-M3.1-Flash" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("attestation-unknown");
  });

  it("rejects candidate with stale attestation", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.opencode-go", model: "mimo-v2.6-flash" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("attestation-stale");
  });

  it("rejects candidate sharing exhausted quota scope with primary", () => {
    // Add attestation for the mistral candidate
    const attestationsWithMistral = new Map(MOCK_ATTESTATIONS);
    attestationsWithMistral.set("omp.mistral#zai-glm-5-3-flash", makeAttestation("verified-live", "measured"));
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [{ ...BASE_PROFILE.candidates[0], route: "omp.mistral", model: "zai-glm-5-3-flash" }],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, attestationsWithMistral, "mistral:infisical");

    expect(resolution.rejected[0].reason).toBe("quota-exhausted-scope");
  });

  it("enforces global max spend", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      globalMaxSpend: 30, // less than sum of candidates (50 + 0)
      candidates: [
        { ...BASE_PROFILE.candidates[0], maxSpend: 20 },
        { ...BASE_PROFILE.candidates[1], maxSpend: 20 },
      ],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    // Second candidate should be rejected due to global cap
    expect(resolution.usable).toHaveLength(1);
    expect(resolution.rejected.some((r) => r.reason === "spend-cap-exceeded")).toBe(true);
  });

  it("rejects candidate with expired candidate-level expiration", () => {
    const profile: FallbackProfile = {
      ...BASE_PROFILE,
      candidates: [
        { ...BASE_PROFILE.candidates[0], expiresAt: "2020-01-01T00:00:00Z" }, // long expired
      ],
    };
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);

    expect(resolution.rejected[0].reason).toBe("expired");
  });
});

describe("renderFallbackResolution", () => {
  it("renders a human-readable summary", () => {
    const resolution = resolveFallbackProfile(BASE_PROFILE, MOCK_CATALOG, MOCK_ATTESTATIONS, "mistral:infisical");
    const output = renderFallbackResolution(resolution);

    expect(output).toContain("Fallback Profile: test-profile");
    expect(output).toContain("Primary Route: omp.mistral");
    expect(output).toContain("STATUS: USABLE");
    expect(output).toContain("Usable candidates");
    expect(output).toContain("omp.openrouter");
  });

  it("shows REVOKED status for revoked profile", () => {
    const profile = parseFallbackProfile(MOCK_TOML, "revoked-profile")!;
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);
    const output = renderFallbackResolution(resolution);

    expect(output).toContain("STATUS: REVOKED");
  });

  it("shows EXPIRED status for expired profile", () => {
    const profile = parseFallbackProfile(MOCK_TOML, "expired-profile")!;
    const resolution = resolveFallbackProfile(profile, MOCK_CATALOG, MOCK_ATTESTATIONS, null);
    const output = renderFallbackResolution(resolution);

    expect(output).toContain("STATUS: EXPIRED");
  });
});