const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(path.join(path.resolve(__dirname,'../../../..'),'desktop-client/node_modules/playwright'));
async function fixture(fn){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady&&!!window.WandouImageOutput);
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=128;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(32,16,64,32);window.outputReviewPng=c.toDataURL('image/png')});
  await fn(page);
 }finally{await browser.close()}
}
test('file-based output worker preserves ratio and alpha and releases every worker URL',async()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),NativeWorker=Worker;
  let created=0,revoked=0,active=0;
  URL.createObjectURL=value=>{created++;return create(value)};URL.revokeObjectURL=value=>{revoked++;return revoke(value)};
  window.Worker=class extends NativeWorker{constructor(url){super(url);active++}terminate(){active--;return super.terminate()}};
  const out=await WandouImageOutput.process({url:outputReviewPng,targetSize:'2048x2048'});
  const image=await createImageBitmap(out.blob);const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);
  const alpha=ctx.getImageData(0,0,1,1).data[3],red=Array.from(ctx.getImageData(1024,512,1,1).data);image.close();
  return{width:out.width,height:out.height,sourcePreserved:out.sourceUrl===outputReviewPng,processing:out.processing,alpha,red,created,revoked,active};
 });
 assert.deepEqual(result,{width:2048,height:1024,sourcePreserved:true,processing:'local-upscale',alpha:0,red:[255,0,0,255],created:1,revoked:1,active:0});
}));

test('six simultaneous output requests bound original fetch and worker processing concurrency',async()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  const nativeFetch=fetch.bind(window),NativeWorker=Worker;let reads=0,reading=0,peakReads=0,workers=0,peakWorkers=0,started=performance.now();
  window.Worker=class extends NativeWorker{constructor(url){super(url);workers++;peakWorkers=Math.max(peakWorkers,workers)}terminate(){workers--;return super.terminate()}};
  const fetcher=async(url,options)=>{reads++;reading++;peakReads=Math.max(peakReads,reading);await new Promise(resolve=>setTimeout(resolve,12));const response=await nativeFetch(url,options);const blob=response.blob.bind(response);response.blob=async()=>{try{return await blob()}finally{reading--}};return response};
  const results=await Promise.all(Array.from({length:6},()=>WandouImageOutput.process({url:outputReviewPng,targetSize:'1024x1024',fetch:fetcher})));
  return{reads,peakReads,peakWorkers,workers,reading,sizes:results.map(r=>[r.width,r.height]),elapsedMs:performance.now()-started};
 });
 assert.equal(result.reads,6);assert.equal(result.peakReads,1);assert.equal(result.peakWorkers,1);assert.equal(result.workers,0);assert.equal(result.reading,0);assert.deepEqual(result.sizes,Array.from({length:6},()=>[1024,512]));
}));

test('cancelling queued output settles immediately and never reads another original',async()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  let unlock,reads=0;const held=new Promise(resolve=>unlock=resolve),controller=new AbortController();
  const first=WandouImageOutput.process({url:outputReviewPng,targetSize:'1024x1024',fetch:async(url,options)=>{reads++;await held;return fetch(url,options)}});
  const second=WandouImageOutput.process({url:outputReviewPng,targetSize:'1024x1024',signal:controller.signal,fetch:async(url,options)=>{reads++;return fetch(url,options)}});
  const outcome=second.then(()=> 'unexpected success',error=>error.name);controller.abort();
  const immediate=await Promise.race([outcome,new Promise(resolve=>setTimeout(()=>resolve('still blocked'),200))]);
  unlock();await first;const eventual=await outcome;return{immediate,eventual,reads};
 });
 assert.deepEqual(result,{immediate:'AbortError',eventual:'AbortError',reads:1});
}));

for(const error of ['图片尺寸处理超时；原图已保留','图片处理线程无法启动'])test(`successful generation with ${error} never sends a second API request`,async()=>fixture(async page=>{
 const result=await page.evaluate(async message=>{
  apiKeyInput.value='synthetic-key-never-transmitted';nodes=[];links=[];nodeId=1;let requests=0;
  callApi=async()=>{requests++;return{url:outputReviewPng,mediaType:'image',fromApi:true}};
  WandouImageOutput=Object.freeze({process:async()=>{throw new Error(message)}});
  generationRetryDelay=async()=>{};
  const generator=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'synthetic only',ratio:'2:1',resolution:'2K',count:1,_deferRender:true});render({skipSave:true});
  await generateFromNode(generator.id);const result=nodes.find(n=>n.type==='result');
  const original=await getLocalMedia(result.sourceUrl);
  return{requests,resultCount:nodes.filter(n=>n.type==='result').length,processing:result.resolutionProcessing,status:result.status,originalPreserved:original===outputReviewPng,busy:wandouHasActiveTasks()};
 },error);
 assert.equal(result.requests,1);assert.equal(result.resultCount,1);assert.equal(result.processing,'incomplete');assert.equal(result.originalPreserved,true);assert.equal(result.busy,false);assert.match(result.status,/未重复发送/);
}));
