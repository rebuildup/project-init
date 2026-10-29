#!/usr/bin/env node
// Strict project-local delegation entrypoint. No implicit provider or harness fallback.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPlacement } from './layout.mjs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const ROUTE = /^[a-z][a-z0-9-]*$/;
const PANE = /^[\w:-]+$/;
const MAX_TIMEOUT = 300000;
export function discoverProjectRoot(cwd) {
  const run=spawnSync('git',['-C',cwd,'rev-parse','--path-format=absolute','--git-common-dir'],
    {encoding:'utf8',timeout:10000});
  if (run.status!==0) return cwd; // Non-Git workspace: cwd is the explicit project identity.
  const common=resolve(run.stdout.trim());
  if (basename(common)!=='.git') fail('nonstandard Git common directory; specify --project-root');
  return dirname(common); // Main checkout for linked Worktrunk/Git worktrees.
}
async function locked(root, fn) {
  const id=createHash('sha256').update(root).digest('hex').slice(0,24);
  const lock=join(tmpdir(),'project-init-herdr-'+id+'.lock');
  let fd;
  try { fd=openSync(lock,'wx',0o600); }
  catch (e) {
    if(e.code==='EEXIST') fail('concurrent or stale layout lock; inspect existing attempts before retry: '+lock);
    throw e;
  }
  try { return await fn(); }
  finally { closeSync(fd); unlinkSync(lock); }
}
function fail(message) { throw new Error(message); }
function call(binary, args, json = false) {
  const out = spawnSync(binary, args, { encoding: 'utf8', shell: false, timeout: MAX_TIMEOUT });
  if (out.error || out.status !== 0) fail(binary + ' ' + (args[0] ?? '') + ': ' + (out.error?.message ?? out.stderr?.trim() ?? 'command failed'));
  if (!json) return out.stdout.trim();
  try { return JSON.parse(out.stdout); } catch { fail(binary + ': malformed JSON response'); }
}
export function resolveRoute(config, role) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('invalid routing config');
  if (typeof role !== 'string' || !NAME.test(role)) fail('invalid role');
  if (!config.roles || !Object.hasOwn(config.roles, role)) fail('role not configured: ' + role);
  const selected = config.roles[role];
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) fail('invalid role route');
  if (selected.supervisor !== 'herdr') fail('unsupported supervisor; no native fallback');
  if (typeof selected.harness !== 'string' || !ROUTE.test(selected.harness)) fail('invalid harness');
  if (typeof selected.provider !== 'string' || !ROUTE.test(selected.provider)) fail('invalid provider');
  if (selected.fallback !== 'none') fail('implicit fallback prohibited');
  if (selected.nativeSubagents !== 'deny') fail('native subagent substitution not permitted');
  if (Object.hasOwn(selected, 'model')) fail('model selection belongs to dotfiles agent launcher');
  return {role, supervisor:'herdr', harness:selected.harness, provider:selected.provider,
    fallback:'none', nativeSubagents:'deny'};
}
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['plan','start','prompt','read'].includes(command)) fail('usage: dispatch.mjs <plan|start|prompt|read> --config FILE [--role ROLE] [--cwd PATH] [--name NAME] [--target PANE] [--message-file FILE]');
  const opts = {command};
  const allowed = new Set(['config','role','cwd','name','target','message-file','project-root','workspace-id']);
  if (rest.length % 2) fail('flag missing value');
  for (let i=0;i<rest.length;i+=2) {
    const flag=rest[i];
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2)) || !rest[i+1] || Object.hasOwn(opts,flag.slice(2))) fail('invalid/duplicate option: '+flag);
    opts[flag.slice(2)]=rest[i+1];
  }
  if (!opts.config) fail('--config required');
  if (['plan','start'].includes(command) && !opts.role) fail('--role required');
  if (command==='start' && (!opts.cwd || !opts.name)) fail('--cwd and --name required');
  if (command==='prompt' && (!opts.target || !opts['message-file'])) fail('--target and --message-file required');
  if (command==='read' && !opts.target) fail('--target required');
  if (opts.target && !PANE.test(opts.target)) fail('invalid pane target');
  if (opts.name && !NAME.test(opts.name)) fail('invalid agent name');
  if (opts['workspace-id'] && !PANE.test(opts['workspace-id'])) fail('invalid workspace id');
  return opts;
}
export async function run(argv) {
  const args=parseArgs(argv);
  const config=JSON.parse(readFileSync(resolve(args.config),'utf8'));
  if (args.command==='plan') return resolveRoute(config,args.role);
  if (args.command==='start') {
    const route=resolveRoute(config,args.role);
    const cwd=resolve(args.cwd);
    const projectRoot=resolve(args['project-root'] ?? discoverProjectRoot(cwd));
    if (!existsSync(cwd) || !existsSync(projectRoot)) fail('workspace/project root does not exist');
    const functionName=config.roles[args.role].function ?? args.role;
    return locked(projectRoot, async () => {
      call('agent',['check']);
      const snapshot=call('herdr',['api','snapshot'],true);
      const decision=planPlacement(snapshot,{
        layout:config.layout, functionName, cwd, projectRoot,
        name:args.name,workspaceId:args['workspace-id'],
      });
      if (decision.action==='blocked' || decision.action==='queued') {
        fail(decision.action + ': ' + decision.reason);
      }
      let pane;
      let workspace=decision.workspace;
      if (decision.action==='create-workspace') {
        const ws=call('herdr',['workspace','create','--cwd',projectRoot,
          '--label',decision.workspaceLabel,'--no-focus'],true);
        workspace=ws?.result?.workspace?.workspace_id;
        const controlTab=ws?.result?.tab?.tab_id;
        const controlPane=ws?.result?.root_pane?.pane_id;
        if (!workspace || !controlTab || !controlPane) fail('created workspace IDs unavailable; reconcile before retry');
        // Keep an anchored project-root shell, so project identity survives worker cwd changes.
        call('herdr',['tab','rename',controlTab,'Ctrl']);
        if (decision.tabLabel==='Ctrl') {
          if (cwd!==projectRoot) fail('Ctrl actor requires cwd=projectRoot on initial workspace');
          pane=controlPane;
        } else {
          const tab=call('herdr',['tab','create','--workspace',workspace,'--cwd',cwd,
            '--label',decision.tabLabel,'--no-focus'],true);
          pane=tab?.result?.root_pane?.pane_id;
        }
      } else if (decision.action==='create-tab') {
        const tab=call('herdr',['tab','create','--workspace',workspace,'--cwd',cwd,
          '--label',decision.tabLabel,'--no-focus'],true);
        pane=tab?.result?.root_pane?.pane_id;
      } else if (decision.action==='split-pane') {
        const split=call('herdr',['pane','split',decision.targetPane,'--direction',
          decision.direction,'--cwd',cwd,'--no-focus'],true);
        pane=split?.result?.pane?.pane_id;
      }
      if (typeof pane!=='string'||!PANE.test(pane)) fail('layout changed but pane ID unavailable; reconcile before retry');
      // Provider-scoped command; never switch to herdr agent start --kind.
      call('herdr',['pane','run',pane,'agent '+route.harness+' '+route.provider]);
      for(let i=0;i<16;i++){
        await new Promise(ok=>setTimeout(ok,750));
        const probe=spawnSync('herdr',['agent','get',pane],{encoding:'utf8',timeout:20000});
        if (probe.status!==0) continue;
        let found;
        try { found=JSON.parse(probe.stdout); } catch { fail('Herdr returned malformed agent state'); }
        if (!found?.result?.agent) continue;
        call('herdr',['agent','rename',pane,args.name]);
        return {...route,workspace,pane,agent:args.name,detected:true,placement:decision};
      }
      fail('pane '+pane+' started but no detectable agent; inspect pane before retry');
    });
  }
  if (args.command==='prompt'){
    const message=readFileSync(resolve(args['message-file']),'utf8');
    if (!message.trim()) fail('message file empty');
    return {response:call('herdr',['agent','prompt',args.target,message,'--wait','--timeout','120000'],true)};
  }
  return {output:call('herdr',['agent','read',args.target,'--source','recent-unwrapped','--lines','120'])};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value,null,2)),error=>{
    console.error('agent-routing: '+error.message);
    process.exitCode=1;
  });
}
