#!/usr/bin/env bun
/**
 * project-init policy resolver (dotfiles#95, Epic#86 US2 / T009).
 *
 * Resolves the local policy stack — Constitution > Operating Model >
 * Practice (ADR / agent instructions) > Skill (skills lock + installed
 * skill files) — in application order and reports facts about the
 * target repository: project-init absence, stale/modified skill
 * installs, floating (unpinned) lock sources, baseline divergence and
 * landing-policy conflicts.
 *
 * Network-free by contract: only local repository state is read
 * (files + `git rev-parse HEAD`). Upstream freshness of the floating
 * `rebuildup/project-init` skill source and GitHub Issue/PR state are
 * reported as known limitations, never guessed.
 *
 * This resolver reports facts only. It does not authorize, apply or
 * overwrite policy; reconciliation evidence lives in
 * organization/profiles/release-driven-solo.md and durable decisions
 * in docs/adr/.
 *
 * Usage: bun script/agent/policy.ts [repoRoot] [--json]
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type PolicyLayer =
  | "constitution"
  | "operating-model"
  | "practice"
  | "skill";

export interface PolicySource {
  layer: PolicyLayer;
  /** Repo-relative posix path. */
  path: string;
  present: boolean;
  /** sha256 of the file content when present. */
  sha256: string | null;
}

export interface SkillInstall {
  /** Canonical install layout, e.g. `.agents/skills`. */
  layout: string;
  path: string;
  present: boolean;
  /** null when not installed or the lock records no hash. */
  hashMatchesLock: boolean | null;
}

export interface SkillState {
  name: string;
  source: string | null;
  sourceType: string | null;
  lockHash: string | null;
  installs: SkillInstall[];
  status: "not-installed" | "ok" | "hash-mismatch";
}

export type PolicyFactKind =
  | "project-init-absent"
  | "skills-lock-present"
  | "skills-lock-invalid"
  | "lock-unpinned-source"
  | "skill-not-installed"
  | "skill-hash-mismatch"
  | "baseline-pinned"
  | "baseline-divergence-risk"
  | "authority-conflict"
  | "landing-method-undeclared"
  | "landing-settings-absent"
  | "project-specific-override"
  | "quality-profile-absent"
  | "agents-md-absent"
  | "adr-status";

export interface PolicyFact {
  kind: PolicyFactKind;
  severity: "info" | "warning" | "conflict";
  detail: string;
}

export interface PolicyResolution {
  repoRoot: string;
  /** Local HEAD sha when resolving; null outside a git repository. */
  headSha: string | null;
  /** Policy sources in application order (constitution first). */
  sources: PolicySource[];
  /** Pinned project-init baseline recorded by the operating model. */
  baseline: { ref: string; sha: string } | null;
  lockPresent: boolean;
  /** True when lock entries carry no revision pin (freshness unverifiable offline). */
  lockUnpinned: boolean;
  skills: SkillState[];
  facts: PolicyFact[];
  /** Consequential decisions that still need an authority decision. */
  unresolvedDecisions: string[];
  knownLimitations: string[];
}

const CONSTITUTION_PATH = "constitution/CONSTITUTION.md";
const PROFILE_PATH = "organization/profiles/release-driven-solo.md";
const AGENTS_PATH = "AGENTS.md";
const CLAUDE_PATH = "CLAUDE.md";
const ADR_DIR = "docs/adr";
const LOCK_PATH = "skills-lock.json";
const SKILL_LAYOUTS = [".agents/skills", ".claude/skills"];
const QUALITY_PROFILE_PATHS = [
  "organization/quality-profile.md",
  "docs/quality-profile.md",
];

const BASELINE_RE =
  /rebuildup\/project-init@([A-Za-z0-9._-]+)`?\s*\(`?([0-9a-f]{40})`?\)/;
const LANDING_RE = /PR landing method:\s*([^\n`]+)/;
const MERGE_SETTING_RE =
  /allow_(merge_commit|squash_merge|rebase_merge)=(true|false)/g;
const LANDING_METHOD_KEYS: Array<[RegExp, string]> = [
  [/merge commit/i, "merge"],
  [/squash/i, "squash"],
  [/rebase/i, "rebase"],
];
const LOCK_PIN_KEYS = ["rev", "revision", "commit", "sha", "ref", "tag"];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readIfPresent(
  repoRoot: string,
  rel: string,
): { present: boolean; content: string | null } {
  const path = join(repoRoot, ...rel.split("/"));
  if (!existsSync(path)) return { present: false, content: null };
  return { present: true, content: readFileSync(path, "utf8") };
}

