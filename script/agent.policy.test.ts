#!/usr/bin/env bun
/**
 * Tests for script/agent/policy.ts (dotfiles#95, Epic#86 US2 / T009).
 *
 * REAL vs MOCK separation:
 * - "real repository": resolves the actual dotfiles checkout. Asserts only
 *   facts determined by committed state (no network, no fixtures).
 * - "fixture repositories": mock policy stacks built in temp dirs to exercise
 *   project-init absence, stale/modified skill installs, floating lock
 *   sources, landing-policy conflicts and overrides.
 *
 * Run: bun test script/agent.policy.test.ts
 */

import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePolicy, type PolicyResolution } from "./agent/policy";

const REPO = join(import.meta.dir, "..");
const BASELINE_SHA = "57fb4a2e5abe6f52e4fd9cb2cb88234496e47d4b";
/** skills@1.7.0 folder hash of a skill directory holding SKILL.md
 * ("exact locked body") and references/note.md ("note text"). Precomputed
 * from the documented algorithm, independent of the resolver implementation. */
const FRESH_SKILL_FOLDER_HASH =
  "0ac5560b3a1b6da13cebb57ca706b8bdb1e2b52ed7a34b21304c09b188d803a6";

function factKinds(resolution: PolicyResolution): Set<string> {
  return new Set(resolution.facts.map((fact) => fact.kind));
}

