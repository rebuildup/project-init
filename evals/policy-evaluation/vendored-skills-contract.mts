#!/usr/bin/env -S bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function walk(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...walk(directory, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export function folderHash(directory: string): string {
  const files = walk(directory).sort((a, b) => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const sha = createHash('sha256');
  for (const relative of files) {
    sha.update(relative);
    sha.update(readFileSync(join(directory, relative)));
  }
  return sha.digest('hex');
}

function validate(): void {
  const lockPath = join(root, 'skills-lock.json');
  const json: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (!isRecord(json) || !isRecord(json.skills)) throw new Error('invalid skills-lock.json');
  for (const [name, value] of Object.entries(json.skills)) {
    if (!isRecord(value) || typeof value.computedHash !== 'string') {
      throw new Error(name + ': invalid skills-lock.json hash');
    }
    const dirs = ['.claude/skills', '.agents/skills'].map(p => join(root, p, name));
    const directory = dirs.find(p => existsSync(join(p, 'SKILL.md')) && statSync(join(p, 'SKILL.md')).isFile());
    if (!directory) throw new Error(name + ' is in skills-lock.json but its files are not committed');
    if (folderHash(directory) !== value.computedHash) {
      throw new Error(name + " differs from skills-lock.json; update it with 'bunx skills update' instead of editing the copy");
    }
    if (existsSync(join(root, 'skills', name))) {
      throw new Error(name + ' is both vendored and published from skills/');
    }
  }
}

try {
  validate();
  console.log('vendored-skills-contract: PASS');
} catch (error) {
  console.error('vendored-skills-contract: FAIL: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