function headSha(repoRoot: string): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const sha = result.stdout.toString().trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function source(
  repoRoot: string,
  layer: PolicyLayer,
  rel: string,
): PolicySource {
  const read = readIfPresent(repoRoot, rel);
  return {
    layer,
    path: rel,
    present: read.present,
    sha256: read.present ? sha256(read.content as string) : null,
  };
}

function parseBaseline(profile: string): { ref: string; sha: string } | null {
  const match = BASELINE_RE.exec(profile);
  if (!match) return null;
  return { ref: match[1], sha: match[2] };
}

interface LockEntry {
  source?: unknown;
  sourceType?: unknown;
  skillPath?: unknown;
  computedHash?: unknown;
  [key: string]: unknown;
}

function resolveSkills(
  repoRoot: string,
  lock: { skills: Record<string, LockEntry> } | null,
): SkillState[] {
  if (!lock) return [];
  return Object.keys(lock.skills)
    .sort()
    .map((name) => {
      const entry = lock.skills[name];
      const lockHash =
        typeof entry.computedHash === "string" ? entry.computedHash : null;
      const installs: SkillInstall[] = SKILL_LAYOUTS.map((layout) => {
        const path = join(repoRoot, ...layout.split("/"), name, "SKILL.md");
        if (!existsSync(path)) {
          return {
            layout,
            path: relative(repoRoot, path).split(sep).join("/"),
            present: false,
            hashMatchesLock: null,
          };
        }
        const hash = sha256(readFileSync(path, "utf8"));
        return {
          layout,
          path: relative(repoRoot, path).split(sep).join("/"),
          present: true,
          hashMatchesLock: lockHash === null ? null : hash === lockHash,
        };
      });
      const installed = installs.filter((install) => install.present);
      const status: SkillState["status"] =
        installed.length === 0
          ? "not-installed"
          : installed.every((install) => install.hashMatchesLock === true)
            ? "ok"
            : "hash-mismatch";
      return {
        name,
        source: typeof entry.source === "string" ? entry.source : null,
        sourceType: typeof entry.sourceType === "string" ? entry.sourceType : null,
        lockHash,
        installs,
        status,
      };
    });
}

function landingFacts(profile: string): PolicyFact[] {
  const facts: PolicyFact[] = [];
  const landing = LANDING_RE.exec(profile);
  if (!landing) {
    facts.push({
      kind: "landing-method-undeclared",
      severity: "info",
      detail: `${PROFILE_PATH} declares no "PR landing method:" line; landing authority is not machine-checkable here`,
    });
    return facts;
  }
  const settings = new Map<string, boolean>();
  for (const match of profile.matchAll(MERGE_SETTING_RE)) {
    const key = match[1].replace(/_(merge|commit)$/, "");
    settings.set(key, match[2] === "true");
  }
  if (settings.size === 0) {
    facts.push({
      kind: "landing-settings-absent",
      severity: "warning",
      detail: `${PROFILE_PATH} declares landing method "${landing[1].trim()}" but no allow_*_merge repository settings; cannot check consistency`,
    });
    return facts;
  }
  for (const [pattern, key] of LANDING_METHOD_KEYS) {
    if (!pattern.test(landing[1])) continue;
    const allowed = settings.get(key);
    if (allowed === undefined) {
      facts.push({
        kind: "landing-settings-absent",
        severity: "warning",
        detail: `landing method "${landing[1].trim()}" needs allow_${key}_merge but the operating model does not declare it`,
      });
    } else if (!allowed) {
      facts.push({
        kind: "authority-conflict",
        severity: "conflict",
        detail: `landing method "${landing[1].trim()}" conflicts with the declared repository setting allow_${key}_merge=false`,
      });
    }
  }
  return facts;
}

function resolveLock(
  repoRoot: string,
): { lock: { skills: Record<string, LockEntry> } | null; facts: PolicyFact[] } {
  const read = readIfPresent(repoRoot, LOCK_PATH);
  if (!read.present) return { lock: null, facts: [] };
  try {
    const parsed = JSON.parse(read.content as string) as {
      skills?: Record<string, LockEntry>;
    };
    if (!parsed.skills || typeof parsed.skills !== "object") {
      return {
        lock: null,
        facts: [
          {
            kind: "skills-lock-invalid",
            severity: "conflict",
            detail: `${LOCK_PATH} has no usable "skills" mapping`,
          },
        ],
      };
    }
    return { lock: { skills: parsed.skills }, facts: [] };
  } catch (error) {
    return {
      lock: null,
      facts: [
        {
          kind: "skills-lock-invalid",
          severity: "conflict",
          detail: `${LOCK_PATH} is not valid JSON: ${(error as Error).message}`,
        },
      ],
    };
  }
}

