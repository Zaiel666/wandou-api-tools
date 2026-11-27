'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
for(const file of ['ai-node-canvas-test.html','ai-node-canvas.html'])test(file+' delete history uses stable stored identifiers for runtime media',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app',file)).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async()=>{const id='sha256-'+'a'.repeat(64),runtime='wandou-media://'+'b'.repeat(64)+'/'+id,newRuntime='wandou-media://'+'c'.repeat(64)+'/'+id;nodes=[{id:'x',type:'result',fullUrl:runtime,references:[{url:runtime}]}];links=[];historyStack=[];redoStack=[];const snapshot=getDeleteHistorySnapshot(),state=parseCanvasSnapshot(snapshot);window.wandouShell={getCanvasMediaUrl:async({id:requested})=>({success:true,url:'wandou-media://'+'c'.repeat(64)+'/'+requested})};return{full:state.nodes[0].fullUrl,reference:state.nodes[0].references[0].url,resolved:await resolveLoadedMedia(state.nodes[0].fullUrl),newRuntime,id};});
  assert.equal(result.full,'indexed-media:'+result.id);assert.equal(result.reference,result.full);assert.equal(result.resolved,result.newRuntime);await context.close();
 }finally{await browser.close()}
});
