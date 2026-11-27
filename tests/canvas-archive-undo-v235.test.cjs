'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
test('undo is rejected during archive and works after completion, with save and reopen',{timeout:45000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href+'?workspace=undo-check');await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const id=await page.evaluate(async()=>{nodes=[];links=[];nodeId=1;const c=document.createElement('canvas');c.width=8;c.height=8;c.getContext('2d').fillRect(0,0,8,8);const image=c.toDataURL();const node=createNode('result',200,200,{_deferRender:true,mediaType:'image',title:'fixture',mediaUrl:image,previewUrl:image,fullUrl:image,width:8,height:8});render({skipSave:true});await saveCanvasState();window.savedPreviewFactory=createPreviewImageUrl;createPreviewImageUrl=()=>new Promise(resolve=>window.releaseArchivePreview=()=>resolve(image));deleteNode(node.id);return node.id;});
  await page.waitForFunction(()=>typeof releaseArchivePreview==='function');
  const blocked=await page.evaluate(async id=>{await undoCanvas();return{exists:nodes.some(n=>n.id===id),busy:deletedResultArchiveJobs.size,toast:document.querySelector('#toast')?.textContent};},id);
  assert.equal(blocked.exists,false);assert.ok(blocked.busy>0);assert.match(blocked.toast,/等待完成/);
  await page.evaluate(()=>releaseArchivePreview());await page.waitForFunction(()=>deletedResultArchiveJobs.size===0);
  const restored=await page.evaluate(async id=>{await undoCanvas();return{exists:nodes.some(n=>n.id===id),archive:deletedResults.some(n=>n.originalId===id),saved:await saveCanvasState()};},id);
  assert.equal(restored.exists,true);assert.equal(restored.saved,true);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(id=>nodes.some(n=>n.id===id),id),true);
  await context.close();
 }finally{await browser.close()}
});