function adrSourcesAndFacts(repoRoot: string): {
  sources: PolicySource[];
  facts: PolicyFact[];
} {
  const sources: PolicySource[] = [];
  const facts: PolicyFact[] = [];
  const dir = join(repoRoot, ...ADR_DIR.split("/"));
  if (!existsSync(dir)) return { sources, facts };
  const names = readdirSync(dir)
    .filter((name) => /^ADR-\d+\.md$/.test(name))
    .sort();
  for (const name of names) {
    const rel = `${ADR_DIR}/${name}`;
    sources.push(source(repoRoot, "practice", rel));
    const status = /^- Status:\s*(.+)$/m.exec(
      readFileSync(join(dir, name), "utf8"),
    );
    if (!status) {
      facts.push({
        kind: "adr-status",
        severity: "warning",
        detail: `${rel} declares no Status line`,
      });
    } else if (!status[1].startsWith("Accepted")) {
      facts.push({
        kind: "adr-status",
        severity: "info",
        detail: `${rel} status: ${status[1].trim()}`,
      });
    }
  }
  return { sources, facts };
}

export function resolvePolicy(repoRoot: string): PolicyResolution {
  const facts: PolicyFact[] = [];
  const constitution = source(repoRoot, "constitution", CONSTITUTION_PATH);
  const profile = source(repoRoot, "operating-model", PROFILE_PATH);
  const agents = source(repoRoot, "practice", AGENTS_PATH);
  const claude = source(repoRoot, "practice", CLAUDE_PATH);
  const adrs = adrSourcesAndFacts(repoRoot);
  const profileText =
    readIfPresent(repoRoot, PROFILE_PATH).content ?? "";

  const { lock, facts: lockFacts } = resolveLock(repoRoot);
  facts.push(...lockFacts);
  const lockPresent = lock !== null;
  const entries = lock ? Object.values(lock.skills) : [];
  const lockUnpinned =
    entries.length > 0 &&
    entries.every(
      (entry) => !LOCK_PIN_KEYS.some((key) => typeof entry[key] === "string" && entry[key]),
    );
  const skills = resolveSkills(repoRoot, lock);

  const baseline = parseBaseline(profileText);
  const baselinePinFacts: PolicyFact[] = [];
  if (baseline) {
    baselinePinFacts.push({
      kind: "baseline-pinned",
      severity: "info",
      detail: `operating model pins reviewed project-init baseline ${baseline.ref} @ ${baseline.sha.slice(0, 12)}`,
    });
  }

  const installedAnywhere = skills.some((skill) =>
    skill.installs.some((install) => install.present),
  );
  if (!lockPresent && !baseline && !installedAnywhere) {
    facts.push({
      kind: "project-init-absent",
      severity: "warning",
      detail:
        "no skills-lock.json, no installed project-init skills and no pinned baseline: project-init policy material is absent",
    });
  } else {
    facts.push({
      kind: "skills-lock-present",
      severity: "info",
      detail: `${LOCK_PATH} records ${entries.length} skill(s)`,
    });
  }
  if (lockPresent && lockUnpinned) {
    facts.push({
      kind: "lock-unpinned-source",
      severity: "warning",
      detail: `${LOCK_PATH} entries carry no revision pin; freshness against upstream cannot be verified offline (stale-lock risk)`,
    });
  }
  for (const skill of skills) {
    if (skill.status === "not-installed") {
      facts.push({
        kind: "skill-not-installed",
        severity: "warning",
        detail: `skill ${skill.name} is locked but not materialized in ${SKILL_LAYOUTS.join(" or ")}`,
      });
    } else if (skill.status === "hash-mismatch") {
      facts.push({
        kind: "skill-hash-mismatch",
        severity: "conflict",
        detail: `installed skill ${skill.name} differs from the lock's computedHash (stale or hand-edited upstream skill)`,
      });
    }
  }
  facts.push(...baselinePinFacts);
  if (baseline && lockPresent && lockUnpinned) {
    facts.push({
      kind: "baseline-divergence-risk",
      severity: "warning",
      detail: `lock tracks a floating source while the operating model pins baseline ${baseline.ref} @ ${baseline.sha.slice(0, 12)}; lock updates may pull skill content newer than the reviewed baseline`,
    });
  }
  facts.push(...landingFacts(profileText));
  if (/^## Project-specific reconciliation/m.test(profileText)) {
    facts.push({
      kind: "project-specific-override",
      severity: "info",
      detail: `${PROFILE_PATH} carries project-specific reconciliation overrides (refine, never silently replace, upstream policy)`,
    });
  }
  if (baseline && !QUALITY_PROFILE_PATHS.some((rel) => existsSync(join(repoRoot, ...rel.split("/"))))) {
    facts.push({
      kind: "quality-profile-absent",
      severity: "warning",
      detail: `operating model requires a compiled project-specific quality profile but none exists at ${QUALITY_PROFILE_PATHS.join(" or ")}`,
    });
  }
  if (!agents.present) {
    facts.push({
      kind: "agents-md-absent",
      severity: "warning",
      detail: `${AGENTS_PATH} is missing; project-local agent contract is not discoverable`,
    });
  }
  facts.push(...adrs.facts);

  const unresolvedDecisions: string[] = [];
  if (baseline && lockPresent && lockUnpinned) {
    unresolvedDecisions.push(
      `upstream re-adoption unresolved: skill content newer than reviewed baseline ${baseline.ref} @ ${baseline.sha.slice(0, 12)} requires an explicit review/authorization decision before being treated as current policy`,
    );
  }
  if (facts.some((fact) => fact.kind === "authority-conflict")) {
    unresolvedDecisions.push(
      `landing-policy conflict in ${PROFILE_PATH} must be resolved by the authority that owns the operating model`,
    );
  }
  if (facts.some((fact) => fact.kind === "quality-profile-absent")) {
    unresolvedDecisions.push(
      "quality profile declared by the operating model is not compiled yet",
    );
  }

  const knownLimitations = [
    "network-free: upstream freshness of floating-source skills and GitHub Issue/PR state are not resolved; only committed local state is read",
    "skill hash comparison validates installed files against the lock's recorded computedHash, not against upstream",
    "the landing-policy check is an internal consistency check of the operating model text, not a semantic policy evaluation",
    "this resolver reports facts only; it does not authorize, apply or overwrite policy",
  ];

  return {
    repoRoot,
    headSha: headSha(repoRoot),
    sources: [constitution, profile, agents, claude, ...adrs.sources],
    baseline,
    lockPresent,
    lockUnpinned,
    skills,
    facts,
    unresolvedDecisions,
    knownLimitations,
  };
}

