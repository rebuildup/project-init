import {expect, test} from 'bun:test';
import {validateNode, validateRegistry, renderSSH, assertIdentity,preflightSSH} from './devices';
const node = {id:'wsl',label:'Ubuntu',os:'linux',instanceId:'306ab9474cff458ca563e7807ded1da5',host:'100.118.123.62',port:2222,user:'basic',hostKey:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7vsV/ZP4V/Z1+MyVUCRAomZRpDsMWUm6A2rzOFv7ce',session:'default'};
test('rejects SSH config and command injection before effects',()=>{
 for(const patch of [{host:'ok\nProxyCommand evil'},{user:'$(id)'},{session:'a;id'},{id:'../x'},{hostKey:'ssh-ed25519 nope'},{port:0},{os:'other'},{privateKey:'secret'}]) expect(()=>validateNode({...node,...patch})).toThrow();
});
test('rejects duplicate logical nodes, endpoint sessions and shared host key across instances',()=>{
 expect(()=>validateRegistry([node,{...node}])).toThrow();
 expect(()=>validateRegistry([node,{...node,id:'other'}])).toThrow();
 expect(()=>validateRegistry([node,{...node,id:'other',port:2223,instanceId:'different'}])).toThrow();
});
test('pins dedicated SSH identity and host key; never inherits proxy or agent forwarding',()=>{
 const text=renderSSH([validateNode(node)],'/home/user');
 expect(text).toContain('StrictHostKeyChecking yes');
 expect(text).toContain('HostKeyAlias device-wsl');
 expect(text).toContain('ProxyCommand none');
 expect(text).toContain('ForwardAgent no');
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
  const first=runSync();expect(first.stderr.toString()).toBe('');expect(first.exitCode).toBe(0);
  const conf=readFileSync(join(home,'.ssh/devices.conf'),'utf8');expect(conf).toEndWith('Host *\n');
  expect(runSync().exitCode).toBe(0);
  expect(JSON.parse(readFileSync(db,'utf8'))).toHaveLength(2);
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
  expect(runSync().exitCode).toBe(1);
  expect(JSON.parse(readFileSync(db,'utf8'))).toHaveLength(2);
  expect(JSON.parse(readFileSync(db,'utf8'))[1].enabled).toBe(true);
  interrupted.wsl.profileId='managed';writeFileSync(ownership,JSON.stringify(interrupted));
  expect(readFileSync(join(home,'.ssh/config'),'utf8').match(/Include/g)).toHaveLength(1);
  writeFileSync(registry,JSON.stringify([{secretKey:'DEVICE_WSL',secretValue:JSON.stringify({...node,instanceId:'00000000000000000000000000000000'})}]));
  const mismatch=runSync();expect(mismatch.exitCode).toBe(1);expect(mismatch.stderr.toString()).toContain('instance mismatch');
  expect(JSON.parse(readFileSync(db,'utf8'))).toEqual([foreign]);
  writeFileSync(registry,'null');expect(runSync().exitCode).toBe(0);
  expect(JSON.parse(readFileSync(db,'utf8'))).toEqual([foreign]);
 }finally{rmSync(dir,{recursive:true,force:true});}
}, 20000);

const windowsTest=process.platform==='win32'?test:test.skip;
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

unixTest('SSH config symlink is rejected before creating generated files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'devices-foreign-'));
 try{mkdirSync(join(dir,'.ssh'));writeFileSync(join(dir,'foreign'),'Host keep\n');symlinkSync(join(dir,'foreign'),join(dir,'.ssh/config'));
 expect(()=>preflightSSH(dir)).toThrow('symlink');expect(readFileSync(join(dir,'foreign'),'utf8')).toBe('Host keep\n');expect(existsSync(join(dir,'.ssh/devices.conf'))).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
