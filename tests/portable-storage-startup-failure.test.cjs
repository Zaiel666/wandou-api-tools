const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const desktop=process.env.WANDOU_TEST_DESKTOP_ROOT||path.resolve(__dirname,'../desktop-client');
const create=require(path.join(desktop,'project-storage.cjs'));
const parent=path.resolve(__dirname,'../artifacts/prepublish-v216-20261027/startup-failure-fixtures');
function fixture(){
 fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'case-'));
 const legacyRoot=path.join(base,'profile'),installRoot=path.join(base,'program'),target=path.join(installRoot,'豌豆AI数据');
 fs.mkdirSync(legacyRoot);fs.mkdirSync(installRoot);fs.mkdirSync(path.join(legacyRoot,'canvas-media'));
 const original=path.join(legacyRoot,'canvas-media/original.data');fs.writeFileSync(original,'data:image/png;base64,AQID');
 const settings=path.join(legacyRoot,'Local Storage/leveldb/settings.fixture');fs.mkdirSync(path.dirname(settings),{recursive:true});fs.writeFileSync(settings,'synthetic-api-profile-config');
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const originalHash=sha(original),settingsHash=sha(settings);
 return{base,legacyRoot,installRoot,target,original,settings,sha,originalHash,settingsHash,make:extra=>create({legacyRoot,installRoot,...extra})};
}
function originalUnchanged(f){assert.equal(f.sha(f.original),f.originalHash);assert.equal(f.sha(f.settings),f.settingsHash);assert.equal(fs.existsSync(f.target),false);assert.equal(fs.existsSync(path.join(f.legacyRoot,'project-storage.json')),false)}
function usefulError(f,error,reason){assert.equal(error.code,'PROJECT_STORAGE_UNAVAILABLE');assert.ok(error.message.includes(f.target));assert.ok(error.message.includes(f.legacyRoot));assert.match(error.message,/项目和图片未修改/);assert.match(error.message,/释放目标磁盘空间/);assert.match(error.message,/整个软件目录移到可写且空间足够/);assert.match(error.message,reason);return true}

test('first legacy upgrade with insufficient space blocks edits and reports target/source plus actionable recovery',async()=>{
 const f=fixture(),statfs=fsp.statfs;fsp.statfs=async()=>({bavail:0,bsize:4096});
 try{
  const api=f.make();let callback=false;
  await assert.rejects(()=>api.prepareStartup(),error=>usefulError(f,error,/剩余空间不足/));
  await assert.rejects(()=>api.write(()=>{callback=true}),error=>usefulError(f,error,/剩余空间不足/));
  assert.equal(callback,false);originalUnchanged(f);
 }finally{fsp.statfs=statfs}
 const retry=f.make();assert.equal((await retry.initialize()).migrated,true);assert.equal(retry.root(),f.target);assert.equal(f.sha(f.original),f.originalHash);assert.equal(f.sha(f.settings),f.settingsHash);
});
test('unreadable or unwritable target parent has the same recovery guidance and does not create an empty C library',async()=>{
 const f=fixture(),lstat=fsp.lstat;
 fsp.lstat=async(file,...args)=>{if(path.resolve(file)===f.installRoot){const error=Error('EACCES: isolated program directory access denied');error.code='EACCES';throw error}return lstat(file,...args)};
 try{const api=f.make();let callback=false;await assert.rejects(()=>api.read(()=>{callback=true}),error=>usefulError(f,error,/EACCES/));assert.equal(callback,false);originalUnchanged(f)}finally{fsp.lstat=lstat}
 const retry=f.make();assert.equal((await retry.initialize()).migrated,true);assert.equal(retry.root(),f.target);
});
test('large-file startup verification emits scanning/copy progress and yields the event loop while preserving settings',async()=>{
 const f=fixture();fs.writeFileSync(f.original,'data:image/png;base64,'+'A'.repeat(16*1024*1024));const originalHash=f.sha(f.original);
 const phases=[];let heartbeats=0;const timer=setInterval(()=>heartbeats++,1);
 try{const result=await f.make({onProgress:value=>phases.push({...value,heartbeats})}).initialize();assert.equal(result.success,true);assert.ok(phases.find(item=>item.phase==='scanning'));assert.ok(phases.find(item=>item.phase==='copying'&&item.completedBytes===item.totalBytes));assert.equal(phases.at(-1).phase,'complete');assert.ok(phases.find(item=>item.phase==='copying').heartbeats>0,'Streaming verification must yield while processing files');assert.ok(heartbeats>0)}finally{clearInterval(timer)}
 assert.equal(f.sha(f.original),originalHash);assert.equal(f.sha(path.join(f.target,'canvas-media/original.data')),originalHash);assert.equal(f.sha(f.settings),f.settingsHash);assert.equal(fs.existsSync(path.join(f.target,'Local Storage')),false);
});
