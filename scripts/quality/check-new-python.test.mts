import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectGitDiffEntries,
  evaluateAddedFiles,
  hasPythonShebang,
  isAcceptedAdrContent,
  loadExceptions,
  POLICY_REFERENCE,
  readFirstLineFromGitObject,
} from "./check-new-python.mts";

const SCRIPT_PATH = resolve(fileURLToPath(import.meta.url), "..", "check-new-python.mts");

async function withTempRepo(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "new-python-guard-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRepoFile(dir: string, relPath: string, content: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function commitFile(dir: string, relPath: string, content: string, message: string): void {
  writeRepoFile(dir, relPath, content);
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

test("hardened Python shebang detection handles BOM, case, env flags/assignments, absolute path, free-threaded, and pypy", () => {
  const positiveShebangs = [
    "#!/usr/bin/env python3",
    "\uFEFF#!/usr/bin/env python3",
    "\uFEFF#!/usr/bin/env PYTHONDONTWRITEBYTECODE=1 python3.13t",
    "#!/usr/bin/env -S FOO=bar BAR=1 python3.13t -u",
    "#!/usr/bin/env /usr/bin/python3",
    "#!/usr/bin/env -- pypy3",
    "#!/usr/local/bin/PYTHON3",
    "#!/opt/venv/bin/pypy3.10",
    "#!/usr/bin/pythonw3",
  ];
  for (const shebang of positiveShebangs) {
    assert.equal(hasPythonShebang(shebang), true, `expected match for: ${shebang}`);
  }

  const negativeShebangs = [
    "#!/usr/bin/env node",
    "#!/usr/bin/env bash",
    "#!/usr/bin/env MY_VAR=python3 bash",
    "#!/usr/bin/env -u PYTHONHOME node",
    '#!/usr/bin/env -S bash -c "python3 -V"',
    "# not a shebang python3",
    "",
  ];
  for (const shebang of negativeShebangs) {
    assert.equal(hasPythonShebang(shebang), false, `expected non-match for: ${shebang}`);
  }
});

test("ADR status parser accepts only Accepted/Approved/承認 status in header", () => {
  assert.equal(isAcceptedAdrContent("# ADR-0001\n\n- Status: Accepted\n"), true);
  assert.equal(
    isAcceptedAdrContent("# ADR-0001\n\n- Status: Accepted; revised by ADR-0003\n"),
    true,
  );
  assert.equal(isAcceptedAdrContent("# ADR-0001\n\n**Status**: Approved\n"), true);
  assert.equal(isAcceptedAdrContent("# ADR-0001\n\n- ステータス: 承認済み\n"), true);
  assert.equal(isAcceptedAdrContent("# ADR-0001\n\n## Status\n\nAccepted\n"), true);
  assert.equal(isAcceptedAdrContent("---\nstatus: accepted\n---\n"), true);

  assert.equal(isAcceptedAdrContent("# ADR-0001\n\n- Status: Draft\n"), false);
  assert.equal(isAcceptedAdrContent("# ADR-0001\n\n- Status: Proposed\n"), false);
  assert.equal(
    isAcceptedAdrContent("# ADR-0001\n\n- Status: Draft (not yet Accepted)\n"),
    false,
  );
  assert.equal(isAcceptedAdrContent("# ADR-0001\n\nNo status header here\n"), false);
  assert.equal(isAcceptedAdrContent("# README\n\nAccepted by team.\n"), false);
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

test("real git repo: non-ASCII filenames and >1 MiB shebang files cannot bypass detection", async () => {
  await withTempRepo(async (dir) => {
    commitFile(dir, "README.md", "# demo\n", "initial");
    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir });

    // Non-ASCII .py filename + non-ASCII extensionless python shebang
    commitFile(dir, "scripts/日本語.py", "print('ja')\n", "add non-ascii py");
    commitFile(
      dir,
      "scripts/日本語スクリプト",
      "\uFEFF#!/usr/bin/env FOO=1 python3.13t\nprint('ja')\n",
      "add non-ascii shebang",
    );

    // >1.5 MiB file starting with Python shebang (must NOT be silently skipped by maxBuffer)
    const hugePythonBody = `#!/usr/bin/env python3\n# ${"x".repeat(1_500_000)}\n`;
    commitFile(dir, "scripts/huge-script", hugePythonBody, "add huge python shebang");

    // >1.5 MiB non-Python single-line file (must NOT crash or false-positive)
    const hugeNonPythonBody = "A".repeat(1_500_000);
    commitFile(dir, "assets/huge-blob.dat", hugeNonPythonBody, "add huge non-python blob");

    const entries = await collectGitDiffEntries(dir, "main", "HEAD");
    const result = evaluateAddedFiles(entries);
    assert.equal(result.status, "FAIL");
    assert.deepEqual(
      result.violations.map((v) => [v.code, v.path]).sort(),
      [
        ["NEW_PYTHON_FILE", "scripts/日本語.py"],
        ["NEW_PYTHON_SHEBANG", "scripts/huge-script"],
        ["NEW_PYTHON_SHEBANG", "scripts/日本語スクリプト"],
      ].sort(),
    );

    // Fail-closed check: invalid git blob OID throws instead of silently returning undefined
    await assert.rejects(
      () => readFirstLineFromGitObject(dir, "0000000000000000000000000000000000000000"),
      /git cat-file blob/,
    );
  });
});

test("real git repo: rename semantics allow .py->.py while catching .txt->.py", async () => {
  await withTempRepo(async (dir) => {
    const sharedPyBody = Array.from({ length: 20 }, (_, i) => `x_${i} = ${i}\n`).join("");
    const sharedTxtBody = Array.from({ length: 20 }, (_, i) => `line ${i} plain text\n`).join("");
    commitFile(dir, "legacy/old.py", sharedPyBody, "add legacy py");
    commitFile(dir, "notes/plain.txt", sharedTxtBody, "add plain txt");
    commitFile(
      dir,
      "legacy/old-exec",
      `#!/usr/bin/env python3\n${sharedPyBody}`,
      "add legacy python shebang",
    );

    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir });
    execFileSync("git", ["mv", "legacy/old.py", "legacy/moved.py"], { cwd: dir });
    execFileSync("git", ["mv", "legacy/old-exec", "legacy/moved-exec"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "rename existing python files"], { cwd: dir });

    const allowedEntries = await collectGitDiffEntries(dir, "main", "HEAD");
    const allowedResult = evaluateAddedFiles(allowedEntries);
    assert.equal(allowedResult.status, "PASS");
    assert.equal(allowedResult.violations.length, 0);

    // Now rename a non-Python .txt file into .py -> MUST FAIL
    execFileSync("git", ["mv", "notes/plain.txt", "notes/disguised.py"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "rename txt to py"], { cwd: dir });

    const caughtEntries = await collectGitDiffEntries(dir, "main", "HEAD");
    const caughtResult = evaluateAddedFiles(caughtEntries);
    assert.equal(caughtResult.status, "FAIL");
    assert.equal(caughtResult.violations.length, 1);
    assert.equal(caughtResult.violations[0]?.code, "NEW_PYTHON_FILE");
    assert.equal(caughtResult.violations[0]?.path, "notes/disguised.py");
  });
});

