#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface RecordContract {
  heading: string;
  required: Array<[label: string, line: string]>;
  forbid: Array<[label: string, pattern: string]>;
  order: boolean;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function gradeRecords(raw: string, contract: RecordContract): string[] {
  const out: string[] = [];
  const normalized = raw.replace(/\r/g, '');
  const lines = normalized ? normalized.split('\n') : [];
  if (normalized.endsWith('\n')) lines.pop();
  const trailingBlank = Number(lines.at(-1) === '');
  let hits = 0, misses = 0, violations = 0, invalid = 0, duplicates = 0, orderErrors = 0;
  out.push(contract.heading + ':');
  for (const [label, value] of contract.required) {
    if (lines.includes(value)) { hits++; out.push('  hit   ' + label); }
    else { misses++; out.push('  MISS  ' + label); }
  }
  out.push('must-nots:');
  for (const [label, pattern] of contract.forbid) {
    if (new RegExp(pattern, 'm').test(normalized)) {
      violations++;
      out.push('  VIOL  ' + label);
    } else out.push('  clean ' + label);
  }
  const expected = contract.required.map(([, value]) => value);
  const allowed = new Set(expected);
  out.push('schema:');
  for (const line of lines) {
    if (!allowed.has(line)) { invalid++; out.push('  INVALID record: ' + line); }
  }
  for (const value of expected) {
    if (lines.filter(line => line === value).length > 1) {
      duplicates++;
      out.push('  DUPLICATE record: ' + value);
    }
  }
  if (contract.order) {
    out.push('ordering:');
    for (const [i, actual] of lines.entries()) {
      const target = expected[i];
      if (target && actual === target) out.push('  ord ' + (i + 1) + ' ok: ' + actual);
      else if (target) { orderErrors++; out.push('  OUT-OF-ORDER line ' + (i + 1) + ': got ' + actual + ' expected ' + target); }
      else out.push('  ord ' + (i + 1) + ' extra: ' + actual);
    }
  }
  out.push('');
  out.push('hits: ' + hits + '   misses: ' + misses +
    '   violations: ' + violations + '   lines: ' + lines.length +
    '   invalid: ' + invalid + '   duplicates: ' + duplicates +
    (contract.order ? '   out_of_order: ' + orderErrors + '   trailing_blank: ' + trailingBlank : ''));
  const passed = hits === expected.length && misses === 0 && violations === 0 &&
    lines.length === expected.length && invalid === 0 && duplicates === 0 &&
    (!contract.order || (orderErrors === 0 && trailingBlank === 0));
  out.push(passed ? 'EVAL PASS' : 'EVAL FAIL');
  return out;
}
function main(args: string[]): number {
  const [name, path] = args;
  if (!name || !path) { console.error('usage: record-grader.mts <contract> <answer-file>'); return 2; }
  try {
    const all: unknown = JSON.parse(readFileSync(join(import.meta.dirname, 'record-contracts.json'), 'utf8'));
    if (!isRecord(all) || !isRecord(all[name])) throw new Error('Unknown record contract: ' + name);
    const contract = all[name] as unknown as RecordContract;
    if (!Array.isArray(contract.required) || !Array.isArray(contract.forbid)) throw new Error('Invalid record contract');
    const lines = gradeRecords(readFileSync(path, 'utf8'), contract);
    for (const line of lines) console.log(line);
    return lines.at(-1) === 'EVAL PASS' ? 0 : 1;
  } catch (error) {
    console.error('Invalid input: ' + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}
if (process.argv[1]?.endsWith('record-grader.mts')) process.exitCode = main(process.argv.slice(2));
