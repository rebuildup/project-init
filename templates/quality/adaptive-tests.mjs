#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 0 = executed and passed; 78 = deferred (not verified); any other code = failed.
const DEFERRED = 78;
const VERSION = 1;
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--force') options.force = true;
  else if (['--config', '--check', '--context', '--environment', '--state'].includes(key)) {
    if (!process.argv[i + 1]) throw new Error('Missing value for ' + key);
    options[key.slice(2)] = process.argv[++i];
  } else throw new Error('Unknown option: ' + key);
}
if (!options.config || !options.check) throw new Error('Usage: adaptive-tests.mjs --config FILE --check ID [--context worker|integration|release] [--environment ID] [--force] [--state FILE]');

const config = JSON.parse(readFileSync(resolve(options.config), 'utf8'));
if (config.version !== VERSION || !Array.isArray(config.checks)) throw new Error('Unsupported configuration');
const matches = config.checks.filter((c) => c.id === options.check);
if (matches.length !== 1) throw new Error('Check must exist exactly once');
const check = matches[0];
if (!Array.isArray(check.command) || check.command.length === 0 || check.command.some((s) => typeof s !== 'string' || !s)) throw new Error('Invalid command');
if (!Array.isArray(check.inputs) || check.inputs.length === 0 || check.inputs.some((s) => typeof s !== 'string' || !s)) throw new Error('Explicit Git input pathspecs required');
if (typeof check.required !== 'boolean') throw new Error('required must be explicitly true or false');
if (check.required && check.allowDefer === true) throw new Error('required checks cannot allow deferral');
if (check.allowDefer !== true && check.allowDefer !== false) throw new Error('allowDefer must be a boolean');
if (!Number.isInteger(check.maxInterval) || check.maxInterval < 1 || check.maxInterval > 64) throw new Error('maxInterval must be in [1, 64]');

const statePath = resolve(options.state || '.tmp/adaptive-tests/state.json');
const adaptive = check.allowDefer === true && options.context === 'worker' && Boolean(options.environment) && !options.force && !process.env.CI;
let fingerprint = null;
if (adaptive) {
  try {
    const matches = new Set();
    for (const input of check.inputs) {
      const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', input], { encoding: 'buffer' });
      const resolved = out.toString('utf8').split('\0').filter(Boolean);
      if (resolved.length === 0) throw new Error('Unresolved required input pathspec: ' + input);
      for (const file of resolved) matches.add(file);
    }
    const files = [...matches].sort();
    if (files.length > 0) {
      const digest = createHash('sha256');
      digest.update(JSON.stringify({ version: VERSION, command: check.command, inputs: check.inputs, environment: options.environment, platform: process.platform, arch: process.arch, runtime: process.version, bun: process.versions.bun || null }));
      for (const file of files) {
        digest.update(file).update('\0').update(readFileSync(file)).update('\0');
      }
      fingerprint = digest.digest('hex');
    }
  } catch {
    // Unknown inputs or unavailable Git are not permission to skip verification.
    fingerprint = null;
  }
}
let state = { version: VERSION, checks: {} };
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
try {
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  if (isRecord(saved) && saved.version === VERSION && isRecord(saved.checks)) state = saved;
} catch { /* Missing or corrupt state always forces execution. */ }
const previous = state.checks[check.id];
if (adaptive && fingerprint && previous?.fingerprint === fingerprint && previous?.passed === true &&
    Number.isInteger(previous.remaining) && previous.remaining > 1 && previous.remaining <= previous.interval &&
    Number.isInteger(previous.interval) && previous.interval >= 1 && previous.interval <= check.maxInterval) {
  previous.remaining -= 1;
  persist();
  console.log('[adaptive-test] DEFERRED ' + check.id + ' (next due in ' + previous.remaining + ' requests); NOT VERIFIED');
  process.exit(DEFERRED);
}

const reason = !adaptive ? 'required/forced/non-opt-in' : !fingerprint ? 'untrusted inputs' : previous?.fingerprint !== fingerprint ? 'inputs changed' : 'interval due or previous failure';
console.log('[adaptive-test] EXECUTE ' + check.id + ': ' + reason);
const run = spawnSync(check.command[0], check.command.slice(1), { stdio: 'inherit', shell: false });
const succeeded = !run.error && run.status === 0;
if (run.error) console.error('[adaptive-test] ' + run.error.message);
if (adaptive && fingerprint) {
  if (succeeded) {
    const interval = previous?.passed && previous.fingerprint === fingerprint &&
      Number.isInteger(previous.interval) && previous.interval >= 1 && previous.interval <= check.maxInterval
      ? Math.min(previous.interval * 2, check.maxInterval) : 1;
    state.checks[check.id] = { fingerprint, passed: true, interval, remaining: interval };
  } else state.checks[check.id] = { fingerprint, passed: false, interval: 1, remaining: 1 };
  persist();
} else if ((!succeeded || (adaptive && !fingerprint)) && Object.hasOwn(state.checks, check.id)) {
  // A failed or untrusted run invalidates reusable success history.
  delete state.checks[check.id];
  persist();
}
console.log('[adaptive-test] ' + (succeeded ? 'VERIFIED' : 'FAILED') + ' ' + check.id);
process.exit(succeeded ? 0 : (run.status && run.status !== DEFERRED ? run.status : 1));

function persist() {
  mkdirSync(dirname(statePath), { recursive: true });
  const temp = statePath + '.' + process.pid + '.tmp';
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n');
  renameSync(temp, statePath);
}
