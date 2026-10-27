const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const desktop=process.env.WANDOU_TEST_DESKTOP_ROOT||path.resolve(__dirname,'../desktop-client');
const create=require(path.join(desktop,'project-storage.cjs'));
const parent=path.resolve(__dirname,'../artifacts/portable-storage-20261027/test-fixtures');
function fixture(){
 fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'portable-'));
 const legacyRoot=path.join(base,'profile'),installRoot=path.join(base,'program');
 for(const directory of[legacyRoot,installRoot])fs.mkdirSync(directory);
 const portableRoot=path.join(installRoot,'豌豆AI数据'),configFile=path.join(legacyRoot,'project-storage.json');
 return{base,legacyRoot,installRoot,portableRoot,configFile,make:extra=>create({legacyRoot,installRoot,...extra})};
}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)}
function seed(f){write(path.join(f.legacyRoot,'canvas-media/original.data'),'data:image/png;base64,AQID');write(path.join(f.legacyRoot,'canvas-backups/folder/project/1.json'),'{"state":{"nodes":[{"id":"saved","fullUrl":"indexed-media:original"}]}}');write(path.join(f.legacyRoot,'project-hub-state.json'),'{"folders":[{"id":"folder"}]}');write(path.join(f.legacyRoot,'IndexedDB/workbench.bin'),'workbench');write(path.join(f.legacyRoot,'client-settings.json'),'secret-settings');}
function marker(directory,id=crypto.randomUUID()){write(path.join(directory,'.wandou-project-storage.json'),JSON.stringify({format:'wandou-project-storage',version:1,id}));return id;}

