'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const sharp=require(path.resolve(__dirname,'../../../../desktop-client/node_modules/sharp'));
const media=require('../desktop-client/canvas-media-files.cjs'),createStore=require('../desktop-client/canvas-media-standard-store.cjs');
const roots=[];
async function fixture(bytes,mime='image/png',legacyId){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'wandou-standard-v225-'));roots.push(root);
 const value='data:'+mime+';base64,'+bytes.toString('base64'),id=legacyId||'sha256-'+media.digest(Buffer.from(value));
 await fsp.writeFile(path.join(root,id+'.data'),value);
 return{root,id,value,bytes,file:path.join(root,id+'.data')};
}
let png,jpg,webp,gif;
test.before(async()=>{
 png=await sharp({create:{width:12,height:8,channels:4,background:{r:80,g:180,b:110,alpha:0.4}}}).png().toBuffer();
 jpg=await sharp(png).flatten({background:'#fff'}).jpeg().toBuffer();webp=await sharp(png).webp().toBuffer();
 const raw=Buffer.alloc(8*6*3*4);for(let i=0;i<3;i++)for(let p=i*8*6*4;p<(i+1)*8*6*4;p+=4){raw[p]=i*80;raw[p+1]=130;raw[p+2]=220-i*70;raw[p+3]=255;}
 gif=await sharp(raw,{raw:{width:8,height:18,pageHeight:6,channels:4}}).gif({loop:0,delay:[80,120,200]}).toBuffer();
});
test.after(async()=>{for(const root of roots){assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('wandou-standard-v225-'));await fsp.rm(root,{recursive:true,force:true});}});
for(const [format,mime]of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp'],['gif','image/gif'],['svg','image/svg+xml']])test('exact standard '+format+' plus unchanged legacy data URL and reference',async()=>{
 const bytes={png,jpg,webp,gif,svg:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><path fill="#abc" d="M0 0H80V40H0Z"/></svg>')}[format];
 const f=await fixture(bytes,mime),result=await media.ensureStandard(f.root,f.id);
 assert.equal(result.success,true,result.error);assert.equal(result.filename,f.id+'.'+format);assert.deepEqual(await fsp.readFile(result.path),bytes);
 assert.equal(await fsp.readFile(f.file,'utf8'),f.value);assert.equal((await media.readValue(f.root,f.id)).value,f.value);
 const binary=await media.readBinary(f.root,f.id);assert.deepEqual(binary.bytes,bytes);assert.equal(binary.mime,mime);
 if(format==='gif'){const m=await sharp(binary.bytes,{animated:true}).metadata();assert.equal(m.pages,3);assert.deepEqual(m.delay,[80,120,200]);}
 const again=await media.ensureStandard(f.root,f.id);assert.equal(again.deduplicated,true);
});
test('real bytes determine extension despite a wrong declaration; original declaration and ID remain exact',async()=>{
 const f=await fixture(png,'image/jpeg'),r=await media.ensureStandard(f.root,f.id);assert.equal(r.success,true);assert.match(r.path,/\.png$/);
 assert.equal((await media.readBinary(f.root,f.id)).mime,'image/png');assert.equal((await media.readValue(f.root,f.id)).value,f.value);
});
test('legacy short IDs and noncanonical Base64 never become a different content reference',async()=>{
 const f=await fixture(gif,'image/gif','old-123');const value=f.value.replace(',',',\n').replace(/(.{100})/g,'$1\n').replace('data:image/gif;base64\n','data:image/gif;base64');
 // Restrict whitespace to the encoded body; the header remains exact.
 const actual='data:image/gif;base64,'+gif.toString('base64').replace(/(.{20})/g,'$1\n');
 await fsp.writeFile(f.file,actual);const r=await media.ensureStandard(f.root,f.id);assert.equal(r.success,true,r.error);
 assert.equal((await media.readValue(f.root,f.id)).value,actual);assert.deepEqual((await media.readBinary(f.root,f.id)).bytes,gif);
 assert.equal((await media.readRecord(f.root,f.id)).record.canonicalBase64,false);
});
test('percent-encoded SVG preserves its exact data URL representation',async()=>{
 const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1V1Z"/></svg>'),f=await fixture(bytes,'image/svg+xml');
 const value='data:image/svg+xml,'+encodeURIComponent(bytes.toString()).replace(/%3C/g,'%3c'),id='sha256-'+media.digest(Buffer.from(value));
 await fsp.writeFile(path.join(f.root,id+'.data'),value);const r=await media.ensureStandard(f.root,id);assert.equal(r.success,true,r.error);assert.equal((await media.readValue(f.root,id)).value,value);
});
for(const fragment of ['<script>alert(1)</script>','<g onload="alert(1)"/>','<use href="https://example.invalid/x.svg#x"/>','<path style="fill:url(https://example.invalid/a)"/>','<foreignObject/>','<animate attributeName="href"/>','<use href="&#104;ttps://example.invalid/x"/>']){
 test('unsafe SVG remains compatibility-only: '+fragment.slice(0,30),async()=>{
  const f=await fixture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'+fragment+'</svg>'),'image/svg+xml');
  const r=await media.ensureStandard(f.root,f.id);assert.equal(r.success,false);assert.equal(r.unsupported,true);assert.equal(await fsp.readFile(f.file,'utf8'),f.value);assert.equal(fs.existsSync(path.join(f.root,'originals')),false);
 });
}
test('DOCTYPE, unsupported bytes and non-image media never produce misleading standard extensions',async()=>{
 for(const [bytes,mime]of [[Buffer.from('<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///x">]><svg/>'),'image/svg+xml'],[Buffer.from('not an image'),'image/png'],[Buffer.from('video'),'video/mp4']]){
  const f=await fixture(bytes,mime),r=await media.ensureStandard(f.root,f.id);assert.equal(r.success,false);assert.equal(r.unsupported,true);assert.equal((await media.readValue(f.root,f.id)).value,f.value);
 }
});
for(const stage of ['before-original','before-publish','after-publish','before-metadata','after-metadata'])test('restart after '+stage+' retains all original bytes and resumes idempotently',async()=>{
 const f=await fixture(png);let failed=false;
 const result=await media.ensureStandard(f.root,f.id,{fault:async phase=>{if(phase===stage&&!failed){failed=true;throw Object.assign(Error('synthetic interruption'),{code:'INJECTED'});}}});
 assert.equal(result.success,false);assert.equal((await media.readValue(f.root,f.id)).value,f.value);assert.equal(await fsp.readFile(f.file,'utf8'),f.value);
 const resumed=await media.ensureStandard(f.root,f.id);assert.equal(resumed.success,true,resumed.error);assert.deepEqual(await fsp.readFile(resumed.path),png);
});
test('insufficient space does not modify, drop or redirect the legacy reference',async()=>{
 const f=await fixture(png);const r=await media.ensureStandard(f.root,f.id,{statfs:async()=>({bavail:0,bsize:4096})});
 assert.equal(r.success,false);assert.equal(r.code,'ENOSPC');assert.deepEqual(await fsp.readdir(f.root),[f.id+'.data']);assert.equal((await media.readValue(f.root,f.id)).value,f.value);
});
test('concurrent same-ID conversion deduplicates without overwriting conflicting files',async()=>{
 const f=await fixture(png);const results=await Promise.all(Array.from({length:6},()=>media.ensureStandard(f.root,f.id)));assert.ok(results.every(r=>r.success),JSON.stringify(results));
 const other=await fixture(png);await fsp.mkdir(path.join(other.root,'originals'));const target=path.join(other.root,'originals',other.id+'.png');await fsp.writeFile(target,'keep this unknown file');
 const r=await media.ensureStandard(other.root,other.id);assert.equal(r.success,false);assert.equal(r.code,'MEDIA_CONFLICT');assert.equal(await fsp.readFile(target,'utf8'),'keep this unknown file');assert.equal((await media.readValue(other.root,other.id)).value,other.value);
});
test('corrupt standard bytes or metadata falls back; intact canonical standard survives missing compatibility copy',async()=>{
 const f=await fixture(png),r=await media.ensureStandard(f.root,f.id);await fsp.writeFile(r.path,'corrupt');assert.equal((await media.readValue(f.root,f.id)).storageFormat,'data-url');assert.deepEqual((await media.readBinary(f.root,f.id)).bytes,png);
 const g=await fixture(png),ok=await media.ensureStandard(g.root,g.id);await fsp.unlink(g.file);assert.equal((await media.readValue(g.root,g.id)).value,g.value);
 await fsp.writeFile(path.join(g.root,'.original-metadata',g.id+'.json'),'{}');assert.equal((await media.readValue(g.root,g.id)).success,false);assert.deepEqual(await fsp.readFile(ok.path),png);
});
test('tampered SHA source, traversal and redirected directories cannot publish outside the managed root',async()=>{
 const f=await fixture(png);await fsp.writeFile(f.file,'data:image/png;base64,wrong');assert.equal((await media.ensureStandard(f.root,f.id)).code,'MEDIA_CHECKSUM');
 for(const id of ['../x','x/y','x\\y','x.png','a'.repeat(101)])assert.equal((await media.ensureStandard(f.root,id)).success,false);
 const g=await fixture(png),outside=await fixture(png),alias=path.join(g.root,'originals');await fsp.symlink(outside.root,alias,process.platform==='win32'?'junction':'dir');
 assert.equal((await media.ensureStandard(g.root,g.id)).code,'UNSAFE_MEDIA_PATH');assert.deepEqual(await fsp.readdir(outside.root),[outside.id+'.data']);
});
test('worker queue gives exact reads, pauses migration for freeze and binds jobs to their data root',async()=>{
 const f=await fixture(png),g=await fixture(gif,'image/gif');let current=f.root,blocked=false,writes=0;
 const store=createStore({directory:()=>current,guardWrite:async task=>{if(blocked)throw Error('frozen');writes++;return task();},delayMs:1});
 try{
  const result=await store.ensure(f.id);assert.equal(result.success,true,result.error);assert.equal((await store.read(f.id)).value,f.value);
  store.pause();blocked=true;assert.equal((await store.ensure(f.id)).code,'MEDIA_PAUSED');
  current=g.root;blocked=false;store.resume();await store.start();assert.equal((await store.read(g.id)).value,g.value);assert.ok(writes>=2);assert.equal(fs.existsSync(path.join(g.root,'originals',f.id+'.png')),false);
 }finally{store.dispose();}
});
test('disposing a queued conversion settles promises and preserves the compatibility original',async()=>{
 const f=await fixture(png),store=createStore({directory:()=>f.root});const pending=store.ensure(f.id);store.dispose();
 const r=await pending;assert.equal(r.success,false);assert.equal(await fsp.readFile(f.file,'utf8'),f.value);
});
test('resuming while the previous busy scan exits starts the new root scan',async()=>{
 const first=await fixture(png),second=await fixture(gif,'image/gif');let root=first.root,busy=true;
 const store=createStore({directory:()=>root,isBusy:()=>busy,delayMs:0});
 try{const oldScan=store.start();await new Promise(r=>setTimeout(r,30));store.pause();root=second.root;busy=false;store.resume();await oldScan;
 for(let tries=0;tries<100&&!fs.existsSync(path.join(second.root,'.original-metadata',second.id+'.json'));tries++)await new Promise(r=>setTimeout(r,10));
 assert.equal((await media.readValue(second.root,second.id)).storageFormat,'image-file');assert.equal(fs.existsSync(path.join(first.root,'originals')),false);assert.equal(fs.existsSync(path.join(second.root,'originals',first.id+'.png')),false);
 }finally{store.dispose();}
});
test('real process interruption after original publication resumes without replacing legacy bytes',async()=>{
 const f=await fixture(png),{fork}=require('node:child_process'),script=path.join(f.root,'interruption-child.cjs');
 await fsp.writeFile(script,`const media=require(${JSON.stringify(require.resolve('../desktop-client/canvas-media-files.cjs'))});media.ensureStandard(process.argv[2],process.argv[3],{fault:async phase=>{if(phase==='before-metadata'){process.send('published');await new Promise(()=>{});}}}).then(result=>process.send(result));`);
 const child=fork(script,[f.root,f.id],{silent:true,windowsHide:true});let stopped=false;
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child publication timeout')),10000);child.once('message',message=>{clearTimeout(timer);message==='published'?resolve():reject(Error(JSON.stringify(message)));});child.once('error',reject);});
 child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);});stopped=true;
 assert.equal(fs.existsSync(path.join(f.root,'.original-metadata',f.id+'.json')),false);assert.equal(await fsp.readFile(f.file,'utf8'),f.value);
 const standard=path.join(f.root,'originals',f.id+'.png'),before=await fsp.readFile(standard),stat=await fsp.stat(standard),retry=await media.ensureStandard(f.root,f.id);assert.equal(retry.success,true,retry.error);assert.deepEqual(await fsp.readFile(standard),before);assert.equal((await fsp.stat(standard)).mtimeMs,stat.mtimeMs);assert.equal((await media.readValue(f.root,f.id)).value,f.value);
 }finally{if(!stopped)child.kill();}
});
test('real process killed during no-hardlink copy keeps original and resumes only its authenticated partial file',async()=>{
 const raw=Buffer.alloc(256*256*4);let seed=17;for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=seed>>>24;}
 const large=await sharp(raw,{raw:{width:256,height:256,channels:4}}).png().toBuffer();assert.ok(large.length>65536);
 const f=await fixture(large),{fork}=require('node:child_process'),script=path.join(f.root,'fallback-child.cjs');
 await fsp.writeFile(script,`const media=require(${JSON.stringify(require.resolve('../desktop-client/canvas-media-files.cjs'))});media.ensureStandard(process.argv[2],process.argv[3],{link:async()=>{throw Object.assign(Error('no hardlink'),{code:'ENOTSUP'});},fault:async(phase,state)=>{if(phase==='fallback-copy-chunk'&&state.written<state.total){process.send({written:state.written});await new Promise(()=>{});}}}).then(result=>process.send(result));`);
 const child=fork(script,[f.root,f.id],{silent:true,windowsHide:true});let stopped=false;
 try{const progress=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('copy interruption timeout')),10000);child.once('message',message=>{clearTimeout(timer);message.written?resolve(message):reject(Error(JSON.stringify(message)));});child.once('error',reject);});child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);});stopped=true;
 const target=path.join(f.root,'originals',f.id+'.png'),partial=await fsp.readFile(target);assert.equal(partial.length,progress.written);assert.deepEqual(partial,large.subarray(0,partial.length));assert.equal(await fsp.readFile(f.file,'utf8'),f.value);assert.equal(fs.existsSync(path.join(f.root,'.original-metadata',f.id+'.json')),false);
 const retried=await media.ensureStandard(f.root,f.id);assert.equal(retried.success,true,retried.error);assert.deepEqual(await fsp.readFile(target),large);assert.equal(await fsp.readFile(f.file,'utf8'),f.value);const recovered=(await fsp.readdir(path.dirname(target))).filter(name=>name.startsWith('.recovered-'));assert.equal(recovered.length,1);assert.deepEqual(await fsp.readFile(path.join(path.dirname(target),recovered[0])),partial);assert.equal(fs.existsSync(target+'.publish-intent.json'),false);
 }finally{if(!stopped)child.kill();}
});
test('untrusted or edited partial-publication state cannot authorize overwriting a user file',async()=>{
 const unsupported=async()=>{throw Object.assign(Error('no hardlink'),{code:'ENOTSUP'});};
 for(const scenario of ['edited-target','changed-identity','edited-receipt','missing-receipt']){
 const f=await fixture(png),r=await media.ensureStandard(f.root,f.id,{link:unsupported,fault:async phase=>{if(phase==='fallback-copy-chunk')throw Error('stop before sync');}});assert.equal(r.success,false);
 const target=path.join(f.root,'originals',f.id+'.png'),intent=target+'.publish-intent.json';
 if(scenario==='edited-target')await fsp.writeFile(target,'user file changed');
 if(scenario==='changed-identity'){await fsp.rename(target,target+'.kept');await fsp.writeFile(target,'new user file');}
 if(scenario==='edited-receipt'){const bad=JSON.parse(await fsp.readFile(intent,'utf8'));bad.mac='0'.repeat(64);await fsp.writeFile(intent,JSON.stringify(bad));await fsp.writeFile(target,png.subarray(0,10));}
 if(scenario==='missing-receipt'){await fsp.rename(intent,intent+'.kept');await fsp.writeFile(target,png.subarray(0,10));}
 const before=await fsp.readFile(target),retry=await media.ensureStandard(f.root,f.id);assert.equal(retry.success,false,scenario);assert.deepEqual(await fsp.readFile(target),before,scenario);assert.equal((await media.readValue(f.root,f.id)).value,f.value);
 }
});
test('SVG XML encoding declarations cannot reinterpret validated UTF-8 bytes in external viewers',async()=>{
 const body='<svg xmlns="http://www.w3.org/2000/svg"><text>+ADw-script+AD4-</text></svg>';
 assert.equal(media.safeSvg(Buffer.from('<?xml version="1.0" encoding="UTF-8"?>'+body)),true);
 for(const declaration of ['<?xml version="1.0" encoding="UTF-7"?>','<?xml version="1.0" encoding="Shift_JIS"?>','<?xml version="1.0" encoding="UTF-8" encoding="UTF-7"?>','<?xml version="1.0" surprise="allowed"?>']){
 const f=await fixture(Buffer.from(declaration+body),'image/svg+xml'),result=await media.ensureStandard(f.root,f.id);assert.equal(result.unsupported,true);assert.equal(await fsp.readFile(f.file,'utf8'),f.value);
 }
});
