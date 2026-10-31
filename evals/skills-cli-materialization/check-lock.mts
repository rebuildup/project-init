#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateLock(source: unknown, names: readonly string[]): number {
  if (!isRecord(source) || !isRecord(source.skills)) {
    throw new Error('lock skills must be a JSON object');
  }
  const skills = source.skills;
  const wanted = new Set(names);
  if (wanted.size !== names.length || Object.keys(skills).length !== wanted.size ||
      Object.keys(skills).some(name => !wanted.has(name))) {
    throw new Error('lock entries do not match materialized skills');
  }
  for (const name of wanted) {
    const entry = skills[name];
    if (!isRecord(entry)) throw new Error(name + ': lock entry is not a JSON object');
    for (const field of ['source', 'skillPath', 'computedHash']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(name + ': lock ' + field + ' missing or empty');
      }
    }
  }
  return wanted.size;
}

function main(args: string[]): number {
  const [path, ...names] = args;
  if (!path) {
    console.error('usage: check-lock.mts skills-lock.json <skill-name>...');
    return 2;
  }
  try {
    const source: unknown = JSON.parse(readFileSync(path, 'utf8'));
    console.log(validateLock(source, names));
    return 0;
  } catch (error) {
    console.error(String(error));
    return 1;
  }
}

if (process.argv[1]?.endsWith('check-lock.mts')) {
  process.exitCode = main(process.argv.slice(2));
}
