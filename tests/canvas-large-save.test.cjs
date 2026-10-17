const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {mapLimited,createQueue}=require('../app/canvas-save-pipeline');
const createWriter=require('../desktop-client/canvas-media-writer.cjs');
test('more than 96 MB is streamed, verified and atomically committed',async()=>{
 const dir=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'wandou-media-test-'));
 const writer=createWriter({directory:()=>dir,destination:id=>path.join(dir,id+'.data')});
 try{
  const chunk='A'.repeat(1024*1024),prefix='data:application/octet-stream;base64,';
  const length=prefix.length+chunk.length*100;
  const begun=await writer.write(1,{action:'begin',id:'large',length});assert.ok(begun.success);
  const token=begun.token;let offset=0;const expected=crypto.createHash('sha256');
  for(const text of [prefix,...Array(100).fill(chunk)]){
   assert.ok((await writer.write(1,{action:'chunk',token,offset,chunk:text})).success);
   expected.update(text);offset+=text.length;
  }
  await assert.rejects(fs.stat(path.join(dir,'large.data')),e=>e.code==='ENOENT');
  const committed=await writer.write(1,{action:'commit',token});assert.equal(committed.success,true);assert.equal(committed.bytes,length);
  const actual=crypto.createHash('sha256');for await(const bytes of require('node:fs').createReadStream(committed.path))actual.update(bytes);
  assert.equal(actual.digest('hex'),expected.digest('hex'));
  const incomplete=await writer.write(1,{action:'begin',id:'large',length:100});
  assert.equal((await writer.write(2,{action:'commit',token:incomplete.token})).success,false);
  assert.equal((await writer.write(1,{action:'commit',token:incomplete.token})).success,false);
  assert.equal((await fs.stat(committed.path)).size,length,'incomplete save must preserve previous complete file');
  assert.equal((await fs.readdir(dir)).filter(x=>x.endsWith('.tmp')).length,0);
 }finally{await writer.disposeOwner(1);await fs.rm(dir,{recursive:true,force:true})}
});
test('autosaves coalesce pending versions but keep each project and all callers',async()=>{
 const queue=createQueue();let unlock;const gate=new Promise(r=>unlock=r);const writes=[];
 const task=async value=>{writes.push(value);if(value===1)await gate;return value};
 const pending=[queue.enqueue('a',1,task),queue.enqueue('a',2,task),queue.enqueue('a',3,task),queue.enqueue('b',4,task)];
 unlock();assert.deepEqual(await Promise.all(pending),[1,3,3,4]);assert.deepEqual(writes,[1,3,4]);
});
test('bounded workers drain in-flight writes on error before the next save',async()=>{
 let active=0,max=0;const progress=[];
 const result=await mapLimited([1,2,3,4],2,async n=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return n*2},n=>progress.push(n));
 assert.deepEqual(result,[2,4,6,8]);assert.equal(max,2);assert.equal(progress.at(-1),4);
 await assert.rejects(mapLimited([1,2,3],2,async n=>{active++;try{await new Promise(r=>setTimeout(r,n===1?1:15));if(n===1)throw Error('disk full')}finally{active--}}),/disk full/);
 assert.equal(active,0);
});
test('latest announcement follows GitHub latest while historical links stay pinned',()=>{
 const html=require('node:fs').readFileSync(path.join(__dirname,'../app/homepage-test.html'),'utf8');
 const latest=html.split('notice-card-latest')[1].split('</details>')[0];
 assert.match(latest,/releases\/latest"/);assert.match(latest,/releases\/latest\/download\/wandou-ai-tools-windows-x64.zip/);
 assert.match(html,/releases\/tag\/v1.0.84/);
});
