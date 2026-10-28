import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { resolveRoute, parseArgs } from './dispatch.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(readFileSync(join(here,'agent-routing.example.json'),'utf8'));
test('free review route stays free and excludes fallback',()=>{
  assert.deepEqual(resolveRoute(config,'review'),{role:'review',supervisor:'herdr',harness:'pi',provider:'openrouter-free',fallback:'none',nativeSubagents:'deny'});
});
test('implementation uses separately configured route',()=>{
  assert.equal(resolveRoute(config,'implementation').provider,'minimax');
});
test('unknown roles and native supervisor fail closed',()=>{
  assert.throws(()=>resolveRoute(config,'security'),/not configured/);
  assert.throws(()=>resolveRoute({roles:{review:{...config.roles.review,supervisor:'native'}}},'review'),/no native fallback/);
});
test('fallback, native substitution and model override are rejected',()=>{
  for(const patch of [{fallback:'minimax'},{nativeSubagents:'allow'},{model:'expensive'}])
    assert.throws(()=>resolveRoute({roles:{review:{...config.roles.review,...patch}}},'review'));
});
test('shell metacharacters cannot enter route names',()=>{
  assert.throws(()=>resolveRoute({roles:{review:{...config.roles.review,provider:'free; echo hello'}}},'review'),/invalid provider/);
});
test('command validation rejects unknown flags',()=>{
  assert.throws(()=>parseArgs(['start','--config','x','--role','review','--cwd','.']),/--name/);
  assert.throws(()=>parseArgs(['start','--config','x','--role','review','--cwd','.','--name','test','--model','paid']),/invalid/);
});
test('plan requires no installed agent/herdr binary',()=>{
  const child=spawnSync(process.execPath,[join(here,'dispatch.mjs'),'plan','--config',join(here,'agent-routing.example.json'),'--role','review'],{encoding:'utf8',env:{PATH:'/nonexistent'}});
  assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(child.stdout).provider,'openrouter-free');
});

test('native Claude Agent/Task tool invocations are rejected by hook',()=>{
  for (const tool_name of ['Agent','Task']) {
    const child=spawnSync(process.execPath,[join(here,'claude-guard.mjs')],{encoding:'utf8',input:JSON.stringify({tool_name})});
    assert.equal(child.status,0,child.stderr);
    assert.equal(JSON.parse(child.stdout).hookSpecificOutput.permissionDecision,'deny');
  }
  const allowed=spawnSync(process.execPath,[join(here,'claude-guard.mjs')],{encoding:'utf8',input:JSON.stringify({tool_name:'Read'})});
  assert.equal(allowed.status,0);
  assert.equal(allowed.stdout,'');
});
