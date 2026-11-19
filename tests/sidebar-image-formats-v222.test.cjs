'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright'),sharp=require('../desktop-client/node_modules/sharp');
const qa=path.resolve(__dirname,'../../qa'),app=path.resolve(__dirname,'../app'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><title>独立入口测试</title><g id="subject"><path fill="#6a8" d="M20 20H140V76H20Z"/></g></svg>');
const checks=[],screenshots=[];let browser,gif,png,appHashes,startedAt,registered=0;
function filesHash(){const value={};function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const target=path.join(dir,entry.name);if(entry.isDirectory())visit(target);else if(entry.isFile())value[path.relative(app,target).replaceAll('\\','/')]=hash(fs.readFileSync(target));}}visit(app);return value;}
function check(name,fn){registered++;test(name,async t=>{try{await fn(t);checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});throw error;}});}
test.before(async()=>{
 startedAt=new Date().toISOString();appHashes=filesHash();fs.mkdirSync(qa,{recursive:true});
 const w=64,h=40,raw=Buffer.alloc(w*h*2*4);for(let f=0;f<2;f++)for(let y=8;y<32;y++)for(let x=8;x<56;x++){const p=(f*w*h+y*w+x)*4;raw[p]=f?55:235;raw[p+1]=f?180:90;raw[p+2]=130;raw[p+3]=255;}
 gif=await sharp(raw,{raw:{width:w,height:h*2,pageHeight:h,channels:4}}).gif({loop:0,delay:[80,120]}).toBuffer();
 png=await sharp(Buffer.from([255,0,0,255,255,0,0,255,0,102,255,255,0,102,255,255,255,0,0,255,255,0,0,255,0,102,255,255,0,102,255,255]),{raw:{width:4,height:2,channels:4}}).png().toBuffer();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{
 await browser?.close();const after=filesHash(),runtimeUnchanged=JSON.stringify(Object.entries(appHashes||{}).sort())===JSON.stringify(Object.entries(after).sort());
 fs.writeFileSync(path.join(qa,'sidebar-image-formats-v222.json'),JSON.stringify({success:checks.length===registered&&checks.every(c=>c.passed)&&runtimeUnchanged,startedAt,finishedAt:new Date().toISOString(),appHashes,appHashesAfter:after,runtimeUnchanged,testFileSha256:hash(fs.readFileSync(__filename)),checks,screenshots},null,2));
 assert.equal(runtimeUnchanged,true,'do not claim results for a changing runtime');
});
async function fixture(t,{width=1440,theme='dark',invalid=false}={}){
 const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce',acceptDownloads:true});t.after(()=>context.close());
 const page=await context.newPage(),calls=[],errors=[],downloads=[],external=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.route(/^https?:/,async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/v1/images/generations'){
   const payload=request.postDataJSON();calls.push(payload);const bytes=invalid?Buffer.from('invalid synthetic response'):payload.output_format==='svg'?svg:gif;
   return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:payload.output_format,data:[{b64_json:bytes.toString('base64')}]})});
  }
  external.push(url.origin+url.pathname);return route.abort();
 });
 await context.addInitScript(theme=>{localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);},theme);
 await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href+'?workspace=production');await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
 await page.evaluate(theme=>{apiKeyInput.value='synthetic-never-paid';nodes=[];links=[];nodeId=1;selectedNodeId=null;boxSelectedIds=[];view={x:0,y:0,zoom:1};document.body.classList.toggle('dark-theme',theme==='dark');document.documentElement.dataset.theme=theme;render({skipSave:true});applyCanvasTransform();},theme);
 return{page,calls,errors,downloads,external};
}
async function entry(page,format,via='sidebar'){
 const before=await page.evaluate(()=>nodes.length);
 if(via==='sidebar')await page.locator(`[data-add-node="${format}"]`).click();
 else {
  const point=await page.evaluate(()=>{const r=canvasWrap.getBoundingClientRect();return{x:r.left+Math.min(200,r.width/3),y:r.top+80};});
  await page.mouse.dblclick(point.x,point.y);await page.locator('#contextMenu.open').waitFor();await page.locator(`[data-menu-node="${format}"]`).click();
 }
 const value=await page.evaluate(()=>{window.generator=nodes.at(-1);centerOnNode(generator.id);return{id:generator.id,type:generator.type,format:generator.imageOutputFormat,output:generator.outputFormat,prompt:generator.prompt,model:generator.model,count:generator.count,split:generator.autoSplit,quality:generator.imageQuality,complexity:generator.imageComplexity,frames:generator.gifFrameCount,duration:generator.gifFrameDurationMs,total:nodes.length,title:generator.title};});
 assert.equal(value.total,before+1);assert.equal(value.type,'generator');assert.equal(value.format,format);assert.equal(value.output,format);assert.equal(value.prompt,'');assert.equal(value.count,1);assert.equal(value.split,false);assert.equal(value.quality,'high');assert.equal(value.complexity,'high');assert.equal(value.frames,9);assert.equal(value.duration,200);assert.match(value.model,/gpt-image-2\.6-(?:flare|sunburst)/i);assert.doesNotMatch(value.title,/SVG|GIF/i);
 await page.locator(`.node[data-id="${value.id}"] [data-field="prompt"]`).fill(format==='svg'?'生成简洁的矢量方形图标':'主体缓慢摆动，首尾循环');return value.id;
}
async function result(page,format){
 await page.waitForFunction(()=>!wandouHasActiveTasks());
 const value=await page.evaluate(async()=>{window.resultNode=nodes.find(n=>n.type==='result');if(!resultNode)return null;centerOnNode(resultNode.id);return{format:resultNode.imageOutputFormat,processing:resultNode.resolutionProcessing,width:resultNode.width,height:resultNode.height,full:await getLocalMedia(resultNode.fullUrl),preview:await getLocalMedia(resultNode.previewUrl),frames:resultNode.animationFrameCount,durations:resultNode.animationFrameDurationsMs,loop:resultNode.animationLoopCount};});
 assert.ok(value);assert.equal(value.format,format);assert.equal(value.processing,format==='svg'?'native-vector':'native-animation');assert.equal(hash(Buffer.from(value.full.split(',')[1],'base64')),hash(format==='svg'?svg:gif));assert.match(value.preview,/^data:image\/png/);
 if(format==='svg')assert.deepEqual([value.width,value.height],[160,96]);else{assert.deepEqual([value.width,value.height,value.frames],[64,40,2]);assert.deepEqual(value.durations,[80,120]);assert.equal(value.loop,0);}return value;
}
async function installSaveAs(page){await page.evaluate(()=>{window.saved=[];window.saveMode='success';window.legacyWrites=0;window.wandouShell={saveFileAs:async(name,bytes,mime)=>{saved.push({name,bytes:Array.from(bytes),mime});return saveMode==='cancel'?{success:false,canceled:true}:saveMode==='failure'?{success:false,error:'合成文件夹不可写'}:{success:true,path:'X:/synthetic/'+name};},writeSaveFile:async()=>{legacyWrites++;throw Error('legacy export must not run');}};});}
async function snapshot(page,name){await page.screenshot({path:path.join(qa,name)});screenshots.push(name);}
async function downloadBytes(download){const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}