test('fresh install defaults beside the program and never creates a C-profile image library',async()=>{
 const f=fixture(),api=f.make();await api.prepareStartup();assert.equal(api.hasPending(),true);assert.equal(fs.existsSync(f.portableRoot),false);
 assert.equal((await api.initialize()).migrated,true);assert.equal(api.root(),f.portableRoot);
 const info=await api.info();assert.equal(info.storageMode,'portable');assert.equal(info.custom,false);assert.equal(info.defaultDirectory,f.portableRoot);
 await api.write(()=>write(path.join(api.root(),'canvas-media/new.data'),'new original'));
 assert.equal(fs.existsSync(path.join(f.legacyRoot,'canvas-media')),false);assert.equal(fs.readFileSync(path.join(f.portableRoot,'canvas-media/new.data'),'utf8'),'new original');
 assert.equal(JSON.parse(fs.readFileSync(f.configFile,'utf8')).active.mode,'portable');
});
test('older default project bytes migrate and verify before use while settings and source remain intact',async()=>{
 const f=fixture();seed(f);const api=f.make(),result=await api.initialize();assert.equal(result.success,true);assert.equal(result.fileCount,3);
 for(const relative of['canvas-media/original.data','canvas-backups/folder/project/1.json','project-hub-state.json'])assert.deepEqual(fs.readFileSync(path.join(f.portableRoot,relative)),fs.readFileSync(path.join(f.legacyRoot,relative)));
 for(const relative of['IndexedDB/workbench.bin','client-settings.json'])assert.equal(fs.existsSync(path.join(f.portableRoot,relative)),false);
 assert.equal((await api.info()).previousDirectory,f.legacyRoot);
});
test('existing explicit v1 custom selection is retained until the user selects the program directory',async()=>{
 const f=fixture(),custom=path.join(f.base,'custom','豌豆AI数据'),id=marker(custom);write(path.join(custom,'canvas-media/original.data'),'custom original');
 write(f.configFile,JSON.stringify({version:1,active:{directory:custom,id}}));
 const api=f.make();await api.initialize();assert.equal(api.root(),custom);assert.equal((await api.info()).storageMode,'custom');assert.equal(fs.existsSync(f.portableRoot),false);
 const selected=await api.chooseDefault();assert.equal(api.root(),custom);assert.equal(fs.existsSync(f.portableRoot),false);
 await api.prepare(selected);const restarted=f.make();assert.equal((await restarted.initialize()).migrated,true);assert.equal(restarted.root(),f.portableRoot);
 assert.equal((await restarted.info()).storageMode,'portable');assert.equal(fs.readFileSync(path.join(custom,'canvas-media/original.data'),'utf8'),'custom original');
});
test('moving the whole program resolves the same portable marker at the new location',async()=>{
 const f=fixture();seed(f);const api=f.make();await api.initialize();const before=JSON.parse(fs.readFileSync(f.configFile,'utf8'));
 const relocated=path.resolve(f.base,'moved-program');assert.equal(path.dirname(relocated),f.base);assert.equal(path.dirname(f.installRoot),f.base);fs.renameSync(f.installRoot,relocated);
 const moved=f.make({installRoot:relocated});await moved.prepareStartup();await moved.initialize();
 assert.equal(moved.root(),path.join(relocated,'豌豆AI数据'));assert.equal(JSON.parse(fs.readFileSync(f.configFile,'utf8')).active.id,before.active.id);
 assert.equal(JSON.parse(fs.readFileSync(f.configFile,'utf8')).active.directory,moved.root());assert.equal(fs.existsSync(f.installRoot),false);
 assert.equal(await moved.read(()=>fs.readFileSync(path.join(moved.root(),'canvas-media/original.data'),'utf8')),'data:image/png;base64,AQID');
});
test('moving only program files or losing the portable marker blocks without blank fallback',async()=>{
 const f=fixture();seed(f);await f.make().initialize();const newInstall=path.join(f.base,'program-without-data');fs.mkdirSync(newInstall);
 const api=f.make({installRoot:newInstall});let wrote=false;await assert.rejects(()=>api.write(()=>{wrote=true}),/暂不可用/);
 assert.equal(wrote,false);assert.equal(fs.existsSync(path.join(newInstall,'豌豆AI数据')),false);
 assert.equal(fs.readFileSync(path.join(f.legacyRoot,'canvas-media/original.data'),'utf8'),'data:image/png;base64,AQID');
 const markerFile=path.join(f.portableRoot,'.wandou-project-storage.json');fs.renameSync(markerFile,markerFile+'.held');
 await assert.rejects(()=>f.make().initialize(),/暂不可用/);assert.equal(fs.existsSync(markerFile),false);
});
test('a portable folder brought to a clean profile adopts its marker and original files',async()=>{
 const f=fixture(),id=marker(f.portableRoot);write(path.join(f.portableRoot,'canvas-media/original.data'),'portable original');
 const api=f.make();await api.initialize();assert.equal(api.root(),f.portableRoot);assert.equal(JSON.parse(fs.readFileSync(f.configFile,'utf8')).active.id,id);
 assert.equal(fs.readFileSync(path.join(f.portableRoot,'canvas-media/original.data'),'utf8'),'portable original');
});
test('nonempty unmarked targets and conflicting legacy/portable projects are never overwritten',async()=>{
 const f=fixture();write(path.join(f.portableRoot,'user-file.txt'),'unrelated');
 await assert.rejects(()=>f.make().initialize(),/已有无法识别/);assert.equal(fs.readFileSync(path.join(f.portableRoot,'user-file.txt'),'utf8'),'unrelated');assert.equal(fs.existsSync(f.configFile),false);
 marker(f.portableRoot);seed(f);await assert.rejects(()=>f.make().initialize(),/不能自动合并/);assert.equal(fs.existsSync(f.configFile),false);
});
test('a read-only program directory blocks fresh project writes instead of falling back to the profile',async()=>{
 const f=fixture(),original=fsp.mkdir;
 fsp.mkdir=async(directory,...args)=>{if(path.resolve(directory).startsWith(f.installRoot+path.sep)){const error=Error('simulated read-only program directory');error.code='EACCES';throw error}return original(directory,...args)};
 try{const api=f.make();let wrote=false;await assert.rejects(()=>api.write(()=>{wrote=true}),/无法在程序目录/);assert.equal(wrote,false);assert.equal(fs.existsSync(path.join(f.legacyRoot,'canvas-media')),false);assert.equal(fs.existsSync(f.portableRoot),false)}finally{fsp.mkdir=original}
 const retry=f.make();assert.equal((await retry.initialize()).migrated,true);assert.equal(retry.root(),f.portableRoot);
});
test('an interrupted default migration blocks editor access and safely resumes on restart',async()=>{
 const f=fixture();seed(f);let once=false;const api=f.make({fault:async phase=>{if(phase==='copied-file'&&!once){once=true;throw Error('simulated interruption')}}});
 await assert.rejects(()=>api.initialize(),/无法在程序目录/);assert.equal(api.root(),f.legacyRoot);assert.equal(fs.existsSync(f.portableRoot),false);
 const pending=JSON.parse(fs.readFileSync(f.configFile,'utf8')).pending;assert.equal(pending.automaticDefault,true);assert.equal(pending.status,'failed');
 const retry=f.make();assert.equal((await retry.initialize()).migrated,true);assert.equal(retry.root(),f.portableRoot);
});
test('default migration can finish a published target after config interruption without another full copy',async()=>{
 const f=fixture();seed(f);const failed=f.make({fault:async(phase,{value}={})=>{if(phase==='config-rename'&&value.active?.mode==='portable')throw Error('config switch unavailable')}});
 await assert.rejects(()=>failed.initialize(),/无法在程序目录/);assert.equal(fs.existsSync(f.portableRoot),true);
 const statfs=fsp.statfs;fsp.statfs=async()=>({bavail:0,bsize:4096});
 try{const retry=f.make();assert.equal((await retry.initialize()).migrated,true);assert.equal(retry.root(),f.portableRoot)}finally{fsp.statfs=statfs}
});
test('only the exact portable directory is permitted under the installation and redirected roots are rejected',async()=>{
 const f=fixture(),api=f.make();await api.chooseDefault();
 await assert.rejects(()=>api.choose(path.join(f.installRoot,'other')),/安装目录/);
 await assert.rejects(()=>api.choose(path.join(f.installRoot,'程序文件')),/安装目录/);
 const alias=path.join(f.base,'alias');fs.symlinkSync(f.installRoot,alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>f.make({installRoot:alias}).initialize(),/链接|重定向/);
});
test('moving a program while an unfinished portable migration is pending cannot switch to its old location',async()=>{
 const f=fixture();seed(f);await f.make().prepareStartup();const moved=path.resolve(f.base,'moved-during-migration');assert.equal(path.dirname(moved),f.base);fs.renameSync(f.installRoot,moved);
 const api=f.make({installRoot:moved});await assert.rejects(()=>api.initialize(),/程序目录发生变化/);assert.equal(api.root(),f.legacyRoot);assert.equal(fs.existsSync(path.join(moved,'豌豆AI数据')),false);
});
