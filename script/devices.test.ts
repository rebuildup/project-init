import {expect, test} from 'bun:test';
import {validateNode, validateRegistry, renderSSH, assertIdentity,preflightSSH,installSSH,identityCommand,localInstance} from './devices';
const node = {id:'wsl',label:'Ubuntu',os:'linux',instanceId:'306ab9474cff458ca563e7807ded1da5',host:'100.118.123.62',port:2222,user:'basic',hostKey:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7vsV/ZP4V/Z1+MyVUCRAomZRpDsMWUm6A2rzOFv7ce',session:'default'};
test('rejects SSH config and command injection before effects',()=>{
 for(const patch of [{host:'ok\nProxyCommand evil'},{user:'$(id)'},{session:'a;id'},{id:'../x'},{hostKey:'ssh-ed25519 nope'},{port:0},{os:'other'},{privateKey:'secret'}]) expect(()=>validateNode({...node,...patch})).toThrow();
});
test('rejects duplicate logical nodes, endpoint sessions and shared host key across instances',()=>{
 expect(()=>validateRegistry([node,{...node}])).toThrow();
 expect(()=>validateRegistry([node,{...node,id:'other'}])).toThrow();
 expect(()=>validateRegistry([node,{...node,id:'other',host:'100.118.123.63',hostKey:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFCZ5DX93f5H0F/4MtxNIYmo+f1OZQkLT54BZkrETXZP',instanceId:'AA600942-3101-5070-BABE-8BB07631D097',label:node.label}])).toThrow();
 expect(()=>validateRegistry([node,{...node,id:'other',port:2223,instanceId:'different'}])).toThrow();
});
test('pins dedicated SSH identity and host key; never inherits proxy or agent forwarding',()=>{
 const text=renderSSH([validateNode(node)],'/home/user');
 expect(text).toContain('StrictHostKeyChecking yes');
 expect(text).toContain('HostKeyAlias device-wsl');
 expect(text).toContain('IdentityFile "/home/user/.ssh/id_ed25519_devices"');
 expect(text).toContain('UserKnownHostsFile "/home/user/.ssh/devices_known_hosts"');
 expect(text).toContain('ProxyCommand none');
 expect(text).toContain('ForwardAgent no');
});
test('Windows remote identity command reads the registry MachineGuid',()=>{
 expect(identityCommand('windows')).toContain('HKLM:\\SOFTWARE\\Microsoft\\Cryptography');
 expect(identityCommand('windows')).toContain('MachineGuid');
});
const windowsTest=process.platform==='win32'?test:test.skip;
windowsTest('Windows local identity is the machine GUID from the registry',()=>{
 expect(localInstance()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
test('wrong instance or execution user fails closed',()=>{
 expect(()=>assertIdentity(validateNode(node),'Linux\nbasic\n306ab9474cff458ca563e7807ded1da5\n')).not.toThrow();
 expect(()=>assertIdentity(validateNode(node),'Linux\nroot\n306ab9474cff458ca563e7807ded1da5\n')).toThrow();
 expect(()=>assertIdentity(validateNode(node),'Linux\nbasic\nother\n')).toThrow();
});

import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const unixTest=process.platform==='win32'?test.skip:test;
unixTest('real CLI sync is idempotent, isolates foreign profiles and rejects wrong replacement identity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-test-')),home=join(dir,'home'),bin=join(dir,'bin');
 mkdirSync(home);mkdirSync(bin);
 const registry=join(dir,'registry.json'),db=join(dir,'profiles.json'),calls=join(dir,'calls');
 writeFileSync(registry,JSON.stringify([{secretKey:'DEVICE_WSL',secretValue:JSON.stringify(node)}]));
 const foreign={id:'foreign',label:'Keep',target:'untouched',session:'default',enabled:true};
 writeFileSync(db,JSON.stringify([foreign]));
 const prelude=`#!/usr/bin/env bun\nimport{readFileSync as read,writeFileSync as write,appendFileSync as append,existsSync}from'node:fs';\nconst args=process.argv.slice(2);append(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');\n`;
 writeFileSync(join(bin,'infisical'),prelude+`if(!args.includes('--domain=https://secrets.rebuildup.dev/api')||!args.includes('--env=dev')||!args.includes('--path=/devices')||!args.includes('--include-imports=false')||!args.includes('--secret-overriding=false'))process.exit(1);console.log(read(${JSON.stringify(registry)},'utf8'));`,{mode:0o755});
 writeFileSync(join(bin,'ssh'),prelude+`if(existsSync(${JSON.stringify(join(dir,'offline'))}))process.exit(255);console.log(args.at(-1).includes('status server')?'status: running':'Linux\\nbasic\\n306ab9474cff458ca563e7807ded1da5');`,{mode:0o755});
 writeFileSync(join(bin,'herdr'),prelude+`const f=${JSON.stringify(db)},p=JSON.parse(read(f,'utf8'));if(args[1]==='list')console.log(JSON.stringify(p));else if(args[1]==='add'){p.push({id:'managed',label:args.at(-1),target:args[2],session:args[4],enabled:true});write(f,JSON.stringify(p));}else if(args[1]==='remove')write(f,JSON.stringify(p.filter(x=>x.id!==args[2])));else if(args[1]==='disable'||args[1]==='enable'){p.find(x=>x.id===args[2]).enabled=args[1]==='enable';write(f,JSON.stringify(p));}else process.exit(1);`,{mode:0o755});
 const runSync=(args=['sync'])=>Bun.spawnSync([process.execPath,join(import.meta.dir,'devices.ts'),...args],{env:{...process.env,HOME:home,PATH:bin+':'+process.env.PATH},stdout:'pipe',stderr:'pipe'});
 try{
  const state=join(home,'.local/state/dotfiles/devices'),lock=join(state,'lock');
  mkdirSync(lock,{recursive:true});writeFileSync(join(lock,'pid'),'2147483647');
  const first=runSync();expect(first.stderr.toString()).toContain('recovered stale devices lock from dead process 2147483647');expect(first.exitCode).toBe(0);
  const conf=readFileSync(join(home,'.ssh/devices.conf'),'utf8');expect(conf).toEndWith('Host *\n');
  expect(runSync().exitCode).toBe(0);
  expect(JSON.parse(readFileSync(db,'utf8'))).toHaveLength(2);
  mkdirSync(lock);writeFileSync(join(lock,'pid'),String(process.pid));
  const blocked=runSync(['list']);expect(blocked.exitCode).toBe(1);expect(blocked.stderr.toString()).toContain(`pid ${process.pid}`);
  expect(readFileSync(join(lock,'pid'),'utf8')).toBe(String(process.pid));rmSync(lock,{recursive:true});
  writeFileSync(calls,'');
  expect(runSync(['check','wsl']).exitCode).toBe(0);
  expect(readFileSync(calls,'utf8')).not.toContain('"machine"');
  expect(readFileSync(calls,'utf8')).not.toContain('status server');
  writeFileSync(join(dir,'offline'),'');writeFileSync(calls,'');
  expect(runSync().exitCode).toBe(1);
  expect(JSON.parse(readFileSync(db,'utf8'))[1].enabled).toBe(true);
  expect(readFileSync(calls,'utf8')).not.toContain('"disable"');
  rmSync(join(dir,'offline'));
  const ownership=join(home,'.local/state/dotfiles/devices/profiles.json');
  const interrupted=JSON.parse(readFileSync(ownership,'utf8'));interrupted.wsl.profileId='';
  writeFileSync(ownership,JSON.stringify(interrupted));
  const interruptedRun=runSync();expect(interruptedRun.exitCode).toBe(1);expect(interruptedRun.stderr.toString()).toContain('remove the unclaimed profile explicitly');
  expect(JSON.parse(readFileSync(db,'utf8'))).toHaveLength(2);
  expect(JSON.parse(readFileSync(db,'utf8'))[1].enabled).toBe(true);
  interrupted.wsl.profileId='managed';writeFileSync(ownership,JSON.stringify(interrupted));
  expect(readFileSync(join(home,'.ssh/config'),'utf8').match(/Include/g)).toHaveLength(1);
  writeFileSync(registry,JSON.stringify([{secretKey:'DEVICE_WSL',secretValue:JSON.stringify({...node,instanceId:'00000000000000000000000000000000'})}]));
  const mismatch=runSync();expect(mismatch.exitCode).toBe(1);expect(mismatch.stderr.toString()).toContain('instance mismatch');
  expect(JSON.parse(readFileSync(db,'utf8'))).toEqual([foreign]);
  writeFileSync(registry,'null');expect(runSync().exitCode).toBe(0);
  expect(JSON.parse(readFileSync(db,'utf8'))).toEqual([foreign]);
  expect(readFileSync(join(home,'.ssh/devices.conf'),'utf8')).not.toContain('Host device-wsl');
  expect(readFileSync(join(home,'.ssh/devices_known_hosts'),'utf8')).not.toContain('device-wsl');
 }finally{rmSync(dir,{recursive:true,force:true});}
}, 20000);

windowsTest('Windows ACL helper works without PowerShell modules and excludes inherited writers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-acl-')),file=join(dir,'config');
 writeFileSync(file,'Host example\n');
 const script=join(import.meta.dir,'devices-acl.ps1');
 try{
  const result=Bun.spawnSync(['powershell','-NoProfile','-Command',`& '${script.replaceAll("'","''")}' '${file.replaceAll("'","''")}'; if(!$?) {exit 1}; $a=[IO.File]::GetAccessControl('${file.replaceAll("'","''")}'); if(!$a.AreAccessRulesProtected){exit 2}; $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544'); foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.IdentityReference.Value -notin $allowed){exit 3}}`],{env:{...process.env,PSModulePath:dir},stdout:'pipe',stderr:'pipe',timeout:20000});
  expect(result.stderr.toString()).toBe('');expect(result.exitCode).toBe(0);
  expect(readFileSync(file,'utf8')).toBe('Host example\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
}, 30000);

unixTest('SSH config symlink to unmanaged config is rejected before creating generated files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-foreign-'));
 try{mkdirSync(join(dir,'.ssh'));writeFileSync(join(dir,'foreign'),'Host keep\n');symlinkSync(join(dir,'foreign'),join(dir,'.ssh/config'));
 expect(()=>preflightSSH(dir)).toThrow('symlink');expect(readFileSync(join(dir,'foreign'),'utf8')).toBe('Host keep\n');expect(existsSync(join(dir,'.ssh/devices.conf'))).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

unixTest('SSH config symlink with managed Include is preserved and usable',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-managed-link-'));
 try{
  mkdirSync(join(dir,'.ssh'));const target=join(dir,'foreign'),config=join(dir,'.ssh/config');
  const original=`Include "${join(dir,'.ssh/devices.conf')}"\nHost keep\n`;
  writeFileSync(target,original);symlinkSync(target,config);
  installSSH([validateNode(node)],dir);
  expect(readFileSync(config,'utf8')).toBe(original);
  expect(readFileSync(target,'utf8')).toBe(original);
  expect(readFileSync(join(dir,'.ssh/devices.conf'),'utf8')).toContain('Host device-wsl');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

unixTest('regular SSH config is backed up once and keeps its settings after the Include',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-managed-config-'));
 const original='Host keep\n  HostName example.invalid\n';
 try{
  mkdirSync(join(dir,'.ssh'));writeFileSync(join(dir,'.ssh/config'),original);
  installSSH([validateNode(node)],dir);
  const config=readFileSync(join(dir,'.ssh/config'),'utf8');
  expect(config).toBe(`Include "${join(dir,'.ssh/devices.conf')}"\n${original}`);
  expect(readFileSync(join(dir,'.ssh/config.before-devices'),'utf8')).toBe(original);
  installSSH([validateNode(node)],dir);
  expect(readFileSync(join(dir,'.ssh/config'),'utf8')).toBe(config);
  expect(readFileSync(join(dir,'.ssh/config.before-devices'),'utf8')).toBe(original);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

unixTest('stale generated temp files do not block atomic SSH installation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-stale-tmp-'));
 try{
  mkdirSync(join(dir,'.ssh'));const stale=join(dir,'.ssh/devices_known_hosts.tmp');
  writeFileSync(stale,'preserve foreign temp');
  installSSH([validateNode(node)],dir);
  expect(readFileSync(stale,'utf8')).toBe('preserve foreign temp');
  expect(readFileSync(join(dir,'.ssh/devices_known_hosts'),'utf8')).toContain('device-wsl');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

unixTest('backup conflicts fail before touching config or generated files',()=>{
 for(const kind of ['dangling','existing-link','file','directory']){
  const dir=mkdtempSync(join(tmpdir(),'devices-backup-'));
  try{
   mkdirSync(join(dir,'.ssh'));const config=join(dir,'.ssh/config'),backup=config+'.before-devices',target=join(dir,'foreign');
   writeFileSync(config,'Host keep\n');
   if(kind==='existing-link')writeFileSync(target,'keep target');
   if(kind==='dangling'||kind==='existing-link')symlinkSync(target,backup);
   if(kind==='file')writeFileSync(backup,'keep backup');
   if(kind==='directory')mkdirSync(backup);
   expect(()=>installSSH([validateNode(node)],dir)).toThrow();
   expect(readFileSync(config,'utf8')).toBe('Host keep\n');
   expect(existsSync(join(dir,'.ssh/devices.conf'))).toBe(false);
   expect(existsSync(join(dir,'.ssh/devices_known_hosts'))).toBe(false);
   if(kind==='dangling')expect(existsSync(target)).toBe(false);
   if(kind==='existing-link')expect(readFileSync(target,'utf8')).toBe('keep target');
   if(kind==='file')expect(readFileSync(backup,'utf8')).toBe('keep backup');
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
