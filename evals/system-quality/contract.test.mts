import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { changes } from "../../skills/system-quality/scripts/verify-contract.mts";
test("candidate cannot remove its own protection or rewrite the expected result", () => {
  const root = mkdtempSync(join(tmpdir(), "trusted-contract-")),
    trusted = join(root, "trusted"),
    candidate = join(root, "candidate");
  try {
    for (const dir of [trusted, candidate]) {
      mkdirSync(join(dir, "rules"), { recursive: true });
      writeFileSync(join(dir, "quality-contract.json"), '["rules"]');
      writeFileSync(join(dir, "rules", "check.txt"), "required");
    }
    assert.deepEqual(changes(trusted, candidate), []);
    writeFileSync(join(candidate, "quality-contract.json"), "[]");
    writeFileSync(join(candidate, "rules", "check.txt"), "optional");
    assert.deepEqual(changes(trusted, candidate), [
      "quality-contract.json",
      "rules/check.txt",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("new and removed contract files are both detected", () => {
  const root = mkdtempSync(join(tmpdir(), "trusted-contract-"));
  try {
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name, "rules"), { recursive: true });
      writeFileSync(join(root, name, "quality-contract.json"), '["rules"]');
    }
    writeFileSync(join(root, "a", "rules", "old"), "old");
    writeFileSync(join(root, "b", "rules", "new"), "new");
    assert.deepEqual(changes(join(root, "a"), join(root, "b")), [
      "rules/new",
      "rules/old",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dangling candidate symlinks cannot disappear from the contract inventory", () => {
  const root = mkdtempSync(join(tmpdir(), "trusted-contract-"));
  try {
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name, "rules"), { recursive: true });
      writeFileSync(join(root, name, "quality-contract.json"), '["rules"]');
    }
    symlinkSync("absent", join(root, "b", "rules", "escape"));
    assert.throws(() => changes(join(root, "a"), join(root, "b")), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("misspelled trusted paths do not silently reduce protected scope", () => {
  const root = mkdtempSync(join(tmpdir(), "trusted-contract-"));
  try {
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "quality-contract.json"), '["missing"]');
    }
    assert.throws(() => changes(join(root, "a"), join(root, "b")), /missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
