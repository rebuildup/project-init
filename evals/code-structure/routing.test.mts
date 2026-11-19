import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("initialization connects normal code edits to naming and system quality", () => {
  const init = read("PROMPT.ja.md");
  assert.match(init, /新規実装・追加・変更時の責務・階層・識別子/);
  assert.match(init, /既存の責務・階層を先に調べ、`code-naming` と `system-quality`/);
  assert.match(init, /今回生んだ負債を先送りしていない/);
});

test("code naming is a default ability in source repositories, not an opt-in rename task", () => {
  const row = read("catalog/capabilities.tsv").split("\n").find((line) => line.startsWith("code-naming\t"));
  assert.ok(row);
  const [,scope,condition] = row.split("\t");
  assert.equal(scope, "single");
  assert.match(condition, /コードがある/);
  assert.match(read("skills/skill-selection/SKILL.md"), /リネーム依頼がなくても `code-naming`/);
  assert.match(read("skills/system-quality/SKILL.md"), /requires-skills: code-naming/);
});

test("incremental structural drift is an explicit quality failure case", () => {
  assert.match(read("skills/system-quality/SKILL.md"), /新規実装と機能追加で全体を整合する/);
  assert.match(read("skills/system-quality/references/anti-cases.md"), /\| S8 \|/);
  assert.match(read("skills/system-quality/references/improvements.md"), /\| I7 /);
  const cases=read("evals/code-structure/scenarios.md");
  for (const label of ["Case A:", "Case B:", "Case C:", "Case D:"]) {
    assert.ok(cases.includes(label), `missing ${label}`);
  }
});