function writeFixture(
  root: string,
  rel: string,
  content: string,
): void {
  const path = join(root, ...rel.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function lockJson(entries: Record<string, Record<string, string>>): string {
  return JSON.stringify({ version: 1, skills: entries }, null, 2);
}

describe("policy resolver: real repository (no mocks)", () => {
  const resolution = resolvePolicy(REPO);

  test("binds resolution to the local git HEAD without network", () => {
    const expected = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: REPO,
      stdout: "pipe",
    })
      .stdout.toString()
      .trim();
    expect(resolution.headSha).toBe(expected);
    expect(resolution.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("resolves constitution and operating model with content hashes", () => {
    const byPath = new Map(resolution.sources.map((s) => [s.path, s]));
    const constitution = byPath.get("constitution/CONSTITUTION.md");
    const profile = byPath.get(
      "organization/profiles/release-driven-solo.md",
    );
    expect(constitution?.present).toBe(true);
    expect(profile?.present).toBe(true);
    expect(constitution?.layer).toBe("constitution");
    expect(profile?.layer).toBe("operating-model");
    for (const src of [constitution, profile]) {
      expect(src?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("reports the pinned release-0-3-0 baseline from the operating model", () => {
    expect(resolution.baseline).toEqual({
      ref: "release-0-3-0",
      sha: BASELINE_SHA,
    });
    expect(factKinds(resolution)).toContain("baseline-pinned");
  });

  test("reports the committed skills lock as floating (unpinned) source", () => {
    expect(resolution.lockPresent).toBe(true);
    expect(resolution.lockUnpinned).toBe(true);
    expect(resolution.skills.length).toBeGreaterThan(0);
    for (const skill of resolution.skills) {
      expect(skill.source).toBe("rebuildup/project-init");
    }
    expect(factKinds(resolution)).toContain("lock-unpinned-source");
    expect(factKinds(resolution)).toContain("baseline-divergence-risk");
    expect(factKinds(resolution)).not.toContain("project-init-absent");
  });

  test("surfaces unresolved consequential decisions and limitations", () => {
    expect(resolution.unresolvedDecisions.length).toBeGreaterThan(0);
    expect(
      resolution.unresolvedDecisions.some((decision) =>
        decision.includes(BASELINE_SHA.slice(0, 12)),
      ),
    ).toBe(true);
    expect(resolution.knownLimitations.length).toBeGreaterThan(0);
  });

  test("does not report a landing-policy conflict for the current profile", () => {
    expect(factKinds(resolution)).not.toContain("authority-conflict");
  });
});

describe("policy resolver: fixture repositories (mocks)", () => {
  test("reports project-init-absent for a repository without policy material", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-absent-"));
    try {
      const resolution = resolvePolicy(root);
      expect(resolution.headSha).toBeNull();
      expect(resolution.baseline).toBeNull();
      expect(resolution.lockPresent).toBe(false);
      expect(factKinds(resolution)).toContain("project-init-absent");
      expect(factKinds(resolution)).not.toContain("baseline-divergence-risk");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a stale (hash-mismatched) installed skill as a conflict", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-stale-"));
    try {
      // Lock hash is the skills@1.7.0 folder hash of a different skill body
      // (precomputed independently of the resolver implementation).
      writeFixture(
        root,
        "skills-lock.json",
        lockJson({
          "some-skill": {
            source: "rebuildup/project-init",
            sourceType: "github",
            skillPath: "skills/some-skill/SKILL.md",
            computedHash: FRESH_SKILL_FOLDER_HASH,
          },
        }),
      );
      writeFixture(
        root,
        ".agents/skills/some-skill/SKILL.md",
        "modified skill body",
      );
      const resolution = resolvePolicy(root);
      expect(resolution.skills[0]?.status).toBe("hash-mismatch");
      const mismatch = resolution.facts.find(
        (fact) => fact.kind === "skill-hash-mismatch",
      );
      expect(mismatch?.severity).toBe("conflict");
      expect(factKinds(resolution)).not.toContain("project-init-absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports locked-but-uninstalled skills as missing, not conflicting", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-uninstalled-"));
    try {
      writeFixture(
        root,
        "skills-lock.json",
        lockJson({
          "ghost-skill": {
            source: "rebuildup/project-init",
            sourceType: "github",
            skillPath: "skills/ghost-skill/SKILL.md",
            computedHash: "0".repeat(64),
          },
        }),
      );
      const resolution = resolvePolicy(root);
      expect(resolution.skills[0]?.status).toBe("not-installed");
      const missing = resolution.facts.find(
        (fact) => fact.kind === "skill-not-installed",
      );
      expect(missing?.severity).toBe("warning");
      expect(factKinds(resolution)).not.toContain("skill-hash-mismatch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts an installed skill whose folder hash matches the lock", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-ok-"));
    try {
      // FRESH_SKILL_FOLDER_HASH is the skills@1.7.0 folder hash of a skill
      // directory containing SKILL.md ("exact locked body") and
      // references/note.md ("note text"), precomputed independently of the
      // resolver implementation.
      writeFixture(
        root,
        "skills-lock.json",
        lockJson({
          "fresh-skill": {
            source: "rebuildup/project-init",
            sourceType: "github",
            skillPath: "skills/fresh-skill/SKILL.md",
            computedHash: FRESH_SKILL_FOLDER_HASH,
          },
        }),
      );
      writeFixture(root, ".claude/skills/fresh-skill/SKILL.md", "exact locked body");
      writeFixture(root, ".claude/skills/fresh-skill/references/note.md", "note text");
      const resolution = resolvePolicy(root);
      expect(resolution.skills[0]?.status).toBe("ok");
      expect(factKinds(resolution)).not.toContain("skill-hash-mismatch");
      expect(factKinds(resolution)).not.toContain("skill-not-installed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flags a landing method contradicting the declared merge settings", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-conflict-"));
    try {
      writeFixture(
        root,
        "organization/profiles/release-driven-solo.md",
        [
          "- PR landing method: squash merge only",
          "- repository merge settings: `allow_merge_commit=true` / `allow_squash_merge=false` / `allow_rebase_merge=false`",
        ].join("\n"),
      );
      const resolution = resolvePolicy(root);
      const conflict = resolution.facts.find(
        (fact) => fact.kind === "authority-conflict",
      );
      expect(conflict?.severity).toBe("conflict");
      expect(conflict?.detail).toContain("allow_squash_merge=false");
      expect(
        resolution.unresolvedDecisions.some((decision) =>
          decision.includes("landing-policy conflict"),
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports no conflict when landing method and merge settings agree", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-consistent-"));
    try {
      writeFixture(
        root,
        "organization/profiles/release-driven-solo.md",
        [
          "- PR landing method: merge commit only",
          "- repository merge settings: `allow_merge_commit=true` / `allow_squash_merge=false` / `allow_rebase_merge=false`",
        ].join("\n"),
      );
      const resolution = resolvePolicy(root);
      expect(factKinds(resolution)).not.toContain("authority-conflict");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("distinguishes missing merge settings from conflicting ones", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-missing-"));
    try {
      writeFixture(
        root,
        "organization/profiles/release-driven-solo.md",
        "- PR landing method: merge commit only\n",
      );
      const resolution = resolvePolicy(root);
      const absent = resolution.facts.find(
        (fact) => fact.kind === "landing-settings-absent",
      );
      expect(absent?.severity).toBe("warning");
      expect(factKinds(resolution)).not.toContain("authority-conflict");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("derives baseline divergence risk from a pinned baseline plus floating lock", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-baseline-"));
    try {
      writeFixture(
        root,
        "organization/profiles/release-driven-solo.md",
        `## Upstream source\n\nrebuildup/project-init@release-0-3-0 (\`${BASELINE_SHA}\`) を基準にする。\n`,
      );
      writeFixture(
        root,
        "skills-lock.json",
        lockJson({
          "upstream-skill": {
            source: "rebuildup/project-init",
            sourceType: "github",
            skillPath: "skills/upstream-skill/SKILL.md",
            computedHash: "0".repeat(64),
          },
        }),
      );
      const resolution = resolvePolicy(root);
      expect(resolution.baseline?.ref).toBe("release-0-3-0");
      expect(factKinds(resolution)).toContain("baseline-divergence-risk");
      expect(
        resolution.unresolvedDecisions.some((decision) =>
          decision.includes("re-adoption"),
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("treats the lock as unpinned when any entry lacks a revision pin", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-partialpin-"));
    try {
      writeFixture(
        root,
        "skills-lock.json",
        lockJson({
          "pinned-skill": {
            source: "rebuildup/project-init",
            sourceType: "github",
            skillPath: "skills/pinned-skill/SKILL.md",
            computedHash: FRESH_SKILL_FOLDER_HASH,
            rev: "release-0-3-0",
          },
          "floating-skill": {
            source: "rebuildup/project-init",
            sourceType: "github",
            skillPath: "skills/floating-skill/SKILL.md",
            computedHash: FRESH_SKILL_FOLDER_HASH,
          },
        }),
      );
      const resolution = resolvePolicy(root);
      expect(resolution.lockUnpinned).toBe(true);
      expect(factKinds(resolution)).toContain("lock-unpinned-source");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("includes non-ADR-numbered markdown files from docs/adr as practice sources", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-adr-"));
    try {
      writeFixture(root, "docs/adr/ADR-0001.md", "- Status: Accepted\n");
      writeFixture(root, "docs/adr/decision-notes.md", "- Status: Proposed\n");
      const resolution = resolvePolicy(root);
      const adr = resolution.sources.filter((src) =>
        src.path.startsWith("docs/adr/"),
      );
      expect(adr.map((src) => src.path)).toEqual([
        "docs/adr/ADR-0001.md",
        "docs/adr/decision-notes.md",
      ]);
      const note = resolution.facts.find(
        (fact) =>
          fact.kind === "adr-status" &&
          fact.detail.includes("decision-notes.md"),
      );
      expect(note?.severity).toBe("info");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports project-specific overrides and absent quality profile as facts", () => {
    const root = mkdtempSync(join(tmpdir(), "policy-override-"));
    try {
      writeFixture(
        root,
        "organization/profiles/release-driven-solo.md",
        [
          "## Upstream source",
          "",
          `rebuildup/project-init@release-0-3-0 (\`${BASELINE_SHA}\`) を基準にする。`,
          "",
          "## Project-specific reconciliation",
          "",
          "- symlink idempotence is a project-local invariant",
        ].join("\n"),
      );
      const resolution = resolvePolicy(root);
      expect(factKinds(resolution)).toContain("project-specific-override");
      expect(factKinds(resolution)).toContain("quality-profile-absent");
      expect(
        resolution.unresolvedDecisions.some((decision) =>
          decision.includes("quality profile"),
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