test("real git repo: exceptions and ADR are loaded from --head tree, rejecting traversal, Draft ADRs, and non-ADR files", async () => {
  await withTempRepo(async (dir) => {
    commitFile(dir, "README.md", "# Project\n\nStatus: Accepted\n", "initial");
    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir });
    commitFile(dir, "bootstrap/pre-bun-init.py", "print('bootstrap')\n", "add python file");

    // 1. Exception manifest + ADR present ONLY in working tree (not committed to head) -> MUST FAIL!
    writeRepoFile(
      dir,
      "docs/adr/ADR-9001.md",
      "# ADR-9001: Bootstrap Python\n\n- Status: Accepted\n",
    );
    writeRepoFile(
      dir,
      ".config/python-exceptions.json",
      JSON.stringify({
        exceptions: [
          {
            paths: ["bootstrap/pre-bun-init.py"],
            adr: "docs/adr/ADR-9001.md",
            reason: "pre-bun bootstrap",
            alternatives: "sh lacks json",
            sunsetCondition: "remove after bun bootstrap",
          },
        ],
      }),
    );
    const headOnlyLoaded = loadExceptions(dir, ".config/python-exceptions.json", { ref: "HEAD" });
    assert.equal(headOnlyLoaded.exceptions.length, 0);
    assert.equal(headOnlyLoaded.errors.length, 0);
    const headEntries = await collectGitDiffEntries(dir, "main", "HEAD");
    assert.equal(
      evaluateAddedFiles(headEntries, headOnlyLoaded.exceptions, headOnlyLoaded.errors).status,
      "FAIL",
    );

    // 2. Commit accepted ADR + manifest on feature, then checkout main so working tree lacks them -> --head feature MUST PASS!
    execFileSync("git", ["add", "docs/adr/ADR-9001.md", ".config/python-exceptions.json"], {
      cwd: dir,
    });
    execFileSync("git", ["commit", "-q", "-m", "commit approved exception"], { cwd: dir });
    const featureSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["checkout", "-q", "main"], { cwd: dir });

    const fromCommittedHead = loadExceptions(dir, ".config/python-exceptions.json", {
      ref: featureSha,
    });
    assert.equal(fromCommittedHead.errors.length, 0);
    assert.equal(fromCommittedHead.exceptions.length, 1);
    const committedEntries = await collectGitDiffEntries(dir, "main", featureSha);
    const passResult = evaluateAddedFiles(
      committedEntries,
      fromCommittedHead.exceptions,
      fromCommittedHead.errors,
    );
    assert.equal(passResult.status, "PASS");
    assert.deepEqual(passResult.exemptedFiles, ["bootstrap/pre-bun-init.py"]);

    // 3. Reject path traversal, README.md, and Status: Draft ADR
    execFileSync("git", ["checkout", "-q", "feature"], { cwd: dir });
    commitFile(
      dir,
      "docs/adr/ADR-9002.md",
      "# ADR-9002: Draft exception\n\n- Status: Draft\n",
      "add draft adr",
    );
    commitFile(
      dir,
      ".config/bad-exceptions.json",
      JSON.stringify({
        exceptions: [
          {
            paths: ["bootstrap/pre-bun-init.py"],
            adr: "../../etc/hosts",
            reason: "traversal",
            alternatives: "none",
            sunsetCondition: "never",
          },
          {
            paths: ["bootstrap/pre-bun-init.py"],
            adr: "README.md",
            reason: "non-adr file",
            alternatives: "none",
            sunsetCondition: "never",
          },
          {
            paths: ["bootstrap/pre-bun-init.py"],
            adr: "docs/adr/ADR-9002.md",
            reason: "draft adr",
            alternatives: "none",
            sunsetCondition: "never",
          },
          {
            paths: ["../escape.py"],
            adr: "docs/adr/ADR-9001.md",
            reason: "bad path",
            alternatives: "none",
            sunsetCondition: "never",
          },
        ],
      }),
      "add invalid exceptions",
    );
    const invalidLoaded = loadExceptions(dir, ".config/bad-exceptions.json", { ref: "HEAD" });
    assert.equal(invalidLoaded.exceptions.length, 0);
    assert.equal(invalidLoaded.errors.length, 4);
    assert.ok(invalidLoaded.errors.every((e) => e.code === "INVALID_EXCEPTION"));
  });
});