for(const width of [1440,1024])for(const theme of ['light','dark'])for(const format of ['svg','gif'])check(`new ${format} entry through ${theme==='light'?'sidebar':'blank-canvas menu'}, request, reopen and Save As: ${width} ${theme}`,async t=>{
 const{page,calls,errors,downloads}=await fixture(t,{width,theme});await entry(page,format,theme==='light'?'sidebar':'menu');assert.equal(calls.length,0);
 assert.equal(await page.locator(`[data-image-format="${format}"]`).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.node.generator .resolution-row').isVisible(),false);assert.equal(await page.locator('[data-auto-split-toggle]').isDisabled(),true);
 await page.locator('[data-image-option="imageQuality"]').selectOption('medium');await page.locator('[data-image-option="imageComplexity"]').selectOption('low');
 if(format==='gif'){await page.locator('[data-image-option="gifFrameCount"]').fill('6');await page.locator('[data-image-option="gifFrameCount"]').press('Tab');await page.locator('[data-image-option="gifFrameDurationMs"]').fill('150');await page.locator('[data-image-option="gifFrameDurationMs"]').press('Tab');}
 assert.equal(await page.evaluate(()=>document.body.classList.contains('dark-theme')),theme==='dark');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await snapshot(page,`sidebar-${format}-controls-${width}-${theme}.png`);
 await page.locator('.node.generator [data-generate]').click();await result(page,format);assert.equal(calls.length,1);const payload=calls[0];assert.equal(payload.output_format,format);assert.equal(payload.n,1);assert.equal(payload.quality,'medium');assert.equal(payload.complexity,'low');assert.equal(payload.background,undefined);for(const key of ['resolution','response_format','stream','partial_images','output_compression'])assert.equal(payload[key],undefined,key);
 if(format==='gif'){assert.equal(payload.frame_count,6);assert.equal(payload.frame_duration_ms,150);assert.equal(payload.size,'auto');assert.doesNotMatch(payload.prompt,/4096|4K/);}else{assert.equal(payload.frame_count,undefined);assert.equal(payload.frame_duration_ms,undefined);}
 await page.evaluate(()=>saveCanvasState());await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await result(page,format);
 const restored=await page.evaluate(()=>{const n=nodes.find(n=>n.type==='generator');return{format:n.imageOutputFormat,quality:n.imageQuality,complexity:n.imageComplexity,frames:n.gifFrameCount,duration:n.gifFrameDurationMs};});assert.equal(restored.format,format);assert.equal(restored.quality,'medium');assert.equal(restored.complexity,'low');if(format==='gif'){assert.equal(restored.frames,6);assert.equal(restored.duration,150);}
 await installSaveAs(page);await page.locator('.node.result [data-download]').click();await page.waitForFunction(()=>saved.length===1);await page.evaluate(()=>saveMode='cancel');await page.locator('.node.result [data-download]').click();await page.waitForFunction(()=>saved.length===2);assert.match(await page.locator('#toast').textContent(),/取消/);
 const saved=await page.evaluate(()=>saved);for(const item of saved){assert.match(item.name,new RegExp('\\.'+format+'$'));assert.equal(item.mime,format==='svg'?'image/svg+xml':'image/gif');assert.equal(hash(Buffer.from(item.bytes)),hash(format==='svg'?svg:gif));}
 assert.equal(await page.evaluate(()=>legacyWrites),0);assert.equal(calls.length,1);assert.deepEqual(downloads,[]);assert.deepEqual(errors,[]);
});

for(const format of ['svg','gif'])for(const action of ['cancel','delete','project-guards'])check(`${format} sidebar entry duplicate click and ${action} while decoding keeps task ownership`,async t=>{
 const{page,calls,errors}=await fixture(t);await entry(page,format);
 await page.evaluate(format=>{const name=format==='svg'?'WandouNativeSvg':'WandouAnimatedImage',original=window[name].prepare;window[name]={...window[name],prepare:async(input,options)=>{const valid=await original(input,options);return new Promise(resolve=>window.finishDecode=()=>resolve(valid));}};window.originalProject=activeProjectId;projects.push({id:'entry-other',name:'合成隔离项目'});},format);
 await page.locator('.node.generator [data-generate]').evaluate(button=>{button.click();button.click();});await page.waitForFunction(()=>typeof finishDecode==='function');assert.equal(calls.length,1);
 if(action==='project-guards'){
  const guards=await page.evaluate(async()=>{const count=projects.length;await switchProject('entry-other');await createProject();await deleteProject(originalProject);const close=await wandouSaveBeforeClose(),tab=await wandouPrepareTabSuspend();return{same:activeProjectId===originalProject,count,now:projects.length,close,tab};});assert.equal(guards.same,true);assert.equal(guards.count,guards.now);assert.equal(guards.close.success,false);assert.equal(guards.close.busy,true);assert.equal(guards.tab.safe,false);
  await page.evaluate(()=>finishDecode());await result(page,format);await page.evaluate(()=>switchProject('entry-other'));assert.equal(await page.evaluate(()=>nodes.some(n=>['native-vector','native-animation'].includes(n.resolutionProcessing))),false);await page.evaluate(()=>switchProject(originalProject));await result(page,format);
 }else{
  await page.evaluate(action=>{if(action==='cancel')stopCanvasImageTask(generator.id);else{const pending=nodes.find(n=>n.type==='result');deleteNode(pending.id);window.replacement={id:pending.id,type:'result',status:'replacement remains'};nodes.push(replacement);}finishDecode();},action);
  await page.waitForFunction(()=>!wandouHasActiveTasks());assert.equal(await page.evaluate(()=>nodes.some(n=>n.type==='result'&&n.fullUrl)),false);if(action==='delete')assert.equal(await page.evaluate(()=>replacement.status),'replacement remains');
 }
 assert.equal(calls.length,1);assert.deepEqual(errors,[]);
});

for(const format of ['svg','gif'])check(`${format} new entry rejects invalid original without another generation`,async t=>{
 const{page,calls,errors}=await fixture(t,{invalid:true});await entry(page,format);await page.locator('.node.generator [data-generate]').click();await page.waitForFunction(()=>!wandouHasActiveTasks());
 const value=await page.evaluate(()=>{const n=nodes.find(n=>n.type==='result');return{full:n?.fullUrl,status:n?.status};});assert.equal(calls.length,1);assert.ok(!value.full);assert.match(value.status,/失败.*未自动重复/);assert.deepEqual(errors,[]);
});

check('SVG sidebar blocks reference editing and unsupported models locally, while PNG remains selectable',async t=>{
 const{page,calls,errors}=await fixture(t);await entry(page,'svg');
 const value=await page.evaluate(async png=>{generator.references=[{url:png,mediaType:'image'}];await generateFromNode(generator.id);const reference=generator.status;generator.references=[];generator.model='gpt-image-2.5-1k';await generateFromNode(generator.id);const model=generator.status;render({skipSave:true});return{reference,model};},'data:image/png;base64,'+png.toString('base64'));
 assert.equal(calls.length,0);assert.match(value.reference,/参考图/);assert.match(value.model,/2\.6/);await page.locator('[data-image-format="png"]').click();assert.equal(await page.evaluate(()=>generator.imageOutputFormat),'png');assert.doesNotMatch(await page.evaluate(()=>generator.title),/SVG|GIF/);assert.deepEqual(errors,[]);
});

for(const listed of [true,false])check(`new SVG/GIF entries preserve compatible channel-two selection ${listed?'in the catalog':'missing from cached catalog'}`,async t=>{
 const{page,calls,errors}=await fixture(t);await entry(page,'svg');await page.evaluate(listed=>{const model='gpt-image-2.6-sunburst · 渠道 2';if(listed&&!imageModelOptions.includes(model))imageModelOptions.push(model);generator.model=model;selectedNodeId=generator.id;render({skipSave:true});},listed);
 const second=await entry(page,'gif');assert.equal(await page.evaluate(id=>nodes.find(n=>n.id===id).model,second),'gpt-image-2.6-sunburst · 渠道 2');assert.equal(await page.evaluate(()=>nodes.some(n=>['svg','gif'].includes(n.type))),false);assert.equal(calls.length,0);assert.deepEqual(errors,[]);
 if(!listed)assert.equal(await page.evaluate(()=>imageModelOptions.includes('gpt-image-2.6-sunburst · 渠道 2')),false,'a local compatible option must not rewrite the channel catalog');
});

for(const width of [1440,1024])for(const theme of ['light','dark'])check(`edge creation menu stays reachable and preserves SVG/GIF world positions: ${width} ${theme}`,async t=>{
 for(const format of ['svg','gif']){
  const{page,calls,errors}=await fixture(t,{width,theme});const point=await page.evaluate(()=>{
   const bounds=canvasWrap.getBoundingClientRect(),panel=assistantPanel.getBoundingClientRect(),toolbar=document.querySelector('.test-canvas-toolbar')?.getBoundingClientRect();
   const right=Math.min(bounds.right,assistantPanel.closest('.app')?.classList.contains('assistant-open')?panel.left:innerWidth),bottom=Math.min(bounds.bottom,toolbar?.height?toolbar.top:innerHeight);
   // The IP mascot also floats above this corner. Pick the nearest exposed
   // blank canvas pixel; never dispatch a synthetic dblclick through an overlay.
   for(const dy of [24,80,140,200])for(const dx of [24,80,140]){const point={x:right-dx,y:bottom-dy},target=document.elementFromPoint(point.x,point.y);if(canvasWrap.contains(target)&&!assistantPanel.contains(target)&&!target.closest('.node,.topbar,.project-hub,.test-canvas-toolbar,button'))return point;}
   throw Error('No exposed blank canvas point near the lower-right edge');
  });
  assert.equal(await page.evaluate(point=>canvasWrap.contains(document.elementFromPoint(point.x,point.y))&&!assistantPanel.contains(document.elementFromPoint(point.x,point.y)),point),true,'double-click must hit exposed canvas, not the assistant panel or toolbar');
  const world=await page.evaluate(point=>screenToWorld(point.x,point.y),point);
  await page.mouse.dblclick(point.x,point.y);await page.locator('#contextMenu.open').waitFor();
  const bounds=await page.locator('#contextMenu').evaluate(element=>{const r=element.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom};});
  assert.ok(bounds.left>=0&&bounds.top>=0&&bounds.right<=width+1&&bounds.bottom<=801,JSON.stringify(bounds));
  await snapshot(page,`sidebar-menu-edge-${format}-${width}-${theme}.png`);
  await page.locator(`[data-menu-node="${format}"]`).click();
  const value=await page.evaluate(()=>{const n=nodes.at(-1);return{x:n.x,y:n.y,type:n.type,format:n.imageOutputFormat,count:nodes.length};});
  assert.equal(value.count,1);assert.equal(value.type,'generator');assert.equal(value.format,format);assert.equal(value.x,world.x);assert.equal(value.y,world.y);assert.equal(calls.length,0);assert.deepEqual(errors,[]);
 }
});

