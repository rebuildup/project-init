import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export type Expected = 'PASS' | 'FAIL';
export type ControlCase = readonly [label: string, fixture: string, expected: Expected];

export function runControls(
  directory: string,
  grader: string,
  cases: readonly ControlCase[],
  marker: 'EVAL' | 'PLAIN' = 'EVAL',
): number {
  let failures = 0;
  for (const [label, fixture, expected] of cases) {
    const result = spawnSync(process.execPath, [join(directory, grader), join(directory, fixture)], {
      encoding: 'utf8',
    });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const last = output.trimEnd().split('\n').at(-1) ?? '';
    const successMarker = marker === 'EVAL' ? 'EVAL PASS' : 'PASS';
    const failMarker = marker === 'EVAL' ? 'EVAL FAIL' : 'FAIL';
    const valid = expected === 'PASS'
      ? result.status === 0 && last === successMarker
      : result.status !== 0 && (marker === 'EVAL' ? last === failMarker : last === failMarker || last.startsWith('FAIL '));
    if (valid) {
      console.log('  ok   ' + label.padEnd(34) + ' -> ' + last);
    } else {
      console.error('  FAIL ' + label.padEnd(34) + ' -> ' + last +
        ' (wanted ' + expected + ', rc=' + String(result.status) + ')');
      console.error(output);
      failures++;
    }
  }
  console.log(failures ? 'CONTROLS BROKEN: eval scores are not trustworthy' : 'controls OK: grader discriminates');
  return failures ? 1 : 0;
}
