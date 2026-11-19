const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright'),sharp=require('../desktop-client/node_modules/sharp');
const qa=path.resolve(__dirname,'../../qa'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let browser,gif,gifUrl;
test.before(async()=>{
 const w=64,h=40,raw=Buffer.alloc(w*h*2*4);
 for(let frame=0;frame<2;frame++)for(let y=8;y<32;y++)for(let x=8;x<56;x++){const p=(frame*w*h+y*w+x)*4;raw[p]=frame?55:235;raw[p+1]=frame?180:90;raw[p+2]=130;raw[p+3]=255;}
 gif=await sharp(raw,{raw:{width:w,height:h*2,pageHeight:h,channels:4}}).gif({loop:0,delay:[80,120]}).toBuffer();gifUrl='data:image/gif;base64,'+gif.toString('base64');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});fs.mkdirSync(qa,{recursive:true});
});
test.after(()=>browser?.close());
async function fixture(t,{width=1440,theme='dark',invalid=false}={}){
 const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'});t.after(()=>context.close());
 const page=await context.newPage(),calls=[],errors=[],downloads=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.route(/^https?:/,async route=>{
  if(route.request().url()==='https://www.zayapi.top/v1/images/generations'){
   calls.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'gif',data:[{b64_json:invalid?Buffer.from('GIF89a truncated').toString('base64'):gif.toString('base64')}]})});
  }
  return route.abort();
 });
 await context.addInitScript(theme=>{localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);},theme);
 await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
 await page.evaluate(({theme,gifUrl})=>{
  document.body.classList.toggle('dark-theme',theme==='dark');document.documentElement.dataset.theme=theme;apiKeyInput.value='synthetic-never-paid';nodes=[];links=[];nodeId=1;window.syntheticGif=gifUrl;
  window.generator=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'测试主体平滑循环',ratio:'16:9',resolution:'4K',count:1,_deferRender:true});render({skipSave:true});centerOnNode(generator.id);
 },{theme,gifUrl});
 return {page,calls,errors,downloads};
}
async function generated(page){await page.evaluate(async()=>{generator.imageOutputFormat='gif';generator.outputFormat='gif';await generateFromNode(generator.id);window.resultNode=nodes.find(n=>n.type==='result');render({skipSave:true});centerOnNode(resultNode.id);});}
async function deferCalls(page,count=1){await page.evaluate(count=>{generator.imageOutputFormat='gif';generator.outputFormat='gif';generator.count=count;window.mockCalls=[];window.tasks=[];callApi=(node,signal)=>new Promise((resolve,reject)=>mockCalls.push({node,signal,resolve,reject}));},count);}
async function finishCalls(page){await page.evaluate(async()=>{mockCalls.forEach(call=>call.resolve({url:syntheticGif,mediaType:'image',fromApi:true}));await Promise.all(tasks);});}

