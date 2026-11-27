'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
for(const file of ['ai-node-canvas-test.html','ai-node-canvas.html'])test(file+' memory-backed delete snapshot retains nested original and can undo/redo',{timeout:45000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app',file)).href+'?workspace=delete-exp');await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const before=await page.evaluate(async()=>{
   nodes=[];links=[];historyStack=[];redoStack=[];nodeId=1;
   const c=document.createElement('canvas');c.width=300;c.height=300;const ctx=c.getContext('2d'),pixels=ctx.createImageData(300,300);for(let i=0;i<pixels.data.length;i++)pixels.data[i]=(i*83+(i>>4))&255;ctx.putImageData(pixels,0,0);const image=c.toDataURL('image/png');
   const first=createNode('result',200,200,{_deferRender:true,title:'fixture',mediaType:'image',mediaUrl:image,previewUrl:image,fullUrl:image,sourceUrl:image,width:300,height:300,references:[{url:image,name:'reference'}]});const second=createNode('generator',50,50,{_deferRender:true});links=[{from:second.id,to:first.id}];render({skipSave:true});
   const history=getDeleteHistorySnapshot(new Set([first.id])),decoded=parseCanvasSnapshot(history);return{id:first.id,other:second.id,image,jsonLength:history.json.length,held:history.originals.length,decoded:decoded.nodes.find(n=>n.id===first.id).references[0].url===image};
  });
  assert.ok(before.image.length>8192);assert.ok(before.held>=4);assert.ok(before.jsonLength<before.image.length);assert.equal(before.decoded,true);
  await page.evaluate(id=>deleteNode(id),before.id);
  if(file==='ai-node-canvas-test.html')await page.waitForFunction(()=>deletedResultArchiveJobs.size===0,{timeout:20000});
  const result=await page.evaluate(async({id,other,image})=>{await undoCanvas();let n=nodes.find(item=>item.id===id);const restored=!!n&&n.fullUrl===image&&n.references[0].url===image&&links.some(l=>l.from===other&&l.to===id);await redoCanvas();const redone=!nodes.some(item=>item.id===id);await undoCanvas();n=nodes.find(item=>item.id===id);const restoredAgain=!!n&&n.fullUrl===image;const saved=await saveCanvasState();return{restored,redone,restoredAgain,saved};},before);
  assert.equal(result.restored,true);assert.equal(result.redone,true);assert.equal(result.restoredAgain,true);assert.equal(result.saved,true);await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const after=await page.evaluate(async({id,other,image})=>{const n=nodes.find(item=>item.id===id);return{present:!!n,full:n&&await getLocalMedia(n.fullUrl),reference:n&&await getLocalMedia(n.references[0].url),link:links.some(l=>l.from===other&&l.to===id)};},before);
  assert.equal(after.present,true);assert.equal(after.full,before.image);assert.equal(after.reference,before.image);assert.equal(after.link,true);await context.close();
 }finally{await browser.close()}
});
