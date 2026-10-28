#!/usr/bin/env node
// Strict project-local delegation entrypoint. No implicit provider or harness fallback.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const ROUTE = /^[a-z][a-z0-9-]*$/;
const PANE = /^[\w:-]+$/;
const MAX_TIMEOUT = 300000;
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
  const allowed = new Set(['config','role','cwd','name','target','message-file']);
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
  return opts;
}
export async function run(argv) {
  const args=parseArgs(argv);
  const config=JSON.parse(readFileSync(resolve(args.config),'utf8'));
  if (args.command==='plan') return resolveRoute(config,args.role);
  if (args.command==='start') {
    const route=resolveRoute(config,args.role);
    const cwd=resolve(args.cwd);
    if (!existsSync(cwd)) fail('workspace does not exist: '+cwd);
    call('agent',['check']); // dotfiles launcher validates its canonical routing config.
    const ws=call('herdr',['workspace','create','--cwd',cwd,'--label',args.name,'--no-focus'],true);
    const pane=ws?.result?.root_pane?.pane_id;
    if (typeof pane!=='string'||!PANE.test(pane)) fail('workspace created but pane ID unavailable; reconcile before retry');
    // Do not use Herdr agent start --kind: it would bypass the provider-scoped launcher.
    // Strict bareword validation prevents shell metacharacters in the dispatched command.
    call('herdr',['pane','run',pane,'agent '+route.harness+' '+route.provider]);
    // pane.run acknowledgement is not proof of a working agent or the selected model.
    for(let i=0;i<16;i++){
      await new Promise(ok=>setTimeout(ok,750));
      const probe=spawnSync('herdr',['agent','get',pane],{encoding:'utf8',timeout:20000});
      if (probe.status!==0) continue;
      let found;
      try { found=JSON.parse(probe.stdout); } catch { fail('Herdr returned malformed agent state'); }
      if (!found?.result?.agent) continue;
      call('herdr',['agent','rename',pane,args.name]);
      return {...route,pane,workspace:ws.result.workspace?.workspace_id,agent:args.name,detected:true};
    }
    fail('pane '+pane+' started but no detectable agent; inspect pane before retry');
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
