const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(root,'desktop-client/node_modules/playwright'));
const app=path.resolve(__dirname,'../app');let browser,server,origin;
test.before(async()=>{server=http.createServer((req,res)=>{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
async function setup({theme='light',width=1440,mode='success'}={}){
 const context=await browser.newContext({viewport:{width,height:800}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['data:','blob:','file:'].includes(url.protocol))return route.continue();return url.origin===origin?route.continue():route.abort();});
 await context.addInitScript(({theme,mode})=>{
  localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);
  const projects=[{id:'old',name:'旧项目',createdAt:10,updatedAt:20,favorite:true},{id:'recent',name:'最近项目',createdAt:20,updatedAt:100},{id:'middle',name:'中间项目',createdAt:15,updatedAt:50}];
  localStorage.setItem('aiCanvasProjectsV1',JSON.stringify(projects));
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=4;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(4,0,4,4);window.syntheticOriginal=canvas.toDataURL('image/png');
  window.syntheticPreview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="gray"/></svg>');
  for(let folder=0;folder<3;folder++){const id=projects[folder].id;const nodes=folder===1?[1,2,3].map(n=>({id:'node-'+n,type:'result',mediaType:'image',title:'测试图'+n,previewUrl:syntheticPreview,fullUrl:'indexed-media:original-'+n,mediaUrl:'indexed-media:original-'+n,width:777,height:555,createdAt:n,resolutionProcessing:n===1?'local-upscale':'native',originalWidth:4,originalHeight:2,requestedResolution:'4K'})):[];localStorage.setItem('aiCanvasStateV1:'+id,JSON.stringify({folderId:id,nodes,links:[],savedAt:projects[folder].updatedAt}));}
  window.mediaReads=[];window.exports=[];window.exportMode=mode;window.savedHub=[];window.openedTabs=[];
  window.wandouDesktopTabs={open:(...args)=>openedTabs.push(args)};
  window.wandouShell={readCanvasMedia:async({id})=>{mediaReads.push(id);return{success:true,value:syntheticOriginal};},readProjectHubState:async()=>({success:true,state:null}),writeProjectHubState:async state=>{savedHub.push(structuredClone(state));return{success:true};},getCanvasMediaLocation:async()=>({success:true,path:'X:/test.data',storageFormat:'data-url'}),saveFileAs:async(name,bytes,mime)=>{exports.push({name,bytes:Array.from(bytes),mime});if(exportMode==='pending')return await new Promise(resolve=>window.finishExport=resolve);if(exportMode==='cancel-second'&&exports.length===2)return{success:false,canceled:true};if(exportMode==='failure')return{success:false,error:'合成磁盘错误'};return{success:true,path:'X:/chosen/'+name};}};
 },{theme,mode});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{page,context,errors};
}
const card=(page,n)=>page.locator('.media-card').filter({has:page.locator('.asset-card-title',{hasText:'测试图'+n})});
async function assetsPage(page){await page.goto(origin+'/asset-library-test.html');await page.waitForFunction(()=>document.querySelectorAll('[data-asset-download]').length===3);}

for(const width of [1440,1024])for(const theme of ['light','dark']){
 test(`${width} ${theme}: recent projects, rename F2, asset view/info, native preview and neutral controls`,async()=>{
  const {page,context,errors}=await setup({theme,width});try{
   await page.goto(origin+'/homepage-test.html');await page.waitForSelector('.home-recent-card');
   assert.equal(await page.locator('.home-recent-card strong').first().innerText(),'最近项目');
   assert.ok((await page.locator('.home-recent').boundingBox()).y<(await page.locator('.home-test-hero').boundingBox()).y);
   assert.equal(await page.locator('.module-card').count(),12);
   await page.locator('.home-start-guide summary').click();assert.equal(await page.locator('.home-start-guide-content').isVisible(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2,'home no horizontal overflow');
   if(width===1024)await page.screenshot({path:path.resolve(__dirname,'../../qa/workspace-home-'+theme+'.png')});
   await page.goto(origin+'/project-hub.html');await page.waitForSelector('[data-rename]');
   await page.locator('[data-project="recent"]').focus();await page.keyboard.press('F2');
   await page.locator('[data-name="recent"]').fill('F2 改名');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('aiCanvasProjectsV1')).find(p=>p.id==='recent').name==='F2 改名');
   await page.locator('[data-rename="recent"]').click();await page.locator('[data-name="recent"]').fill('不保存的名字');await page.keyboard.press('Escape');assert.equal(await page.locator('[data-name="recent"]').inputValue(),'F2 改名');
   await page.locator('[data-project="recent"]').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>openedTabs.length),1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2,'project no horizontal overflow');
   if(width===1024)await page.screenshot({path:path.resolve(__dirname,'../../qa/workspace-projects-'+theme+'.png')});
   await assetsPage(page);assert.deepEqual(await page.evaluate(()=>mediaReads),[],'list does not fetch originals');
   await page.locator('[data-fit="cover"]').click();await page.waitForSelector('.media-preview img');assert.equal(await page.locator('.media-preview img').first().evaluate(el=>getComputedStyle(el).objectFit),'cover');
   await page.locator('[data-fit="contain"]').click();assert.equal(await page.locator('.media-preview img').first().evaluate(el=>getComputedStyle(el).objectFit),'contain');
   assert.match(await page.locator('.media-preview').first().evaluate(el=>getComputedStyle(el).backgroundImage),/conic-gradient/);
   await card(page,1).locator('[data-asset-info]').click();await page.waitForFunction(()=>!document.querySelector('#assetInfoSave').disabled);
   assert.match(await page.locator('#assetFileFacts').innerText(),/PNG · 8 × 4 像素 ·/);assert.doesNotMatch(await page.locator('#assetFileFacts').innerText(),/777/);assert.match(await page.locator('#assetFileFacts').innerText(),/非原生生成/);
   assert.equal(await page.locator('#assetInfoDialog').evaluate(el=>el.open),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#assetInfoDialog').evaluate(el=>el.open),false);
   if(width===1024)await page.screenshot({path:path.resolve(__dirname,'../../qa/workspace-assets-'+theme+'.png')});
   await card(page,1).locator('[data-open-media]').click();await page.waitForFunction(()=>document.getElementById('assetLightbox').open);await page.keyboard.press('Escape');assert.equal(await page.locator('#assetLightbox').evaluate(el=>el.open),false);
   await page.locator('[data-filter="skill"]').click();assert.match(await page.locator('#assetSubtitle').innerText(),/提示词/);assert.equal(await page.locator('.asset-selection-toolbar').isVisible(),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2,'no horizontal overflow');
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
}

test('batch chooses original bytes per file; cancellation stops all later exports and keeps remaining selection',async()=>{
 const {page,context,errors}=await setup({mode:'cancel-second'});try{await assetsPage(page);await page.locator('#assetSelectVisible').click();await page.locator('#assetBatchSave').click();await page.waitForFunction(()=>document.getElementById('assetSelectionStatus').textContent.includes('已取消'));
  assert.equal(await page.evaluate(()=>exports.length),2);assert.match(await page.locator('#assetSelectionStatus').innerText(),/已保存 1 \/ 3/);assert.match(await page.locator('#assetBatchSave').innerText(),/2/);
  const result=await page.evaluate(async()=>{const original=Array.from(new Uint8Array(await(await fetch(syntheticOriginal)).arrayBuffer()));return exports.every(call=>JSON.stringify(call.bytes)===JSON.stringify(original));});assert.equal(result,true);assert.equal(await page.locator('#assetLightbox').evaluate(el=>el.open),false);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('batch rejects repeated clicks, blocks close, survives filter changes and stops on write failure',async()=>{
 const {page,context}=await setup({mode:'pending'});try{await assetsPage(page);await page.locator('#assetSelectVisible').click();await page.locator('#assetBatchSave').click();await page.waitForFunction(()=>exports.length===1);await page.evaluate(()=>document.getElementById('assetBatchSave').click());assert.equal(await page.evaluate(()=>exports.length),1);assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).busy,true);
  await page.locator('[data-filter="video"]').click();await page.evaluate(()=>finishExport({success:false,error:'合成磁盘错误'}));await page.waitForFunction(()=>!wandouHasActiveTasks());assert.equal(await page.evaluate(()=>exports.length),1);assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,true);await page.locator('[data-filter="image"]').click();assert.match(await page.locator('#assetBatchSave').innerText(),/3/);
 }finally{await context.close();}
});
test('JPG fills transparency white, WebP retains alpha, originals remain byte-identical and cancel never falls through',async()=>{
 const {page,context}=await setup();try{await assetsPage(page);await card(page,1).locator('[data-asset-info]').click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);
  await page.locator('#assetExportFormat').selectOption('image/jpeg');assert.match(await page.locator('#assetExportFormatNote').innerText(),/透明区域将填白/);await page.locator('#assetInfoSave').click();await page.waitForFunction(()=>exports.length===1&&!wandouHasActiveTasks());
  await page.locator('#assetExportFormat').selectOption('image/webp');await page.locator('#assetInfoSave').click();await page.waitForFunction(()=>exports.length===2&&!wandouHasActiveTasks());
  await page.locator('#assetExportFormat').selectOption('original');await page.locator('#assetInfoSave').click();await page.waitForFunction(()=>exports.length===3&&!wandouHasActiveTasks());
  const facts=await page.evaluate(async()=>{const result=[];for(const entry of exports){const bitmap=await createImageBitmap(new Blob([new Uint8Array(entry.bytes)],{type:entry.mime}));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);result.push({mime:entry.mime,width:bitmap.width,height:bitmap.height,pixel:Array.from(ctx.getImageData(0,0,1,1).data)});bitmap.close();}const original=Array.from(new Uint8Array(await(await fetch(syntheticOriginal)).arrayBuffer()));return{result,unchanged:JSON.stringify(original)===JSON.stringify(exports[2].bytes)};});
  assert.deepEqual(facts.result.map(x=>x.mime),['image/jpeg','image/webp','image/png']);assert.ok(facts.result[0].pixel.slice(0,3).every(v=>v>240));assert.equal(facts.result[0].pixel[3],255);assert.equal(facts.result[1].pixel[3],0);assert.equal(facts.unchanged,true);
  for(const f of facts.result){assert.equal(f.width,8);assert.equal(f.height,4);}
 }finally{await context.close();}
});
test('complete batch exports all selected originals once, and preview preference persists after reopening',async()=>{
 const {page,context}=await setup();try{await assetsPage(page);await page.locator('[data-fit="cover"]').click();await page.locator('#assetSelectVisible').click();await page.locator('#assetBatchSave').click();await page.waitForFunction(()=>exports.length===3&&!wandouHasActiveTasks());assert.match(await page.locator('#assetSelectionStatus').innerText(),/全部另存为.*3 \/ 3/);assert.equal(await page.locator('#assetBatchSave').isDisabled(),true);await page.reload();await page.waitForSelector('.media-preview img');assert.equal(await page.locator('.media-preview img').first().evaluate(el=>getComputedStyle(el).objectFit),'cover');}finally{await context.close();}
});
test('file origin Worker supports metadata and export; open dialogs follow theme changes and Escape restores focus',async()=>{
 const {page,context,errors}=await setup();try{await page.goto(require('node:url').pathToFileURL(path.join(app,'asset-library-test.html')).href);await page.waitForSelector('[data-asset-info]');await card(page,1).locator('[data-asset-info]').click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);assert.match(await page.locator('#assetFileFacts').innerText(),/8 × 4 像素/);const light=await page.locator('#assetInfoDialog').evaluate(el=>getComputedStyle(el).backgroundColor);await page.evaluate(()=>WandouTheme.set('dark'));const dark=await page.locator('#assetInfoDialog').evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(light,dark);await page.locator('#assetExportFormat').selectOption('image/webp');await page.locator('#assetInfoSave').click();await page.waitForFunction(()=>exports.length===1&&!wandouHasActiveTasks());assert.equal(await page.evaluate(()=>exports[0].mime),'image/webp');await page.keyboard.press('Escape');assert.equal(await card(page,1).locator('[data-asset-info]').evaluate(el=>document.activeElement===el),true);assert.deepEqual(errors,[]);}finally{await context.close();}
});
test('rename reports rejected durable write without losing cached name or throwing unhandled errors',async()=>{
 const {page,context,errors}=await setup();try{await page.goto(origin+'/project-hub.html');await page.waitForSelector('[data-rename="recent"]');await page.waitForFunction(()=>savedHub.length>0);await page.evaluate(()=>{wandouShell.writeProjectHubState=async()=>{throw Error('合成磁盘离线');};});await page.locator('[data-rename="recent"]').click();await page.locator('[data-name="recent"]').fill('离线保留的名称');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('projectNotice').textContent.includes('合成磁盘离线'));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aiCanvasProjectsV1')).find(p=>p.id==='recent').name),'离线保留的名称');assert.match(await page.locator('#projectNotice').innerText(),/保存失败/);assert.deepEqual(errors,[]);}finally{await context.close();}
});
for(const completion of ['success','cancel','failure'])test(`a closed export retains its result owner after switching image info: ${completion}`,async()=>{
 const {page,context,errors}=await setup({mode:'pending'});try{
  await assetsPage(page);await card(page,1).locator('[data-asset-info]').click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);
  await page.evaluate(()=>{const ActualWorker=Worker;window.Worker=class extends ActualWorker{postMessage(data){if(data.type)window.releaseConversion=()=>super.postMessage(data);else super.postMessage(data);}};});
  await page.locator('#assetExportFormat').selectOption('image/webp');await page.locator('#assetInfoSave').click();await page.waitForFunction(()=>!!window.releaseConversion);
  await page.locator('#assetInfoClose').click();await card(page,2).locator('[data-asset-info]').click();await page.evaluate(()=>releaseConversion());await page.waitForFunction(()=>exports.length===1);await page.waitForFunction(()=>document.getElementById('assetFileFacts').textContent.includes('像素'));
  await page.evaluate(completion=>finishExport(completion==='success'?{success:true}:completion==='cancel'?{success:false,canceled:true}:{success:false,error:'合成保存失败'}),completion);await page.waitForFunction(()=>!wandouHasActiveTasks());
  assert.equal(await page.locator('#assetInfoName').innerText(),'测试图2');assert.equal(await page.locator('#assetInfoSaveStatus').innerText(),'');assert.equal(await page.evaluate(()=>exports[0].name),'测试图1.webp');assert.match(await page.locator('#assetToast').innerText(),/测试图1/);assert.match(await page.locator('#assetToast').innerText(),completion==='success'?/已另存为/:completion==='cancel'?/已取消/:/保存失败/);assert.equal(await page.locator('#assetInfoSave').isDisabled(),false);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
