import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planPlacement, resolveLayout } from './layout.mts';

test('canonical alias overrides and inconsistent later lane inventory', () => {
  assert.equal(resolveLayout({functionTabs:{implementation:'Impl'}},'implement').tabLabel,'Impl');
  const dir=mkdtempSync(join(tmpdir(),'herdr-realpath-'));
  try {
    const physical=join(dir,'source'),alias=join(dir,'alias');
    mkdirSync(physical); symlinkSync(physical,alias,'dir');
    const s={result:{
      workspaces:[{workspace_id:'w',label:'source'}],
      tabs:[{tab_id:'c',workspace_id:'w',label:'Ctrl',pane_count:1},
        {tab_id:'t1',workspace_id:'w',label:'Work',pane_count:1},
        {tab_id:'t2',workspace_id:'w',label:'Work2',pane_count:2}],
      panes:[{pane_id:'p0',workspace_id:'w',tab_id:'c',cwd:alias},
        {pane_id:'p1',workspace_id:'w',tab_id:'t1',cwd:physical},
        {pane_id:'p2',workspace_id:'w',tab_id:'t2',cwd:physical}],
      agents:[],
    }};
    const opts={functionName:'implement',cwd:physical,projectRoot:physical,name:'safe'};
    assert.equal(planPlacement(s,opts).action,'blocked');
    s.result.tabs[2].pane_count=1;
    assert.equal(planPlacement(s,opts).action,'split-pane');
    assert.throws(()=>resolveLayout({functionTabs:{review:'Build',verify:'Build2'}},'review'),/collides/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

const mockHerdr=[
  "import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';",
  "const args=process.argv.slice(2);",
  "appendFileSync(process.env.MOCK_LOG,JSON.stringify(args)+'\\n');",
  "const key=args.slice(0,2).join(' ');",
  "const snapshot=JSON.parse(readFileSync(process.env.MOCK_SNAPSHOT,'utf8'));",
  "if(key==='agent rename')writeFileSync(process.env.MOCK_NAME,args[3]);",
  "const result=key==='api snapshot'?snapshot.result",
  "  :key==='workspace create'?{workspace:{workspace_id:'w1'},tab:{tab_id:'w1:t1'},root_pane:{pane_id:'w1:p1'}}",
  "  :key==='tab create'?{tab:{tab_id:'w1:t2'},root_pane:{pane_id:'w1:p2'}}",
  "  :key==='pane split'?{pane:{pane_id:'w1:p3'}}",
  "  :key==='agent get'?{agent:{name:existsSync(process.env.MOCK_NAME)?readFileSync(process.env.MOCK_NAME,'utf8'):'detected',agent_id:existsSync(process.env.MOCK_INSTANCE)?readFileSync(process.env.MOCK_INSTANCE,'utf8'):'instance1'}}",
  "  :key==='agent prompt'?{accepted:true}:{};",
  "console.log(JSON.stringify({result}));",
].join('\n');
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'herdr-route-regression-'));
  const bin=join(dir,'bin'); mkdirSync(bin);
  const root=join(dir,'root'); mkdirSync(root);
  const log=join(dir,'log'); writeFileSync(log,'');
  const config=join(dir,'config.json'),msg=join(dir,'message.txt'),snapshot=join(dir,'snapshot.json');
  writeFileSync(msg,'test task');
  writeFileSync(snapshot,JSON.stringify({result:{workspaces:[],tabs:[],panes:[],agents:[]}}));
  const makeRole=(provider:string, fn:string)=>({supervisor:'herdr',harness:'pi',provider,fallback:'none',nativeSubagents:'deny',function:fn});
  writeFileSync(config,JSON.stringify({roles:{
    implementation:makeRole('minimax','implement'),
    review:makeRole('openrouter-free','review'),
    recovery:makeRole('minimax','recover'),
  },layout:{workspaceLabel:'root'}}));
  writeFileSync(join(bin,'herdr'),'#!/usr/bin/env node\n'+mockHerdr+'\n',{mode:0o755});
  writeFileSync(join(bin,'agent'),"#!/usr/bin/env node\nif(process.argv[2]==='check'&&process.env.MOCK_AGENT_FAIL==='1')process.exit(1);\n",{mode:0o755});
  const env={...process.env,PATH:bin+delimiter+process.env.PATH,MOCK_LOG:log,MOCK_SNAPSHOT:snapshot,MOCK_NAME:join(dir,'name'),MOCK_INSTANCE:join(dir,'instance')};
  const run=(cmd:string,flags:string[],additionalEnv:NodeJS.ProcessEnv={})=>
    spawnSync(process.execPath,[join(import.meta.dirname,'dispatch.mts'),cmd,'--config',config,...flags],
      {encoding:'utf8',timeout:20000,env:{...env,...additionalEnv}});
  const commands=():string[][]=>readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x) as string[]);
  return {dir,root,config,msg,bin,run,commands};
}

