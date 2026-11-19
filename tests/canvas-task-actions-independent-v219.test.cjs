const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(path.join(path.resolve(__dirname,'../../../..'),'desktop-client/node_modules/playwright'));
async function fixture(fn,{theme='dark',width=1440}={}){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width,height:800}});await page.route(/^https?:/,route=>route.abort());
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
  await page.evaluate(theme=>{
   document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;
   apiKeyInput.value='synthetic-key-never-sent';nodes=[];links=[];nodeId=1;
   const c=document.createElement('canvas');c.width=128;c.height=64;c.getContext('2d').fillRect(32,16,64,32);window.testPng=c.toDataURL();
   window.requests=[];window.tasks=[];window.originalProcess=WandouImageOutput.process;
   window.source=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'synthetic only',ratio:'2:1',resolution:'1K',count:1,_deferRender:true});
   callApi=(node,signal)=>new Promise((resolve,reject)=>{requests.push({node,signal,resolve,reject});signal?.addEventListener('abort',()=>reject(signal.reason),{once:true})});
   render({skipSave:true});centerOnNode(source.id);
  },theme);
  await fn(page);assert.deepEqual(errors,[]);
 } finally {await browser.close()}
}


test('regeneration local-size failure retains original 4K tier for free local retry',async()=>fixture(async page=>{
 await page.evaluate(()=>{
  window.original=createNode('result',500,0,{mediaType:'image',fullUrl:testPng,mediaUrl:testPng,sourceUrl:testPng,width:128,height:64,requestedResolution:'4K',resolution:'4K',model:source.model,_deferRender:true});
  links.push({from:source.id,to:original.id});
  WandouImageOutput={process:async()=>{throw Error('local worker unavailable')}};
  tasks.push(regenerateResultNode(original.id));
 });
 await page.waitForFunction(()=>requests.length===1);
 await page.evaluate(async()=>{requests[0].resolve({url:testPng,mediaType:'image',fromApi:true});await Promise.all(tasks);window.retryNode=nodes.find(n=>n.regeneratedFromId===original.id);window.targets=[];WandouImageOutput={process:async options=>{targets.push(options.targetSize);return originalProcess(options);}};await retryResultResolution(retryNode.id);});
 const actual=await page.evaluate(()=>({calls:requests.length,target:targets[0],width:retryNode.width,height:retryNode.height,requested:retryNode.requestedResolution}));
 assert.equal(actual.calls,1);assert.equal(actual.target,'4096x4096',JSON.stringify(actual));assert.equal(actual.width,4096);assert.equal(actual.height,2048);
 const saved=await page.evaluate(async()=>{await saveCanvasState();return{id:retryNode.id,original:testPng};});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
 const reopened=await page.evaluate(async id=>{const n=nodes.find(n=>n.id===id);return{source:await getLocalMedia(n.sourceUrl),width:n.width,height:n.height,requested:n.requestedResolution,processing:n.resolutionProcessing};},saved.id);
 assert.deepEqual(reopened,{source:saved.original,width:4096,height:2048,requested:'4K',processing:'local-upscale'});
}));

test('stopping after API returned preserves resumable local-size work without another paid generation',async()=>fixture(async page=>{
 await page.evaluate(()=>{source.resolution='2K';WandouImageOutput={process:options=>new Promise((resolve,reject)=>{window.localStarted=true;options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})};tasks.push(generateFromNode(source.id));});
 await page.waitForFunction(()=>requests.length===1);
 await page.evaluate(()=>requests[0].resolve({url:testPng,mediaType:'image',fromApi:true}));
 await page.waitForFunction(()=>window.localStarted===true);
 await page.evaluate(async()=>{stopCanvasImageTask(source.id);await Promise.all(tasks);window.retryNode=nodes.find(n=>n.type==='result');});
 const actual=await page.evaluate(()=>({calls:requests.length,busy:wandouHasActiveTasks(),processing:retryNode.resolutionProcessing||'',ready:retryNode.outputResolutionReady,original:!!retryNode.sourceUrl,actions:resultTaskActionsHtml(retryNode)}));
 assert.equal(actual.calls,1);assert.equal(actual.busy,false);assert.equal(actual.processing,'incomplete',JSON.stringify(actual));assert.match(actual.actions,/data-retry-output/);
 await page.evaluate(async()=>{WandouImageOutput={process:originalProcess};await retryResultResolution(retryNode.id)});assert.equal(await page.evaluate(()=>requests.length),1);
}));

test('cancel while generating preview keeps original output marked incomplete',async()=>fixture(async page=>{
 await page.evaluate(()=>{source.resolution='2K';const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;window.syntheticUpscaled=canvas.toDataURL();WandouImageOutput={process:async()=>({url:syntheticUpscaled,width:2048,height:1024,originalWidth:128,originalHeight:64,processing:'local-upscale',nonNative:true})};createPreviewImageUrl=()=>new Promise(resolve=>window.finishPreview=resolve);tasks.push(generateFromNode(source.id));});
 await page.waitForFunction(()=>requests.length===1);await page.evaluate(()=>requests[0].resolve({url:testPng,mediaType:'image',fromApi:true}));await page.waitForFunction(()=>!!window.finishPreview);
 await page.evaluate(async()=>{stopCanvasImageTask(source.id);finishPreview(syntheticUpscaled);await Promise.all(tasks);});
 const state=await page.evaluate(()=>{const n=nodes.find(n=>n.type==='result');return{calls:requests.length,processing:n.resolutionProcessing,actions:resultTaskActionsHtml(n),original:n.fullUrl===testPng};});
 assert.equal(state.calls,1);assert.equal(state.processing,'incomplete',JSON.stringify(state));assert.match(state.actions,/data-retry-output/);assert.equal(state.original,true);
}));

test('manual retry of another queued failed item is not retried again by failed-only batch',async()=>fixture(async page=>{
 await page.evaluate(()=>{window.failedItems=[1,2].map(i=>{const n=createNode('result',500,i*300,{mediaType:'image',model:source.model,width:128,height:64,status:'生成失败',requestedResolution:'1K',_deferRender:true});links.push({from:source.id,to:n.id});return n;});tasks.push(retryFailedFromNode(source.id));});
 await page.waitForFunction(()=>requests.length===1);await page.evaluate(()=>tasks.push(regenerateResultNode(failedItems[1].id)));await page.waitForFunction(()=>requests.length===2);
 await page.evaluate(()=>requests[1].reject(Error('HTTP 403: synthetic failure')));await page.waitForFunction(()=>!failedItems[1].regenerating);
 await page.evaluate(()=>requests[0].resolve({url:testPng,mediaType:'image',fromApi:true}));await page.waitForFunction(()=>requests.length>=3||!wandouHasActiveTasks());
 await page.evaluate(async()=>{if(requests[2])requests[2].reject(Error('HTTP 403: synthetic extra'));await Promise.all(tasks);});
 assert.equal(await page.evaluate(()=>requests.length),2,'each failed item should receive at most one request in the current retry round');
}));