for(const width of [1440,1024])for(const theme of ['light','dark'])test(`canvas GIF controls, native wire payload, static preview and explicit fullscreen playback: ${width} ${theme}`,async t=>{
 const {page,calls,errors}=await fixture(t,{width,theme});
 await page.locator('[data-image-format="gif"]').click();await page.locator('[data-image-option="imageQuality"]').selectOption('medium');await page.locator('[data-image-option="imageComplexity"]').selectOption('low');
 await page.locator('[data-image-option="gifFrameCount"]').fill('6');await page.locator('[data-image-option="gifFrameCount"]').press('Tab');await page.locator('[data-image-option="gifFrameDurationMs"]').fill('150');await page.locator('[data-image-option="gifFrameDurationMs"]').press('Tab');
 assert.equal(await page.locator('.node.generator .resolution-row').isVisible(),false);assert.equal(await page.locator('[data-auto-split-toggle]').isDisabled(),true);
 await page.screenshot({path:path.join(qa,`gif-canvas-options-${width}-${theme}.png`)});
 await page.locator('.node.generator [data-generate]').click();await page.waitForFunction(()=>!wandouHasActiveTasks());
 assert.equal(calls.length,1);assert.equal(calls[0].output_format,'gif');assert.equal(calls[0].quality,'medium');assert.equal(calls[0].complexity,'low');assert.equal(calls[0].frame_count,6);assert.equal(calls[0].frame_duration_ms,150);assert.equal(calls[0].size,'auto');assert.equal(calls[0].n,1);assert.doesNotMatch(calls[0].prompt,/4096|4K/);
 for(const key of ['resolution','response_format','stream','partial_images','output_compression'])assert.equal(calls[0][key],undefined,key);
 const result=await page.evaluate(async()=>{window.resultNode=nodes.find(n=>n.type==='result');centerOnNode(resultNode.id);return{format:resultNode.imageOutputFormat,processing:resultNode.resolutionProcessing,width:resultNode.width,height:resultNode.height,frames:resultNode.animationFrameCount,durations:resultNode.animationFrameDurationsMs,loop:resultNode.animationLoopCount,full:await getLocalMedia(resultNode.fullUrl),preview:await getLocalMedia(resultNode.previewUrl)};});
 assert.equal(result.format,'gif');assert.equal(result.processing,'native-animation');assert.deepEqual([result.width,result.height,result.frames],[64,40,2]);assert.deepEqual(result.durations,[80,120]);assert.equal(result.loop,0);assert.equal(hash(Buffer.from(result.full.split(',')[1],'base64')),hash(gif));assert.match(result.preview,/^data:image\/png/);
 assert.equal(await page.locator('.node.result img').evaluateAll(images=>images.some(img=>/^data:image\/gif/i.test(img.src))),false);
 await page.locator('.node.result [data-result-transfer]').click();await page.locator('#lightbox.open').waitFor();assert.equal(await page.locator('[data-gif-playback]').getAttribute('aria-pressed'),'false');assert.match(await page.locator('#lightboxImage').getAttribute('src'),/^data:image\/png/);
 await page.locator('[data-gif-playback]').click();await page.waitForFunction(()=>lightboxImage.complete&&lightboxImage.naturalWidth===64);assert.equal(await page.locator('#lightboxImage').getAttribute('src'),gifUrl);
 await page.locator('[data-gif-playback]').click();assert.match(await page.locator('#lightboxImage').getAttribute('src'),/^data:image\/png/);
 await page.locator('[data-gif-playback]').click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});assert.equal(await page.locator('[data-gif-playback]').getAttribute('aria-pressed'),'false');
 await page.screenshot({path:path.join(qa,`gif-canvas-playback-${width}-${theme}.png`)});await page.locator('#lightboxClose').click();assert.equal(await page.locator('[data-gif-playback]').count(),0);assert.deepEqual(errors,[]);
});

