const wandouQaVersion=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../desktop-client/package.json'),'utf8')).version;
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const moduleFile=path.resolve(__dirname,'../desktop-client/storage-maintenance.cjs'),qa=path.resolve(__dirname,'../../qa');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const report={version:wandouQaVersion,success:false,productionDataAccessed:false,paidCalls:0,checks:[],scopeHashes:{'desktop-client/storage-maintenance.cjs':sha(sync.readFileSync(moduleFile))},testSha256:sha(sync.readFileSync(__filename))};
const plain=value=>JSON.parse(JSON.stringify(value));
function load(api=fs,clock=Date){const module={exports:{}};vm.runInNewContext(sync.readFileSync(moduleFile,'utf8'),{module,require:name=>name==='node:fs/promises'?api:require(name),Date:clock},{filename:moduleFile});return module.exports;}
function check(name,fn){test(name,async t=>{try{await fn(t);report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false,error:error.message});throw error;}});}
test.after(()=>{report.scopeHashesAfter={'desktop-client/storage-maintenance.cjs':sha(sync.readFileSync(moduleFile))};report.runtimeUnchanged=JSON.stringify(report.scopeHashes)===JSON.stringify(report.scopeHashesAfter);report.success=report.checks.length===13&&report.checks.every(c=>c.passed)&&report.runtimeUnchanged;sync.mkdirSync(qa,{recursive:true});sync.writeFileSync(path.join(qa,'storage-usage-breakdown-v228.json'),JSON.stringify(report,null,2));});
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wandou-v228-usage-'));t.after(async()=>{assert.equal(path.dirname(base),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('wandou-v228-usage-'));await fs.rm(base,{recursive:true,force:true});});
 const project=path.join(base,'project'),profile=path.join(base,'profile'),browser=path.join(project,'browser-session');for(const p of [project,profile,browser])await fs.mkdir(p,{recursive:true});
 const files={'canvas-media/sample.data':17,'canvas-media/originals/sample.png':13,'canvas-media/.original-metadata/sample.json':11,'canvas-media/.original-recovery/sample-corrupt.data':7,'canvas-media/originals/sample.png.publish-intent.json':5,'canvas-media/originals/.publication-key':32,'canvas-media/.media-test.tmp':3,'canvas-media/originals/.recovered-sample.png-test.partial':19,'canvas-media/unknown.bin':2,'canvas-backups/one.json':23,'local-data/projects.json':29,'export-artifacts/design.psd':31,'browser-session/IndexedDB/state.tmp':37,'browser-session/Cache/network':41};
 const write=async(root,rel,data)=>{const file=path.join(root,rel);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof data==='number'?Buffer.alloc(data,7):data);return file;};
 for(const [file,size]of Object.entries(files))await write(project,file,size);await write(profile,'settings.json',43);await write(profile,'Cache/old-cache',47);
 let cacheCalls=0;const options={projectRoot:()=>project,profileRoot:()=>profile,sessionRoot:()=>browser,session:()=>({getCacheSize:async()=>{cacheCalls++;return 41;},clearCache:async()=>{throw Error('Unexpected cache clearing');}}),confirmClear:async()=>{throw Error('Unexpected cleanup prompt');}};
 return {base,project,profile,browser,files,write,options,get cacheCalls(){return cacheCalls;}};
}
async function snapshot(root){const out={};async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink())out[path.relative(root,file)]='link';else if(e.isDirectory())await walk(file);else out[path.relative(root,file)]=sha(await fs.readFile(file));}}await walk(root);return out;}
check('size-only inventory separates retained original roles, sums exactly and does not read contents or mutate any file',async t=>{
 const f=await fixture(t),before=await snapshot(f.base),api={...fs};for(const name of ['readFile','writeFile','open','rename','unlink','rm','mkdir','copyFile'])api[name]=()=>{throw Error('Inventory attempted '+name);};
 const r=await load(api)(f.options).info();assert.equal(r.partial,false);assert.deepEqual(plain(r.originalBreakdown),{standard:13,compatibility:17,metadata:48,recovery:26,other:2});assert.equal(Object.values(r.originalBreakdown).reduce((a,b)=>a+b,0),r.sizes.originals);assert.equal(r.sizes.originals,106);assert.equal(r.sizes.temporary,3);assert.equal(r.sizes.backups,23);assert.equal(r.sizes.browserSession,37);assert.equal(r.sizes.profile,90);assert.equal(r.cacheBytes,41);assert.equal(r.fileCount,15);assert.deepEqual(await snapshot(f.base),before);
});
check('unsupported media and filename-only standards are measured without claiming content validation; browser .tmp is never media temporary',async t=>{
 const f=await fixture(t);await f.write(f.project,'canvas-media/sound.data',53);await f.write(f.project,'canvas-media/originals/unsafe.svg','<svg><script>not executed</script></svg>');await f.write(f.project,'canvas-media/originals/custom.txt',59);await f.write(f.project,'canvas-media/subfolder/other.data',61);
 const before=await snapshot(f.base),r=await load()(f.options).info();assert.equal(r.originalBreakdown.compatibility,70);assert.equal(r.originalBreakdown.other,122);assert.equal(r.originalBreakdown.standard,13+Buffer.byteLength('<svg><script>not executed</script></svg>'));assert.equal(r.sizes.temporary,3);assert.equal(r.sizes.browserSession,37);assert.equal(r.partial,false);assert.deepEqual(await snapshot(f.base),before);
});
check('file removed between directory listing and stat is partial, not a complete lower total',async t=>{
 const f=await fixture(t),target=path.join(f.project,'canvas-media/sample.data');let removed=false;const api={...fs,lstat:async file=>{if(file===target&&!removed){removed=true;await fs.unlink(file);}return fs.lstat(file);}};
 const r=await load(api)(f.options).info();assert.equal(removed,true);assert.equal(r.partial,true);assert.equal(r.skipped,1);assert.ok(r.partialReasons.includes('changed-during-scan'));assert.equal(r.originalBreakdown.compatibility,0);
});
check('a nested directory disappearing before traversal reports a partial inventory',async t=>{
 const f=await fixture(t),target=path.join(f.project,'canvas-backups');let moved=false;const api={...fs,lstat:async file=>{if(file===target&&!moved){moved=true;await fs.rename(file,path.join(f.base,'retained-backups'));}return fs.lstat(file);}};
 const r=await load(api)(f.options).info();assert.equal(r.partial,true);assert.ok(r.partialReasons.includes('changed-during-scan'));assert.equal(r.sizes.backups,0);assert.equal((await fs.stat(path.join(f.base,'retained-backups/one.json'))).size,23);
});
check('permission failures keep partial bytes, preserve all files, and permit a later retry',async t=>{
 const f=await fixture(t),before=await snapshot(f.base),target=path.join(f.project,'canvas-media/sample.data');let fail=true;const api={...fs,lstat:async file=>{if(file===target&&fail)throw Object.assign(Error('synthetic denied'),{code:'EACCES'});return fs.lstat(file);}};const service=load(api)(f.options);
 const first=await service.info();assert.equal(first.partial,true);assert.ok(first.partialReasons.includes('unreadable-entry'));fail=false;const second=await service.info();assert.equal(second.partial,false);assert.equal(second.originalBreakdown.compatibility,17);assert.deepEqual(await snapshot(f.base),before);
});
check('junctions are skipped without counting files outside the selected roots',async t=>{
 const f=await fixture(t),outside=path.join(f.base,'outside');await fs.mkdir(outside);await f.write(outside,'private.bin',10000);await fs.symlink(outside,path.join(f.project,'canvas-media/redirect'),'junction');
 const r=await load()(f.options).info();assert.equal(r.partial,true);assert.ok(r.partialReasons.includes('redirected-path'));assert.equal(r.sizes.originals,106);assert.equal((await fs.stat(path.join(outside,'private.bin'))).size,10000);
});
check('nested realpath redirection is rejected before opening the redirected directory',async t=>{
 const f=await fixture(t),target=path.join(f.project,'canvas-media/originals');let opened=false;const api={...fs,realpath:async file=>file===target?path.join(f.base,'outside'):fs.realpath(file),opendir:async file=>{if(file===target)opened=true;return fs.opendir(file);}};
 const r=await load(api)(f.options).info();assert.equal(opened,false);assert.equal(r.partial,true);assert.ok(r.partialReasons.includes('redirected-path'));assert.equal(r.originalBreakdown.standard,0);
});
check('entry and time bounds expose their reasons and never imply a complete zero',async t=>{
 const f=await fixture(t);const bounded=await load()({...f.options,limit:1}).info();assert.equal(bounded.partial,true);assert.ok(bounded.partialReasons.includes('entry-limit'));assert.ok(bounded.scannedEntries<=1);
 let tick=0;const timed=await load(fs,{now:()=>tick++*10})({...f.options,timeoutMs:1}).info();assert.equal(timed.partial,true);assert.ok(timed.partialReasons.includes('time-limit'));assert.equal(timed.fileCount,0);
});
check('missing root and invalid/failed HTTP cache measurements report explicit partial reasons',async t=>{
 const f=await fixture(t);await fs.rename(f.project,path.join(f.base,'retained-project'));const missing=await load()(f.options).info();assert.equal(missing.partial,true);assert.ok(missing.partialReasons.includes('missing-directory'));
 for(const value of [-1,NaN,Infinity,'41']){const r=await load()({...f.options,session:()=>({getCacheSize:async()=>value})}).info();assert.equal(r.cacheBytes,null);assert.ok(r.partialReasons.includes('cache-unavailable'));}
 const failed=await load()({...f.options,session:()=>({getCacheSize:async()=>{throw Error('synthetic unavailable');}})}).info();assert.ok(failed.partialReasons.includes('cache-unavailable'));
});
check('concurrent callers share one scan and completion, then a new explicit request rescans',async t=>{
 const f=await fixture(t);let release;const held=new Promise(r=>release=r);let first=true,entered;const started=new Promise(r=>entered=r);const api={...fs,lstat:async file=>{if(first){first=false;entered();await held;}return fs.lstat(file);}};const service=load(api)(f.options),calls=Array.from({length:8},()=>service.info());await started;release();const results=await Promise.all(calls);for(const result of results)assert.strictEqual(result,results[0]);assert.equal(f.cacheCalls,1);assert.equal((await service.info()).partial,false);assert.equal(f.cacheCalls,2);
});
check('scan initialization failure releases shared promise for retry without cleanup',async t=>{
 const f=await fixture(t);let fail=true;const service=load()({...f.options,projectRoot:()=>{if(fail)throw Error('synthetic unavailable');return f.project;}});await assert.rejects(service.info(),/synthetic unavailable/);fail=false;assert.equal((await service.info()).partial,false);
});
check('a root changing during scanning is reported and the new root is not traversed',async t=>{
 const f=await fixture(t),other=path.join(f.base,'other');await fs.mkdir(other);await f.write(other,'not-selected.data',10000);let current=f.project;const r=await load()({...f.options,projectRoot:()=>current,session:()=>({getCacheSize:async()=>{current=other;return 41;}})}).info();assert.equal(r.projectDirectory,f.project);assert.equal(r.sizes.originals,106);assert.equal(r.partial,true);assert.ok(r.partialReasons.includes('location-changed'));
});
check('legacy same-root profile is counted once without double-counting managed originals or HTTP cache',async t=>{
 const f=await fixture(t);const r=await load()({...f.options,profileRoot:()=>f.project,sessionRoot:()=>f.project}).info();assert.equal(r.sizes.originals,106);assert.equal(r.originalBreakdown.compatibility,17);assert.equal(r.sizes.browserSession,0);assert.equal(r.sizes.profile,0);assert.equal(r.partial,false);
});