test("CLI exit codes (0 PASS, 1 FAIL, 2 error) and --policy override", async () => {
  await withTempRepo((dir) => {
    commitFile(dir, "README.md", "# demo\n", "initial");
    execFileSync("git", ["checkout", "-q", "-b", "clean"], { cwd: dir });
    commitFile(dir, "scripts/ok.mts", "export const ok = true;\n", "add ts");

    const passRun = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--root", dir, "--base", "main", "--head", "HEAD"],
      { encoding: "utf8" },
    );
    assert.equal(passRun.status, 0, passRun.stderr);
    const passJson = JSON.parse(passRun.stdout) as { status: string };
    assert.equal(passJson.status, "PASS");

    commitFile(dir, "scripts/bad.py", "print('no')\n", "add py");
    const customPolicy = "docs/adr/LOCAL-ADR-0002.md";
    const failRun = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--root",
        dir,
        "--base",
        "main",
        "--head",
        "HEAD",
        "--policy",
        customPolicy,
      ],
      { encoding: "utf8" },
    );
    assert.equal(failRun.status, 1, failRun.stderr);
    const failJson = JSON.parse(failRun.stdout) as {
      status: string;
      violations: Array<{ policy: string }>;
    };
    assert.equal(failJson.status, "FAIL");
    assert.equal(failJson.violations[0]?.policy, customPolicy);

    const badArgRun = spawnSync(process.execPath, [SCRIPT_PATH, "--unknown-flag"], {
      encoding: "utf8",
    });
    assert.equal(badArgRun.status, 2);

    const badRefRun = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--root", dir, "--base", "main", "--head", "refs/heads/does-not-exist"],
      { encoding: "utf8" },
    );
    assert.equal(badRefRun.status, 2);
  });
});
