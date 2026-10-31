#!/usr/bin/env -S bun
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const fixtureDir = join(root, 'evals/release-batching/fixtures');
const grader = join(import.meta.dirname, 'grade.mts');
let failed = false;

const cases: ReadonlyArray<readonly [string, 'PASS' | 'FAIL']> = [
  ['positive-weekly-hold', 'PASS'],
  ['positive-frozen-candidate', 'PASS'],
  ['positive-authorized-release', 'PASS'],
  ['positive-blocked-unknown', 'PASS'],
  ['negative-weekly-auto-merge', 'FAIL'],
  ['negative-counts-only', 'FAIL'],
  ['negative-mutable-ref', 'FAIL'],
  ['negative-stale-validation', 'FAIL'],
  ['negative-freeze-ticket-landing', 'FAIL'],
  ['negative-unadmitted-candidate', 'FAIL'],
  ['negative-unapproved-release', 'FAIL'],
];

for (const [label, expected] of cases) {
  const result = spawnSync(process.execPath, [grader, join(fixtureDir, label + '.json')], { encoding: 'utf8' });
  const output = (result.stdout || '') + (result.stderr || '');
  const verdict = output.trimEnd().split('\n').at(-1) ?? '';
  const valid = expected === 'PASS'
    ? result.status === 0 && verdict === 'EVAL PASS'
    : result.status !== 0 && verdict === 'EVAL FAIL' && /^VIOL /m.test(output);
  if (valid) {
    console.log('  ok  ' + label.padEnd(34) + ' -> ' + verdict);
  } else {
    console.error('  FAIL ' + label.padEnd(34) + ' -> ' + verdict +
      ' (exit ' + String(result.status) + '; expected ' + expected + ')');
    console.error(output);
    failed = true;
  }
}

const required: ReadonlyArray<readonly [string, string]> = [
  ['organization/profiles/release-driven-solo.md', 'planning / review cadence: 1 week'],
  ['organization/profiles/release-driven-solo.md', 'release candidate freeze'],
  ['skills/github-delivery/SKILL.md', '## Weekly planning / adaptive release batching'],
  ['skills/github-delivery/SKILL.md', 'references/adaptive-release-batching.md'],
  ['skills/github-delivery/references/adaptive-release-batching.md', 'hold | candidate | blocked'],
  ['skills/linear-release-control/SKILL.md', 'release cadenceは可変'],
  ['docs/adr/ADR-0032.md', 'user authorization'],
];
for (const [path, text] of required) {
  let present = false;
  try {
    present = readFileSync(join(root, path), 'utf8').includes(text);
  } catch {
    // Missing source files must fail the contract.
  }
  if (!present) {
    console.error('  FAIL contract: ' + path + ' missing ' + text);
    failed = true;
  }
}

console.log(failed ? 'release-batching CONTROLS BROKEN' : 'release-batching controls OK');
process.exitCode = failed ? 1 : 0;