test('canvas GIF save/reopen, footer/fullscreen/right-click Save As preserve original bytes through cancel and failure',async t=>{
 const {page,calls,errors,downloads}=await fixture(t);await generated(page);await page.evaluate(()=>saveCanvasState());await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
 const restored=await page.evaluate(async()=>{window.resultNode=nodes.find(n=>n.type==='result');centerOnNode(resultNode.id);window.saved=[];window.mode='success';window.legacyWrites=0;window.wandouShell={saveFileAs:async(name,bytes,mime)=>{saved.push({name,bytes:Array.from(bytes),mime});return mode==='cancel'?{success:false,canceled:true}:mode==='failure'?{success:false,error:'合成目录不可写'}:{success:true,path:'X:/synthetic/'+name};},writeSaveFile:async()=>{legacyWrites++;throw Error('must not fall back');}};return{frames:resultNode.animationFrameCount,durations:resultNode.animationFrameDurationsMs,loop:resultNode.animationLoopCount,processing:resultNode.resolutionProcessing,full:await getLocalMedia(resultNode.fullUrl)};});
 assert.deepEqual({frames:restored.frames,durations:restored.durations,loop:restored.loop,processing:restored.processing},{frames:2,durations:[80,120],loop:0,processing:'native-animation'});assert.equal(hash(Buffer.from(restored.full.split(',')[1],'base64')),hash(gif));
 await page.locator('.node.result [data-download]').click();await page.waitForFunction(()=>saved.length===1);
 await page.locator('.node.result [data-result-transfer]').click();await page.locator('#lightbox.open').waitFor();await page.locator('[data-gif-playback]').click();await page.waitForFunction(()=>lightboxImage.complete&&lightboxImage.naturalWidth===64);
 await page.evaluate(()=>mode='cancel');await page.locator('#lightboxDownload').click();await page.waitForFunction(()=>saved.length===2);assert.match(await page.locator('#toast').textContent(),/取消/);
 await page.evaluate(()=>mode='success');await page.locator('#lightboxImage').click({button:'right'});await page.locator('#lightboxContextDownload').click();await page.waitForFunction(()=>saved.length===3);
 await page.evaluate(()=>mode='failure');await page.locator('#lightboxDownload').click();await page.waitForFunction(()=>saved.length===4);assert.match(await page.locator('#toast').textContent(),/合成目录不可写/);
 for(const item of await page.evaluate(()=>saved)){assert.equal(item.mime,'image/gif');assert.match(item.name,/\.gif$/);assert.equal(hash(Buffer.from(item.bytes)),hash(gif));}
 assert.equal(calls.length,1);assert.equal(await page.evaluate(()=>legacyWrites),0);assert.deepEqual(downloads,[]);assert.deepEqual(errors,[]);
});

