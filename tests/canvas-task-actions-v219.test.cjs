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
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
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

for(const theme of ['dark','light'])test(`failed-only retry controls ${theme} at 1024x800 preserve success and block duplicate`,async()=>fixture(async page=>{
 await page.evaluate(()=>{source.count=3;tasks.push(generateFromNode(source.id))});await page.waitForFunction(()=>requests.length===3);
 await page.evaluate(async()=>{requests[0].resolve({url:testPng,mediaType:'image',fromApi:true});requests[1].reject(new Error('HTTP 403: denied'));requests[2].reject(new Error('HTTP 403: denied'));await Promise.all(tasks);window.success=nodes.find(n=>n.type==='result'&&n.fullUrl);centerOnNode(source.id)});
 const successId=await page.evaluate(()=>success.id);
 assert.equal(await page.evaluate(()=>failedImageResultsForSource(source.id).length),2);
 assert.equal(await page.locator('[data-retry-failed]').count(),1,await page.evaluate(()=>JSON.stringify({busy:imageGenerationJobs.size,actions:generatorTaskActionsHtml(source),rendered:canvas.querySelector('[data-id="'+source.id+'"]')?.textContent})));
 await page.locator('[data-retry-failed]').click();
 await page.waitForFunction(()=>requests.length===4);
 await page.evaluate(()=>tasks.push(retryFailedFromNode(source.id)));
 await page.evaluate(()=>requests[3].resolve({url:testPng,mediaType:'image',fromApi:true}));
 await page.waitForFunction(()=>requests.length===5);
 await page.evaluate(()=>requests[4].resolve({url:testPng,mediaType:'image',fromApi:true}));
 await page.waitForFunction(()=>!wandouHasActiveTasks());
 const result=await page.evaluate(()=>({calls:requests.length,remaining:failedImageResultsForSource(source.id).length,successId:success.id,successful:nodes.filter(n=>n.type==='result'&&n.fullUrl).length}));
 assert.deepEqual(result,{calls:5,remaining:0,successId,successful:3});
 await page.evaluate(async()=>{await retryFailedFromNode(source.id)});assert.equal(await page.evaluate(()=>requests.length),5);
},{theme,width:1024}));

test('stop button cancels active batch and queued six without deleting completed results',async()=>fixture(async page=>{
 await page.evaluate(()=>{source.count=9;tasks.push(generateFromNode(source.id))});await page.waitForFunction(()=>requests.length===3);
 await page.evaluate(()=>centerOnNode(source.id));await page.locator('[data-stop-task]').click();
 assert.equal(await page.evaluate(()=>requests.every(r=>r.signal.aborted)),true,await page.evaluate(()=>JSON.stringify({source:source.id,jobs:[...imageGenerationJobs].map(([id,j])=>({id,cancelled:j.cancelled,controllers:j.controllers.size})),buttons:document.querySelectorAll('[data-stop-task]').length})));
 await page.evaluate(()=>Promise.all(tasks));
 const result=await page.evaluate(()=>({requests:requests.length,aborted:requests.every(r=>r.signal.aborted),busy:wandouHasActiveTasks(),pending:nodes.filter(n=>n.pending).length,status:source.status,results:nodes.filter(n=>n.type==='result').length}));
 assert.equal(result.requests,3);assert.equal(result.aborted,true);assert.equal(result.busy,false);assert.equal(result.pending,0);assert.equal(result.results,9);assert.match(result.status,/已停止/);
}));

test('local output retry makes zero further paid calls and preserves alpha, original and reopened provenance',async()=>fixture(async page=>{
 await page.evaluate(()=>{source.resolution='2K';WandouImageOutput={process:async()=>{throw Error('worker failed')}};tasks.push(generateFromNode(source.id))});
 await page.waitForFunction(()=>requests.length===1);
 await page.evaluate(async()=>{requests[0].resolve({url:testPng,mediaType:'image',fromApi:true});await Promise.all(tasks);window.result=nodes.find(n=>n.type==='result');WandouImageOutput={process:originalProcess};centerOnNode(result.id)});
 await page.locator('[data-retry-output]').click();await page.waitForFunction(()=>!wandouHasActiveTasks());
 const result=await page.evaluate(async()=>{
  const original=await getLocalMedia(result.sourceUrl),out=await getLocalMedia(result.fullUrl),img=await createImageBitmap(await (await fetch(out)).blob());
  const canvas=new OffscreenCanvas(img.width,img.height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const alpha=ctx.getImageData(0,0,1,1).data[3];img.close();
  await saveCanvasState();return{calls:requests.length,width:result.width,height:result.height,alpha,processing:result.resolutionProcessing,original:original===testPng,id:result.id};
 });
 assert.deepEqual({...result,id:undefined},{calls:1,width:2048,height:1024,alpha:0,processing:'local-upscale',original:true,id:undefined});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
 assert.deepEqual(await page.evaluate(id=>{const n=nodes.find(n=>n.id===id);return[n.width,n.height,n.resolutionProcessing,!!n.sourceUrl]},result.id),[2048,1024,'local-upscale',true]);
}));

for(const action of ['cancel','delete'])test(`local resize ${action} blocks close and late completion does not overwrite results`,async()=>fixture(async page=>{
 await page.evaluate(()=>{
  window.result=createNode('result',500,0,{mediaType:'image',fullUrl:testPng,mediaUrl:testPng,sourceUrl:testPng,width:128,height:64,resolutionProcessing:'incomplete',outputResolutionReady:true,requestedResolution:'4K',_deferRender:true});
  WandouImageOutput={process:()=>new Promise(resolve=>window.finishLocal=resolve)};
  tasks.push(retryResultResolution(result.id));tasks.push(retryResultResolution(result.id));
 });await page.waitForFunction(()=>!!window.finishLocal);
 const close=await page.evaluate(()=>wandouSaveBeforeClose());assert.equal(close.busy,true);assert.equal(close.success,false);
 await page.evaluate(action=>{
  if(action==='delete'){const id=result.id;deleteNode(id);window.replacement={id,type:'result',status:'replacement',width:1,height:1};nodes.push(replacement)}
  else cancelLocalResolutionForNode(result.id);
  finishLocal({url:testPng,width:4096,height:2048,processing:'local-upscale'});
 },action);await page.evaluate(()=>Promise.all(tasks));
 const state=await page.evaluate(()=>({calls:requests.length,busy:wandouHasActiveTasks(),width:window.replacement?.width||result.width}));
 assert.deepEqual(state,{calls:0,busy:false,width:action==='delete'?1:128});
}));

test('failure content is plain text; technical details exclude credentials and payload',async()=>fixture(async page=>{
 await page.evaluate(()=>tasks.push(generateFromNode(source.id)));await page.waitForFunction(()=>requests.length===1);
 await page.evaluate(async()=>{requests[0].reject(Error('HTTP 403: request id: abcdef123456 <img src=x onerror=alert(1)> secret-key'));await Promise.all(tasks)});
 const details=await page.evaluate(()=>nodes.find(n=>n.type==='result').errorDetails);
 assert.equal(details,'HTTP 403 · 请求编号：abcdef123456');assert.equal(await page.locator('.status img').count(),0);
}));
