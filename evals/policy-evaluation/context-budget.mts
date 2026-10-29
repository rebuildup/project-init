#!/usr/bin/env -S bun
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const baselinePath = join(import.meta.dirname, 'context-budget-baseline.tsv');
const rootFiles = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];
type Kind = 'root' | 'skill' | 'always_on_total';
interface Row { kind: Kind; path: string; bytes: number; }

function exists(path: string): boolean {
  return existsSync(join(root, path));
}
function bytes(path: string): number {
  return exists(path) ? readFileSync(join(root, path)).byteLength : 0;
}
function words(path: string): number {
  if (!exists(path)) return 0;
  const value = readFileSync(join(root, path), 'utf8').trim();
  return value ? value.split(/\s+/u).length : 0;
}
function alwaysOnBytes(): number { return rootFiles.reduce((sum, path) => sum + bytes(path), 0); }
function alwaysOnWords(): number { return rootFiles.reduce((sum, path) => sum + words(path), 0); }

export function snapshot(): Row[] {
  const rows: Row[] = rootFiles.filter(exists).map(path => ({ kind: 'root', path, bytes: bytes(path) }));
  rows.push({ kind: 'always_on_total', path: '__always_on_total__', bytes: alwaysOnBytes() });
  const skillsDirectory = join(root, 'skills');
  if (existsSync(skillsDirectory)) {
    for (const skill of readdirSync(skillsDirectory, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const path = 'skills/' + skill.name + '/SKILL.md';
      if (exists(path) && statSync(join(root, path)).isFile()) {
        rows.push({ kind: 'skill', path, bytes: bytes(path) });
      }
    }
  }
  const roots = rows.filter(row => row.kind !== 'skill');
  const skills = rows.filter(row => row.kind === 'skill').sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return [...roots, ...skills];
}

const header = 'status\tkind\tpath\tbaseline_bytes\tcurrent_bytes\tdelta_bytes\tlimit_bytes\tcurrent_words\ttoken_estimate';
function show(...cells: Array<string | number>): void { console.log(cells.join('\t')); }
function key(row: Pick<Row, 'kind' | 'path'>): string { return row.kind + '\0' + row.path; }
function parseBaseline(content: string): Row[] {
  const rows = content.split(/\r?\n/);
  if (rows.at(-1) === '') rows.pop();
  return rows.slice(1).map(line => {
    const [kind, path, raw] = line.split('\t');
    const value = Number(raw);
    if (!['root', 'skill', 'always_on_total'].includes(kind) ||
        typeof path !== 'string' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error('invalid context budget baseline: ' + line);
    }
    return { kind: kind as Kind, path, bytes: value };
  });
}

function main(): number {
  const current = snapshot();
  if (process.argv[2] === '--snapshot') {
    console.log('kind\tpath\tbytes');
    for (const row of current) show(row.kind, row.path, row.bytes);
    return 0;
  }
  console.log(header);
  if (!existsSync(baselinePath)) {
    show('FAIL', 'baseline', baselinePath, 0, 0, 0, 0, 0, 0);
    return 1;
  }
  let base: Row[];
  try { base = parseBaseline(readFileSync(baselinePath, 'utf8')); }
  catch (error) { console.error(String(error)); return 1; }
  const currentByKey = new Map(current.map(row => [key(row), row] as const));
  const baseByKey = new Set(base.map(key));
  let failed = false;
  for (const row of base) {
    const actual = currentByKey.get(key(row));
    const baseBytes = row.bytes;
    if (actual) {
      const limit = baseBytes + Math.max(512, Math.ceil(baseBytes * 0.1));
      const delta = actual.bytes - baseBytes;
      const wordCount = row.kind === 'always_on_total' ? alwaysOnWords() : words(row.path);
      const tokens = Math.ceil(actual.bytes / 4);
      const status = actual.bytes > limit ? 'FAIL' : 'PASS';
      if (status === 'FAIL') failed = true;
      show(status, row.kind, row.path, baseBytes, actual.bytes, delta, limit, wordCount, tokens);
    } else if (row.kind === 'root' || baseBytes > 0) {
      const wordCount = row.kind === 'always_on_total' ? alwaysOnWords() : 0;
      show('DELETED', row.kind, row.path, baseBytes, 0, -baseBytes, baseBytes, wordCount, 0);
      failed = true;
    } else {
      show('PASS', row.kind, row.path, 0, 0, 0, 0, row.kind === 'always_on_total' ? alwaysOnWords() : 0, 0);
    }
  }
  for (const row of current) {
    if (baseByKey.has(key(row))) continue;
    const wordCount = row.kind === 'always_on_total' ? alwaysOnWords() : words(row.path);
    show('UNBASELINED', row.kind, row.path, 0, row.bytes, row.bytes, 0, wordCount, Math.ceil(row.bytes / 4));
    failed = true;
  }
  return failed ? 1 : 0;
}

try { process.exitCode = main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
