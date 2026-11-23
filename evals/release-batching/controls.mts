#!/usr/bin/env -S bun
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface BatchingControlCase {
  readonly label: string;
  readonly expected: 'PASS' | 'FAIL';
  readonly expectedViolations?: readonly string[];
}

const root = resolve(import.meta.dirname, '../..');
const fixtureDir = join(root, 'evals/release-batching/fixtures');
const grader = join(import.meta.dirname, 'grade.mts');
let failed = false;

const cases: readonly BatchingControlCase[] = [
  { label: 'positive-weekly-hold', expected: 'PASS' },
  { label: 'positive-frozen-candidate', expected: 'PASS' },
  { label: 'positive-authorized-release', expected: 'PASS' },
  { label: 'positive-blocked-unknown', expected: 'PASS' },
  { label: 'positive-discovery-separated', expected: 'PASS' },
  {
    label: 'negative-weekly-auto-merge',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL release merge requires a verified candidate',
      'VIOL release merge requires explicit authorization for current candidate SHA',
    ],
  },
  {
    label: 'negative-counts-only',
    expected: 'FAIL',
    expectedViolations: ['VIOL candidate requires substantive non-count evidence'],
  },
  {
    label: 'negative-mutable-ref',
    expected: 'FAIL',
    expectedViolations: ['VIOL freeze requires an immutable candidate SHA'],
  },
  {
    label: 'negative-stale-validation',
    expected: 'FAIL',
    expectedViolations: ['VIOL verified requires a passed gate for current candidate SHA'],
  },
  {
    label: 'negative-freeze-ticket-landing',
    expected: 'FAIL',
    expectedViolations: ['VIOL candidate freeze forbids unrelated ticket landing'],
  },
  {
    label: 'negative-unadmitted-candidate',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL candidate requires admitted scope',
      'VIOL candidate scope must be selected',
    ],
  },
  {
    label: 'negative-unconfirmed-requirement',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL critical-path item #203 failed admission criterion: requirement_confirmed',
    ],
  },
  {
    label: 'negative-unreproduced-bug',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL critical-path item #204 failed admission criterion: bug_reproduced_or_pinpointed',
    ],
  },
  {
    label: 'negative-bug-not-applicable-evasion',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL critical-path bug item #207 cannot use not-applicable for bug_reproduced_or_pinpointed',
    ],
  },
  {
    label: 'negative-calendar-only-promotion',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL calendar target alone cannot admit critical-path item #208',
    ],
  },
  {
    label: 'negative-zero-critical-path-items',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL candidate with admission_items requires at least one critical-path item',
    ],
  },
  {
    label: 'negative-invalid-admission-schema',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL promoted_by_calendar_only must be a boolean',
      'VIOL admission_items[0] requires a non-empty id',
      'VIOL admission item #0 promoted_by_calendar_only must be a boolean',
    ],
  },
  {
    label: 'negative-unapproved-release',
    expected: 'FAIL',
    expectedViolations: [
      'VIOL release merge requires explicit authorization for current candidate SHA',
    ],
  },
];

for (const testCase of cases) {
  const result = spawnSync(
    process.execPath,
    [grader, join(fixtureDir, testCase.label + '.json')],
    { encoding: 'utf8' },
  );
  const output = (result.stdout || '') + (result.stderr || '');
  const lines = output.trimEnd().split('\n');
  const verdict = lines.at(-1) ?? '';
  const violLines = lines.filter((line) => line.startsWith('VIOL '));

  let valid = false;
  let mismatchDetail = '';
  if (testCase.expected === 'PASS') {
    valid = result.status === 0 && verdict === 'EVAL PASS' && violLines.length === 0;
  } else {
    const expectedViolations = testCase.expectedViolations ?? [];
    const exactMatch =
      violLines.length === expectedViolations.length &&
      expectedViolations.every((expectedLine) => violLines.includes(expectedLine));
    valid = result.status !== 0 && verdict === 'EVAL FAIL' && exactMatch;
    if (!exactMatch) {
      mismatchDetail =
        'expected VIOLs: ' +
        JSON.stringify(expectedViolations) +
        '; actual VIOLs: ' +
        JSON.stringify(violLines);
    }
  }

  if (valid) {
    console.log('  ok  ' + testCase.label.padEnd(36) + ' -> ' + verdict);
  } else {
    console.error(
      '  FAIL ' +
        testCase.label.padEnd(36) +
        ' -> ' +
        verdict +
        ' (exit ' +
        String(result.status) +
        '; expected ' +
        testCase.expected +
        ')',
    );
    if (mismatchDetail) console.error('       ' + mismatchDetail);
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
  ['skills/github-delivery/references/adaptive-release-batching.md', '## 1.5 Release scope admission gate'],
  ['skills/github-delivery/references/adaptive-release-batching.md', '`critical-path` / `research-discovery` / `backlog`'],
  ['skills/github-delivery/references/adaptive-release-batching.md', '`requirement_confirmed`'],
  ['skills/github-delivery/references/adaptive-release-batching.md', '`bug_reproduced_or_pinpointed`'],
  ['skills/agent-delivery-estimation/SKILL.md', 'release scope admission gate'],
  ['skills/agent-delivery-estimation/SKILL.md', '`critical-path`'],
  ['skills/agent-delivery-estimation/SKILL.md', '`research-discovery`'],
  ['skills/agent-delivery-estimation/SKILL.md', '`backlog`'],
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
