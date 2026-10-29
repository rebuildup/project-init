import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeSnapshot, resolveLayout, planPlacement } from './layout.mjs';

const root='/work/project';
const worker='/work/project-wt/134';
const opts={functionName:'implementation',cwd:worker,projectRoot:root,name:'impl134',layout:{}};
const empty={result:{workspaces:[],tabs:[],panes:[],agents:[]}};
const active={result:{
  workspaces:[{workspace_id:'w1',label:'project'}],
  tabs:[{tab_id:'w1:t1',workspace_id:'w1',label:'Ctrl',pane_count:1},
        {tab_id:'w1:t2',workspace_id:'w1',label:'Work',pane_count:2}],
  panes:[{pane_id:'w1:p1',tab_id:'w1:t1',workspace_id:'w1',cwd:root},
         {pane_id:'w1:p2',tab_id:'w1:t2',workspace_id:'w1',cwd:worker},
         {pane_id:'w1:p3',tab_id:'w1:t2',workspace_id:'w1',cwd:'/work/project-wt/133'}],
  agents:[{name:'impl133',pane_id:'w1:p3'}],
}};
const clone=x=>structuredClone(x);
test('first worker plans one project workspace, not an attempt-scoped workspace',()=>{
  assert.deepEqual(planPlacement(empty,opts),{action:'create-workspace',workspaceLabel:'project',
    tabLabel:'Work',cwd:worker,projectRoot:root,function:'implement'});
});
test('subsequent worker reuses same workspace and Work tab',()=>{
  const p=planPlacement(active,opts);
  assert.equal(p.action,'split-pane'); assert.equal(p.workspace,'w1');
  assert.equal(p.tab,'w1:t2');assert.equal(p.targetPane,'w1:p3');
});
test('capacity queues instead of creating unbounded tabs by default',()=>{
  const s=clone(active);
  for(let i=4;i<=5;i++)s.result.panes.push({pane_id:'w1:p'+i,tab_id:'w1:t2',workspace_id:'w1',cwd:worker});
  s.result.tabs[1].pane_count=4;
  const p=planPlacement(s,opts);
  assert.equal(p.action,'queued');
});
test('bounded overflow creates Work2 only when explicitly enabled',()=>{
  const s=clone(active);
  for(let i=4;i<=5;i++)s.result.panes.push({pane_id:'w1:p'+i,tab_id:'w1:t2',workspace_id:'w1',cwd:worker});
  s.result.tabs[1].pane_count=4;
  const o={...opts,layout:{overflow:'new-tab',maxTabsPerLane:2}};
  assert.equal(planPlacement(s,o).tabLabel,'Work2');
  s.result.tabs.push({tab_id:'w1:t3',workspace_id:'w1',label:'Work2',pane_count:4});
  for(let i=6;i<=9;i++)s.result.panes.push({pane_id:'w1:p'+i,tab_id:'w1:t3',workspace_id:'w1',cwd:worker});
  assert.equal(planPlacement(s,o).action,'queued');
});
test('function and presentation are separate: Review/Refactor/Recover map without tab explosion',()=>{
  assert.equal(resolveLayout({},'review').tabLabel,'Work');
  assert.equal(resolveLayout({},'refactor').tabLabel,'Work');
  assert.equal(resolveLayout({},'recover').tabLabel,'Ctrl');
  assert.equal(resolveLayout({},'verify').tabLabel,'Work');
  assert.equal(resolveLayout({functionTabs:{review:'Review',verify:'Test'}},'review').tabLabel,'Review');
});
test('duplicate agent names never silently reassign old attempt',()=>{
  const p=planPlacement(active,{...opts,name:'impl133'});
  assert.equal(p.action,'blocked');
});
test('ambiguous identical project roots and labels fail closed',()=>{
  const s=clone(active);s.result.workspaces.push({workspace_id:'w2',label:'project'});
  s.result.panes.push({pane_id:'w2:p1',workspace_id:'w2',tab_id:'w2:t1',cwd:root});
  assert.equal(planPlacement(s,opts).action,'blocked');
  const noPath=clone(empty);noPath.result.workspaces.push({workspace_id:'w2',label:'project'});
  assert.equal(planPlacement(noPath,opts).action,'blocked');
});
test('existing user pane cannot be taken over as a worker',()=>{
  const p=planPlacement(active,opts);
  assert.equal(p.action,'split-pane'); // must materialize a new pane, never pane run on the target.
});
test('missing or inconsistent state does not create additional layout',()=>{
  assert.throws(()=>normalizeSnapshot({result:{tabs:[],panes:[],agents:[]}}),/workspaces/);
  const s=clone(active);s.result.tabs[1].pane_count=1;
  assert.equal(planPlacement(s,opts).action,'blocked');
});
test('unknown functions and unsafe configuration fail closed',()=>{
  assert.throws(()=>resolveLayout({},'arbitrary'),/unknown execution function/);
  assert.throws(()=>resolveLayout({preferredPanesPerTab:8},'review'),/1..6/);
  assert.throws(()=>resolveLayout({functionTabs:{review:'../../../'}},'review'),/invalid tab label/);
});
test('explicit workspace selection does not infer other workspace authority from UI position',()=>{
  const selected=planPlacement(active,{...opts,workspaceId:'w1',functionName:'recovery'});
  assert.equal(selected.function,'recover');
  assert.equal(selected.action,'split-pane'); // Ctrl has one anchored shell.
});
