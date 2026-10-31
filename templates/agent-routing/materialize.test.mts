import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialize } from './materialize.mts';

test('install is idempotent, preserves project settings and custom routes',()=>{
  const project=mkdtempSync(join(tmpdir(),'routing-materialize-'));
  try {
    mkdirSync(join(project,'.claude'));
    writeFileSync(join(project,'AGENTS.md'),'# Existing rules\n');
    writeFileSync(join(project,'.claude/settings.json'),JSON.stringify({permissions:{allow:['Read']},hooks:{PreToolUse:[]}}));
    const first=materialize(project,true);
    assert.ok(first.changed.includes('scripts/agent-routing/dispatch.mts'));
    assert.match(readFileSync(join(project,'AGENTS.md'),'utf8'),/# Existing rules/);
    const settings=JSON.parse(readFileSync(join(project,'.claude/settings.json'),'utf8'));
    assert.deepEqual(settings.permissions,{allow:['Read']});
    assert.equal(settings.hooks.PreToolUse.length,1);
    assert.deepEqual(materialize(project,true).changed,[]);
    writeFileSync(join(project,'scripts/agent-routing/agent-routing.json'),'{"roles":{}}\n');
    assert.deepEqual(materialize(project,true,true).changed,[]);
  } finally {rmSync(project,{recursive:true,force:true});}
});
test('modified managed scripts and overlapping hooks fail closed',()=>{
  const project=mkdtempSync(join(tmpdir(),'routing-materialize-'));
  try {
    materialize(project);
    const path=join(project,'scripts/agent-routing/dispatch.mts');
    writeFileSync(path,'// customized');
    assert.throws(()=>materialize(project),/local customization/);
    assert.equal(readFileSync(path,'utf8'),'// customized');
    writeFileSync(path,readFileSync(join(import.meta.dirname,'dispatch.mts'),'utf8'));
    mkdirSync(join(project,'.claude'));
    writeFileSync(join(project,'.claude/settings.json'),JSON.stringify({hooks:{
      PreToolUse:[{matcher:'Agent|Task',hooks:[{type:'command',command:'echo other'}]}]}}));
    assert.throws(()=>materialize(project,true),/hook differs/);
  } finally {rmSync(project,{recursive:true,force:true});}
});
test('check mode does not write any files',()=>{
  const project=mkdtempSync(join(tmpdir(),'routing-materialize-'));
  try {
    assert.ok(materialize(project,false,true).changed.length>0);
    assert.equal(readFileSync(join(import.meta.dirname,'agent-routing.example.json'),'utf8').length>0,true);
    assert.ok(!readFileSync(join(project,'not-created.txt'),'utf8'));
  } catch(error) {
    if(!(error instanceof Error)||!error.message.includes('ENOENT')) throw error;
  } finally {rmSync(project,{recursive:true,force:true});}
});
