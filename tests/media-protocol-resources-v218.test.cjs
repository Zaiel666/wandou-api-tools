const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const modulePath=process.env.WANDOU_PROTOCOL_TEST_MODULE||path.resolve(__dirname,'../desktop-client/canvas-media-protocol.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data='data:image/png;base64,aGVsbG8=';
const fixtures=[];
function trackedAbort(){
 const controller=new AbortController();let subscribed;
 const ready=new Promise(resolve=>subscribed=resolve),add=controller.signal.addEventListener.bind(controller.signal);
 controller.signal.addEventListener=(...args)=>{add(...args);if(args[0]==='abort')subscribed()};
 return{controller,ready};
}
function fixture(mock=true,ResponseClass=Response){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-protocol-v218-')),workers=[],requests=[];
 fixtures.push(directory);
 class FakeWorker extends EventEmitter{
  constructor(){super();workers.push(this)}unref(){}terminate(){this.terminated=true;this.emit('exit',1);return Promise.resolve(1)}
  postMessage(request){requests.push({worker:this,...request})}
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(modulePath,'utf8'),{module,require:name=>name==='node:worker_threads'&&mock?{Worker:FakeWorker}:require(name),Buffer,URL,Response:ResponseClass,Promise,Map,Set,AbortController,DOMException,setTimeout,clearTimeout,console});
 const api=module.exports({directory:()=>directory});
 const write=(id,value=data)=>fs.writeFileSync(path.join(directory,id+'.data'),value);
 const ready=async count=>{for(let i=0;i<200&&requests.length<count;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(requests.length,count)};
 const complete=(index,bytes=Buffer.from('hello'))=>{const request=requests[index];request.worker.emit('message',{id:request.id,mime:'image/png',bytes})};
 return{api,write,workers,requests,ready,complete};
}
test.after(()=>{for(const directory of fixtures){assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('wandou-protocol-v218-'));fs.rmSync(directory,{recursive:true,force:true})}});

test('aborted queued image request is not decoded after an earlier image completes',async()=>{
 const f=fixture();const keepAlive=setInterval(()=>{},1000);
 try{
  f.write('first');f.write('cancelled');const a=await f.api.getUrl('first'),b=await f.api.getUrl('cancelled');
  const first=f.api.handle({url:a.url,method:'GET'});await f.ready(1);
  const controller=new AbortController();const second=f.api.handle({url:b.url,method:'GET',signal:controller.signal});controller.abort();
  const result=await Promise.race([second,new Promise(resolve=>setTimeout(()=>resolve(null),200))]);
  assert.ok(result,'cancel must settle without waiting for unrelated decode');assert.equal(result.status,499);
  f.complete(0);assert.equal((await first).status,200);await tick();await tick();assert.equal(f.requests.length,1);
 }finally{clearInterval(keepAlive);f.api.dispose()}
});

test('first and last full-image buffers are released after their responses are consumed',{skip:!global.gc},async()=>{
 const f=fixture(),refs=[];
 try{
  async function consume(index){
   f.write('large-'+index);const info=await f.api.getUrl('large-'+index);
   let result=f.api.handle({url:info.url,method:'GET'});await f.ready(index+1);let bytes=new Uint8Array(8*1024*1024);refs.push(new WeakRef(bytes));f.complete(index,bytes);bytes=null;await(await result).arrayBuffer();result=null;
  }
  for(let index=0;index<3;index++)await consume(index);
  let collected=false;
  for(let i=0;i<20;i++){await tick();global.gc();await tick();if(refs.every(ref=>!ref.deref())){collected=true;break}}
  assert.equal(collected,true,'neither worker listeners nor ordering promises may retain completed original-image buffers');
 }finally{f.api.dispose()}
});

test('protocol refuses SHA-addressed media whose stored bytes were altered and preserves legacy reads',async()=>{
 const f=fixture(false),keepAlive=setInterval(()=>{},1000);
 try{
  const id='sha256-'+crypto.createHash('sha256').update(data).digest('hex');f.write(id,'data:image/png;base64,d3Jvbmc=');
  const info=await f.api.getUrl(id);assert.equal(info.success,true);
  const bad=await f.api.handle({url:info.url,method:'GET'});assert.equal(bad.status,404);
  f.write(id,data);const good=await f.api.handle({url:info.url,method:'GET'});assert.equal(good.status,200);assert.equal(await good.text(),'hello');
  f.write('legacy-123');const legacy=await f.api.handle({url:(await f.api.getUrl('legacy-123')).url,method:'GET'});assert.equal(await legacy.text(),'hello');
 }finally{clearInterval(keepAlive);f.api.dispose()}
});

test('cancelling one shared reader preserves the other reader and decodes the original once',async()=>{
 const f=fixture();
 try{
  f.write('shared');const url=(await f.api.getUrl('shared')).url,a=trackedAbort(),b=trackedAbort();
  const first=f.api.handle({url,method:'GET',signal:a.controller.signal});await a.ready;await f.ready(1);
  const second=f.api.handle({url,method:'GET',signal:b.controller.signal});await b.ready;
  a.controller.abort();assert.equal((await first).status,499);assert.equal(f.workers[0].terminated,undefined);
  f.complete(0);const remaining=await second;assert.equal(remaining.status,200);assert.equal(await remaining.text(),'hello');assert.equal(f.requests.length,1);
 }finally{f.api.dispose()}
});

test('cancelling every active reader releases its worker and the next image can decode',async()=>{
 const f=fixture();
 try{
  f.write('active');f.write('next');const a=trackedAbort();
  const first=f.api.handle({url:(await f.api.getUrl('active')).url,method:'GET',signal:a.controller.signal});await a.ready;await f.ready(1);
  a.controller.abort();assert.equal((await first).status,499);assert.equal(f.workers[0].terminated,true);
  const second=f.api.handle({url:(await f.api.getUrl('next')).url,method:'GET'});await f.ready(2);
  // A late message from the terminated decoder cannot settle the new read.
  f.complete(0,Buffer.from('stale'));f.complete(1,Buffer.from('next'));
  assert.equal(await(await second).text(),'next');assert.equal(f.workers.length,2);
 }finally{f.api.dispose()}
});

test('shutdown settles active and queued reads and does not dispatch queued work',async()=>{
 const f=fixture();
 try{
  f.write('active');f.write('queued');const b=trackedAbort();
  const first=f.api.handle({url:(await f.api.getUrl('active')).url,method:'GET'});await f.ready(1);
  const second=f.api.handle({url:(await f.api.getUrl('queued')).url,method:'GET',signal:b.controller.signal});await b.ready;
  f.api.dispose();const results=await Promise.all([first,second]);assert.deepEqual(results.map(r=>r.status),[499,499]);assert.equal(f.requests.length,1);
  assert.equal((await f.api.handle({url:(await f.api.getUrl('active')).url,method:'GET'})).status,499);
 }finally{f.api.dispose()}
});

test('worker failure does not poison the queue or reuse a stale pending entry',async()=>{
 const f=fixture();
 try{
  f.write('retry');const url=(await f.api.getUrl('retry')).url;
  const first=f.api.handle({url,method:'GET'});await f.ready(1);f.workers[0].emit('error',new Error('synthetic worker failed'));
  assert.equal((await first).status,404);const retry=f.api.handle({url,method:'GET'});await f.ready(2);f.complete(1);
  assert.equal((await retry).status,200);assert.equal(f.workers.length,2);
 }finally{f.api.dispose()}
});

test('cancelling a queued read then requesting the same image again does not lose or duplicate its replacement',async()=>{
 const f=fixture();
 try{
  f.write('active');f.write('same');const target=(await f.api.getUrl('same')).url,a=trackedAbort(),b=trackedAbort();
  const first=f.api.handle({url:(await f.api.getUrl('active')).url,method:'GET'});await f.ready(1);
  const cancelled=f.api.handle({url:target,method:'GET',signal:a.controller.signal});await a.ready;a.controller.abort();assert.equal((await cancelled).status,499);
  const replacement=f.api.handle({url:target,method:'GET',signal:b.controller.signal});await b.ready;f.complete(0);await first;await f.ready(2);
  f.complete(1,Buffer.from('replacement'));assert.equal(await(await replacement).text(),'replacement');assert.equal(f.requests.length,2);
 }finally{f.api.dispose()}
});
