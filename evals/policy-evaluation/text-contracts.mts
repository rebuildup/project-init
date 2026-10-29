#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Contract {
  contains: Array<[file: string, text: string]>;
  routes: Array<[file: string, first: string, ...fragments: string[]]>;
  forbid: Array<[file: string, pattern: string, flags: string, message: string]>;
  matches: Array<[file: string, pattern: string]>;
  files: string[];
}
const repoRoot = resolve(import.meta.dirname, '../..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function runContract(name: string): void {
  const all: unknown = JSON.parse(readFileSync(join(import.meta.dirname, 'text-contracts.json'), 'utf8'));
  if (!isRecord(all) || !isRecord(all[name])) throw new Error('Unknown contract: ' + name);
  const raw = all[name];
  if (!Array.isArray(raw.contains) || !Array.isArray(raw.routes) || !Array.isArray(raw.forbid) || !Array.isArray(raw.matches) || !Array.isArray(raw.files)) {
    throw new Error('Malformed contract specification: ' + name);
  }
  const contract = raw as unknown as Contract;
  const read = (file: string): string => readFileSync(join(repoRoot, file), 'utf8');

  for (const file of contract.files) read(file);
  for (const [file, pattern] of contract.matches) {
    if (!new RegExp(pattern).test(read(file))) throw new Error(file + ' missing pattern: ' + pattern);
  }
  for (const [file, needle] of contract.contains) {
    if (!read(file).includes(needle)) throw new Error(file + ' missing: ' + needle);
  }
  for (const [file, first, ...fragments] of contract.routes) {
    if (!read(file).split(/\r?\n/).some(line =>
      line.includes(first) && fragments.every(fragment => line.includes(fragment)))) {
      throw new Error(file + ' has no line routing this domain to: ' + fragments.join(' '));
    }
  }
  for (const [file, pattern, flags, message] of contract.forbid) {
    if (new RegExp(pattern, flags).test(read(file))) throw new Error(message);
  }
}

const name = process.argv[2];
if (!name) {
  console.error('usage: text-contracts.mts contract-name');
  process.exitCode = 2;
} else {
  try {
    runContract(name);
    console.log(name + ': PASS');
  } catch (error) {
    console.error(name + ': FAIL: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
