const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const desktop=process.env.WANDOU_TEST_DESKTOP_ROOT||path.resolve(__dirname,'../desktop-client');
const create=require(path.join(desktop,'project-storage.cjs'));
const parent=path.resolve(__dirname,'../artifacts/storage-directory-20261025/test-fixtures');
function fixture(){
 fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'storage-')),legacyRoot=path.join(base,'legacy'),installRoot=path.join(base,'software'),targetParent=path.join(base,'other-drive');
 for(const dir of [legacyRoot,installRoot,targetParent])fs.mkdirSync(dir);
 const files={'canvas-media/original.data':'data:image/png;base64,AA==','canvas-backups/folder/project/10-abcd.json':'{"format":"wandou-canvas-backup","state":{"nodes":[{"fullUrl":"indexed-media:original"}]}}','local-data/data/file.json':'{"saved":true}','export-artifacts/original.bin':'original bytes','project-hub-state.json':'{"folders":[{"id":"folder"}]}','IndexedDB/browser-only.db':'workbench must stay','ui-theme.json':'{"theme":"dark"}'};
 for(const [relative,value]of Object.entries(files)){const file=path.join(legacyRoot,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)}
 const make=(fault)=>create({legacyRoot,installRoot,fault}),target=path.join(targetParent,'豌豆AI数据');
 return{base,legacyRoot,installRoot,targetParent,target,files,make};
}
async function prepared(f,api=f.make()){const choice=await api.choose(f.targetParent);assert.equal(choice.targetDirectory,f.target);assert.equal(fs.existsSync(f.target),false);await api.prepare(choice);return{api,choice}}
test('legacy is kept before verified startup; chooser is preview-only and forged or conflicting destinations are rejected',async()=>{
 const f=fixture(),api=f.make(),info=await api.info();assert.equal(info.currentDirectory,f.legacyRoot);assert.equal(info.storageMode,'legacy');assert.equal(info.defaultDirectory,path.join(f.installRoot,'豌豆AI数据'));assert.equal(info.custom,false);assert.equal(info.fileCount,5);
 await assert.rejects(()=>api.prepare({targetDirectory:f.target,selectionToken:'forged'}),/失效/);
 const portable=await api.chooseDefault();assert.equal(portable.targetDirectory,path.join(f.installRoot,'豌豆AI数据'));assert.equal(fs.existsSync(portable.targetDirectory),false);
 await assert.rejects(()=>api.choose(path.join(f.installRoot,'nested')),/安装目录/);
 fs.mkdirSync(f.target);fs.writeFileSync(path.join(f.target,'unrelated.txt'),'keep');await assert.rejects(()=>api.choose(f.targetParent),/已有内容/);assert.equal(fs.readFileSync(path.join(f.target,'unrelated.txt'),'utf8'),'keep');
});
test('offline startup migration verifies exact bytes, switches configuration once and preserves all old files and Chromium data',async()=>{
 const f=fixture();await prepared(f);const api=f.make(),result=await api.initialize();assert.equal(result.migrated,true);assert.equal(api.root(),f.target);
 for(const [relative,value]of Object.entries(f.files)){assert.equal(fs.readFileSync(path.join(f.legacyRoot,relative),'utf8'),value);if(!relative.startsWith('IndexedDB')&&relative!=='ui-theme.json')assert.equal(fs.readFileSync(path.join(f.target,relative),'utf8'),value)}
 assert.equal(fs.existsSync(path.join(f.target,'IndexedDB')),false);assert.equal(fs.existsSync(path.join(f.target,'ui-theme.json')),false);
 const config=JSON.parse(fs.readFileSync(path.join(f.legacyRoot,'project-storage.json'),'utf8'));assert.equal(config.pending,null);assert.equal(config.active.directory,f.target);assert.equal(config.previousDirectory,f.legacyRoot);
 const reopened=f.make();await reopened.initialize();assert.equal((await reopened.info()).available,true);assert.equal(reopened.root(),f.target);
});
test('insufficient target capacity refuses migration before creating files or changing configuration',async()=>{
 const f=fixture(),original=fsp.statfs;fsp.statfs=async()=>({bavail:1,bsize:1});
 try{await assert.rejects(()=>f.make().choose(f.targetParent),/空间不足/);assert.equal(fs.existsSync(f.target),false);assert.equal(fs.existsSync(path.join(f.legacyRoot,'project-storage.json')),false)}finally{fsp.statfs=original}
});
test('interrupted copy resumes its owned stage and verifies already copied files',async()=>{
 const f=fixture();await prepared(f);let stopped=false;
 const crash=f.make(async(phase,context)=>{if(phase==='copied-file'&&!stopped){stopped=true;throw Error('simulated interruption')}if(phase==='config-rename'&&context.value.pending?.status==='failed')throw Error('process stopped before error record')});
 assert.equal((await crash.initialize()).success,false);assert.equal(crash.root(),f.legacyRoot);assert.equal(fs.existsSync(f.target),false);
 const pending=JSON.parse(fs.readFileSync(path.join(f.legacyRoot,'project-storage.json'),'utf8')).pending;assert.equal(pending.status,'pending');assert.equal(fs.existsSync(pending.stage),true);
 assert.equal((await f.make().initialize()).migrated,true);
});
test('failed migration preserves source and permits a fresh retry after more source edits',async()=>{
 const f=fixture();await prepared(f);const failure=f.make(async phase=>{if(phase==='copied-file')throw Error('simulated copy failure')});assert.equal((await failure.initialize()).success,false);assert.equal(failure.root(),f.legacyRoot);
 const previous=JSON.parse(fs.readFileSync(path.join(f.legacyRoot,'project-storage.json'),'utf8')).pending;
 fs.writeFileSync(path.join(f.legacyRoot,'canvas-media/new.data'),'data:image/jpeg;base64,AA==');
 const retry=f.make(),choice=await retry.choose(f.targetParent);await retry.prepare(choice);assert.equal((await f.make().initialize()).migrated,true);
 assert.equal(fs.existsSync(previous.stage),true,'failed partial copy is retained rather than deleted');assert.equal(fs.existsSync(path.join(f.target,'canvas-media/new.data')),true);
});
test('crash after target publish but before config switch can safely finish the atomic switch',async()=>{
 const f=fixture();await prepared(f);const api=f.make(async(phase,context)=>{if(phase==='config-rename'&&context.value.active?.directory===f.target)throw Error('config volume unavailable')});
 assert.equal((await api.initialize()).success,false);assert.equal(api.root(),f.legacyRoot);assert.equal(fs.existsSync(f.target),true);
 const original=fsp.statfs;fsp.statfs=async()=>({bavail:0,bsize:4096});
 try{const retry=f.make(),choice=await retry.choose(f.targetParent);assert.equal(choice.requiredBytes,0);await retry.prepare(choice);assert.equal((await f.make().initialize()).migrated,true)}finally{fsp.statfs=original}
});
test('concurrent source changes refuse the switch and keep the old root active',async()=>{
 const f=fixture();await prepared(f);let edited=false;const api=f.make(async phase=>{if(phase==='copied-file'&&!edited){edited=true;fs.writeFileSync(path.join(f.legacyRoot,'project-hub-state.json'),'changed during migration')}});
 assert.equal((await api.initialize()).success,false);assert.equal(api.root(),f.legacyRoot);assert.equal(fs.existsSync(f.target),false);assert.equal(fs.readFileSync(path.join(f.legacyRoot,'project-hub-state.json'),'utf8'),'changed during migration');
});
test('disconnected external data root blocks read/write/startup and never silently recreates an empty library',async()=>{
 const f=fixture();await prepared(f);await f.make().initialize();const moved=path.join(f.base,'disconnected-copy');assert.ok(moved.startsWith(f.base+path.sep));fs.renameSync(f.target,moved);
 const api=f.make();assert.equal((await api.info()).available,false);let called=false;await assert.rejects(()=>api.write(()=>{called=true}),/暂不可用/);await assert.rejects(()=>api.read(()=>{called=true}),/暂不可用/);await assert.rejects(()=>api.initialize(),/暂不可用/);assert.equal(called,false);assert.equal(api.root(),f.target);assert.equal(fs.existsSync(f.target),false);
});
test('runtime disconnection stays latched after reconnection until a new process reloads the saved project',async()=>{
 const f=fixture();await prepared(f);const api=f.make();await api.initialize();
 const moved=path.join(f.base,'offline-root');assert.ok(moved.startsWith(f.base+path.sep));fs.renameSync(f.target,moved);
 await assert.rejects(()=>api.read(()=>[]),/暂不可用/);fs.renameSync(moved,f.target);
 assert.equal(await api.checkConnection(),true);let mutated=false;
 await assert.rejects(()=>api.write(()=>{mutated=true}),/曾中断/);await assert.rejects(()=>api.read(()=>[]),/曾中断/);assert.equal(mutated,false);
 const restarted=f.make();await restarted.initialize();assert.equal(await restarted.write(()=>true),true);
 assert.equal(fs.readFileSync(path.join(f.target,'project-hub-state.json'),'utf8'),f.files['project-hub-state.json']);
});
test('freeze waits for current writes and rejects new writes until explicitly released',async()=>{
 const f=fixture(),api=f.make();let release,start;const started=new Promise(r=>start=r),pending=api.write(async()=>{start();await new Promise(r=>release=r);return 3});await started;
 let completed=false;const freeze=api.freeze().then(()=>{completed=true});await new Promise(r=>setTimeout(r,5));assert.equal(completed,false);await assert.rejects(()=>api.write(()=>1),/切换/);release();assert.equal(await pending,3);await freeze;api.unfreeze();assert.equal(await api.write(()=>4),4);
});
test('linked target parents and linked source directories are rejected without following them',async()=>{
 const f=fixture(),alias=path.join(f.base,'alias');fs.symlinkSync(f.targetParent,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(()=>f.make().choose(alias),/链接|重定向/);
 fs.symlinkSync(f.installRoot,path.join(f.legacyRoot,'canvas-media/linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>f.make().choose(f.targetParent),/链接/);assert.equal(fs.existsSync(f.target),false);
});
