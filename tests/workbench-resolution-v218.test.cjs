const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
test('workbench unverified models keep output choices but avoid guessed high-resolution request extensions',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(app,'image-workbench/customize.js'),'utf8').replace(/\r\n/g,'\n');
 const context={WandouImageCapabilities:require(path.join(app,'image-model-capabilities.js')),addEventListener:()=>{},QUALITY_OPTIONS:[{value:'low',label:'1k'},{value:'medium',label:'2k'},{value:'high',label:'4k'}],RESOLUTION_EDGE:{low:1024,medium:2048,high:4096},COMMON_ASPECTS:[[1,1],[16,9]],readModel:()=>context.model,readRawVisibleSize:()=> '4096x2304',readResolutionSource:()=> 'quality',readQuality:()=> 'high',modelToApiModel:value=>value,writeTargetSize:()=>{},model:'imagen-custom'};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(app,'image-workbench/resolution-output.js'),'utf8'),context);
 const names=['parseSizeText','formatSize','nearestCommonAspect','sizeForQuality','qualityFromSize','qualityLabel','qualityOptionsForModel','apiSafeGenerationSize','isGoogleModel','normalizeImageBody','grokImageAspectRatio'];
 for(const name of names){const match=new RegExp('^( +)(?:async )?function '+name+'\\(','m').exec(source);assert.ok(match,name);const end=source.indexOf('\n'+match[1]+'}',match.index)+match[1].length+2;vm.runInContext(source.slice(match.index,end),context);}
 for(const model of ['imagen-custom','dall-e-3','grok-imagine-image-2.0']){
  context.model=model;const body=context.normalizeImageBody({model,prompt:'test',size:'4096x4096',quality:'high',resolution:'4k',output_format:'png'});
  assert.equal(context.qualityOptionsForModel(model).length,3);
  if(model==='grok-imagine-image-2.0'){assert.equal(body.resolution,'2k');assert.equal(body.size,undefined);assert.equal(body.quality,undefined);}
  else {assert.equal(body.resolution,undefined);assert.equal(body.quality,undefined);assert.equal(body.output_format,undefined);assert.equal(body.size,model==='dall-e-3'?'1024x1024':'1536x1024');}
 }
});
async function fixture(run){
 const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');const file=path.resolve(app,name);if(!file.startsWith(path.resolve(app)+path.sep))throw Error('outside');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{await run(browser,base);}finally{await browser.close();await new Promise(r=>server.close(r));}
}
test('workbench 4K output uses one paid request at legal 1K, preserves alpha and durable non-native metadata',async()=>fixture(async(browser,base)=>{
 const page=await browser.newPage({viewport:{width:1280,height:900}});let requests=[],png;
 await page.route('**/*',async route=>{
  const url=route.request().url();if(url.startsWith(base))return route.continue();
  if(url==='https://offline.invalid/v1/images/generations'){requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{b64_json:png.split(',')[1]}]})});}
  return route.abort();
 });
 await page.addInitScript(()=>{localStorage.setItem('wd-model','gpt-image-2.5-1k');localStorage.setItem('wd-quality','high');localStorage.setItem('wd-resolution-source','quality');});
 await page.goto(base+'/image-workbench/index.html');
 await page.waitForSelector('.wd-custom-quality-button');
 png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,16,32);return c.toDataURL();});
 const result=await page.evaluate(async()=>{
  const response=await fetch('https://offline.invalid/v1/images/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'gpt-image-2.5-1k',prompt:'synthetic',size:'4096x4096',quality:'high'})});
  const value=await response.json(),source=value.data[0].url;window.qaOutput=source;
  const image=await createImageBitmap(await(await fetch(source)).blob());
  const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(image,3000,1000,1,1,0,0,1,1);
  const alpha=c.getContext('2d').getImageData(0,0,1,1).data[3];const dimensions=[image.width,image.height];image.close();
  const metadata=await WandouWorkbenchOutput.metadata(source);
  return {dimensions,alpha,metadata,revised:value.data[0].revised_prompt,note:document.querySelector('.wd-resolution-note')?.textContent};
 });
 assert.equal(requests.length,1);assert.equal(requests[0].size,'1024x1024');assert.equal(requests[0].quality,'low');
 assert.deepEqual(result.dimensions,[4096,4096]);assert.equal(result.alpha,0);assert.equal(result.metadata.processing,'local-upscale');assert.equal(result.metadata.originalWidth,32);assert.match(result.revised,/非原生生成/);assert.match(result.note,/非原生/);
 await page.evaluate(async()=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.open('gpt-image-playground',2);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id:'resolution-fixture',dataUrl:qaOutput,width:4096,height:4096});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});
  const card=document.createElement('div');card.id='qa-resolution-card';card.className='task-card-wrapper';card.innerHTML='<img class="saveable-image" data-image-id="resolution-fixture" style="width:160px;height:160px"><span>1024×1024</span>';card.querySelector('img').src=qaOutput;document.body.prepend(card);
 });
 await page.locator('#qa-resolution-card .wd-output-processing').waitFor();
 assert.match(await page.locator('#qa-resolution-card .wd-output-processing').textContent(),/非原生生成.*32×32/);
 assert.equal(await page.locator('#qa-resolution-card > span').textContent(),'4096×4096');
 await page.evaluate(async()=>{localStorage.setItem('qa-output-key',await WandouMediaHash.idAsync(qaOutput));});
 await page.reload();
 const durable=await page.evaluate(async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('wandou-workbench-output-metadata',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('outputs');const q=tx.objectStore('outputs').get(localStorage.getItem('qa-output-key'));q.onsuccess=async()=>{const value=q.result;const bitmap=await createImageBitmap(value.originalBlob);const result={processing:value.processing,output:[value.width,value.height],original:[bitmap.width,bitmap.height]};bitmap.close();resolve(result);};q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);}));
 assert.deepEqual(durable,{processing:'local-upscale',output:[4096,4096],original:[32,32]});assert.equal(requests.length,1);
}));
test('workbench local conversion failure preserves generated bytes without a second generation; abort does not publish',async()=>fixture(async(browser,base)=>{
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 await page.goto(base+'/image-workbench/index.html');await page.waitForFunction(()=>window.WandouWorkbenchOutput&&window.WandouImageOutput);
 const result=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=c.height=32;const original=c.toDataURL();let reads=0;
  const nativeFetch=window.fetch.bind(window),originalOutput=WandouImageOutput;
  window.WandouImageOutput={processBlob:async()=>{throw Error('synthetic worker failure');}};
  const response=await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({data:[{url:original}]}),{headers:{'content-type':'application/json'}}),{plan:WandouWorkbenchOutput.plan('gpt-image-2.5-1k','high','4096x4096'),fetch:async(...args)=>{reads++;return nativeFetch(...args);}});
  const value=await response.json();window.WandouImageOutput=originalOutput;
  const controller=new AbortController();controller.abort();let aborted=false;
  try{await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({data:[{url:original}]})),{plan:WandouWorkbenchOutput.plan('gpt-image-2','high','4096x4096'),signal:controller.signal,fetch:()=>{reads++;throw Error('must not read');}});}catch(e){aborted=e.name==='AbortError';}
  return {same:value.data[0].url===original,note:value.data[0].revised_prompt,reads,aborted,warning:document.querySelector('[role="alert"]')?.textContent};
 });
 assert.equal(result.same,true);assert.equal(result.reads,1);assert.equal(result.aborted,true);assert.match(result.note,/未再次请求/);assert.match(result.warning,/保留生成原图/);
}));
