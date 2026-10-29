#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';

const required = [
  'implementation_sot=github_issue',
  'dependency_sot=github_issue',
  'release_planning_control=linear_project',
  'mirror_all_github_issues=no',
  'default_linear_cycle=no',
  'implementation_worker_linear_access=none_or_readonly',
  'linear_coding_sessions_baseline=no',
  'linear_project_mapping=one_release_train',
];

export function grade(value: string): string {
  const lines = value.split('\n');
  if (value.endsWith('\n')) lines.pop();
  if (lines.length !== 8) return 'FAIL expected exactly 8 total lines, got ' + lines.length;
  if (lines.some(line => !/^[a-z_]+=/.test(line))) return 'FAIL answer contains non key=value lines';
  for (const expected of required) {
    if (!lines.includes(expected)) return 'FAIL missing-or-wrong: ' + expected;
  }
  return 'PASS';
}

if (process.argv[1]?.endsWith('grade.mts')) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: bun grade.mts <answer-file>');
    process.exitCode = 1;
  } else {
    try {
      const verdict = grade(readFileSync(path, 'utf8'));
      console.log(verdict);
      process.exitCode = verdict === 'PASS' ? 0 : 1;
    } catch {
      console.log('FAIL no answer file at ' + path);
      process.exitCode = 1;
    }
  }
}
