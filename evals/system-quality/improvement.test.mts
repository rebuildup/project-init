import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspect } from "../../scripts/quality/check.mts";

// Both candidates receive the same source and strictness; only discovery differs.
test("whole-system discovery preserves valid behavior and catches errors at a new placement", () => {
  const root = mkdtempSync(join(tmpdir(), "quality-comparison-"));
  const compiler = resolve("node_modules/typescript/bin/tsc");
  const options = {
    strict: true,
    noEmit: true,
    target: "ES2022",
    module: "NodeNext",
    types: [],
  };
  const configure = (include: string[]) =>
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: options, include }),
    );
  const check = () =>
    spawnSync(process.execPath, [compiler, "-p", root], { encoding: "utf8" });
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "skills", "new", "scripts"), { recursive: true });
    writeFileSync(
      join(root, "src", "main.mts"),
      "export const value: number = 1;",
    );
    const added = join(root, "skills", "new", "scripts", "main.mts");
    writeFileSync(added, "export const extra: number = 2;");
    configure(["src/**/*.mts"]);
    assert.equal(check().status, 0);
    configure(["**/*.mts"]);
    assert.equal(check().status, 0);
    writeFileSync(added, 'export const extra: number = "wrong";');
    configure(["src/**/*.mts"]);
    assert.equal(check().status, 0);
    assert.ok(inspect(root).some((x) => x.code === "UNANALYZED_SOURCE"));
    configure(["**/*.mts"]);
    const result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /TS2322/);
    writeFileSync(added, "export const extra: number = 2;");
    writeFileSync(
      join(root, "src", "main.mts"),
      'export const value: number = "wrong";',
    );
    assert.notEqual(check().status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
