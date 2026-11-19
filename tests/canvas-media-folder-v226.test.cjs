const wandouQaVersion=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../desktop-client/package.json'),'utf8')).version;
'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const desktop=path.resolve(__dirname,'../desktop-client'),qa=path.resolve(__dirname,'../../qa'),createLocation=require(path.join(desktop,'canvas-media-location.cjs')),createProtocol=require(path.join(desktop,'canvas-media-protocol.cjs')),files=require(path.join(desktop,'canvas-media-files.cjs'));
const baselineFile=path.resolve(__dirname,'../../../release-v225/source/desktop-client/canvas-media-location.cjs'),baselineLocation=require(baselineFile);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const roots=[],checks=[],sourceNames=['canvas-media-location.cjs','main.js'],hashes=()=>Object.fromEntries(sourceNames.map(name=>[name,sha(fs.readFileSync(path.join(desktop,name)))]));let initial,startedAt;
before(()=>{initial=hashes();startedAt=new Date().toISOString();});
after(async()=>{const final=hashes(),unchanged=JSON.stringify(initial)===JSON.stringify(final);fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,'canvas-media-folder-v226.json'),JSON.stringify({version:wandouQaVersion,success:checks.length===13&&checks.every(c=>c.passed)&&unchanged,sourceHashes:initial,sourceHashesAfter:final,sourceUnchanged:unchanged,testSha256:sha(fs.readFileSync(__filename)),baselineSha256:sha(fs.readFileSync(baselineFile)),checks,realShellCalls:0,productionDataAccessed:false,paidCalls:0,startedAt,finishedAt:new Date().toISOString()},null,2));for(const root of roots){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('wandou-v226-folder-'));assert.equal(await fsp.realpath(root),root);await fsp.rm(root,{recursive:true,force:true});}assert.equal(unchanged,true);});
function check(name,fn){test(name,async t=>{try{await fn(t);checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.stack});throw error;}});}
async function fixture(t){const base=await fsp.mkdtemp(path.join(os.tmpdir(),'wandou-v226-folder-'));roots.push(base);const root=path.join(base,'画布 原图库');await fsp.mkdir(root);const id='source_1',value='data:image/png;base64,'+png.toString('base64');await files.writeLegacy(root,id,value);const standard=await files.ensureStandard(root,id);assert.equal(standard.success,true);const protocol=createProtocol({directory:()=>root});t.after(()=>protocol.dispose());const calls={open:[],show:[]},options={directory:()=>root,getUrl:protocol.getUrl,standardize:async requested=>requested===id?standard:{success:false},platform:'win32',openPath:async directory=>{calls.open.push(directory);return '';},showItemInFolder:file=>{calls.show.push(file);}};return{base,root,id,value,standard,protocol,calls,options,create:extra=>createLocation({...options,...extra})};}
check('v225 void reveal acknowledges a simulated OS failure; Windows replacement does not use that failing API',async t=>{
 const f=await fixture(t);let fireAndForgetFailed=false;const broken=file=>{f.calls.show.push(file);fireAndForgetFailed=true;return undefined;};
 const old=await baselineLocation({...f.options,showItemInFolder:broken}).show('indexed-media:'+f.id);assert.equal(old.shown,true);assert.equal(fireAndForgetFailed,true);assert.equal(f.calls.open.length,0);
 f.calls.show.length=0;const changed=await f.create({showItemInFolder:broken}).show('indexed-media:'+f.id);assert.equal(changed.shown,true);assert.deepEqual(f.calls.open,[path.dirname(f.standard.path)]);assert.deepEqual(f.calls.show,[]);
});
check('Windows opens only the Unicode parent directory and preserves all original bytes and location fields',async t=>{
 const f=await fixture(t),result=await f.create().show('indexed-media:'+f.id);assert.equal(result.success,true);assert.equal(result.shown,true);assert.equal(result.path,f.standard.path);assert.equal(result.directory,path.dirname(f.standard.path));assert.deepEqual(f.calls.open,[result.directory]);assert.deepEqual(f.calls.show,[]);assert.equal(await fsp.readFile(path.join(f.root,f.id+'.data'),'utf8'),f.value);assert.deepEqual(await fsp.readFile(f.standard.path),png);
});
check('actual main-process injection wires shell.openPath to the checked directory',async t=>{
 const f=await fixture(t),source=await fsp.readFile(path.join(desktop,'main.js'),'utf8'),start=source.indexOf("const canvasMediaLocation = require('./canvas-media-location.cjs')"),end=source.indexOf('function isCanvasMediaLocationCaller',start);assert.ok(start>0&&end>start);
 const env={canvasMediaRootDirectory:()=>f.root,canvasMediaProtocol:f.protocol,canvasStandardMedia:{ensure:f.options.standardize},shell:{openPath:f.options.openPath,showItemInFolder:f.options.showItemInFolder},require:()=>options=>createLocation({...options,platform:'win32'})};vm.runInNewContext(source.slice(start,end)+'\nthis.locationForTest=canvasMediaLocation;',env);
 const result=await env.locationForTest.show('indexed-media:'+f.id);assert.equal(result.shown,true);assert.deepEqual(f.calls.open,[path.dirname(f.standard.path)]);assert.deepEqual(f.calls.show,[]);
});
check('Windows waits for the native error-result promise before acknowledging the request',async t=>{
 const f=await fixture(t);let finish,settled=false;const request=f.create({openPath:()=>new Promise(resolve=>finish=resolve)}).show('indexed-media:'+f.id).then(value=>{settled=true;return value;});while(!finish)await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);finish('');assert.equal((await request).shown,true);
});
check('non-empty native openPath error is surfaced as a failed request without fallback',async t=>{
 const f=await fixture(t),result=await f.create({openPath:async directory=>{f.calls.open.push(directory);return 'synthetic OS path error';}}).show('indexed-media:'+f.id);assert.equal(result.success,false);assert.notEqual(result.shown,true);assert.match(result.error,/无法打开/);assert.equal(f.calls.open.length,1);assert.deepEqual(f.calls.show,[]);
});
check('native openPath rejection is surfaced and never invokes fire-and-forget reveal',async t=>{
 const f=await fixture(t),result=await f.create({openPath:async()=>{throw Error('synthetic shell rejection');}}).show('indexed-media:'+f.id);assert.equal(result.success,false);assert.notEqual(result.shown,true);assert.match(result.error,/无法打开/);assert.deepEqual(f.calls.show,[]);
});
check('missing or invalid native completion values cannot be mistaken for success',async t=>{
 const f=await fixture(t);for(const value of [undefined,null,true,false,0]){const result=await f.create({openPath:async()=>value}).show('indexed-media:'+f.id);assert.equal(result.success,false);assert.notEqual(result.shown,true);}const missing=await f.create({openPath:undefined}).show('indexed-media:'+f.id);assert.equal(missing.success,false);assert.deepEqual(f.calls.show,[]);
});
check('untrusted paths, URLs, invalid IDs and stale sessions never reach either shell API',async t=>{
 const f=await fixture(t),url=(await f.protocol.getUrl(f.id)).url;const invalid=[null,{},[],f.standard.path,path.dirname(f.standard.path),'file:///'+f.standard.path,'https://invalid.test/image.png','data:image/png;base64,AAAA','indexed-media:../source_1','indexed-media:..\\source_1','indexed-media:source_1.png','indexed-media:%2fsource_1','indexed-media:'+'a'.repeat(101),url+'?folder=..',url.replace(new URL(url).hostname,'0'.repeat(64))];for(const ref of invalid)assert.equal((await f.create().show(ref)).success,false);assert.deepEqual(f.calls,{open:[],show:[]});
});
check('missing compatibility originals do not invoke shell',async t=>{
 const f=await fixture(t);assert.equal((await f.create().show('indexed-media:missing')).success,false);assert.deepEqual(f.calls,{open:[],show:[]});
});
check('a file removed after location lookup is revalidated before the next open',async t=>{
 const f=await fixture(t),api=f.create();assert.equal((await api.get('indexed-media:'+f.id)).success,true);const kept=path.join(f.base,'retained-synthetic.png');assert.ok(f.standard.path.startsWith(f.base+path.sep)&&kept.startsWith(f.base+path.sep));await fsp.rename(f.standard.path,kept);const result=await api.show('indexed-media:'+f.id);assert.equal(result.success,false);assert.equal(result.missing,true);assert.deepEqual(f.calls,{open:[],show:[]});
});
check('a returned standard path outside the managed originals directory is rejected',async t=>{
 const f=await fixture(t),outside=path.join(f.base,'not-managed.png');await fsp.writeFile(outside,png);const result=await f.create({standardize:async()=>({...f.standard,path:outside})}).show('indexed-media:'+f.id);assert.equal(result.success,false);assert.deepEqual(f.calls,{open:[],show:[]});
});
check('Windows legacy fallback opens its managed folder without executing the data file',async t=>{
 const f=await fixture(t),result=await f.create({standardize:async()=>({success:false,unsupported:true})}).show('indexed-media:'+f.id);assert.equal(result.storageFormat,'data-url');assert.equal(result.shown,true);assert.deepEqual(f.calls.open,[f.root]);assert.deepEqual(f.calls.show,[]);
});
check('macOS and Linux retain file reveal and never call the Windows directory path API',async t=>{
 const f=await fixture(t);for(const platform of ['darwin','linux']){const result=await f.create({platform}).show('indexed-media:'+f.id);assert.equal(result.shown,true);}assert.deepEqual(f.calls.show,[f.standard.path,f.standard.path]);assert.deepEqual(f.calls.open,[]);
});