check('empty compatible model list uses explicit 2.6 defaults without implicit requests and one undo removes one entry',async t=>{
 const{page,calls,errors}=await fixture(t);await page.evaluate(()=>{imageModelOptions.splice(0,imageModelOptions.length,'Nano Banana2');selectedNodeId=null;});
 const first=await entry(page,'svg');assert.equal(await page.evaluate(()=>generator.model),'gpt-image-2.6-flare');await page.evaluate(()=>selectedNodeId=null);
 await entry(page,'gif');assert.equal(await page.evaluate(()=>generator.model),'gpt-image-2.6-flare');assert.equal(calls.length,0);
 await page.evaluate(()=>undoCanvas());assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),[first]);assert.equal(await page.evaluate(()=>nodes[0].imageOutputFormat),'svg');assert.deepEqual(errors,[]);
});

check('retained vector sidebar accepts a real PNG upload and preserves local SVG/AI/EPS conversion and reopen download',async t=>{
 const{page,calls,errors,downloads}=await fixture(t);await page.locator('[data-add-node="vector"]').click();assert.match(await page.locator('[data-add-node="vector"]').getAttribute('title'),/SVG.*AI.*EPS/);await page.evaluate(()=>centerOnNode(nodes.at(-1).id));
 await page.locator('[data-vector-upload]').setInputFiles({name:'synthetic-two-colors.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>nodes.find(n=>n.type==='vector')?.references?.length===1);
 const combinations=[['svg','trace'],['svg','preserve'],['ai','trace'],['ai','preserve'],['eps','trace']];let lastBytes;
 for(const [format,mode]of combinations){
  await page.locator('[data-vector-format]').selectOption(format);if(format!=='eps')await page.locator('[data-vector-mode]').selectOption(mode);const pending=page.waitForEvent('download');await page.locator('[data-vector-generate]').click();const download=await pending,bytes=await downloadBytes(download),text=bytes.toString('latin1');assert.match(download.suggestedFilename(),new RegExp('\\.'+format+'$'));assert.equal(calls.length,0);
  if(format==='svg'){assert.match(text,/<svg/);if(mode==='trace'){assert.doesNotMatch(text,/<image/);assert.match(text,/<path/);}else assert.match(text,/<image[^>]+data:image\/png;base64,/);}
  if(format==='ai'){assert.equal(bytes.subarray(0,8).toString('ascii'),'%PDF-1.4');if(mode==='trace')assert.doesNotMatch(text,/\/Subtype \/Image/);else assert.match(text,/\/Subtype \/Image/);}
  if(format==='eps'){assert.match(text,/^%!PS-Adobe-3\.0 EPSF-3\.0/);assert.match(text,/%%BeginLayer:/);assert.doesNotMatch(text,/colorimage/);}lastBytes=bytes;
 }
 await page.evaluate(()=>saveCanvasState());await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await page.evaluate(()=>centerOnNode(nodes.find(n=>n.type==='vector').id));const pending=page.waitForEvent('download');await page.locator('[data-vector-download]').click();assert.equal(hash(await downloadBytes(await pending)),hash(lastBytes));assert.equal(calls.length,0);assert.equal(downloads.length,6);assert.deepEqual(errors,[]);
});
