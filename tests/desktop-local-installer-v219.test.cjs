const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-installer-'));
const harness=path.join(temp,'installer-tests.exe');
test.before(()=>{
 const compile=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/main:InstallerBehaviorTests','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',`/out:${harness}`,path.resolve(__dirname,'../desktop-client/local-installer.cs'),path.join(__dirname,'installer-behavior-harness.cs')],{encoding:'utf8',windowsHide:true});
 assert.equal(compile.status,0,compile.stdout+compile.stderr);
});
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
for(const scenario of ['fresh','preserve','rollback','capacity','malformed','unknown','long','update-path-margin','locked','shortcuts','shortcut-failure','running','portable-profile','concurrent']){
 test(`native installer: ${scenario}`,()=>{
  const result=spawnSync(harness,[scenario,path.join(temp,scenario)],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+result.stderr);
 });
}
test('native installer rejects redirected target parents before writing',()=>{
 const outside=path.join(temp,'junction-destination'),linked=path.join(temp,'junction-source');fs.mkdirSync(outside);fs.symlinkSync(outside,linked,'junction');
 const result=spawnSync(harness,['fresh',linked],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,1);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('self-contained installer compiles with exact Windows file/product versions and embedded package SHA',()=>{
 const build=path.resolve(__dirname,'../desktop-client',`dist-installer-test-${Date.now()}`);fs.mkdirSync(build);
 try {
  const fixture=spawnSync(harness,['make-zip',build],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(fixture.status,0,fixture.stdout+fixture.stderr);
  const script=path.resolve(__dirname,'../scripts/build-local-installer.ps1');
  const run=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-PackageZip',path.join(build,'package.zip'),'-Version','2.0.19','-OutputDirectory',build],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(run.status,0,run.stdout+run.stderr);
  const executable=path.join(build,'wandou-ai-tools-setup-2.0.19.exe');assert.ok(fs.statSync(executable).size>10000);
  const inspectScript=path.join(build,'inspect.ps1');
  fs.writeFileSync(inspectScript,`$exe=Join-Path $PSScriptRoot 'wandou-ai-tools-setup-2.0.19.exe'\n$v=(Get-Item -LiteralPath $exe).VersionInfo\nif($v.FileVersion -ne '2.0.19.0' -or $v.ProductVersion -ne '2.0.19'){throw 'File/Product version mismatch'}\n$a=[Reflection.Assembly]::LoadFile($exe)\n$s=$a.GetManifestResourceStream('wandou.package.zip')\n$hash=[Security.Cryptography.SHA256]::Create()\n$actual=[BitConverter]::ToString($hash.ComputeHash($s)).Replace('-','').ToLowerInvariant()\n$s.Dispose()\n$expected=$a.GetType('InstallBuild').GetField('Sha256',[Reflection.BindingFlags]'Public,Static').GetRawConstantValue()\nif($actual -ne $expected){throw 'Embedded package hash mismatch'}\nWrite-Output 'Verified 2.0.19.0 / 2.0.19 and embedded SHA256'\n`);
  const verify=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',inspectScript],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(verify.status,0,verify.stdout+verify.stderr);
 }finally{fs.rmSync(build,{recursive:true,force:true});}
});