test('invalid GIF cannot become a visible result and never retries paid generation',async t=>{
 const {page,calls,errors}=await fixture(t,{invalid:true});await generated(page);const value=await page.evaluate(()=>({full:resultNode.fullUrl,status:resultNode.status,busy:wandouHasActiveTasks()}));
 assert.equal(calls.length,1);assert.ok(!value.full);assert.match(value.status,/失败.*未自动重复/);assert.equal(value.busy,false);assert.deepEqual(errors,[]);
});
test('GIF static-preview failure retains original, can save/reopen and does not call generation again',async t=>{
 const {page,calls,errors}=await fixture(t);await page.evaluate(()=>{const prepare=WandouAnimatedImage.prepare;window.WandouAnimatedImage={prepare:async(input,options)=>({...await prepare(input,{...options,preview:false}),previewUrl:'',previewFallback:true})};});await generated(page);
 const value=await page.evaluate(async()=>({full:await getLocalMedia(resultNode.fullUrl),preview:await getLocalMedia(resultNode.previewUrl),status:resultNode.status,frames:resultNode.animationFrameCount}));assert.equal(calls.length,1);assert.equal(hash(Buffer.from(value.full.split(',')[1],'base64')),hash(gif));assert.match(value.preview,/^data:image\/png/);assert.match(value.status,/静态预览暂不可用/);assert.equal(value.frames,2);
 await page.evaluate(()=>saveCanvasState());await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);assert.equal(await page.evaluate(()=>nodes.find(n=>n.type==='result').animationFrameCount),2);assert.equal(calls.length,1);assert.deepEqual(errors,[]);
});
for(const action of ['cancel','delete'])test(`GIF duplicate click and ${action} during decode never publishes a late result`,async t=>{
 const {page,calls,errors}=await fixture(t);
 await page.evaluate(()=>{generator.imageOutputFormat='gif';const original=WandouAnimatedImage.prepare;window.WandouAnimatedImage={prepare:async(input,options)=>{const valid=await original(input,options);return new Promise(resolve=>window.finishDecode=()=>resolve(valid));}};window.tasks=[generateFromNode(generator.id),generateFromNode(generator.id)];});await page.waitForFunction(()=>typeof finishDecode==='function');assert.equal(calls.length,1);
 await page.evaluate(async action=>{const pending=nodes.find(n=>n.type==='result');if(action==='delete'){deleteNode(pending.id);window.replacement={id:pending.id,type:'result',status:'replacement'};nodes.push(replacement);}else stopCanvasImageTask(generator.id);finishDecode();await Promise.all(tasks);},action);
 const result=await page.evaluate(()=>({attached:nodes.some(n=>n.type==='result'&&n.fullUrl),busy:wandouHasActiveTasks(),replacement:window.replacement?.status}));assert.equal(result.attached,false);assert.equal(result.busy,false);if(action==='delete')assert.equal(result.replacement,'replacement');assert.deepEqual(errors,[]);
});
test('GIF active task gates project switch/create/delete, tab suspend and program close; recovery stays with its source project',async t=>{
 const {page,errors}=await fixture(t);await deferCalls(page);
 await page.evaluate(()=>{window.originalProject=activeProjectId;projects.push({id:'gif-other',name:'GIF其他项目'});tasks.push(generateFromNode(generator.id));});await page.waitForFunction(()=>mockCalls.length===1);
 const guards=await page.evaluate(async()=>{const count=projects.length;await switchProject('gif-other');await createProject();await deleteProject(originalProject);const close=await wandouSaveBeforeClose(),tab=await wandouPrepareTabSuspend();return{same:originalProject===activeProjectId,count,now:projects.length,present:nodes.includes(generator),close,tab};});
 assert.equal(guards.same,true);assert.equal(guards.count,guards.now);assert.equal(guards.present,true);assert.equal(guards.close.success,false);assert.equal(guards.close.busy,true);assert.equal(guards.tab.safe,false);
 await finishCalls(page);assert.equal(await page.evaluate(()=>mockCalls.length),1);assert.equal(await page.evaluate(()=>wandouSaveBeforeClose()).then(r=>r.success),true);
 await page.evaluate(()=>switchProject('gif-other'));assert.equal(await page.evaluate(()=>nodes.filter(n=>n.resolutionProcessing==='native-animation').length),0);await page.evaluate(()=>switchProject(originalProject));assert.equal(await page.evaluate(()=>nodes.filter(n=>n.resolutionProcessing==='native-animation').length),1);assert.deepEqual(errors,[]);
});
test('deleting one of three active GIF sources and canceling another preserves the remaining source result',async t=>{
 const {page,errors}=await fixture(t);await deferCalls(page);
 await page.evaluate(()=>{window.sources=[generator,...[1,2].map(i=>createNode('generator',i*400,0,{model:'gpt-image-2.6-flare',prompt:'合成测试'+i,imageOutputFormat:'gif',outputFormat:'gif',count:1,_deferRender:true}))];tasks=sources.map(source=>generateFromNode(source.id));});await page.waitForFunction(()=>mockCalls.length===3);
 const control=await page.evaluate(()=>{deleteNode(sources[0].id);stopCanvasImageTask(sources[1].id);return mockCalls.map(call=>call.signal.aborted);});assert.deepEqual(control,[true,true,false]);await finishCalls(page);
 const result=await page.evaluate(()=>({requests:mockCalls.length,busy:wandouHasActiveTasks(),pending:nodes.filter(n=>n.pending).length,results:nodes.filter(n=>n.resolutionProcessing==='native-animation').map(n=>({id:n.id,parents:links.filter(l=>l.to===n.id).map(l=>l.from)})),remaining:sources[2].id}));
 assert.equal(result.requests,3);assert.equal(result.busy,false);assert.equal(result.pending,0);assert.equal(result.results.length,1);assert.deepEqual(result.results[0].parents,[result.remaining]);assert.deepEqual(errors,[]);
});
test('restored GIF node with a stale batch count still sends exactly one generation request',async t=>{
 const {page,calls,errors}=await fixture(t);await page.evaluate(()=>{generator.count=9;generator.imageOutputFormat='gif';generator.outputFormat='gif';});await generated(page);
 assert.equal(calls.length,1,'GIF UI promises one animation; stale project count must not multiply paid requests');assert.equal(await page.evaluate(()=>nodes.filter(n=>n.resolutionProcessing==='native-animation').length),1);assert.deepEqual(errors,[]);
});
for(const kind of ['psd','vector'])test(`${kind} export rejects original GIF before rasterization or paid work, including a saved PSD review`,async t=>{
 const {page,calls,errors}=await fixture(t);const result=await page.evaluate(async kind=>{
  let paid=0,rasterized=0;callApi=async()=>{paid++;throw Error('must not pay');};postChatCompletion=async()=>{paid++;throw Error('must not pay');};psdCanvasFromUrl=async()=>{rasterized++;throw Error('must not flatten');};
  const node=createNode(kind,500,0,{model:'gpt-image-2.5-sunburst',references:[{url:syntheticGif,mediaType:'image',width:64,height:40}],vectorMode:'trace',vectorFormat:'svg',_deferRender:true});
  if(kind==='psd')node.psdReview={sourceKey:psdReviewSourceKey(psdSourceReference(node)),width:64,height:40,layers:[{name:'测试对象',category:'subject',selected:true,bounds:[0,0,1000,1000]}]};
  await (kind==='psd'?generatePsdFromNode(node.id):generateVectorFromNode(node.id));
  return{paid,rasterized,status:node.status,active:wandouHasActiveTasks(),exported:kind==='psd'?psdExportFiles.has(node.id):vectorExportFiles.has(node.id),review:!!node.psdReview};
 },kind);
 assert.equal(result.paid,0);assert.equal(result.rasterized,0);assert.equal(result.active,false);assert.equal(result.exported,false);assert.match(result.status,/GIF|动图/);assert.equal(calls.length,0);assert.deepEqual(errors,[]);
});
for(const kind of ['psd','vector'])test(`${kind} pending GIF source read claims once, blocks project deletion and cannot overwrite a deleted node`,async t=>{
 const {page,calls,errors}=await fixture(t);await page.evaluate(kind=>{
  window.localReads=0;window.paid=0;window.originalProject=activeProjectId;projects.push({id:'source-read-other',name:'读取隔离项目'});
  callApi=async()=>{paid++;throw Error('must not pay');};psdCanvasFromUrl=async()=>{throw Error('must not flatten');};
  window.sourceNode=createNode(kind,500,0,{model:'gpt-image-2.5-sunburst',references:[{url:syntheticGif,mediaType:'image',width:64,height:40}],vectorMode:'trace',vectorFormat:'svg',_deferRender:true});
  if(kind==='psd')sourceNode.psdReview={sourceKey:psdReviewSourceKey(psdSourceReference(sourceNode)),width:64,height:40,layers:[{name:'测试对象',category:'subject',selected:true,bounds:[0,0,1000,1000]}]};
  const original=assertStaticExportSource;assertStaticExportSource=async(...args)=>{localReads++;await new Promise(resolve=>window.finishRead=resolve);return original(...args);};
  const generate=kind==='psd'?generatePsdFromNode:generateVectorFromNode;window.tasks=[generate(sourceNode.id),generate(sourceNode.id)];
 },kind);await page.waitForFunction(()=>typeof finishRead==='function');
 const guards=await page.evaluate(async()=>{await deleteProject(originalProject);const close=await wandouSaveBeforeClose();return{reads:localReads,same:activeProjectId===originalProject,present:nodes.includes(sourceNode),busy:close.busy};});assert.equal(guards.reads,1);assert.equal(guards.same,true);assert.equal(guards.present,true);assert.equal(guards.busy,true);
 const result=await page.evaluate(async()=>{deleteNode(sourceNode.id);window.replacement={id:sourceNode.id,type:sourceNode.type,status:'replacement remains'};nodes.push(replacement);finishRead();await Promise.all(tasks);return{reads:localReads,paid,busy:wandouHasActiveTasks(),status:replacement.status,exports:psdExportFiles.has(sourceNode.id)||vectorExportFiles.has(sourceNode.id)};});
 assert.deepEqual(result,{reads:1,paid:0,busy:false,status:'replacement remains',exports:false});assert.equal(calls.length,0);assert.deepEqual(errors,[]);
});
