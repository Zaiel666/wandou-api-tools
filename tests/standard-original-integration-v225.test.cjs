'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const sharp=require(path.resolve(__dirname,'../../../../desktop-client/node_modules/sharp'));
const desktop=path.resolve(__dirname,'../desktop-client'),media=require(path.join(desktop,'canvas-media-files.cjs'));
const createProtocol=require(path.join(desktop,'canvas-media-protocol.cjs')),createWriter=require(path.join(desktop,'canvas-media-writer.cjs')),createLocation=require(path.join(desktop,'canvas-media-location.cjs')),createStore=require(path.join(desktop,'canvas-media-standard-store.cjs')),createStorage=require(path.join(desktop,'project-storage.cjs'));
const roots=[];let png;
test.before(async()=>{png=await sharp({create:{width:32,height:20,channels:4,background:{r:20,g:160,b:80,alpha:0.3}}}).png().toBuffer();});
test.after(async()=>{for(const root of roots){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('wandou-standard-integration-'));await fsp.rm(root,{recursive:true,force:true});}});
async function fixture(){const root=await fsp.mkdtemp(path.join(os.tmpdir(),'wandou-standard-integration-'));roots.push(root);return root;}
function original(){const value='data:image/png;base64,'+png.toString('base64');return{value,id:'sha256-'+media.digest(Buffer.from(value))};}
async function writeChunks(writer,id,value){const begin=await writer.write(1,{action:'begin',id,length:value.length});assert.equal(begin.success,true,begin.error);for(let offset=0;offset<value.length;offset+=31){const result=await writer.write(1,{action:'chunk',token:begin.token,offset,chunk:value.slice(offset,offset+31)});assert.equal(result.success,true,result.error);}return writer.write(1,{action:'commit',token:begin.token});}
test('actual direct save functions publish standard bytes; reopen, corrupt fallback, compatible repair and source reference remain exact',async()=>{
 const root=await fixture(),store=createStore({directory:()=>root}),source=await fsp.readFile(path.join(desktop,'main.js'),'utf8');
 const env={fs,path,crypto:require('node:crypto'),Buffer,canvasMediaFiles:media,canvasStandardMedia:store,canvasMediaRootDirectory:()=>root,canvasMediaPath:id=>path.join(root,id+'.data'),canvasMediaStorageId:value=>'sha256-'+media.digest(Buffer.from(value))};
 vm.runInNewContext(source.slice(source.indexOf('async function hasCanvasMedia('),source.indexOf('function canvasBackupDirectory(')),env);
 try{const {id,value}=original(),saved=await env.writeCanvasMedia({id,value});assert.equal(saved.success,true);assert.equal(saved.storageFormat,'image-file');assert.deepEqual(await fsp.readFile(saved.path),png);assert.equal(await fsp.readFile(path.join(root,id+'.data'),'utf8'),value);assert.equal((await env.hasCanvasMedia({id})).exists,true);assert.equal((await env.readCanvasMedia({id})).value,value);
 await fsp.writeFile(saved.path,'corrupted standard');assert.equal((await env.readCanvasMedia({id})).value,value);assert.equal((await env.writeCanvasMedia({id,value})).success,true,'secondary conflict must not turn durable original into failed generation');
 const damaged='data:corrupt';await fsp.writeFile(path.join(root,id+'.data'),damaged);assert.equal((await env.readCanvasMedia({id})).corrupt,true);
 const repair=await env.writeCanvasMedia({id,value});assert.equal(repair.success,true);assert.equal(repair.repaired,true);assert.equal((await env.readCanvasMedia({id})).value,value);
 assert.equal(await fsp.readFile(path.join(root,'.original-recovery',id+'-'+media.digest(Buffer.from(damaged))+'.data'),'utf8'),damaged);
 assert.equal((await env.writeCanvasMedia({id:'../escape',value})).success,false);
 }finally{store.dispose();}
});
test('chunk commit, binary protocol and original location use exact standard bytes; cancel and stale references cannot publish or reveal',async()=>{
 const root=await fixture(),store=createStore({directory:()=>root}),protocol=createProtocol({directory:()=>root}),writer=createWriter({directory:()=>root,destination:id=>path.join(root,id+'.data'),onCommitted:store.ensure}),shown=[];
 const location=createLocation({directory:()=>root,getUrl:protocol.getUrl,standardize:store.ensure,openPath:folder=>{shown.push(folder);return ''},showItemInFolder:file=>shown.push(file)});
 try{const {id,value}=original(),result=await writeChunks(writer,id,value);assert.equal(result.success,true,result.error);assert.equal(result.storageFormat,'image-file');
 const url=(await protocol.getUrl(id)).url,response=await protocol.handle({url,method:'GET'});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
 const found=await location.get('indexed-media:'+id);assert.equal(found.storageFormat,'image-file');assert.equal(found.path,result.path);assert.deepEqual(shown,[]);assert.equal((await location.show(url)).shown,true);assert.deepEqual(shown,[process.platform==='win32'?path.dirname(result.path):result.path]);
 assert.equal((await location.show(url.replace(new URL(url).hostname,'0'.repeat(64)))).success,false);assert.equal(shown.length,1);
 const begin=await writer.write(1,{action:'begin',id:'cancelled',length:value.length});await writer.write(1,{action:'chunk',token:begin.token,offset:0,chunk:value});assert.equal((await writer.write(1,{action:'abort',token:begin.token})).success,true);assert.equal(fs.existsSync(path.join(root,'cancelled.data')),false);assert.equal((await location.get('indexed-media:cancelled')).missing,true);
 // A standard record is self-contained for canonical Base64; the compatibility copy is never deleted by production code.
 await fsp.rename(path.join(root,id+'.data'),path.join(root,id+'.held'));assert.equal((await protocol.getUrl(id)).success,true);assert.equal((await location.get('indexed-media:'+id)).success,true);const reopened=await protocol.handle({url,method:'GET'});assert.deepEqual(Buffer.from(await reopened.arrayBuffer()),png);
 }finally{await writer.disposeOwner(1);protocol.dispose();store.dispose();}
});
test('standardization failure after chunk commit preserves success and exact legacy original',async()=>{
 const root=await fixture(),{id,value}=original(),writer=createWriter({directory:()=>root,destination:id=>path.join(root,id+'.data'),onCommitted:async()=>{throw Error('synthetic disk unavailable');}});
 try{const result=await writeChunks(writer,id,value);assert.equal(result.success,true);assert.equal(result.storageFormat,'data-url');assert.match(result.standardization.error,/unavailable/);assert.equal(await media.readLegacy(root,id),value);}finally{await writer.disposeOwner(1);}
});
test('unsupported hardlinks fall back to exclusive writes with exact fsynced bytes and metadata last',async()=>{
 const root=await fixture(),{id,value}=original(),unsupported=async()=>{throw Object.assign(Error('synthetic exFAT'),{code:'ENOTSUP'});};
 await media.writeLegacy(root,id,value,{link:unsupported});const result=await media.ensureStandard(root,id,{link:unsupported});assert.equal(result.success,true,result.error);assert.deepEqual(await fsp.readFile(result.path),png);assert.equal((await media.readValue(root,id)).value,value);
 const collision=path.join(root,'unknown');await fsp.writeFile(collision,'keep');await assert.rejects(media.atomicNew(collision,Buffer.from('replace'),undefined,{link:unsupported}),error=>error.code==='MEDIA_CONFLICT');assert.equal(await fsp.readFile(collision,'utf8'),'keep');
});
test('verified SHA repair retains corrupt bytes and refuses a concurrent change after recovery is durable',async()=>{
 const root=await fixture(),{id,value}=original(),target=path.join(root,id+'.data');await fsp.writeFile(target,'broken old');
 await assert.rejects(media.writeLegacy(root,id,value,{fault:async phase=>{if(phase==='before-legacy-repair')await fsp.writeFile(target,'concurrent edit');}}),/变化/);
 assert.equal(await fsp.readFile(target,'utf8'),'concurrent edit');assert.equal(await fsp.readFile(path.join(root,'.original-recovery',id+'-'+media.digest(Buffer.from('broken old'))+'.data'),'utf8'),'broken old');
 const result=await media.writeLegacy(root,id,value);assert.equal(result.repaired,true);assert.equal(await media.readLegacy(root,id),value);
 await fsp.writeFile(path.join(root,'short.data'),'keep short');await assert.rejects(media.writeLegacy(root,'short',value),/冲突/);assert.equal(await fsp.readFile(path.join(root,'short.data'),'utf8'),'keep short');
});
test('freeze drains one accepted conversion; queued work never writes after root migration and restart copies both formats',async()=>{
 const base=await fixture(),legacy=path.join(base,'profile'),install=path.join(base,'program'),destination=path.join(base,'drive');for(const p of[legacy,install,destination])await fsp.mkdir(p);
 const storage=createStorage({legacyRoot:legacy,installRoot:install});await storage.initialize();let root=path.join(storage.root(),'canvas-media');await fsp.mkdir(root,{recursive:true});const {id,value}=original();await media.writeLegacy(root,id,value);
 let release,entered;const gate=new Promise(done=>release=done),started=new Promise(done=>entered=done);let guarded=0;
 const store=createStore({directory:()=>path.join(storage.root(),'canvas-media'),guardWrite:task=>storage.write(async()=>{guarded++;entered();await gate;return task();}),delayMs:0});
 try{const saving=store.ensure(id);await started;store.pause();let frozen=false;const freezing=storage.freeze().then(()=>frozen=true);await new Promise(done=>setImmediate(done));assert.equal(frozen,false);release();assert.equal((await saving).success,true);await freezing;assert.equal((await store.ensure('not-started')).code,'MEDIA_PAUSED');assert.equal(guarded,1);
 const selected=await storage.choose(destination);await storage.prepare(selected);const fresh=createStorage({legacyRoot:legacy,installRoot:install});assert.equal((await fresh.initialize()).migrated,true);const next=path.join(fresh.root(),'canvas-media');assert.equal((await media.readValue(next,id)).value,value);assert.deepEqual((await media.readBinary(next,id)).bytes,png);assert.equal(await media.readLegacy(root,id),value);assert.ok(fs.existsSync(path.join(root,'originals',id+'.png')));
 }finally{store.dispose();}
});
test('chunk sessions are bound to their original root and discard only their own temporary file on a root change',async()=>{
 const a=await fixture(),b=await fixture();let current=a;const writer=createWriter({directory:()=>current,destination:id=>path.join(current,id+'.data')}),{value}=original();
 const begun=await writer.write(1,{action:'begin',id:'changing-root',length:value.length});current=b;assert.equal((await writer.write(1,{action:'chunk',token:begun.token,offset:0,chunk:value})).success,false);assert.deepEqual(await fsp.readdir(a),[]);assert.deepEqual(await fsp.readdir(b),[]);await writer.disposeOwner(1);
});
test('SVG base redirection and arbitrary CSS resource declarations never become executable standard documents',async()=>{
 for(const body of ['<g xml:base="//untrusted.invalid"><use href="#a"/></g>','<path style="background-image:image-set(\'secret.png\');"/>']){
 const root=await fixture(),value='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'+body+'</svg>').toString('base64'),id='sha256-'+media.digest(Buffer.from(value));await media.writeLegacy(root,id,value);assert.equal((await media.ensureStandard(root,id)).unsupported,true);assert.equal(await media.readLegacy(root,id),value);assert.equal(fs.existsSync(path.join(root,'originals',id+'.svg')),false);
 }
});
test('short IDs retain legacy authority even if a standard file and its unsigned record are changed consistently',async()=>{
 const root=await fixture(),{value}=original(),id='legacy-short';await media.writeLegacy(root,id,value);const result=await media.ensureStandard(root,id);assert.equal(result.success,true);
 const other=await sharp(png).negate().png().toBuffer(),forged='data:image/png;base64,'+other.toString('base64'),recordPath=path.join(root,'.original-metadata',id+'.json'),record=JSON.parse(await fsp.readFile(recordPath,'utf8'));
 await fsp.writeFile(result.path,other);await fsp.writeFile(recordPath,JSON.stringify({...record,binarySha256:media.digest(other),sourceSha256:media.digest(Buffer.from(forged)),bytes:other.length}));
 const actual=await media.readValue(root,id);assert.equal(actual.storageFormat,'data-url');assert.equal(actual.value,value);assert.deepEqual((await media.readBinary(root,id)).bytes,png);
});
test('simultaneous no-hardlink publications share complete key initialization and never overwrite an unknown target',async()=>{
 const root=await fixture(),value=original().value,link=async()=>{throw Object.assign(Error('no hardlink'),{code:'ENOTSUP'});};
 const results=await Promise.all(Array.from({length:6},(_,i)=>media.writeLegacy(root,'parallel-'+i,value,{link})));assert.ok(results.every(r=>r.created));for(let i=0;i<6;i++)assert.equal(await media.readLegacy(root,'parallel-'+i),value);
 const all=await Promise.all(Array.from({length:6},(_,i)=>media.ensureStandard(root,'parallel-'+i,{link})));assert.ok(all.every(r=>r.success),JSON.stringify(all));
});
