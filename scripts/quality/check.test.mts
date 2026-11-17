import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspect } from "./check.mts";
function project(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "scope-test-"));
  try {
    for (const [path, value] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), value);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("new source outside include is a gap, even when tsc has other valid inputs", () => {
  project(
    {
      "tsconfig.json":
        '{"compilerOptions":{"strict":true},"include":["src/**/*.mts"]}',
      "src/a.mts": "export {};",
      "tools/b.mts": "export {};",
    },
    (root) =>
      assert.ok(
        inspect(root).some(
          (x) => x.code === "UNANALYZED_SOURCE" && x.path === "tools/b.mts",
        ),
      ),
  );
});
test("whole-tree include covers newly placed source", () => {
  project(
    {
      "tsconfig.json":
        '{"compilerOptions":{"strict":true},"include":["**/*.mts"]}',
      "tools/b.mts": "export {};",
    },
    (root) => assert.deepEqual(inspect(root), []),
  );
});
test("broken local Markdown references fail while URLs and anchors are not local files", () => {
  project(
    {
      "README.md":
        "[missing](skills/missing/SKILL.md) [web](https://example.com) [here](#here)",
    },
    (root) =>
      assert.deepEqual(
        inspect(root).map((x) => x.code),
        ["BROKEN_REFERENCE"],
      ),
  );
});
test("relative references resolve from the owning document", () => {
  project(
    {
      "skills/a/SKILL.md": "[guide](references/guide.md)",
      "skills/a/references/guide.md": "guide",
    },
    (root) => assert.deepEqual(inspect(root), []),
  );
});
test("strict subflags and source suppressions cannot bypass analysis", () => {
  project(
    {
      "tsconfig.json":
        '{"compilerOptions":{"strict":true,"strictNullChecks":false},"include":["**/*.mts"]}',
      "a.mts": '// @ts-nocheck\nexport const value: number = "bad";',
    },
    (root) => {
      assert.ok(inspect(root).some((x) => x.code === "WEAKENED_ANALYSIS"));
      assert.ok(inspect(root).some((x) => x.code === "ANALYSIS_SUPPRESSION"));
    },
  );
});
test("unknown file kinds require classification", () => {
  project({ "new.py": "print(1)" }, (root) =>
    assert.ok(inspect(root).some((x) => x.code === "UNCLASSIFIED_FILE")),
  );
});
test("reference-style links resolve too", () => {
  project(
    { "README.md": "[guide][missing]\n\n[missing]: absent.md\n" },
    (root) =>
      assert.ok(inspect(root).some((x) => x.code === "BROKEN_REFERENCE")),
  );
});

test("native TypeScript JSONC syntax remains valid", () => {
  project(
    {
      "tsconfig.json":
        '{ // compiler settings\n "compilerOptions": {"strict": true,}, "include":["**/*.mts"], }',
      "a.mts": "export {};",
    },
    (root) => assert.deepEqual(inspect(root), []),
  );
});

test("suppression comments after interpolated templates are detected", () => {
  project(
    {
      "tsconfig.json":
        '{"compilerOptions":{"strict":true},"include":["**/*.mts"]}',
      "a.mts":
        'const label = `item${1}`;\n// @ts-ignore\nconst value: number = "bad";',
    },
    (root) =>
      assert.ok(inspect(root).some((x) => x.code === "ANALYSIS_SUPPRESSION")),
  );
});

test("suppression-looking text inside a template remains ordinary data", () => {
  project(
    {
      "tsconfig.json":
        '{"compilerOptions":{"strict":true},"include":["**/*.mts"]}',
      "a.mts": "const label = `item${1} // @ts-ignore`;",
    },
    (root) => assert.deepEqual(inspect(root), []),
  );
});

test("missing shell tools are execution errors, not invalid configuration", async () => {
  const { spawnSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  project({ "run.sh": "#!/bin/bash\necho valid\n" }, (root) => {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/quality/check.mts"), root],
      { encoding: "utf8", env: { ...process.env, PATH: "" } },
    );
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, /INVALID_CONFIGURATION/);
  });
});

test("a single-Skill install must include its declared dependency", () => {
  project(
    {
      "skills/owner/SKILL.md":
        "---\nname: owner\nmetadata:\n  requires-skills: system-quality\n---\nOwner",
    },
    (root) => {
      assert.ok(
        inspect(root).some((x) => x.code === "MISSING_SKILL_DEPENDENCY"),
      );
      mkdirSync(join(root, "skills/system-quality"), { recursive: true });
      writeFileSync(
        join(root, "skills/system-quality/SKILL.md"),
        "---\nname: system-quality\n---\nQuality",
      );
      assert.deepEqual(inspect(root), []);
    },
  );
});
