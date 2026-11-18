#!/usr/bin/env -S bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// Defaults to the project-init checkout; downstream projects can point the same
// check at their own root, e.g. VENDORED_SKILLS_ROOT=/path/to/project bun vendored-skills-contract.mts
const root = resolve(process.env.VENDORED_SKILLS_ROOT ?? resolve(import.meta.dirname, '../..'));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// skills-lock.json version 1: sha256 over each file's relative path and content,
// sorted by path case-insensitively, concatenated without separators.
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

function folderHashV1(directory: string): string {
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

// skills-lock.json version 2 (skills CLI >= 1.9): mirrors the CLI's
// hashSkillFiles — excludes metadata.json and cache dirs, resolves symlinks
// only inside the skill root, normalizes CRLF, sorts paths byte-wise, and
// frames each entry as path NUL length NUL content.
const V2_EXCLUDE_FILES = new Set(['metadata.json']);
const V2_EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

interface V2File { path: string; content: Buffer }

function v2Excluded(name: string, isDirectory: boolean): boolean {
  return V2_EXCLUDE_FILES.has(name) || (isDirectory && V2_EXCLUDE_DIRS.has(name));
}

function v2Normalize(content: Buffer): Buffer {
  if (content.includes(0) || !content.includes('\r\n')) return content;
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

function v2Collect(dir: string, prefix: string, rootDir: string, out: V2File[]): void {
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    if (v2Excluded(entry.name, entry.isDirectory())) continue;
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const full = join(dir, prefix, entry.name);
    if (entry.isDirectory()) {
      v2Collect(dir, relative, rootDir, out);
    } else if (entry.isSymbolicLink()) {
      try {
        const target = realpathSync(full);
        if (target !== rootDir && !target.startsWith(rootDir + sep)) continue;
        const st = statSync(target);
        if (st.isDirectory() && v2Excluded(entry.name, true)) continue;
        if (st.isDirectory()) v2Collect(dir, relative, rootDir, out);
        else if (st.isFile()) out.push({ path: relative, content: v2Normalize(readFileSync(target)) });
      } catch { /* dangling symlink: skip like the CLI */ }
    } else if (entry.isFile()) {
      out.push({ path: relative, content: v2Normalize(readFileSync(full)) });
    }
  }
}

function folderHashV2(directory: string): string {
  const skillRoot = realpathSync(directory);
  const files: V2File[] = [];
  v2Collect(directory, '', skillRoot, files);
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const sha = createHash('sha256');
  for (const file of files) {
    sha.update(Buffer.from(file.path, 'utf8'));
    sha.update('\0');
    sha.update(String(file.content.length));
    sha.update('\0');
    sha.update(file.content);
  }
  return sha.digest('hex');
}

function validate(): void {
  const lockPath = join(root, 'skills-lock.json');
  const json: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (!isRecord(json) || !isRecord(json.skills)) throw new Error('invalid skills-lock.json');
  const lockVersion = typeof json.version === 'number' ? json.version : 1;
  const folderHash = lockVersion >= 2 ? folderHashV2 : folderHashV1;
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
