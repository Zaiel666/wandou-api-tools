const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),crypto=require('node:crypto');
const {chromium}=require('../desktop-client/node_modules/playwright'),sharp=require('../desktop-client/node_modules/sharp');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa');
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="80" y="80" width="352" height="352" rx="40" fill="#668477"/></svg>');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function moduleFor(){const context={};vm.runInNewContext(fs.readFileSync(path.join(app,'image-output-contract.js'),'utf8'),context);return context.WandouImageOutputContract;}
const plain=value=>JSON.parse(JSON.stringify(value));
test('output request capture is a bounded non-secret snapshot of JSON, FormData and plain objects',()=>{
 const api=moduleFor(),body={output_format:'gif',size:'auto',frame_count:2,frame_duration_ms:200,key:'must-not-persist',prompt:'private',url:'https://private.invalid'};
 const expected={version:1,format:'gif',size:'auto',frameCount:2,frameDurationMs:200};
 for(const input of [body,JSON.stringify(body),new Map(Object.entries(body))])assert.deepEqual(plain(api.capture(input)),expected);
 body.frame_count=9;assert.equal(expected.frameCount,2);
 for(const input of [null,'invalid','{}',{},[],{output_format:'executable',size:'1x1'}])assert.equal(api.capture(input),null);
 const malformed=api.capture({output_format:'gif',size:'<script>',frame_count:99,frame_duration_ms:Infinity});assert.equal(malformed.size,null);assert.equal(malformed.frameCount,null);assert.equal(malformed.frameDurationMs,null);
 assert.equal(api.capture({output_format:'svg',size:'0x1'}).size,null);assert.equal(api.capture({output_format:'svg',size:'65536x1'}).size,null);
});
test('SVG comparison distinguishes actual canvas dimensions, ratio, auto size and legacy unknown requests',()=>{
 const api=moduleFor(),actual={format:'svg',width:512,height:512};
 const wrong=api.compare(api.capture({output_format:'svg',size:'1024x1536'}),actual);
 assert.deepEqual(Array.from(wrong.differences),['size']);assert.equal(wrong.ratioMismatch,true);assert.match(wrong.message,/请求：1024×1536；实际：512×512 SVG 画布/);
 const sameRatio=api.compare(api.capture({output_format:'svg',size:'1024x1024'}),actual);assert.equal(sameRatio.mismatch,true);assert.equal(sameRatio.ratioMismatch,false);
 for(const size of ['512x512','auto'])assert.equal(api.compare(api.capture({output_format:'svg',size}),actual).mismatch,false);
 const legacy=api.compare(null,actual);assert.equal(legacy.hasRequest,false);assert.equal(legacy.mismatch,false);assert.equal(legacy.message,'');
});
test('GIF comparison checks every frame, count and duration, including documented 10 ms rounding',()=>{
 const api=moduleFor(),request=duration=>api.capture({output_format:'gif',size:'auto',frame_count:2,frame_duration_ms:duration});
 const actual={format:'gif',width:64,height:40,frameCount:2,frameDurationsMs:[300,300]};
 const mismatch=api.compare(request(200),actual);assert.deepEqual(Array.from(mismatch.differences),['frame-duration']);assert.match(mismatch.message,/2 帧 × 200 毫秒.*2 帧 × 300 毫秒，共 0.6 秒/);
 assert.equal(api.compare(request(245),{...actual,frameDurationsMs:[250,250]}).mismatch,false);
 assert.match(api.compare(request(245),{...actual,frameDurationsMs:[250,250]}).message,/按规范取 250 毫秒/);
 assert.equal(api.capture({output_format:'gif',frame_duration_ms:655350}).frameDurationMs,655350);
 const variable=api.compare(request(200),{...actual,frameCount:3,frameDurationsMs:[100,200,300]});assert.deepEqual(Array.from(variable.differences),['frame-count','frame-duration']);assert.match(variable.actualSummary,/每帧 100–300 毫秒/);
 assert.equal(api.compare(request(200),{...actual,frameDurationsMs:[200,200]}).mismatch,false);
});
let browser,server,origin,gif;
test.before(async()=>{
 fs.mkdirSync(qa,{recursive:true});const width=64,height=40,raw=Buffer.alloc(width*height*2*4);
 for(let i=0;i<raw.length;i+=4){raw[i]=i<width*height*4?80:140;raw[i+1]=150;raw[i+2]=110;raw[i+3]=255;}
 gif=await sharp(raw,{raw:{width,height:height*2,pageHeight:height,channels:4}}).gif({delay:[300,300],loop:0}).toBuffer();
 server=http.createServer((req,res)=>{try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep))throw Error('outside');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
async function contextFor(t,{width=1440,theme='dark'}={}){
 const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'});t.after(()=>context.close());
 const calls=[],errors=[];await context.route('**/*',route=>{
  const url=route.request().url();if(url.startsWith(origin)||/^(?:data|blob):/.test(url))return route.continue();
  if(url==='https://www.zayapi.top/v1/images/generations'||url==='https://synthetic.invalid/v1/images/generations'){
   const body=route.request().postDataJSON();calls.push(body);return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:body.output_format,data:[{b64_json:(body.output_format==='gif'?gif:svg).toString('base64')}]})});
  }return route.abort();
 });
 await context.addInitScript(({theme})=>{localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);localStorage.setItem('wd-model','gpt-image-2.6-flare');}, {theme});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));return{context,page,calls,errors};
}
async function canvas(t,options){const value=await contextFor(t,options),{page}=value;await page.goto(origin+'/ai-node-canvas-test.html?workspace=production');await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');await page.evaluate(()=>{nodes=[];links=[];apiKeyInput.value='synthetic-never-paid';window.generator=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'合成参数差异测试',ratio:'2:3',resolution:'1K',count:1,_deferRender:true,gifFrameCount:2,gifFrameDurationMs:200});render({skipSave:true});centerOnNode(generator.id);});return value;}
async function generate(page,format){await frameNode(page,'generator');await page.locator(`[data-image-format="${format}"]`).click();await frameNode(page,'generator');await page.locator('.node.generator [data-generate]').click();await page.waitForFunction(()=>!wandouHasActiveTasks());return page.evaluate(async format=>{const n=nodes.findLast(n=>n.type==='result');window.outputNode=n;centerOnNode(n.id);return{request:n.outputRequest,comparison:n.outputComparison,status:n.status,width:n.width,height:n.height,full:await getLocalMedia(n.fullUrl),format:n.outputFormat};},format);}
async function frameNode(page,globalName){
 if(await page.locator('#assistantCloseButton').isVisible())await page.locator('#assistantCloseButton').click();
 await page.evaluate(async globalName=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const n=window[globalName];selectedNodeId=n.id;updateSelection();WandouCanvasViewport.refresh();},globalName);
 await page.waitForFunction(globalName=>canvas.querySelector(`[data-id="${window[globalName].id}"]`)?.dataset.viewportSkipped!=='true',globalName);
 await page.evaluate(globalName=>{const n=window[globalName],el=document.querySelector(`.node[data-id="${n.id}"]`);canvasWrap.scrollTop=0;canvasWrap.scrollLeft=0;const r=canvasWrap.getBoundingClientRect();view.zoom=Math.min(1,(r.height-140)/el.offsetHeight);view.x=(r.width-el.offsetWidth*view.zoom)/2-n.x*view.zoom;view.y=(r.height-el.offsetHeight*view.zoom)/2-n.y*view.zoom;applyCanvasTransform();},globalName);
 await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 const geometry=await page.evaluate(globalName=>{const n=window[globalName],el=document.querySelector(`.node[data-id="${n.id}"]`),r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,offsetHeight:el.offsetHeight,viewport:innerHeight,view:{...view},node:{x:n.x,y:n.y},canvas:canvas.getBoundingClientRect().toJSON()};},globalName);assert.ok(geometry.top>=60&&geometry.bottom<=geometry.viewport-40,JSON.stringify(geometry));
}
async function frameResult(page){return frameNode(page,'outputNode');}
for(const width of [1024,1440])for(const theme of ['light','dark'])test(`canvas shows requested and actual SVG/GIF values without converting originals: ${width} ${theme}`,async t=>{
 const{page,calls,errors}=await canvas(t,{width,theme});
 for(const format of ['svg','gif']){
  if(format==='gif')await page.evaluate(()=>centerOnNode(generator.id));
  const out=await generate(page,format),request=calls.at(-1);
  assert.ok(out.request,JSON.stringify({missingRequestSnapshot:true,status:out.status,width:out.width,height:out.height,format:out.format,requestSize:request.size}));assert.equal(out.request.size,request.size);assert.equal(out.request.format,format);assert.equal(out.comparison.mismatch,true);assert.match(out.status,/渠道返回参数与请求不一致/);
  if(format==='svg')assert.match(out.status,/实际：512×512 SVG 画布/);else{assert.match(out.status,/2 帧 × 200 毫秒.*2 帧 × 300 毫秒，共 0.6 秒/);assert.equal(request.size,'auto');}
  assert.equal(hash(Buffer.from(out.full.split(',')[1],'base64')),hash(format==='svg'?svg:gif));assert.equal(calls.length,format==='svg'?1:2);
  await page.waitForFunction(()=>{const n=document.querySelector(`.node[data-id="${outputNode.id}"]`);return n&&n.textContent.includes('渠道返回参数与请求不一致');});
  await frameResult(page);
  await page.screenshot({path:path.join(qa,`output-contract-canvas-${format}-${width}-${theme}.png`)});
  assert.equal(await page.locator('.node.result img').evaluateAll(images=>images.some(i=>/^data:image\/gif/i.test(i.src))),false);
 }
 assert.deepEqual(errors,[]);
});
test('canvas request snapshot survives source edits, save/reopen, asset details, cancel and download failure',async t=>{
 const{page,calls,errors}=await canvas(t);await generate(page,'gif');
 assert.equal(await page.evaluate(async()=>{generator.gifFrameCount=9;generator.gifFrameDurationMs=800;outputNode.title='保存原件差异';return await saveCanvasState();}),true);
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
 const saved=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');window.exports=[];window.exportMode='cancel';window.wandouShell={saveFileAs:async(name,bytes,mime)=>{exports.push({name,bytes:Array.from(bytes),mime});return exportMode==='cancel'?{success:false,canceled:true}:{success:false,error:'合成磁盘不可用'};}};await downloadNodeMedia(n);exportMode='failure';await downloadNodeMedia(n);return{request:n.outputRequest,comparison:n.outputComparison,exports};});
 assert.equal(saved.request.frameCount,2);assert.equal(saved.request.frameDurationMs,200);assert.equal(saved.comparison.mismatch,true);for(const item of saved.exports)assert.equal(hash(Buffer.from(item.bytes)),hash(gif));assert.equal(calls.length,1);
 await page.goto(origin+'/asset-library-test.html');
 const assetStates=await page.evaluate(()=>WandouAssetStates.read(JSON.parse(localStorage.getItem('aiCanvasProjectsV1')||'[]')));
 assert.ok(assetStates.some(row=>row.state.nodes.some(n=>n.outputRequest?.frameDurationMs===200)),JSON.stringify(assetStates));
 await page.locator('[data-asset-info]').first().click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);
 assert.match(await page.locator('#assetFileFacts').textContent(),/请求：2 帧 × 200 毫秒.*实际：2 帧 × 300 毫秒/);assert.deepEqual(errors,[]);
});
test('canvas preview failure retains comparison and original without another paid request',async t=>{
 const{page,calls,errors}=await canvas(t);await page.evaluate(()=>{const original=WandouAnimatedImage.prepare;window.WandouAnimatedImage={prepare:async(...args)=>({...await original(...args),previewUrl:'',previewFallback:true})};});const out=await generate(page,'gif');assert.equal(out.comparison.mismatch,true);assert.match(out.status,/静态预览暂不可用/);assert.equal(hash(Buffer.from(out.full.split(',')[1],'base64')),hash(gif));assert.equal(calls.length,1);assert.deepEqual(errors,[]);
});
test('100 comparison results keep bounded overview shells and restore the complete status at normal zoom',async t=>{
 const{page,calls,errors}=await canvas(t);await generate(page,'gif');
 await page.evaluate(()=>{const template=nodes.find(n=>n.type==='result');nodes=Array.from({length:100},(_,i)=>({...template,id:'comparison-'+i,x:(i%10)*400,y:Math.floor(i/10)*350}));links=[];selectedNodeId=null;boxSelectedIds=[];view={x:0,y:0,zoom:.12};render({skipSave:true});applyCanvasTransform();});
 await page.waitForFunction(()=>WandouCanvasViewport.stats().mountedContents<=1);
 assert.equal(await page.evaluate(()=>nodes.length),100);
 await page.evaluate(()=>{view.zoom=1;window.outputNode=nodes[50];centerOnNode(outputNode.id);});await page.waitForFunction(()=>canvas.querySelector('[data-id="comparison-50"] .status')?.textContent.includes('2 帧 × 300 毫秒'));await frameResult(page);
 const height=await page.locator('[data-id="comparison-50"]').evaluate(el=>el.offsetHeight);assert.ok(height>225,'status must contribute to the mounted node geometry');
 await page.evaluate(()=>{selectedNodeId=null;view={x:0,y:0,zoom:.12};applyCanvasTransform();});await page.waitForFunction(()=>canvas.querySelector('[data-id="comparison-50"]').dataset.viewportSkipped==='true');
 const shellHeight=await page.locator('[data-id="comparison-50"]').evaluate(el=>el.offsetHeight);assert.ok(Math.abs(shellHeight-height)<=1,'remeasured shell must retain the status height');
 assert.equal(await page.evaluate(()=>saveCanvasState()),true);await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(()=>nodes.filter(n=>n.outputComparison?.mismatch&&n.outputRequest?.frameDurationMs===200).length),100);assert.equal(calls.length,1);assert.deepEqual(errors,[]);
});
async function workbench(t,options={}){const value=await contextFor(t,options);await value.page.goto(origin+'/image-workbench/index.html');await value.page.waitForSelector('.wd-workbench-generation');return value;}
async function workbenchGenerate(page,format){await page.locator(`[data-image-format="${format}"]`).click();if(format==='gif'){await page.locator('[data-image-option="gifFrameCount"]').fill('2');await page.locator('[data-image-option="gifFrameCount"]').press('Tab');}
 return page.evaluate(async()=>{const response=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'合成参数差异测试',size:'1024x1536'})});const result=await response.json(),url=result.data[0].url;localStorage.setItem('comparison-test-url',url);return{status:response.status,url,note:result.data[0].revised_prompt,metadata:await WandouWorkbenchOutput.metadata(url)};});
}
for(const width of [1024,1440])for(const theme of ['light','dark'])test(`workbench request snapshot and rendered comparison badge, asset facts: ${width} ${theme}`,async t=>{
 const{page,calls,errors}=await workbench(t,{width,theme});
 const out=await workbenchGenerate(page,'gif');assert.equal(calls.length,1);assert.equal(out.metadata.outputRequest.frameCount,calls[0].frame_count);assert.equal(out.metadata.outputRequest.frameDurationMs,200);assert.equal(out.metadata.outputComparison.mismatch,true);assert.equal(hash(Buffer.from(out.url.split(',')[1],'base64')),hash(gif));assert.match(out.note,/实际：2 帧 × 300 毫秒/);
 await page.evaluate(async url=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.open('gpt-image-playground',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('images','readwrite');tx.objectStore('images').put({id:'comparison-card',dataUrl:url,width:64,height:40});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});
  const card=document.createElement('div');card.id='comparison-card';card.className='task-card-wrapper';card.style.cssText='max-width:440px;margin:12px auto;';card.innerHTML='<img class="saveable-image" data-image-id="comparison-card" style="width:256px;height:160px"><div><button type="button">收藏</button><button type="button">复用配置</button></div>';card.querySelector('img').src=url;document.body.prepend(card);
 },out.url);
 await page.waitForFunction(()=>document.querySelector('#comparison-card .wd-output-processing')?.textContent.includes('2 帧 × 300 毫秒'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);await page.screenshot({path:path.join(qa,`output-contract-workbench-${width}-${theme}.png`)});
 await page.reload();const restored=await page.evaluate(()=>WandouWorkbenchOutput.metadata(localStorage.getItem('comparison-test-url')));assert.deepEqual(restored.outputRequest,out.metadata.outputRequest);assert.deepEqual(restored.outputComparison,out.metadata.outputComparison);assert.equal(calls.length,1);
 await page.evaluate(url=>{localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:'comparison',name:'差异测试'}]));localStorage.setItem('aiCanvasStateV1:comparison',JSON.stringify({folderId:'comparison',nodes:[{id:'compare',title:'请求与返回参数',type:'result',mediaType:'image',imageOutputFormat:'gif',resolutionProcessing:'native-animation',previewUrl:url,fullUrl:url,outputRequest:{version:1,format:'gif',size:'auto',frameCount:2,frameDurationMs:200},width:64,height:40,animationFrameCount:2}],links:[]}));},out.url);
 await page.goto(origin+'/asset-library-test.html');await page.locator('[data-asset-info]').click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);assert.match(await page.locator('#assetFileFacts').textContent(),/渠道返回参数与请求不一致.*2 帧 × 200 毫秒.*2 帧 × 300 毫秒/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);await page.screenshot({path:path.join(qa,`output-contract-assets-${width}-${theme}.png`)});assert.deepEqual(errors,[]);
});
test('workbench SVG snapshot is from normalized wire size and metadata failure does not retry or rewrite',async t=>{
 const{page,calls,errors}=await workbench(t);const out=await workbenchGenerate(page,'svg');assert.equal(out.metadata.outputRequest.size,calls[0].size);assert.equal(out.metadata.outputComparison.mismatch,true);assert.equal(hash(Buffer.from(out.url.split(',')[1],'base64')),hash(svg));
 const failed=await page.evaluate(async()=>{const open=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw Error('synthetic storage unavailable');};try{const response=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic',size:'1024x1536'})});return{status:response.status,value:await response.json()};}finally{indexedDB.open=open;}});
 assert.equal(failed.status,200);assert.match(failed.value.data[0].revised_prompt,/渠道返回参数与请求不一致/);assert.match(failed.value.data[0].revised_prompt,/标记保存失败.*未再次请求/);assert.equal(hash(Buffer.from(failed.value.data[0].url.split(',')[1],'base64')),hash(svg));assert.equal(calls.length,2);assert.deepEqual(errors,[]);
});
test('workbench identical original from different requests cannot relabel older cards with the newest request',async t=>{
 const{page,calls,errors}=await workbench(t);const first=await workbenchGenerate(page,'gif');await page.locator('[data-image-option="gifFrameDurationMs"]').fill('300');await page.locator('[data-image-option="gifFrameDurationMs"]').press('Tab');const second=await workbenchGenerate(page,'gif');assert.equal(first.url,second.url);assert.equal(second.metadata.requestAmbiguous,true);assert.equal(second.metadata.outputRequest,null);assert.equal(second.metadata.outputComparison.hasRequest,false);assert.match(second.metadata.outputComparison.message,/不同请求.*无法唯一对应/);assert.match(second.note,/请求：2 帧 × 300 毫秒/);assert.equal(calls.length,2);
 await page.locator('[data-image-option="gifFrameDurationMs"]').fill('200');await page.locator('[data-image-option="gifFrameDurationMs"]').press('Tab');const third=await workbenchGenerate(page,'gif');assert.equal(third.metadata.requestAmbiguous,true);assert.equal(third.metadata.outputRequest,null);assert.equal(calls.length,3);
 await page.reload();const restored=await page.evaluate(()=>WandouWorkbenchOutput.metadata(localStorage.getItem('comparison-test-url')));assert.equal(restored.requestAmbiguous,true);assert.equal(restored.outputRequest,null);assert.deepEqual(errors,[]);
});
test('legacy workbench metadata with no request cannot acquire the next task request, and canceled metadata work never publishes a result',async t=>{
 const{page,calls,errors}=await workbench(t);
 const observed=await page.evaluate(async gifUrl=>{
  const response=()=>new Response(JSON.stringify({output_format:'gif',data:[{url:gifUrl}]}));
  const plan={},read=window.fetch.bind(window);
  await WandouWorkbenchOutput.processResponse(response(),{plan,fetch:read});
  const legacy=await WandouWorkbenchOutput.metadata(gifUrl);
  const originalId=WandouMediaHash.idAsync;let release,entered;
  const gate=new Promise(resolve=>entered=resolve);
  window.WandouMediaHash={...WandouMediaHash,idAsync:async(...args)=>{entered();await new Promise(resolve=>release=resolve);return originalId(...args);}};
  const controller=new AbortController(),request=WandouImageOutputContract.capture({output_format:'gif',size:'auto',frame_count:2,frame_duration_ms:200});
  const processing=WandouWorkbenchOutput.processResponse(response(),{plan,fetch:read,outputRequest:request,signal:controller.signal});await gate;controller.abort();release();
  let canceled=false;try{await processing;}catch(error){canceled=error.name==='AbortError';}window.WandouMediaHash={...WandouMediaHash,idAsync:originalId};
  // The next invocation waits for the canceled local work to leave the serialized queue.
  const next=await WandouWorkbenchOutput.processResponse(response(),{plan,fetch:read,outputRequest:request});
  return{legacy,canceled,status:next.status,metadata:await WandouWorkbenchOutput.metadata(gifUrl),url:(await next.json()).data[0].url};
 },'data:image/gif;base64,'+gif.toString('base64'));
 assert.equal(observed.legacy.outputRequest,null);assert.equal(observed.canceled,true);assert.equal(observed.status,200);assert.equal(observed.metadata.requestAmbiguous,true);assert.equal(observed.metadata.outputRequest,null);assert.equal(hash(Buffer.from(observed.url.split(',')[1],'base64')),hash(gif));assert.equal(calls.length,0);assert.deepEqual(errors,[]);
});
