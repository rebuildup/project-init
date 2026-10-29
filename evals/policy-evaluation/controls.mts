#!/usr/bin/env -S bun
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runControls } from '../shared/controls.mts';

const dir = import.meta.dirname;
let failed = false;

if (runControls(dir, '../shared/record-grader.mts', [
  ['negative control', 'fixtures/negative.txt', 'FAIL'],
  ['regression control', 'fixtures/regression.txt', 'FAIL'],
  ['positive control', 'fixtures/positive.txt', 'PASS'],
], 'EVAL', ['grade']) !== 0) failed = true;

if (runControls(dir, '../shared/record-grader.mts', [
  ['merge auth negative', 'fixtures/merge-authorization-negative.txt', 'FAIL'],
  ['merge auth regression', 'fixtures/merge-authorization-regression.txt', 'FAIL'],
  ['merge auth stack scope', 'fixtures/merge-authorization-stack-scope-regression.txt', 'FAIL'],
  ['merge auth positive', 'fixtures/merge-authorization-positive.txt', 'PASS'],
], 'EVAL', ['merge-authorization-grade']) !== 0) failed = true;

const contracts: ReadonlyArray<readonly [label: string, command: 'bun' | 'bash', path: string, args: string[]]> = [
  ['merge method contract', 'bun', 'text-contracts.mts', ['merge-method-contract']],
  ['Cloudflare CLI contract', 'bun', 'text-contracts.mts', ['cloudflare-cli-contract']],
  ['worktree lifecycle contract', 'bash', 'worktree-lifecycle-contract.sh', []],
  ['vendored skills contract', 'bun', 'vendored-skills-contract.mts', []],
  ['skill catalog contract', 'bun', 'skill-catalog-contract.mts', []],
  ['context budget regression', 'bun', 'context-budget.mts', []],
  ['Herdr orchestration contract', 'bun', 'text-contracts.mts', ['herdr-orchestration-contract']],
  ['constitutional refinement controls', 'bun', 'constitutional-refinement-controls.mts', []],
];
for (const [label, interpreter, path, args] of contracts) {
  const cmd = interpreter === 'bun' ? process.execPath : 'bash';
  const result = spawnSync(cmd, [join(dir, path), ...args], { encoding: 'utf8' });
  if (result.status === 0) console.log('  ok   ' + label.padEnd(34) + ' -> PASS');
  else {
    console.error('  FAIL ' + label.padEnd(34) + ' -> FAIL');
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    failed = true;
  }
}
console.log(failed ? 'CONTROLS BROKEN: eval scores are not trustworthy' : 'controls OK: grader discriminates');
process.exitCode = failed ? 1 : 0;
