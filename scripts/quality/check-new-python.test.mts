import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectGitDiffEntries,
  evaluateAddedFiles,
  loadExceptions,
  POLICY_REFERENCE,
} from "./check-new-python.mts";

function withTempRepo(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "new-python-guard-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function commitFile(dir: string, relPath: string, content: string, message: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  execFileSync("git", ["add", relPath], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

test("negative fixture (pc-setup PR #147 shape): newly added .py files fail with ADR-0001 citation", () => {
  const result = evaluateAddedFiles([
    { status: "A", path: "platforms/ubuntu-wsl/worker-runtime.py" },
    { status: "A", path: "scripts/test-worker-runtime.py" },
  ]);
  assert.equal(result.status, "FAIL");
  assert.equal(result.violations.length, 2);
  assert.deepEqual(
    result.violations.map((v) => v.code),
    ["NEW_PYTHON_FILE", "NEW_PYTHON_FILE"],
  );
  assert.ok(result.violations.every((v) => v.policy === POLICY_REFERENCE));
});

test("negative fixture: extensionless file with python shebang fails", () => {
  const result = evaluateAddedFiles([
    {
      status: "A",
      path: "scripts/bootstrap-helper",
      firstLine: "#!/usr/bin/env python3",
    },
  ]);
  assert.equal(result.status, "FAIL");
  assert.equal(result.violations[0]?.code, "NEW_PYTHON_SHEBANG");
});

test("positive fixture: editing pre-existing .py file and unrelated python-named docs pass", () => {
  const result = evaluateAddedFiles([
    { status: "M", path: "legacy/existing-tool.py" },
    { status: "A", path: "docs/python-migration-notes.md", firstLine: "# Python notes" },
    { status: "A", path: "scripts/check.mts", firstLine: "#!/usr/bin/env node" },
  ]);
  assert.equal(result.status, "PASS");
  assert.equal(result.violations.length, 0);
});

test("positive and fail-closed exception fixtures with real git diff", () => {
  withTempRepo((dir) => {
    commitFile(dir, "legacy/existing.py", "print('v1')\n", "initial legacy python");
    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir });
    // Edit existing .py (allowed) + add approved bootstrap exception + add unapproved shebang script
    commitFile(dir, "legacy/existing.py", "print('v2')\n", "edit existing python");
    commitFile(
      dir,
      "docs/adr/ADR-9001.md",
      "# ADR-9001: Bootstrap Python exception\n",
      "add local ADR",
    );
    commitFile(
      dir,
      ".config/python-exceptions.json",
      JSON.stringify({
        exceptions: [
          {
            paths: ["bootstrap/pre-bun-init.py"],
            adr: "docs/adr/ADR-9001.md",
            reason: "Bun is not installed yet during early OS bootstrap",
            alternatives: "POSIX sh lacks JSON parsing in minimal image",
            sunsetCondition: "Remove once mise/Bun bootstrap runs first",
          },
        ],
      }),
      "declare approved exception",
    );
    commitFile(dir, "bootstrap/pre-bun-init.py", "print('bootstrap')\n", "add approved python");

    const loaded = loadExceptions(dir, ".config/python-exceptions.json");
    assert.equal(loaded.errors.length, 0);
    const entries = collectGitDiffEntries(dir, "main", "HEAD");
    const passResult = evaluateAddedFiles(entries, loaded.exceptions, loaded.errors);
    assert.equal(passResult.status, "PASS");
    assert.deepEqual(passResult.exemptedFiles, ["bootstrap/pre-bun-init.py"]);

    // Now add an unapproved extensionless Python script -> must FAIL
    commitFile(dir, "scripts/sneaky", "#!/usr/bin/python3\nprint('hi')\n", "add python shebang");
    const failEntries = collectGitDiffEntries(dir, "main", "HEAD");
    const failResult = evaluateAddedFiles(failEntries, loaded.exceptions, loaded.errors);
    assert.equal(failResult.status, "FAIL");
    assert.equal(failResult.violations.length, 1);
    assert.equal(failResult.violations[0]?.code, "NEW_PYTHON_SHEBANG");
    assert.equal(failResult.violations[0]?.path, "scripts/sneaky");

    // Missing ADR file in exception manifest must fail closed
    commitFile(
      dir,
      ".config/bad-exceptions.json",
      JSON.stringify({
        exceptions: [
          {
            paths: ["bootstrap/pre-bun-init.py"],
            adr: "docs/adr/ADR-MISSING.md",
            reason: "missing adr",
            alternatives: "none",
            sunsetCondition: "never",
          },
        ],
      }),
      "add broken exception manifest",
    );
    const broken = loadExceptions(dir, ".config/bad-exceptions.json");
    assert.equal(broken.errors.length, 1);
    assert.equal(broken.errors[0]?.code, "INVALID_EXCEPTION");
    const brokenResult = evaluateAddedFiles(entries, broken.exceptions, broken.errors);
    assert.equal(brokenResult.status, "FAIL");
  });
});
