#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';

const required: ReadonlyArray<readonly [label: string, record: string]> = [
  ['agent-owned edit stays agent-owned', 'A owner=agent lead=result user_action=none'],
  ['failed gate is operational and agent continues', 'B owner=agent lead=blocker error=operational next=agent-fix'],
  ['real deployment ambiguity asks one blocking question', 'C owner=user lead=decision user_action=one-question'],
  ['explicit detailed request preserves detail', 'D detail=preserve brevity=task-controlled'],
  ['unrelated tangent is deferred', 'E tangent=defer'],
  ['persistent PR prose routes through writing discipline', 'F route=writing-discipline'],
  ['time estimates require evidence', 'estimate=evidence-only'],
  ['completion reports verified outcome', 'completion=verified-outcome'],
];
const prohibited: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['no avoidable delegation', /^A owner=user|^B .*next=delegate-user/m],
  ['no ceremonial lead', /lead=ceremony/],
  ['no forced truncation', /^D detail=truncate|brevity=always-short/m],
  ['no tangent mixing', /^E tangent=mix-in$/m],
  ['no direct conversation copy into persistent prose', /^F route=direct-copy$/m],
  ['no fabricated mandatory estimate', /^estimate=always-give$/m],
  ['no activity-log completion', /^completion=activity-log$/m],
];

export function grade(raw: string): string[] {
  const output: string[] = [];
  const normalized = raw.replace(/\r/g, '');
  const records = normalized.split('\n');
  if (normalized.endsWith('\n')) records.pop();
  const trailingBlank = Number(records.at(-1) === '');
  const lineCount = records.length;
  const schema = new Set(required.map(([, record]) => record));
  let hits = 0;
  let misses = 0;
  let violations = 0;
  let invalid = 0;
  let duplicates = 0;
  output.push('interaction routing:');
  for (const [label, record] of required) {
    if (records.includes(record)) { output.push('  hit   ' + label); hits++; }
    else { output.push('  MISS  ' + label); misses++; }
  }
  output.push('must-nots:');
  for (const [label, pattern] of prohibited) {
    if (pattern.test(normalized)) { output.push('  VIOL  ' + label); violations++; }
    else output.push('  clean ' + label);
  }
  output.push('schema:');
  for (const record of records) {
    if (!schema.has(record)) { output.push('  INVALID record: ' + record); invalid++; }
  }
  for (const [, record] of required) {
    if (records.filter(line => line === record).length > 1) {
      output.push('  DUPLICATE record: ' + record);
      duplicates++;
    }
  }
  output.push('');
  output.push('hits: ' + hits + '   misses: ' + misses +
    '   violations: ' + violations + '   lines: ' + lineCount +
    '   invalid: ' + invalid + '   duplicates: ' + duplicates +
    '   trailing_blank: ' + trailingBlank);
  const passed = hits === 8 && misses === 0 && violations === 0 &&
    lineCount - trailingBlank === 8 && trailingBlank === 0 && invalid === 0 && duplicates === 0;
  output.push(passed ? 'EVAL PASS' : 'EVAL FAIL');
  return output;
}

if (process.argv[1]?.endsWith('grade.mts')) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: grade.mts /path/to/answer.txt');
    process.exitCode = 1;
  } else {
    try {
      const lines = grade(readFileSync(path, 'utf8'));
      for (const line of lines) console.log(line);
      process.exitCode = lines.at(-1) === 'EVAL PASS' ? 0 : 1;
    } catch {
      console.error('no answer file at ' + path);
      process.exitCode = 1;
    }
  }
}
