const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const create=require('../desktop-client/storage-maintenance.cjs');
async function fixture(t,options={}) {
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wandou-usage-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const project=path.join(base,'project'),profile=path.join(base,'profile');await fs.mkdir(project);await fs.mkdir(profile);
 const write=async(root,name,n)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.alloc(n,7));};
 await write(project,'canvas-media/old-id.data',11);await write(project,'canvas-media/sha256-id.data',13);await write(project,'canvas-media/.media-write.tmp',3);await write(project,'canvas-backups/canvas.json',17);await write(project,'local-data/projects.json',19);await write(project,'export-artifacts/design.bin',23);
 await write(profile,'IndexedDB/test/data',29);await write(profile,'settings.json',31);await write(profile,'Cache/Cache_Data/network',37);
 let cleared=0,accepted=true,busy=false,cache=37;const choices=[];
 const service=create({projectRoot:()=>project,profileRoot:()=>profile,session:()=>({getCacheSize:async()=>cache,clearCache:async()=>{cleared++;cache=0;}}),confirmClear:async location=>{choices.push(location);return accepted;},isBusy:()=>busy,...options});
 return {service,base,project,profile,write,get cleared(){return cleared;},choices,set accepted(v){accepted=v;},set busy(v){busy=v;}};
}
test('disk usage reports byte sizes by role, including legacy originals, without loading/changing image data',async t=>{
 const f=await fixture(t);const before=await fs.readFile(path.join(f.project,'canvas-media/old-id.data'));const r=await f.service.info();
 assert.deepEqual(r.sizes,{originals:24,backups:17,projects:19,exports:23,temporary:3,profile:60,browserSession:0});assert.equal(r.cacheBytes,37);assert.equal(r.partial,false);assert.equal(r.profileDirectory,f.profile);assert.deepEqual(await fs.readFile(path.join(f.project,'canvas-media/old-id.data')),before);
});
test('only confirmed HTTP-cache API is cleared; originals, project files, IndexedDB, settings and temporary writes survive',async t=>{
 const f=await fixture(t);assert.equal((await f.service.clearCache()).success,true);assert.equal(f.cleared,1);assert.deepEqual(f.choices,[path.join(f.profile,'Cache')]);
 for(const file of [path.join(f.project,'canvas-media/old-id.data'),path.join(f.project,'canvas-media/.media-write.tmp'),path.join(f.profile,'IndexedDB/test/data'),path.join(f.profile,'settings.json')])assert.ok((await fs.stat(file)).size>0);
});
test('cancel and task busy paths never dispatch cleanup, including a task starting during confirmation',async t=>{
 const f=await fixture(t);f.accepted=false;assert.equal((await f.service.clearCache()).canceled,true);f.busy=true;assert.equal((await f.service.clearCache()).success,false);assert.equal(f.cleared,0);
 let calls=0,busy=false;const s=create({projectRoot:()=>f.project,profileRoot:()=>f.profile,isBusy:()=>busy,confirmClear:async()=>{busy=true;return true;},session:()=>({clearCache:async()=>calls++,getCacheSize:async()=>0})});assert.equal((await s.clearCache()).success,false);assert.equal(calls,0);
});
test('double click while confirmation is pending dispatches only one cleanup',async t=>{
 const f=await fixture(t);let release,calls=0;const s=create({projectRoot:()=>f.project,profileRoot:()=>f.profile,confirmClear:()=>new Promise(r=>release=r),session:()=>({clearCache:async()=>calls++,getCacheSize:async()=>0})});
 const first=s.clearCache();assert.equal((await s.clearCache()).success,false);release(true);assert.equal((await first).success,true);assert.equal(calls,1);
});
test('cache failure reports an error and releases gate so a later explicit retry works',async t=>{
 const f=await fixture(t);let fail=true;const s=create({projectRoot:()=>f.project,profileRoot:()=>f.profile,confirmClear:async()=>true,session:()=>({clearCache:async()=>{if(fail)throw Error('disk unavailable');},getCacheSize:async()=>0})});
 assert.match((await s.clearCache()).error,/disk unavailable/);fail=false;assert.equal((await s.clearCache()).success,true);
});
test('usage skips redirected directories and reports incomplete scans without following them',async t=>{
 const f=await fixture(t);const outside=path.join(f.base,'outside');await fs.mkdir(outside);await f.write(outside,'secret.data',1000);await fs.symlink(outside,path.join(f.project,'canvas-media','redirect'),'junction');
 const r=await f.service.info();assert.equal(r.sizes.originals,24);assert.equal(r.partial,true);assert.equal(r.skipped,1);
});
test('entry limits and missing directories report partial results rather than claiming a complete zero',async t=>{
 const f=await fixture(t,{limit:1});assert.equal((await f.service.info()).partial,true);await fs.rename(f.project,f.project+'-removed');assert.equal((await f.service.info()).partial,true);
});
