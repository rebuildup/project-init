import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = resolve('skills/system-quality/scripts/challenge.mts');
function fixture(check: string, patches = [{path:'source.txt', before:'valid', after:'invalid'}]) {
  const root = mkdtempSync(join(tmpdir(), 'quality-test-'));
  writeFileSync(join(root,'source.txt'), 'valid');
  writeFileSync(join(root,'check.mjs'), check);
  writeFileSync(join(root,'cases.json'), JSON.stringify({ command:[process.execPath,'check.mjs'], timeoutMs:2000,
    cases:[{id:'invalid-source', expect:'reject', diagnostic:'INVALID_SOURCE', patches}]}));
  return root;
}
function run(root: string) { return spawnSync(process.execPath,[runner,root,join(root,'cases.json')],{encoding:'utf8'}); }
const checker = `import {readFileSync} from 'node:fs'; if(readFileSync('source.txt','utf8')==='invalid'){console.error('INVALID_SOURCE');process.exitCode=1;}`;
test('executes a real rejection in a separate copy and leaves source unchanged',()=>{
 const root=fixture(checker); try {const r=run(root); assert.equal(r.status,0,r.stderr+r.stdout); assert.equal(readFileSync(join(root,'source.txt'),'utf8'),'valid');} finally {rmSync(root,{recursive:true,force:true});}
});
test('a surviving mutation fails the challenge',()=>{
 const root=fixture(''); try {const r=run(root); assert.equal(r.status,1); assert.match(r.stdout,/SURVIVED/);} finally {rmSync(root,{recursive:true,force:true});}
});
test('an unrelated crash is not a rejection',()=>{
 const root=fixture(`import {readFileSync} from 'node:fs'; if(readFileSync('source.txt','utf8')==='invalid') throw Error('crash');`);
 try {const r=run(root); assert.equal(r.status,1); assert.match(r.stdout,/ERROR/);} finally {rmSync(root,{recursive:true,force:true});}
});
test('a broken baseline cannot kill mutants',()=>{
 const root=fixture(`console.error('INVALID_SOURCE');process.exitCode=1;`);
 try {const r=run(root); assert.equal(r.status,1); assert.match(r.stdout,/BASELINE_FAILED/);} finally {rmSync(root,{recursive:true,force:true});}
});
test('patches outside the candidate are rejected',()=>{
 const root=fixture(checker,[{path:'../escape',before:'valid',after:'invalid'}]);
 try {const r=run(root); assert.equal(r.status,1); assert.match(r.stderr,/path/);} finally {rmSync(root,{recursive:true,force:true});}
});
test('empty cases cannot claim success',()=>{
 const root=fixture(checker); writeFileSync(join(root,'cases.json'),JSON.stringify({command:[process.execPath,'check.mjs'],timeoutMs:2000,cases:[]}));
 try {assert.equal(run(root).status,1);} finally {rmSync(root,{recursive:true,force:true});}
});
