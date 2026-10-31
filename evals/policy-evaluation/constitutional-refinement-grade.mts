#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';

const expected = [
  'layer=practice',
  'decision=candidate-refinement',
  'constitutional=identity,evidence,mutable-ownership,continuity',
  'evidence=implementation-conformance-required',
  'worktrunk=replaceable-not-invariant',
  'delivery.ticket_branch=preserve',
  'delivery.draft_pr=preserve',
  'delivery.draft_release_pr=preserve',
  'durable_update=practice-profile-adr',
  'risk=surface-unknowns',
];
const forbidden = [
  'worktrunk=mandatory',
  'evidence=constitution-proves-runtime',
  'delivery.ticket_branch=drop',
  'delivery.draft_pr=drop',
  'delivery.draft_release_pr=drop',
  'durable_update=none',
];

export function grade(raw: string): string[] {
  const text = raw.replace(/\r(?=\n|$)/g, '');
  const actual = text ? text.split('\n') : [];
  if (text.endsWith('\n')) actual.pop();
  const diagnostics: string[] = [];
  let fail = false;
  if (actual.length !== expected.length) {
    diagnostics.push('INVALID line-count=' + actual.length + ' expected=' + expected.length);
    fail = true;
  }
  for (const [i, record] of expected.entries()) {
    const got = actual[i] || '<missing>';
    if (got === record) diagnostics.push('  hit   ' + String(i + 1).padStart(2, '0') + ' ' + record);
    else { diagnostics.push('  MISS  ' + String(i + 1).padStart(2, '0') + ' got=' + got + ' expected=' + record); fail = true; }
  }
  for (const record of forbidden) {
    if (actual.includes(record)) { diagnostics.push('  VIOL  ' + record); fail = true; }
  }
  diagnostics.push(fail ? 'EVAL FAIL' : 'EVAL PASS');
  return diagnostics;
}
if (process.argv[1]?.endsWith('constitutional-refinement-grade.mts')) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: constitutional-refinement-grade.mts /path/to/answer.txt');
    process.exitCode = 1;
  } else {
    try {
      const output = grade(readFileSync(path, 'utf8'));
      for (const line of output) console.log(line);
      process.exitCode = output.at(-1) === 'EVAL PASS' ? 0 : 1;
    } catch (error) {
      console.error('no answer file at ' + path + ' ' + String(error));
      process.exitCode = 1;
    }
  }
}