test('atomic reservation stops duplicate start; prompt/read require bound role and active agent',()=>{
  const f=fixture();
  try {
    const startFlags=['--role','implementation','--cwd',f.root,'--project-root',f.root,'--name','worker'];
    const first=f.run('start',startFlags);
    assert.equal(first.status,0,first.stderr);
    const pane=(JSON.parse(first.stdout) as {pane:string}).pane;
    assert.equal(pane,'w1:p2');
    const existingRuns=f.commands().filter(x=>x[0]==='pane'&&x[1]==='run').length;
    const second=f.run('start',startFlags);
    assert.notEqual(second.status,0);
    assert.match(second.stderr,/reserved/);
    assert.equal(f.commands().filter(x=>x[0]==='pane'&&x[1]==='run').length,existingRuns);
    const flags=['--role','implementation','--project-root',f.root,'--name','worker','--target',pane];
    assert.equal(f.run('prompt',[...flags,'--message-file',f.msg]).status,0);
    assert.equal(f.run('read',flags).status,0);
    const denied=f.run('prompt',['--role','review','--project-root',f.root,'--name','worker',
      '--target',pane,'--message-file',f.msg]);
    assert.notEqual(denied.status,0);
    assert.match(denied.stderr,/binding mismatch/);
    const unknown=f.run('read',['--role','implementation','--project-root',f.root,
      '--name','worker','--target','w1:p9']);
    assert.notEqual(unknown.status,0);
    assert.ok(!f.commands().some(x=>x[0]==='agent'&&x[1]==='prompt'&&x[2]==='w1:p9'));
    writeFileSync(join(f.dir,'instance'),'instance2');
    assert.match(f.run('read',flags).stderr,/agent instance changed/);
    writeFileSync(join(f.dir,'name'),'another');
    assert.match(f.run('read',flags).stderr,/no longer contains the bound live agent/);
  } finally {rmSync(f.dir,{recursive:true,force:true});}
});

test('Ctrl starts split pane without consuming anchor; failed launcher never creates a pane',()=>{
  const f=fixture();
  try {
    const bad=f.run('start',['--role','recovery','--cwd',f.root,'--project-root',f.root,'--name','broken'],{MOCK_AGENT_FAIL:'1'});
    assert.notEqual(bad.status,0);
    assert.equal(f.commands().length,0);
    const child=join(f.root,'subdir'); mkdirSync(child);
    const invalid=f.run('start',['--role','recovery','--cwd',child,'--project-root',f.root,'--name','recover']);
    assert.notEqual(invalid.status,0);
    assert.match(invalid.stderr,/Ctrl actor requires cwd=projectRoot/);
    assert.equal(f.commands().filter(c=>c[0]==='workspace'&&c[1]==='create').length,0);
    // The rejected request must not reserve its name.
    const good=f.run('start',['--role','recovery','--cwd',f.root,'--project-root',f.root,'--name','recover']);
    assert.equal(good.status,0,good.stderr);
    const commands=f.commands();
    assert.deepEqual(commands.find(x=>x[0]==='pane'&&x[1]==='split')?.slice(2),
      ['w1:p1','--direction','right','--cwd',f.root,'--no-focus']);
    assert.equal(commands.find(x=>x[0]==='pane'&&x[1]==='run')?.[2],'w1:p3');
  } finally {rmSync(f.dir,{recursive:true,force:true});}
});

test('non-repository Git errors fail closed instead of creating a second workspace',()=>{
  const f=fixture();
  try {
    writeFileSync(join(f.bin,'git'),"#!/usr/bin/env node\nconsole.error('fatal: unexpected discovery failure');process.exit(1);\n",{mode:0o755});
    const bad=f.run('start',['--role','implementation','--cwd',f.root,'--name','gitbad']);
    assert.notEqual(bad.status,0);
    assert.match(bad.stderr,/Git discovery failed/);
    assert.equal(f.commands().length,0);
  } finally {rmSync(f.dir,{recursive:true,force:true});}
});
