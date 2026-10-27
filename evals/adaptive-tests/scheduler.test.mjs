import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scheduler = resolve(import.meta.dirname, '../../templates/quality/adaptive-tests.mjs');
function fixture(t, allowDefer = true) {
  const dir = mkdtempSync(join(tmpdir(), 'adaptive-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  mkdirSync(join(dir, '.tmp'));
  writeFileSync(join(dir, '.gitignore'), '.tmp/\n');
  writeFileSync(join(dir, 'src.txt'), 'v1');
  writeFileSync(join(dir, 'runner.cjs'), "const fs = require('node:fs'); fs.appendFileSync('.tmp/runs','x'); if (fs.existsSync('.tmp/fail')) process.exit(9);");
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: 1, checks: [{ id: 'unit', command: [process.execPath, 'runner.cjs'], inputs: ['src.txt', 'runner.cjs', 'config.json'], maxInterval: 8, required: false, allowDefer }] }));
  execFileSync('git', ['add', '.gitignore', 'src.txt', 'runner.cjs', 'config.json'], { cwd: dir });
  function call(extra = [], env = {}) {
    return spawnSync(process.execPath, [scheduler, '--config', 'config.json', '--check', 'unit', '--context', 'worker', '--environment', 'dev', '--state', '.tmp/adaptive-tests/state.json', ...extra], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '', ...env } });
  }
  const count = () => { try { return readFileSync(join(dir, '.tmp/runs'), 'utf8').length; } catch { return 0; } };
  return { dir, call, count };
}

test('success interval increases, deferred is not a passed test, and force executes', t => {
  const f = fixture(t);
  assert.equal(f.call().status, 0);
  assert.equal(f.call().status, 0);
  const skipped = f.call();
  assert.equal(skipped.status, 78);
  assert.match(skipped.stdout, /NOT VERIFIED/);
  assert.equal(f.count(), 2);
  assert.equal(f.call().status, 0);
  assert.equal(f.call(['--force']).status, 0);
  assert.equal(f.count(), 4);
});

test('input changes cause execution, failures reset, and corrupt state fails open', t => {
  const f = fixture(t);
  f.call(); f.call();
  assert.equal(f.call().status, 78);
  writeFileSync(join(f.dir, 'src.txt'), 'v2');
  assert.equal(f.call().status, 0);
  writeFileSync(join(f.dir, '.tmp/fail'), '1');
  assert.equal(f.call().status, 9);
  rmSync(join(f.dir, '.tmp/fail'));
  assert.equal(f.call().status, 0);
  writeFileSync(join(f.dir, '.tmp/adaptive-tests/state.json'), '{broken');
  assert.equal(f.call().status, 0);
  assert.equal(f.count(), 6);
});

test('CI and integration bypass deferral; opt-out executes every time', t => {
  const f = fixture(t);
  f.call(); f.call();
  assert.equal(f.call([], { CI: 'true' }).status, 0);
  assert.equal(f.call(['--context', 'integration']).status, 0);
  assert.equal(f.call(['--environment', 'new-env']).status, 0);
  assert.equal(f.count(), 5);
  const g = fixture(t, false);
  for (let i = 0; i < 4; i++) assert.equal(g.call().status, 0);
  assert.equal(g.count(), 4);
});

test('missing inputs cannot be cached', t => {
  const f = fixture(t);
  const config = JSON.parse(readFileSync(join(f.dir, 'config.json'), 'utf8'));
  config.checks[0].inputs = ['does-not-exist'];
  writeFileSync(join(f.dir, 'config.json'), JSON.stringify(config));
  for (let i = 0; i < 3; i++) assert.equal(f.call().status, 0);
  assert.equal(f.count(), 3);
});

test('adaptive workers must specify isolated state ownership', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [
    scheduler, '--config', 'config.json', '--check', 'unit',
    '--context', 'worker', '--environment', 'dev'
  ], { cwd: f.dir, encoding: 'utf8', env: { ...process.env, CI: '' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated --state path/);
  assert.equal(f.count(), 0);
  assert.equal(f.call().status, 0);
});

test('partial pathspec matches never permit deferral', t => {
  const f = fixture(t);
  const path = join(f.dir, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks[0].inputs = ['src.txt', 'tests/missing'];
  writeFileSync(path, JSON.stringify(config));
  for (let i = 0; i < 4; i++) assert.equal(f.call().status, 0);
  assert.equal(f.count(), 4);
});

test('deleted and ignored required inputs cannot be deferred', t => {
  const f = fixture(t);
  assert.equal(f.call().status, 0);
  assert.equal(f.call().status, 0);
  assert.equal(f.call().status, 78);
  rmSync(join(f.dir, 'src.txt'));
  for (let i = 0; i < 3; i++) assert.equal(f.call().status, 0);
  assert.equal(f.count(), 5);
  const g = fixture(t);
  const path = join(g.dir, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(join(g.dir, '.gitignore'), '.tmp/\nignored.txt\n');
  writeFileSync(join(g.dir, 'ignored.txt'), 'ignored');
  config.checks[0].inputs = ['src.txt', 'ignored.txt'];
  writeFileSync(path, JSON.stringify(config));
  for (let i = 0; i < 3; i++) assert.equal(g.call().status, 0);
  assert.equal(g.count(), 3);
});

test('existing directory and glob inputs are resolved per pathspec', t => {
  const f = fixture(t);
  mkdirSync(join(f.dir, 'tests'));
  writeFileSync(join(f.dir, 'tests', 'a.txt'), 'a');
  const path = join(f.dir, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks[0].inputs = ['tests', 'tests/*.txt', 'src.txt'];
  writeFileSync(path, JSON.stringify(config));
  assert.equal(f.call().status, 0);
  assert.equal(f.call().status, 0);
  assert.equal(f.call().status, 78);
  rmSync(join(f.dir, 'tests', 'a.txt'));
  assert.equal(f.call().status, 0);
  assert.equal(f.count(), 3);
});

test('required checks reject deferral even in worker context', t => {
  const f = fixture(t);
  const path = join(f.dir, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.checks[0].required = true;
  writeFileSync(path, JSON.stringify(config));
  const result = f.call();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required checks cannot allow deferral/);
  assert.equal(f.count(), 0);
});

test('array-shaped saved checks are discarded rather than reused', t => {
  const f = fixture(t);
  assert.equal(f.call().status, 0);
  const path = join(f.dir, '.tmp/adaptive-tests/state.json');
  writeFileSync(path, JSON.stringify({ version: 1, checks: [] }));
  assert.equal(f.call().status, 0);
  const repaired = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(Array.isArray(repaired.checks), false);
  assert.equal(f.count(), 2);
});

test('a failed forced check invalidates earlier deferred-success history', t => {
  const f = fixture(t);
  f.call(); f.call();
  writeFileSync(join(f.dir, '.tmp/fail'), '1');
  assert.equal(f.call(['--force']).status, 9);
  rmSync(join(f.dir, '.tmp/fail'));
  assert.equal(f.call().status, 0);
  assert.equal(f.count(), 4);
});

test('out-of-range state cannot indefinitely postpone verification', t => {
  const f = fixture(t);
  assert.equal(f.call().status, 0);
  assert.equal(f.call().status, 0);
  const path = join(f.dir, '.tmp/adaptive-tests/state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.checks.unit.remaining = 999;
  writeFileSync(path, JSON.stringify(state));
  assert.equal(f.call().status, 0);
  assert.equal(f.count(), 3);
});
