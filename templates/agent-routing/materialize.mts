#!/usr/bin/env node
// Safe project-local materialization with managed hashes and conflict detection.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Manifest { version: 1; managed: Record<string,string>; }
const sourceRoot=dirname(fileURLToPath(import.meta.url));
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const markerStart='<!-- project-init:agent-routing:start -->';
const markerEnd='<!-- project-init:agent-routing:end -->';
const contract=[
  markerStart,
  '## Agent delegation route (project-init)',
  'Top-level delegated tasks must resolve their role from scripts/agent-routing/agent-routing.json and use scripts/agent-routing/dispatch.mts with Herdr and the specified provider.',
  'Do not silently substitute native subagents or another provider. A missing route, quota/authentication error, or ambiguous attempt blocks delegation.',
  'Review/verification independence and resource leases are separate from Herdr display layout.',
  markerEnd,
].join('\n')+'\n';
function isRecord(v:unknown):v is Record<string,unknown> {
  return v!==null && typeof v==='object' && !Array.isArray(v);
}
function parse(argv:string[]) {
  let target:string|undefined,claudeHook=false,check=false;
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--target' && argv[i+1]) target=argv[++i];
    else if(argv[i]==='--claude-hook') claudeHook=true;
    else if(argv[i]==='--check') check=true;
    else throw new Error('usage: materialize.mts --target PROJECT [--claude-hook] [--check]');
  }
  if(!target) throw new Error('--target PROJECT required');
  return {target,claudeHook,check};
}
function existing(path:string):string|undefined {
  if(!existsSync(path)) return undefined;
  if(lstatSync(path).isSymbolicLink()) throw new Error('refuse symlinked destination: '+path);
  return readFileSync(path,'utf8');
}
function readManifest(raw:string|undefined):Manifest {
  if(!raw) return {version:1,managed:{}};
  const parsed:unknown=JSON.parse(raw);
  if(!isRecord(parsed)||parsed.version!==1||!isRecord(parsed.managed)||
    Object.entries(parsed.managed).some(([key,value])=>!key.startsWith('scripts/agent-routing/')||
      typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))) throw new Error('invalid materialization manifest');
  return parsed as unknown as Manifest;
}
export function materialize(project:string,claudeHook=false,check=false) {
  const target=realpathSync(resolve(project));
  const scriptDir=join(target,'scripts/agent-routing');
  const manifestPath=join(scriptDir,'.materialization.json');
  const previous=readManifest(existing(manifestPath));
  const next:Manifest={version:1,managed:{...previous.managed}};
  const writes=new Map<string,string>();
  const sources=[
    ['dispatch.mts','scripts/agent-routing/dispatch.mts'],
    ['layout.mts','scripts/agent-routing/layout.mts'],
    ['claude-guard.mts','scripts/agent-routing/claude-guard.mts'],
  ] as const;
  for(const [source,relative] of sources) {
    const destination=join(target,relative),content=readFileSync(join(sourceRoot,source),'utf8');
    const old=existing(destination);
    if(old!==undefined && old!==content && previous.managed[relative]!==sha(old))
      throw new Error('local customization/conflict: '+relative);
    if(old!==content) writes.set(destination,content);
    next.managed[relative]=sha(content);
  }
  const config=join(scriptDir,'agent-routing.json');
  if(existing(config)===undefined) writes.set(config,readFileSync(join(sourceRoot,'agent-routing.example.json'),'utf8'));
  const agentsPath=join(target,'AGENTS.md'),agents=existing(agentsPath)??'';
  const start=agents.indexOf(markerStart),end=agents.indexOf(markerEnd);
  if((start>=0)!==(end>=0)) throw new Error('incomplete AGENTS.md routing marker');
  if(start>=0) {
    if(agents.slice(start,end+markerEnd.length)!==contract.trimEnd())
      throw new Error('AGENTS.md routing section customized; reconcile manually');
  } else writes.set(agentsPath,(agents && !agents.endsWith('\n')?agents+'\n':agents)+(agents?'\n':'')+contract);
  if(claudeHook) {
    const dest=join(target,'.claude/settings.json'),raw=existing(dest),data:unknown=raw?JSON.parse(raw):{};
    if(!isRecord(data)) throw new Error('invalid Claude settings object');
    const hooks:unknown=data.hooks??{};
    if(!isRecord(hooks)) throw new Error('invalid Claude hooks');
    const original:unknown=hooks.PreToolUse??[];
    if(!Array.isArray(original)) throw new Error('invalid PreToolUse hook list');
    const required={matcher:'Agent|Task',hooks:[{type:'command',command:'node scripts/agent-routing/claude-guard.mts'}]};
    const matches=(v:unknown):v is Record<string,unknown>=>isRecord(v)&&v.matcher==='Agent|Task';
    if(original.some((v:unknown)=>matches(v)&&JSON.stringify(v.hooks)!==JSON.stringify(required.hooks)))
      throw new Error('existing Agent|Task hook differs; reconcile manually');
    if(!original.some((v:unknown)=>matches(v))) {
      const updated={...data,hooks:{...hooks,PreToolUse:[...original,required]}};
      writes.set(dest,JSON.stringify(updated,null,2)+'\n');
    }
  }
  const manifestContent=JSON.stringify(next,null,2)+'\n';
  if(existing(manifestPath)!==manifestContent) writes.set(manifestPath,manifestContent);
  if(!check) for(const [path,content] of writes) {
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,content,{mode:0o600});
  }
  return {check,changed:[...writes.keys()].map(path=>path.slice(target.length+1))};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=parse(process.argv.slice(2));
    console.log(JSON.stringify(materialize(args.target,args.claudeHook,args.check),null,2));
  } catch(error) {
    console.error('agent-routing materialization: '+(error instanceof Error?error.message:String(error)));
    process.exitCode=1;
  }
}
