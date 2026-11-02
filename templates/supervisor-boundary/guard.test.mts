import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { brokerAllowlist, guardDecision, isAllowed } from './guard.mts';
import { materialize } from './materialize.mts';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'guard.mts');

function invoke(input: string, broker: string | undefined = undefined) {
  const env = {...process.env};
  delete env.SUPERVISOR_BROKER_TOOLS;
  if (broker !== undefined) env.SUPERVISOR_BROKER_TOOLS = broker;
  return spawnSync(process.execPath, [script], {encoding: 'utf8', input, env});
}

test('default Supervisor allows only observational read tools', () => {
  const allowed = new Set(['Read', 'Glob', 'Grep', 'ToolSearch']);
  for (const tool_name of allowed) {
    assert.equal(guardDecision({tool_name}, new Set()), null);
    const result = invoke(JSON.stringify({tool_name}));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  }
  for (const tool_name of [
    'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell',
    'Agent', 'Task', 'mcp__github__create_file', 'mcp__herdr__pane_run', 'Unknown'
  ]) {
    const result = invoke(JSON.stringify({tool_name}));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(isAllowed(tool_name, new Set()), false);
  }
});

test('exact broker capability permits only specified MCP tools', () => {
  const name = 'mcp__trusted-broker__spawn_worker';
  const allow = JSON.stringify([name]);
  assert.deepEqual([...brokerAllowlist(allow)], [name]);
  assert.equal(invoke(JSON.stringify({tool_name:name}), allow).stdout, '');
  const unknown = invoke(JSON.stringify({tool_name:'mcp__trusted-broker__shell_exec'}), allow);
  assert.equal(JSON.parse(unknown.stdout).hookSpecificOutput.permissionDecision, 'deny');
  for (const invalid of [
    '["Bash"]', '["mcp__trusted-broker__*"]', '["mcp__x__y","mcp__x__y"]', '{}', 'not JSON'
  ]) {
    assert.equal(invoke(JSON.stringify({tool_name:'Read'}), invalid).status, 2);
  }
});

test('malformed payloads and excessive input fail closed', () => {
  for (const input of ['', '{', '{}', '[]', '{"tool_name":null}', '{"tool_name":""}']) {
    assert.equal(invoke(input).status, 2);
  }
  assert.equal(invoke(JSON.stringify({tool_name:'Read', padding:'x'.repeat(1024*1024)})).status, 2);
});

test('materialization is dedicated and idempotent, preserving existing settings', () => {
  const supervisor = mkdtempSync(join(tmpdir(), 'supervisor-only-'));
  const worker = mkdtempSync(join(tmpdir(), 'worker-only-'));
  try {
    mkdirSync(join(supervisor, '.claude'));
    writeFileSync(join(supervisor,'.claude/settings.json'),JSON.stringify({
      permissions: {allow:['Read'], deny:['Bash']},
      hooks: {PreToolUse:[{matcher:'Agent|Task',hooks:[{type:'command',command:'echo no'}]}]}
    }));
    const changed = materialize(supervisor);
    assert.ok(changed.includes('scripts/supervisor-boundary/guard.mts'));
    assert.equal(materialize(supervisor).length,0);
    const settings = JSON.parse(readFileSync(join(supervisor,'.claude/settings.json'),'utf8'));
    assert.ok(settings.permissions.deny.includes('Write'));
    assert.ok(settings.permissions.deny.includes('Bash'));
    assert.deepEqual(settings.permissions.allow,['Read']);
    assert.equal(settings.hooks.PreToolUse.length,2);
    assert.equal(settings.hooks.PreToolUse[1].matcher,'*');
    assert.equal(settings.hooks.PreToolUse[1].hooks[0].onFailure,'block');
    assert.equal(existsSync(join(worker,'.claude/settings.json')),false);
    assert.equal(existsSync(join(worker,'scripts/supervisor-boundary/guard.mts')),false);
  } finally {
    rmSync(supervisor,{recursive:true,force:true});
    rmSync(worker,{recursive:true,force:true});
  }
});

test('materialization checks conflicts without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'supervisor-boundary-'));
  try {
    assert.ok(materialize(root,true).length>0);
    assert.equal(existsSync(join(root,'.claude')),false);
    materialize(root);
    const guard = join(root, 'scripts/supervisor-boundary/guard.mts');
    writeFileSync(guard, '// custom modification');
    assert.throws(()=>materialize(root), /locally modified guard/);
    assert.equal(readFileSync(guard,'utf8'), '// custom modification');
    writeFileSync(guard, readFileSync(script,'utf8'));
    const settingsPath = join(root,'.claude/settings.json');
    const settings = JSON.parse(readFileSync(settingsPath,'utf8'));
    settings.hooks.PreToolUse[0].hooks[0].onFailure='continue';
    writeFileSync(settingsPath,JSON.stringify(settings));
    assert.throws(()=>materialize(root), /hook differs/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
