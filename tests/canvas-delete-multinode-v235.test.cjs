'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
test('multi-selection delete restores both original images and links, then redo survives reopen',{timeout:45000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href+'?workspace=multi-delete-exp');await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const seed=await page.evaluate(()=>{
   window.confirm=()=>true;nodes=[];links=[];historyStack=[];redoStack=[];nodeId=1;
   const image=color=>{const c=document.createElement('canvas');c.width=60;c.height=60;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,60,60);return c.toDataURL('image/png');};
   const first=image('red'),second=image('blue'),source=createNode('generator',20,20,{_deferRender:true});const a=createNode('result',200,200,{_deferRender:true,mediaType:'image',mediaUrl:first,previewUrl:first,fullUrl:first,width:60,height:60});const b=createNode('result',600,200,{_deferRender:true,mediaType:'image',mediaUrl:second,previewUrl:second,fullUrl:second,width:60,height:60});links=[{from:source.id,to:a.id},{from:source.id,to:b.id}];render({skipSave:true});boxSelectedIds=[a.id,b.id];deleteSelectionNodes();return{a:a.id,b:b.id,source:source.id,first,second};
  });
  await page.waitForFunction(()=>deletedResultArchiveJobs.size===0,{timeout:20000});
  const result=await page.evaluate(async d=>{await undoCanvas();const a=nodes.find(n=>n.id===d.a),b=nodes.find(n=>n.id===d.b);const original=!!a&&!!b&&a.fullUrl===d.first&&b.fullUrl===d.second&&links.length===2;await redoCanvas();const removed=!nodes.some(n=>n.id===d.a||n.id===d.b)&&links.length===0;return{original,removed,saved:await saveCanvasState()};},seed);
  assert.deepEqual(result,{original:true,removed:true,saved:true});await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(d=>nodes.some(n=>n.id===d.a||n.id===d.b),seed),false);await context.close();
 }finally{await browser.close()}
});
