#!/usr/bin/env node
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "project-quality-suite-"));
try {
  const suite = join(scratch, "cases.json");
  writeFileSync(
    suite,
    JSON.stringify(
      {
        command: [process.execPath, resolve("scripts/quality/check.mts"), "."],
        timeoutMs: 30000,
        cases: [
          {
            id: "new-owned-source-covered",
            expect: "accept",
            patches: [
              {
                path: "new-component/source.mts",
                before: null,
                after: "export const value: number = 1;\n",
              },
            ],
          },
          {
            id: "exclude-new-source",
            expect: "reject",
            diagnostic: "UNANALYZED_SOURCE",
            patches: [
              {
                path: "new-component/source.mts",
                before: null,
                after: "export const value: number = 1;\n",
              },
              {
                path: "tsconfig.json",
                before: '"node_modules",',
                after: '"node_modules", "new-component",',
              },
            ],
          },
          {
            id: "exclude-skill-code",
            expect: "reject",
            diagnostic: "UNANALYZED_SOURCE",
            patches: [
              {
                path: "tsconfig.json",
                before: '"node_modules",',
                after: '"node_modules", "skills",',
              },
            ],
          },
          {
            id: "weaken-strict-checking",
            expect: "reject",
            diagnostic: "WEAKENED_ANALYSIS",
            patches: [
              {
                path: "tsconfig.json",
                before: '"strict": true',
                after: '"strict": false',
              },
            ],
          },
          {
            id: "broken-skill-reference",
            expect: "reject",
            diagnostic: "BROKEN_REFERENCE",
            patches: [
              {
                path: "skills/system-quality/SKILL.md",
                before: "(references/contract.md)",
                after: "(references/missing.md)",
              },
            ],
          },
          {
            id: "valid-new-skill-reference",
            expect: "accept",
            patches: [
              {
                path: "skills/system-quality/references/additional.md",
                before: null,
                after: "# Additional\n",
              },
              {
                path: "skills/system-quality/SKILL.md",
                before: "(references/contract.md)",
                after: "(references/additional.md)",
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
  const result = spawnSync(
    process.execPath,
    ["skills/system-quality/scripts/challenge.mts", ".", suite],
    { stdio: "inherit", timeout: 240000 },
  );
  process.exitCode = result.error || result.signal ? 2 : (result.status ?? 2);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