function printHuman(resolution: PolicyResolution): void {
  const lines: string[] = [];
  lines.push(
    `policy resolution for ${resolution.repoRoot} @ ${resolution.headSha ?? "no-git"}`,
  );
  lines.push("sources (application order):");
  for (const src of resolution.sources) {
    const rev = src.sha256 ? `sha256:${src.sha256.slice(0, 12)}` : "-";
    lines.push(`  ${src.layer.padEnd(16)} ${src.path.padEnd(48)} ${src.present ? "present" : "absent"}  ${rev}`);
  }
  lines.push(
    resolution.baseline
      ? `project-init baseline: ${resolution.baseline.ref} @ ${resolution.baseline.sha}`
      : "project-init baseline: none pinned",
  );
  lines.push(
    `skills lock: ${resolution.lockPresent ? `${resolution.skills.length} skill(s)` : "absent"}${resolution.lockUnpinned ? ", floating source (unpinned)" : ""}`,
  );
  for (const skill of resolution.skills) {
    lines.push(`  ${skill.name.padEnd(32)} ${skill.status}`);
  }
  lines.push("facts:");
  for (const fact of resolution.facts) {
    lines.push(`  [${fact.severity}] ${fact.kind}: ${fact.detail}`);
  }
  if (resolution.unresolvedDecisions.length > 0) {
    lines.push("unresolved consequential decisions:");
    for (const decision of resolution.unresolvedDecisions) {
      lines.push(`  - ${decision}`);
    }
  }
  lines.push("known limitations:");
  for (const limitation of resolution.knownLimitations) {
    lines.push(`  - ${limitation}`);
  }
  console.log(lines.join("\n"));
}

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const repoRoot = positional[0] ?? join(import.meta.dir, "..", "..");
  const resolution = resolvePolicy(repoRoot);
  if (json) {
    console.log(JSON.stringify(resolution, null, 2));
  } else {
    printHuman(resolution);
  }
}

if (import.meta.main) main();
