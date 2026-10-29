#!/usr/bin/env -S bun
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const own = 'rebuildup/project-init';
function fail(message: string): never { throw new Error(message); }
function lines(path: string): string[][] {
  const rows = readFileSync(join(root, path), 'utf8').split(/\r?\n/);
  if (rows.at(-1) === '') rows.pop();
  return rows.map(row => row.split('\t'));
}
function validate(): void {
  const capabilities = lines('catalog/capabilities.tsv');
  const candidates = lines('catalog/candidates.tsv');
  if (capabilities[0]?.join('\t') !== 'capability\tscope\tneeded_when\tdescription') fail('capabilities.tsv header changed');
  if (candidates[0]?.join('\t') !==
    'skill\tsource\tpath\tcapability\tstatus\tinvocation\tlicense\treview_depth\treviewed_rev\treviewed_on\treason') {
    fail('candidates.tsv header changed');
  }
  const errors: string[] = [];
  const scopes = new Map<string, string>();
  const always = new Set<string>();
  const owner = new Map<string, string>();
  const defaults = new Set<string>();
  const listed = new Set<string>();
  for (const [i, cols] of capabilities.entries()) {
    if (i === 0) continue;
    const [cap, scope, needed] = cols;
    const where = 'capabilities.tsv line ' + (i + 1) + ': ';
    if (cols.length !== 4) errors.push(where + 'expected 4 fields, got ' + cols.length);
    if (scope !== 'single' && scope !== 'multi') errors.push(where + 'unknown scope ' + scope);
    if (scopes.has(cap)) errors.push(where + 'duplicate capability ' + cap);
    scopes.set(cap, scope);
    if (needed === 'always') always.add(cap);
  }
  if (errors.length) fail(errors.join('\n'));
  for (const [i, cols] of candidates.entries()) {
    if (i === 0) continue;
    const [skill, source, path, capability, status, invocation, , depth, rev, date, reason] = cols;
    const where = 'candidates.tsv line ' + (i + 1) + ': ';
    if (cols.length !== 11) { errors.push(where + 'expected 11 fields, got ' + cols.length); continue; }
    if (!scopes.has(capability)) errors.push(where + 'unknown capability ' + capability);
    if (!['default', 'alternative', 'reference', 'watch', 'excluded'].includes(status)) errors.push(where + 'unknown status ' + status);
    if (!['auto', 'manual'].includes(invocation)) errors.push(where + 'unknown invocation ' + invocation);
    if (!['listed', 'skimmed', 'read', 'evaluated'].includes(depth)) errors.push(where + 'unknown review_depth ' + depth);
    if (!rev) errors.push(where + 'empty reviewed_rev');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(where + 'reviewed_on is not YYYY-MM-DD');
    if (!reason) errors.push(where + 'empty reason');
    if (status === 'default') {
      if (skill === '*') errors.push(where + 'a package-wide record cannot be default');
      if (capability === 'routing') errors.push(where + 'routing belongs to the root contract, not an installed Skill');
      defaults.add(capability);
      if (scopes.get(capability) === 'single') {
        if (owner.has(capability)) errors.push(where + 'second default for single-owner capability ' + capability + ' (already ' + owner.get(capability) + ')');
        owner.set(capability, skill + ' from ' + source);
      }
    }
    if (source === own) {
      if (!existsSync(join(root, path))) errors.push('candidates.tsv points at missing in-repo Skill: ' + path);
      listed.add(skill);
    }
  }
  for (const cap of always) if (cap !== 'routing' && !defaults.has(cap)) errors.push('capability ' + cap + ' is needed always but has no default');
  for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
    if (entry.isDirectory() && !listed.has(entry.name)) errors.push('in-repo Skill ' + entry.name + ' has no candidates.tsv record');
  }
  if (!readFileSync(join(root, 'PROMPT.ja.md'), 'utf8').includes(String.fromCharCode(96) + 'skill-selection' + String.fromCharCode(96))) {
    errors.push('PROMPT.ja.md does not route to skill-selection');
  }
  if (errors.length) fail(errors.join('\n'));
}
try {
  validate();
  console.log('skill-catalog-contract: PASS');
} catch (error) {
  console.error('skill-catalog-contract: FAIL: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
