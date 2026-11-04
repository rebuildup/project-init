#!/usr/bin/env bun
/** Supply OCR's api_key_cmd from the canonical Infisical project, never ambient credentials. */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const secretName = "OPENCODE_API_KEY";

function fail(message: string): never {
  process.stderr.write(`ocr-go-key: ${message}\n`);
  process.exit(1);
}

if (process.argv[2] === "--emit-injected-key") {
  // This stage is launched ONLY by script/with-secrets( .ps1 ) after the
  // parent has removed any inherited ambient value of OPENCODE_API_KEY.
  const key = process.env[secretName];
  if (!key || !key.trim() || /[\r\n]/.test(key)) {
    fail(`${secretName} is missing or malformed in the Infisical environment`);
  }
  process.stdout.write(`${key}\n`);
} else if (process.argv.length !== 2) {
  fail("unexpected arguments");
} else {
  const cleanEnv = { ...process.env };
  delete cleanEnv[secretName];
  // The tracked with-secrets wrappers verify the bound self-hosted project.
  // No secret appears in the command arguments, checked-in config, or stderr.
  const script = join(repoRoot, "script", process.platform === "win32" ? "with-secrets.ps1" : "with-secrets");
  const executable = process.platform === "win32" ? "pwsh" : script;
  const args = process.platform === "win32"
    ? ["-NoProfile", "-File", script, "bun", fileURLToPath(import.meta.url), "--emit-injected-key"]
    : ["bun", fileURLToPath(import.meta.url), "--emit-injected-key"];
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: cleanEnv,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail("Infisical retrieval failed; check login, project binding, and secret availability");
  }
  const key = result.stdout.replace(/\r?\n$/, "");
  if (!key || !key.trim() || /[\r\n]/.test(key)) {
    fail("secret output was empty or contained unexpected extra lines");
  }
  process.stdout.write(`${key}\n`);
}
