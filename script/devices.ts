#!/usr/bin/env bun
// Infisical owns destinations; OpenSSH and Herdr own transport and terminals.
import {readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, lstatSync, rmSync, copyFileSync, rmdirSync} from 'node:fs';
import {homedir, platform, userInfo} from 'node:os';
import {join, resolve} from 'node:path';

export type Device = {id:string; label:string; os:'linux'|'macos'|'windows'; instanceId:string; host:string; port:number; user:string; hostKey:string; session:string};
type Profile = {id:string; label:string; target:string; session:string; enabled:boolean};
type Owned = Record<string,{profileId:string; node:Device}>;
const marker='# Managed by dotfiles devices; source: Infisical /devices\n';
const idPattern=/^[a-z][a-z0-9-]{0,47}$/;
export function validateNode(value:unknown):Device {
 const n=value as Device;
 const keys=['id','label','os','instanceId','host','port','user','hostKey','session'];
 if(!n || typeof n!=='object' || Object.keys(n).some(k=>!keys.includes(k)) || keys.some(k=>!(k in n))) throw Error('device must contain only the documented connection fields');
 if(typeof n.id!=='string'||!idPattern.test(n.id)||typeof n.label!=='string'||!n.label.trim()||/[\x00-\x1f\x7f]/.test(n.label)) throw Error('invalid device id/label');
 if(!['linux','macos','windows'].includes(n.os)||typeof n.instanceId!=='string'|| !/^[a-zA-Z0-9-]{8,64}$/.test(n.instanceId)) throw Error('invalid OS/instance identity');
 if(typeof n.host!=='string'|| !/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(n.host) || !Number.isInteger(n.port)||n.port<1||n.port>65535) throw Error('invalid SSH address');
 if(typeof n.user!=='string'|| !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(n.user)||typeof n.session!=='string'|| !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(n.session)) throw Error('invalid user/session');
 if(typeof n.hostKey!=='string'||!/^ssh-ed25519 [A-Za-z0-9+/]{68}$/.test(n.hostKey)) throw Error('expected verified ed25519 public host key (no comment)');
 const key=Buffer.from(n.hostKey.split(' ')[1],'base64');
 if(key.length!==51||key.subarray(0,19).toString('hex')!=='0000000b7373682d6564323535313900000020') throw Error('invalid ed25519 host key');
 return n;
}
export function validateRegistry(values:unknown[]):Device[] {
 const nodes=values.map(validateNode); const ids=new Set(), destinations=new Set(), labels=new Set(); const keys=new Map();
 for(const n of nodes){
  const dst=`${n.host.toLowerCase()}:${n.port}/${n.user.toLowerCase()}/${n.session}`;
  if(ids.has(n.id)||destinations.has(dst)||labels.has(n.label)) throw Error('duplicate node or destination/session');
  if(keys.has(n.hostKey)&&keys.get(n.hostKey)!==n.instanceId.toLowerCase()) throw Error('host key reused across different instances');
  ids.add(n.id);labels.add(n.label);destinations.add(dst);keys.set(n.hostKey,n.instanceId.toLowerCase());
 }
 return nodes.sort((a,b)=>a.id.localeCompare(b.id));
}
function quotePath(p:string){if(/[\r\n"%]/.test(p))throw Error('unsupported path');return '"'+p.replaceAll('\\','/')+'"';}
export function renderSSH(nodes:Device[],home:string):string {
 return marker+nodes.map(n=>`Host device-${n.id}
  HostName ${n.host}
  Port ${n.port}
  User ${n.user}
  IdentityFile ${quotePath(join(home,'.ssh/id_ed25519_devices'))}
  IdentitiesOnly yes
  IdentityAgent none
  HostKeyAlias device-${n.id}
  UserKnownHostsFile ${quotePath(join(home,'.ssh/devices_known_hosts'))}
  GlobalKnownHostsFile none
  StrictHostKeyChecking yes
  HostKeyAlgorithms ssh-ed25519
  UpdateHostKeys no
  ForwardAgent no
  ForwardX11 no
  ClearAllForwardings yes
  ProxyCommand none
  ProxyJump none
  PermitLocalCommand no
  ControlMaster no
  ControlPath none
  ConnectTimeout 8
  ConnectionAttempts 1
  ServerAliveInterval 15
  ServerAliveCountMax 3
`).join('\n')+'\nHost *\n';
}
export function assertIdentity(n:Device,output:string){
 const lines=output.trim().split(/\r?\n/).map(s=>s.trim());
 const os={linux:'Linux',macos:'Darwin',windows:'Windows'}[n.os];
 if(lines.length!==3||lines[0]!==os||lines[1].toLowerCase()!==n.user.toLowerCase()||lines[2].toLowerCase()!==n.instanceId.toLowerCase())throw Error(`${n.id}: OS/user/instance mismatch; refused`);
}
const root=resolve(import.meta.dir,'..');
function providerArgs(){
 const metadata=readFileSync(join(root,'config/infisical.sh'),'utf8');
 const get=(key:string)=>{const v=metadata.match(new RegExp(`^${key}="([^"]+)"$`,'m'))?.[1];if(!v)throw Error(`missing ${key}`);return v;};
 const project=get('INFISICAL_PROJECT_ID'),env=get('INFISICAL_ENVIRONMENT'),domain=get('INFISICAL_API_URL');
 const binding=JSON.parse(readFileSync(join(root,'.infisical.json'),'utf8'));
 if(binding.workspaceId!==project||binding.defaultEnvironment!==env)throw Error('Infisical binding mismatch');
 return [`--domain=${domain}`,`--projectId=${project}`,`--env=${env}`,'--path=/devices','--silent'];
}
function run(args:string[],timeout=30000):string{
 const p=Bun.spawnSync(args,{stdin:'ignore',stdout:'pipe',stderr:'pipe',timeout});
 if(p.exitCode!==0)throw Error(`${args[0]} ${args[1]} failed: ${p.stderr.toString().trim()||'timeout or nonzero exit'}`);
 return p.stdout.toString();
}
function readRegistry():Device[]{
 const rows=JSON.parse(run(['infisical','secrets',...providerArgs(),'--output=json','--expand=false','--include-imports=false','--secret-overriding=false']));
 if(rows===null)return [];
 if(!Array.isArray(rows))throw Error('Infisical did not return a secret array');
 return validateRegistry(rows.map((r:any)=>{
  if(!/^DEVICE_[A-Z][A-Z0-9_]*$/.test(r.secretKey))throw Error('unexpected entry in /devices');
  const n=validateNode(JSON.parse(r.secretValue));
  if(secretName(n.id)!==r.secretKey)throw Error('secret name/device id mismatch');return n;
 }));
}
function secretName(id:string){if(!idPattern.test(id))throw Error('invalid device ID');return 'DEVICE_'+id.toUpperCase().replaceAll('-','_');}
function identityCommand(os:Device['os']){
 if(os==='windows')return 'powershell -NoProfile -Command "Write-Output Windows; Write-Output $env:USERNAME; (Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid"';
 return os==='linux'?'uname -s; id -un; cat /etc/machine-id':"uname -s; id -un; ioreg -rd1 -c IOPlatformExpertDevice | awk -F '\"' '/IOPlatformUUID/ {print $(NF-1)}'";
}
function localInstance(){
 if(platform()==='win32')return run(['powershell','-NoProfile','-Command','(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid']).trim().toLowerCase();
 if(platform()==='linux')return readFileSync('/etc/machine-id','utf8').trim().toLowerCase();
 if(platform()==='darwin')return run(['ioreg','-rd1','-c','IOPlatformExpertDevice']).match(/"IOPlatformUUID" = "([^"]+)"/)?.[1].toLowerCase();
 throw Error('unsupported OS');
}
function check(n:Device,home:string){assertIdentity(n,run(['ssh','-F',join(home,'.ssh/devices.conf'),'-o','BatchMode=yes',`device-${n.id}`,identityCommand(n.os)]));}
export function secureFile(path:string){if(platform()==='win32')run(['powershell','-NoProfile','-File',join(root,'script/devices-acl.ps1'),path]);}
function atomic(path:string,text:string){
 if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error(`refusing symlink: ${path}`);
 const tmp=path+'.tmp'; writeFileSync(tmp,text,{mode:0o600,flag:'wx'});try{secureFile(tmp);renameSync(tmp,path);}finally{if(existsSync(tmp))rmSync(tmp);}
}
function generated(path:string,text:string){
 if(existsSync(path)){if(!readFileSync(path,'utf8').startsWith(marker))throw Error(`foreign file: ${path}`);if(readFileSync(path,'utf8')===text){secureFile(path);return;}}
 atomic(path,text);
}
function installSSH(nodes:Device[],home:string){
 const dir=join(home,'.ssh');mkdirSync(dir,{recursive:true,mode:0o700});
 // Refuse foreign outputs before changing either generated file.
 for(const p of ['devices.conf','devices_known_hosts'])if(existsSync(join(dir,p))&&!readFileSync(join(dir,p),'utf8').startsWith(marker))throw Error(`foreign ${p}`);
 generated(join(dir,'devices_known_hosts'),marker+nodes.map(n=>`device-${n.id} ${n.hostKey}\n`).join(''));
 generated(join(dir,'devices.conf'),renderSSH(nodes,home));
 const config=join(dir,'config'),include=`Include ${quotePath(join(dir,'devices.conf'))}\n`;
 if(existsSync(config))secureFile(config);
 const key=join(dir,'id_ed25519_devices');if(existsSync(key))secureFile(key);
 const old=existsSync(config)?readFileSync(config,'utf8'):'';
 if(!old.startsWith(include)){
  if(old.includes('devices.conf'))throw Error('devices.conf already included elsewhere; place its Include first explicitly');
  if(existsSync(config)&&!existsSync(config+'.before-devices'))copyFileSync(config,config+'.before-devices');
  atomic(config,include+old);
 }
}
function profiles():Profile[]{return JSON.parse(run(['herdr','machine','list','--json']));}
function saveOwned(file:string,owned:Owned){atomic(file,JSON.stringify(owned,null,2)+'\n');}
function isLocal(n:Device,local=localInstance()){return n.instanceId.toLowerCase()===local && n.user.toLowerCase()===userInfo().username.toLowerCase() && n.os===({win32:'windows',darwin:'macos',linux:'linux'} as Record<string,string>)[platform()];}
function requireSession(n:Device,home:string){
 const posix="if command -v herdr >/dev/null 2>&1; then h=$(command -v herdr); elif test -x \"$HOME/.local/share/mise/shims/herdr\"; then h=\"$HOME/.local/share/mise/shims/herdr\"; else h=\"$HOME/.local/bin/herdr\"; fi; \"$h\"";
 const command=(n.os==='windows'?'herdr':posix)+` --session ${n.session} status server`;
 const result=run(['ssh','-F',join(home,'.ssh/devices.conf'),'-o','BatchMode=yes',`device-${n.id}`,command]);
 if(!/^status: running$/m.test(result.replaceAll('\r','')))throw Error(`${n.id}: start Herdr locally first; refusing remote server startup`);
}
function sync(nodes:Device[],home:string,state:string){
 const file=join(state,'profiles.json'),owned:Owned=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
 const current=profiles();const local=localInstance();
 // An empty ID records our intent before Herdr creates its opaque profile ID.
 for(const [id,entry] of Object.entries(owned))if(entry.profileId===''){
  const matches=current.filter(p=>p.target===`device-${id}`);
  if(matches.length>1||matches.some(p=>p.session!==entry.node.session||p.label!==entry.node.label))throw Error(`${id}: interrupted registration conflicts; inspect profiles`);
  if(matches.length){entry.profileId=matches[0].id;run(['herdr','machine','disable',entry.profileId]);}
  else delete owned[id];
  saveOwned(file,owned);
 }
 // Disable changed/deleted registrations before changing their SSH resolution.
 for(const [id,entry] of Object.entries(owned)){
  const p=current.find(p=>p.id===entry.profileId); if(!p){delete owned[id];continue;}
  if(p.target!==`device-${id}`||p.session!==entry.node.session)throw Error(`managed profile ${id} was edited outside devices; reconcile explicitly`);
  const next=nodes.find(n=>n.id===id);
  if(!next||JSON.stringify(next)!==JSON.stringify(entry.node)||isLocal(next,local)){
   run(['herdr','machine','remove',p.id]); delete owned[id];saveOwned(file,owned);
  }
 }
 for(const n of nodes){
  if(profiles().some(p=>p.target===`device-${n.id}` && p.id!==owned[n.id]?.profileId))throw Error(`${n.id}: foreign SSH target collision; refusing config update`);
 }
 installSSH(nodes,home);let failed=false;
 for(const n of nodes){
  if(isLocal(n,local)){console.log(`${n.id}: Local`);continue;}
  try{
   check(n,home);requireSession(n,home);
   if(owned[n.id]){if(!profiles().find(p=>p.id===owned[n.id].profileId)?.enabled)run(['herdr','machine','enable',owned[n.id].profileId]);console.log(`${n.id}: unchanged`);continue;}
   const existing=profiles();
   if(existing.some(p=>p.target===`device-${n.id}`||p.label===n.label))throw Error('foreign target or label collision; no adoption');
   owned[n.id]={profileId:'',node:n};saveOwned(file,owned);
   run(['herdr','machine','add',`device-${n.id}`,'--remote-session',n.session,'--label',n.label],60000);
   const added=profiles().filter(p=>p.target===`device-${n.id}`&&p.session===n.session);
   if(added.length!==1)throw Error('unexpected Herdr registration result');
   owned[n.id]={profileId:added[0].id,node:n};saveOwned(file,owned); console.log(`${n.id}: registered`);
  }catch(e){if(owned[n.id]?.profileId){try{run(['herdr','machine','disable',owned[n.id].profileId]);}catch(disableError){console.error(String(disableError));}}console.error(`${n.id}: ${String(e)}`);failed=true;}
 }
 return !failed;
}
export async function main(args=process.argv.slice(2)){
 const [cmd,...rest]=args,home=homedir(),state=join(home,'.local/state/dotfiles/devices');
 if(!cmd||cmd==='help'){console.log('devices list | sync | check ID | ssh ID | herdr ID | register NODE.json | forget ID\nSource: self-hosted Infisical /devices; keys stay in ~/.ssh/id_ed25519_devices.');return;}
 if(!['list','sync','check','ssh','herdr','register','forget'].includes(cmd))throw Error('unknown command');
 mkdirSync(state,{recursive:true,mode:0o700});const lock=join(state,'lock');let held=true;
 try{mkdirSync(lock);}catch{throw Error(`another devices command is running (or stale lock: ${lock})`);}
 try{
  const nodes=readRegistry();
  if(cmd==='list'){console.log(JSON.stringify(nodes,null,2));return;}
  if(cmd==='register'){
   if(rest.length!==1)throw Error('usage: devices register NODE.json');
   const n=validateNode(JSON.parse(readFileSync(rest[0],'utf8'))),old=nodes.find(x=>x.id===n.id);
   if(old&&old.instanceId.toLowerCase()!==n.instanceId.toLowerCase()&&old.hostKey===n.hostKey)throw Error('replacement instance must have its own host key');
   validateRegistry([...nodes.filter(x=>x.id!==n.id),n]);
   run(['infisical','secrets','set',`${secretName(n.id)}=${JSON.stringify(n)}`,...providerArgs(),'--type=shared']);
   const saved=readRegistry().find(x=>x.id===n.id);if(JSON.stringify(saved)!==JSON.stringify(n))throw Error('readback mismatch');
   console.log(`${n.id}: published to Infisical; run devices sync on clients`);return;
  }
  if(cmd==='forget'){
   if(rest.length!==1||!nodes.some(n=>n.id===rest[0]))throw Error('unknown device');
   run(['infisical','secrets','delete',secretName(rest[0]),...providerArgs()]);console.log('removed from Infisical; run devices sync on clients');return;
  }
  if(cmd==='sync'){if(rest.length)throw Error('sync takes no arguments');if(!sync(nodes,home,state))throw Error('some devices unavailable or rejected; no fallback');return;}
  if(rest.length!==1)throw Error(`usage: devices ${cmd} ID`);
  const n=nodes.find(n=>n.id===rest[0]);if(!n)throw Error('unknown device');
  // Reconcile owned profiles before changing SSH data; stale profiles cannot silently retarget.
  sync(nodes,home,state);if(!isLocal(n)){check(n,home);if(cmd==='herdr')requireSession(n,home);}
  if(cmd==='check'){console.log(isLocal(n)?`${n.id}: verified local OS/user/instance; no SSH host-key probe`:`${n.id}: verified OS/user/instance and pinned SSH host key`);return;}
  const command=cmd==='herdr'&&isLocal(n)?['herdr','--session',n.session]:cmd==='ssh'?['ssh','-F',join(home,'.ssh/devices.conf'),`device-${n.id}`]:['herdr','--remote',`device-${n.id}`,'--session',n.session];
  // Do not hold the synchronization lock throughout an interactive session.
  rmdirSync(lock);held=false;const p=Bun.spawn(command,{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exitCode=await p.exited;
 }finally{if(held&&existsSync(lock))rmdirSync(lock);}
}
if(import.meta.main)main().catch(e=>{console.error(String(e));process.exitCode=1;});
