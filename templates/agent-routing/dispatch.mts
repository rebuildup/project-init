#!/usr/bin/env node
// Strict project-local delegation entrypoint. No implicit provider or harness fallback.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPlacement } from './layout.mts';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type CliResponse = { result?: {
  workspace?: { workspace_id?: string };
  tab?: { tab_id?: string; root_pane?: { pane_id?: string } };
  root_pane?: { pane_id?: string };
  pane?: { pane_id?: string };
  agent?: unknown;
} };
export interface Route {
  role: string; supervisor: 'herdr'; harness: string; provider: string;
  fallback: 'none'; nativeSubagents: 'deny';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const ROUTE = /^[a-z][a-z0-9-]*$/;
const PANE = /^[\w:-]+$/;
const MAX_TIMEOUT = 300000;
export function discoverProjectRoot(cwd: string): string {
  const run=spawnSync('git',['-C',cwd,'rev-parse','--path-format=absolute','--git-common-dir'],
    {encoding:'utf8',timeout:10000});
  if (run.error || run.signal) fail('Git discovery failed; supply --project-root explicitly');
  if (run.status!==0) {
    if (/not a git repository/i.test(run.stderr ?? '')) return cwd;
    fail('Git discovery failed; supply --project-root explicitly');
  }
  const common=resolve(run.stdout.trim());
  if (basename(common)!=='.git') fail('nonstandard Git common directory; specify --project-root');
  return dirname(common); // Main checkout for linked Worktrunk/Git worktrees.
}
interface AttemptBinding {
  status: 'pending' | 'active';
  role: string; provider: string; harness: string; routeHash: string;
  projectRoot: string; pane?: string; name: string; instance?: string;
}
const routeHash = (route: Route) => createHash('sha256').update(JSON.stringify(route)).digest('hex');
function bindingPath(root: string, name: string): string {
  const id=createHash('sha256').update(root).digest('hex').slice(0,24);
  const dir=join(tmpdir(), 'project-init-herdr-attempts-'+id);
  mkdirSync(dir,{recursive:true,mode:0o700});
  return join(dir,name+'.json');
}
function reserveAttempt(path: string, attempt: AttemptBinding): void {
  let fd: number;
  try { fd=openSync(path,'wx',0o600); }
  catch { fail('attempt name already reserved; inspect live Herdr state before retry: '+attempt.name); }
  try { writeFileSync(fd, JSON.stringify(attempt)+'\n'); } finally { closeSync(fd); }
}
function agentInstance(agent: Record<string,unknown>, pane: string): string {
  // Herdr schemas may expose different stable identity fields.
  for(const field of ['instance_id','agent_id','session_id']) {
    const id=agent[field];
    if((typeof id==='string' && id.length>0) || (typeof id==='number' && Number.isInteger(id)))
      return field+':'+String(id);
  }
  // When an agent ID is unavailable, a foreground process group can fence replacement.
  const info=call('herdr',['pane','process-info','--pane',pane],true);
  const state:unknown=info.result;
  if(isRecord(state)) {
    const pgid=state.foreground_pgid ?? state.foreground_process_group_id;
    if(typeof pgid==='number' && Number.isInteger(pgid) && pgid>0) return 'pgid:'+pgid;
    const procs=state.foreground_processes;
    if(Array.isArray(procs) && isRecord(procs[0]) && typeof procs[0].pid==='number')
      return 'pid:'+String(procs[0].pid);
  }
  fail('stable live agent identity not available; do not prompt unverified pane');
}
function verifyAttempt(args: Record<string,string>, route: Route): void {
  if (!args['project-root'] || !args.name) fail('--project-root and --name required for prompt/read');
  const root=realpathSync(resolve(args['project-root']));
  let attempt: AttemptBinding;
  try { attempt=JSON.parse(readFileSync(bindingPath(root,args.name),'utf8')) as AttemptBinding; }
  catch { fail('attempt binding unavailable; cannot dispatch to an untrusted pane'); }
  if (attempt.status!=='active' || attempt.projectRoot!==root || attempt.pane!==args.target ||
      attempt.name!==args.name || attempt.role!==route.role ||
      attempt.harness!==route.harness || attempt.provider!==route.provider ||
      attempt.routeHash!==routeHash(route)) fail('pane/role/provider binding mismatch; fail closed');
  const detected=call('herdr',['agent','get',args.target],true);
  const agent=detected?.result?.agent;
  if (!isRecord(agent) || (agent.name!==args.name && agent.agent_name!==args.name))
    fail('pane no longer contains the bound live agent; reconcile before prompting');
  if(!attempt.instance || agentInstance(agent,args.target)!==attempt.instance)
    fail('agent instance changed; reconcile before prompting');
}
async function locked<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const id=createHash('sha256').update(root).digest('hex').slice(0,24);
  const lock=join(tmpdir(),'project-init-herdr-'+id+'.lock');
  let fd: number;
  try { fd=openSync(lock,'wx',0o600); }
  catch (e) {
    if(isRecord(e) && e.code==='EEXIST') fail('concurrent or stale layout lock; inspect existing attempts before retry: '+lock);
    throw e;
  }
  try { return await fn(); }
  finally { closeSync(fd); unlinkSync(lock); }
}
function fail(message: string): never { throw new Error(message); }
function call(binary: string, args: string[], json: true): CliResponse;
function call(binary: string, args: string[], json?: false): string;
function call(binary: string, args: string[], json = false): CliResponse | string {
  const out = spawnSync(binary, args, { encoding: 'utf8', shell: false, timeout: MAX_TIMEOUT });
  if (out.error || out.status !== 0) fail(binary + ' ' + (args[0] ?? '') + ': ' + (out.error?.message ?? out.stderr?.trim() ?? 'command failed'));
  if (!json) return out.stdout.trim();
  try { return JSON.parse(out.stdout) as CliResponse; } catch { fail(binary + ': malformed JSON response'); }
}
export function resolveRoute(config: unknown, role: string): Route {
  if (!isRecord(config)) fail('invalid routing config');
  if (typeof role !== 'string' || !NAME.test(role)) fail('invalid role');
  if (!isRecord(config.roles) || !Object.hasOwn(config.roles, role)) fail('role not configured: ' + role);
  const selected = config.roles[role];
  if (!isRecord(selected)) fail('invalid role route');
  if (selected.supervisor !== 'herdr') fail('unsupported supervisor; no native fallback');
  if (typeof selected.harness !== 'string' || !ROUTE.test(selected.harness)) fail('invalid harness');
  if (typeof selected.provider !== 'string' || !ROUTE.test(selected.provider)) fail('invalid provider');
  if (selected.fallback !== 'none') fail('implicit fallback prohibited');
  if (selected.nativeSubagents !== 'deny') fail('native subagent substitution not permitted');
  if (Object.hasOwn(selected, 'model')) fail('model selection belongs to dotfiles agent launcher');
  return {role, supervisor:'herdr', harness:selected.harness, provider:selected.provider,
    fallback:'none', nativeSubagents:'deny'};
}
export function parseArgs(argv: string[]): Record<string, string> {
  const [command, ...rest] = argv;
  if (!['plan','start','prompt','read'].includes(command)) fail('usage: dispatch.mts <plan|start|prompt|read> --config FILE [--role ROLE] [--cwd PATH] [--name NAME] [--target PANE] [--message-file FILE]');
  const opts: Record<string, string> = {command};
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
  if (['prompt','read'].includes(command) && (!opts.role || !opts['project-root'] || !opts.name))
    fail('--role, --project-root and --name required for prompt/read');
  if (opts.target && !PANE.test(opts.target)) fail('invalid pane target');
  if (opts.name && !NAME.test(opts.name)) fail('invalid agent name');
  if (opts['workspace-id'] && !PANE.test(opts['workspace-id'])) fail('invalid workspace id');
  return opts;
}
export async function run(argv: string[]): Promise<unknown> {
  const args=parseArgs(argv);
  const config: unknown = JSON.parse(readFileSync(resolve(args.config),'utf8'));
  if (args.command==='plan') return resolveRoute(config,args.role);
  if (args.command==='start') {
    const route=resolveRoute(config,args.role);
    const cwd=resolve(args.cwd);
    if (!existsSync(cwd)) fail('worker cwd does not exist');
    const projectRoot=realpathSync(resolve(args['project-root'] ?? discoverProjectRoot(cwd)));
    if (!existsSync(cwd) || !existsSync(projectRoot)) fail('workspace/project root does not exist');
    if (!isRecord(config) || !isRecord(config.roles)) fail('invalid routing config');
    const selectedRole = config.roles[args.role];
    if (!isRecord(selectedRole)) fail('invalid routing config');
    const configuredFunction = selectedRole.function;
    if (configuredFunction !== undefined && typeof configuredFunction !== 'string') fail('invalid execution function');
    const functionName = configuredFunction ?? args.role;
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
      if (decision.action==='create-workspace' && decision.tabLabel==='Ctrl' && cwd!==projectRoot)
        fail('Ctrl actor requires cwd=projectRoot on initial workspace');
      // Reserve before the first Herdr mutation. Failed/uncertain starts remain reserved.
      const attemptPath=bindingPath(projectRoot,args.name);
      const attempt: AttemptBinding={status:'pending',role:route.role,
        harness:route.harness,provider:route.provider,routeHash:routeHash(route),
        projectRoot,name:args.name};
      reserveAttempt(attemptPath,attempt);
      let pane: string | undefined;
      let workspace: string | undefined = decision.workspace;
      if (decision.action==='create-workspace') {
        if (!decision.workspaceLabel || !decision.tabLabel) fail('invalid workspace placement plan');
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
          const split=call('herdr',['pane','split',controlPane,'--direction','right',
            '--cwd',cwd,'--no-focus'],true);
          pane=split?.result?.pane?.pane_id; // Preserve the root shell as an anchor.
        } else {
          const tab=call('herdr',['tab','create','--workspace',workspace,'--cwd',cwd,
            '--label',decision.tabLabel,'--no-focus'],true);
          pane=tab?.result?.root_pane?.pane_id;
        }
      } else if (decision.action==='create-tab') {
        if (!workspace || !decision.tabLabel) fail('invalid tab placement plan');
        const tab=call('herdr',['tab','create','--workspace',workspace,'--cwd',cwd,
          '--label',decision.tabLabel,'--no-focus'],true);
        pane=tab?.result?.root_pane?.pane_id;
      } else if (decision.action==='split-pane') {
        if (!decision.targetPane || !decision.direction) fail('invalid split placement plan');
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
        const renamed=call('herdr',['agent','get',pane],true)?.result?.agent;
        if(!isRecord(renamed) || (renamed.name!==args.name && renamed.agent_name!==args.name))
          fail('agent rename could not be verified');
        const instance=agentInstance(renamed,pane);
        // Binding is activated only after live identity and rename have been verified.
        writeFileSync(attemptPath,JSON.stringify({...attempt,status:'active',pane,instance})+'\n',{mode:0o600});
        return {...route,workspace,pane,agent:args.name,detected:true,placement:decision};
      }
      fail('pane '+pane+' started but no detectable agent; inspect pane before retry');
    });
  }
  if (args.command==='prompt'){
    const route=resolveRoute(config,args.role);
    verifyAttempt(args,route);
    const message=readFileSync(resolve(args['message-file']),'utf8');
    if (!message.trim()) fail('message file empty');
    return {response:call('herdr',['agent','prompt',args.target,message,'--wait','--timeout','120000'],true)};
  }
  verifyAttempt(args,resolveRoute(config,args.role));
  return {output:call('herdr',['agent','read',args.target,'--source','recent-unwrapped','--lines','120'])};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value,null,2)),error=>{
    console.error('agent-routing: '+(error instanceof Error ? error.message : String(error)));
    process.exitCode=1;
  });
}
