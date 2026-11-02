#!/usr/bin/env node
// Install ONLY in a dedicated Supervisor checkout, never in a Worker checkout.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const DENIED = ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task'];
const HOOK = {matcher: '*', hooks: [{
  type: 'command', command: 'node',
  args: ['${CLAUDE_PROJECT_DIR}/scripts/supervisor-boundary/guard.mts'],
  onFailure: 'block'
}]};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function read(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  if (lstatSync(path).isSymbolicLink()) throw new Error('symlink destination: ' + path);
  return readFileSync(path, 'utf8');
}
function checkParent(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error('symlink parent: ' + path);
}

export function materialize(targetPath: string, check = false): string[] {
  const root = realpathSync(resolve(targetPath));
  checkParent(join(root, 'scripts'));
  checkParent(join(root, 'scripts/supervisor-boundary'));
  checkParent(join(root, '.claude'));
  const scriptPath = join(root, 'scripts/supervisor-boundary/guard.mts');
  const manifestPath = join(root, 'scripts/supervisor-boundary/.guard-sha256');
  const settingsPath = join(root, '.claude/settings.json');
  const source = readFileSync(join(here, 'guard.mts'), 'utf8');
  const old = read(scriptPath);
  const previous = read(manifestPath);
  if (old !== undefined && old !== source && previous?.trim() !== sha(old))
    throw new Error('locally modified guard: reconcile manually');
  const raw = read(settingsPath);
  const settings: unknown = raw === undefined ? {} : JSON.parse(raw);
  if (!record(settings)) throw new Error('invalid Claude settings');
  const permissions = settings.permissions ?? {};
  const hooks = settings.hooks ?? {};
  if (!record(permissions) || !record(hooks)) throw new Error('invalid settings sections');
  const originalDeny = permissions.deny ?? [];
  const originalHooks = hooks.PreToolUse ?? [];
  if (!Array.isArray(originalDeny) || originalDeny.some(v => typeof v !== 'string') ||
      !Array.isArray(originalHooks)) throw new Error('invalid permission or hook arrays');
  const hook = JSON.stringify(HOOK);
  const related = originalHooks.filter(v => record(v) && v.matcher === '*'
    && Array.isArray(v.hooks) && v.hooks.some((h: unknown) =>
      record(h) && h.command === 'node' &&
      Array.isArray(h.args) && h.args.some((arg: unknown) =>
        typeof arg === 'string' && arg.includes('supervisor-boundary/guard.mts'))));
  if (related.some(v => JSON.stringify(v) !== hook))
    throw new Error('existing supervisor guard hook differs; reconcile manually');
  const next = {
    ...settings,
    permissions: {...permissions, deny: [...new Set([...originalDeny, ...DENIED])]},
    hooks: {...hooks, PreToolUse: related.length ? originalHooks : [...originalHooks, HOOK]}
  };
  const desiredSettings = JSON.stringify(next, null, 2) + '\n';
  const writes = new Map<string,string>();
  if (old !== source) writes.set(scriptPath, source);
  if (previous !== sha(source) + '\n') writes.set(manifestPath, sha(source) + '\n');
  if (raw !== desiredSettings) writes.set(settingsPath, desiredSettings);
  if (!check) for (const [path, value] of writes) {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, value, {mode: 0o600});
  }
  return [...writes.keys()].map(p => p.slice(root.length + 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (!(args.length === 2 || args.length === 3) ||
        args[0] !== '--target' || (args.length === 3 && args[2] !== '--check'))
      throw new Error('usage: materialize.mts --target SUPERVISOR_CHECKOUT [--check]');
    const check = args[2] === '--check';
    process.stdout.write(JSON.stringify({check, changed: materialize(args[1], check)}) + '\n');
  } catch (error) {
    process.stderr.write('supervisor materialization: ' +
      (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
