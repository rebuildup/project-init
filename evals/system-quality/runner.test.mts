import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const runner = resolve("skills/system-quality/scripts/challenge.mts");
function fixture(
  check: string,
  patches = [{ path: "source.txt", before: "valid", after: "invalid" }],
) {
  const root = mkdtempSync(join(tmpdir(), "quality-test-"));
  writeFileSync(join(root, "source.txt"), "valid");
  writeFileSync(join(root, "check.mjs"), check);
  writeFileSync(
    join(root, "cases.json"),
    JSON.stringify({
      command: [process.execPath, "check.mjs"],
      timeoutMs: 2000,
      cases: [
        {
          id: "invalid-source",
          expect: "reject",
          diagnostic: "INVALID_SOURCE",
          patches,
        },
      ],
    }),
  );
  return root;
}
function run(root: string) {
  return spawnSync(process.execPath, [runner, root, join(root, "cases.json")], {
    encoding: "utf8",
  });
}
const checker = `import {readFileSync} from 'node:fs'; if(readFileSync('source.txt','utf8')==='invalid'){console.error('INVALID_SOURCE');process.exitCode=1;}`;
test("executes a real rejection in a separate copy and leaves source unchanged", () => {
  const root = fixture(checker);
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(join(root, "source.txt"), "utf8"), "valid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a surviving mutation fails the challenge", () => {
  const root = fixture("");
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /SURVIVED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("an unrelated crash is not a rejection", () => {
  const root = fixture(
    `import {readFileSync} from 'node:fs'; if(readFileSync('source.txt','utf8')==='invalid') throw Error('crash');`,
  );
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a broken baseline cannot kill mutants", () => {
  const root = fixture(`console.error('INVALID_SOURCE');process.exitCode=1;`);
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /BASELINE_FAILED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("patches outside the candidate are rejected", () => {
  const root = fixture(checker, [
    { path: "../escape", before: "valid", after: "invalid" },
  ]);
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("empty cases cannot claim success", () => {
  const root = fixture(checker);
  writeFileSync(
    join(root, "cases.json"),
    JSON.stringify({
      command: [process.execPath, "check.mjs"],
      timeoutMs: 2000,
      cases: [],
    }),
  );
  try {
    assert.equal(run(root).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("timeout is an error rather than a killed mutation", () => {
  const root = fixture(
    `import {readFileSync} from 'node:fs'; if(readFileSync('source.txt','utf8')==='invalid') while(true){}`,
  );
  const path = join(root, "cases.json");
  const suite = JSON.parse(readFileSync(path, "utf8"));
  suite.timeoutMs = 300;
  writeFileSync(path, JSON.stringify(suite));
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("an expected valid change must actually pass", () => {
  const root = fixture(checker);
  const path = join(root, "cases.json");
  const suite = JSON.parse(readFileSync(path, "utf8"));
  suite.cases[0].expect = "accept";
  writeFileSync(path, JSON.stringify(suite));
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("ambiguous patches cannot silently change a different occurrence", () => {
  const root = fixture(checker);
  writeFileSync(join(root, "source.txt"), "valid valid");
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exactly once/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("diagnostic substrings are not accepted as exact evidence", () => {
  const root = fixture(
    `import {readFileSync} from 'node:fs';if(readFileSync('source.txt','utf8')==='invalid'){console.error('not INVALID_SOURCE');process.exitCode=1;}`,
  );
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a command ignoring SIGTERM is forcibly terminated", () => {
  const root = fixture(
    `import {readFileSync} from 'node:fs'; if(readFileSync('source.txt','utf8')==='invalid'){process.on('SIGTERM',()=>{});setInterval(()=>{},100);}`,
  );
  const path = join(root, "cases.json");
  const suite = JSON.parse(readFileSync(path, "utf8"));
  suite.timeoutMs = 500;
  writeFileSync(path, JSON.stringify(suite));
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source identity distinguishes file boundaries and empty directories", async () => {
  const { snapshot } = await import(
    "../../skills/system-quality/scripts/challenge.mts"
  );
  const { lstatSync, mkdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "quality-digest-"));
  try {
    writeFileSync(join(root, "a"), "x");
    writeFileSync(join(root, "b"), "y");
    const original = snapshot(root);
    const oldBoundary = JSON.stringify(["b", lstatSync(join(root, "b")).mode]);
    rmSync(join(root, "b"));
    writeFileSync(join(root, "a"), "x" + oldBoundary + "y");
    assert.notEqual(snapshot(root), original);
    const beforeDirectory = snapshot(root);
    mkdirSync(join(root, "empty"));
    assert.notEqual(snapshot(root), beforeDirectory);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overlapping replacement matches are ambiguous", () => {
  const root = fixture("", [{ path: "source.txt", before: "aba", after: "x" }]);
  writeFileSync(join(root, "source.txt"), "ababa");
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly once/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostics are matched in separate output streams", () => {
  for (const [stdout, stderr, expected] of [
    ["progress", "INVALID_SOURCE\n", 0],
    ["INVALID_", "SOURCE\n", 1],
  ] as const) {
    const root = fixture(
      `import {readFileSync} from 'node:fs';if(readFileSync('source.txt','utf8')==='invalid'){process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exitCode=1;}`,
    );
    try {
      const result = run(root);
      assert.equal(result.status, expected, result.stdout + result.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("cases all use one frozen source despite transient writes to the original", () => {
  const root = fixture("");
  writeFileSync(
    join(root, "check.mjs"),
    `import {readFileSync,writeFileSync} from 'node:fs';const path=${JSON.stringify(join(root, "source.txt"))};if(readFileSync('source.txt','utf8')==='valid'){writeFileSync(path,'tainted');}else{writeFileSync(path,'valid');console.error('INVALID_SOURCE');process.exitCode=1;}`,
  );
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(join(root, "source.txt"), "utf8"), "valid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
