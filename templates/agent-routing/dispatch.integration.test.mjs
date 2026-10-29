// Hermetic CLI integration: validates Herdr layout commands, not live provider identity.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const script=join(here,'dispatch.mjs');
const mockHerdr=[
  "import {appendFileSync,readFileSync} from 'node:fs';",
  "const a=process.argv.slice(2);",
  "appendFileSync(process.env.MOCK_LOG,JSON.stringify(a)+'\\n');",
  "const key=a[0]+' '+a[1];",
  "const snapshot=JSON.parse(readFileSync(process.env.MOCK_SNAPSHOT,'utf8'));",
  "const result=key==='api snapshot'?snapshot.result",
  "  :key==='workspace create'?{workspace:{workspace_id:'w1'},tab:{tab_id:'w1:t1'},root_pane:{pane_id:'w1:p1'}}",
  "  :key==='tab create'?{tab:{tab_id:'w1:t2'},root_pane:{pane_id:'w1:p2'}}",
  "  :key==='pane split'?{pane:{pane_id:'w1:p3'}}",
  "  :key==='agent get'?{agent:{name:'mock-agent',agent_status:'idle'}}",
  "  :{};",
  "console.log(JSON.stringify({result}));"
].join('\n');
function execute(existing) {
  const dir=mkdtempSync(join(tmpdir(),'herdr-route-'));
  const bin=join(dir,'bin');mkdirSync(bin);
  const root=join(dir,'project'),worker=join(dir,'worker');
  mkdirSync(root);mkdirSync(worker);
  const log=join(dir,'log'),snapFile=join(dir,'snapshot.json'),config=join(dir,'routes.json');
  const snapshot=existing?{result:{
    workspaces:[{workspace_id:'w1',label:'project'}],
    tabs:[{tab_id:'w1:t1',workspace_id:'w1',label:'Ctrl',pane_count:1},
      {tab_id:'w1:t2',workspace_id:'w1',label:'Work',pane_count:1}],
    panes:[{pane_id:'w1:p1',tab_id:'w1:t1',workspace_id:'w1',cwd:root},
      {pane_id:'w1:p2',tab_id:'w1:t2',workspace_id:'w1',cwd:worker}],
    agents:[{name:'previous',pane_id:'w1:p2'}],
  }}:{result:{workspaces:[],tabs:[],panes:[],agents:[]}};
  writeFileSync(log,'');writeFileSync(snapFile,JSON.stringify(snapshot));
  writeFileSync(config,JSON.stringify({roles:{implementation:{
    supervisor:'herdr',harness:'pi',provider:'minimax',fallback:'none',nativeSubagents:'deny',function:'implement'}},
    layout:{workspaceLabel:'project',preferredPanesPerTab:4,overflow:'queue'}}));
  writeFileSync(join(bin,'herdr'),'#!/usr/bin/env node\n'+mockHerdr+'\n',{mode:0o755});
  writeFileSync(join(bin,'agent'),'#!/usr/bin/env node\n'+
    "if(process.argv[2]!=='check')process.exit(9);\n",{mode:0o755});
  const result=spawnSync(process.execPath,[script,'start','--config',config,'--role','implementation',
    '--cwd',worker,'--project-root',root,'--name','impl134'],{
      encoding:'utf8',timeout:15000,
      env:{...process.env,PATH:bin+delimiter+process.env.PATH,MOCK_LOG:log,MOCK_SNAPSHOT:snapFile}
    });
  const commands=readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  rmSync(dir,{recursive:true,force:true});
  return {result,commands};
}
test('new project: one workspace and Ctrl anchor, new Work tab without focus steal',()=>{
  const {result,commands}=execute(false);
  assert.equal(result.status,0,result.stderr);
  assert.equal(commands.filter(c=>c[0]==='workspace'&&c[1]==='create').length,1);
  assert.deepEqual(commands.find(c=>c[0]==='tab'&&c[1]==='rename').slice(2),['w1:t1','Ctrl']);
  assert.equal(commands.filter(c=>c[0]==='tab'&&c[1]==='create').length,1);
  assert.deepEqual(commands.find(c=>c[0]==='pane'&&c[1]==='run').slice(2),['w1:p2','agent pi minimax']);
  assert.ok(!commands.some(c=>c.includes('--focus')));
});
test('existing project: a new split, never a new workspace/tab or overwritten live pane',()=>{
  const {result,commands}=execute(true);
  assert.equal(result.status,0,result.stderr);
  assert.equal(commands.filter(c=>c[0]==='workspace'&&c[1]==='create').length,0);
  assert.equal(commands.filter(c=>c[0]==='tab'&&c[1]==='create').length,0);
  assert.ok(commands.some(c=>c[0]==='pane'&&c[1]==='split'&&c[2]==='w1:p2'));
  assert.deepEqual(commands.find(c=>c[0]==='pane'&&c[1]==='run').slice(2),['w1:p3','agent pi minimax']);
});
