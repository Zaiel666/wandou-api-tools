'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
test('delete history memory bound includes undo and redo, falling back safely for oversized images',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(()=>{
   nodes=[];links=[];historyStack=[];redoStack=[];
   const a='data:image/png;base64,'+'A'.repeat(65*1024*1024),b='data:image/png;base64,'+'B'.repeat(65*1024*1024);
   nodes=[{id:'a',type:'result',fullUrl:a,sourceUrl:a,references:[]}];const first=getDeleteHistorySnapshot(new Set(['a']));
   historyStack=[first];nodes=[{id:'b',type:'result',fullUrl:b,references:[]}];const undoOverflow=getDeleteHistorySnapshot(new Set(['b']))===null;
   historyStack=[];redoStack=[first];const redoOverflow=getDeleteHistorySnapshot(new Set(['b']))===null;
   nodes=[{id:'a',type:'result',fullUrl:a,sourceUrl:a,references:[]}];const duplicate=getDeleteHistorySnapshot(new Set(['a']));
   return{first:!!first,undoOverflow,redoOverflow,duplicate:!!duplicate,same:parseCanvasSnapshot(duplicate).nodes[0].fullUrl===a};
  });
  assert.deepEqual(result,{first:true,undoOverflow:true,redoOverflow:true,duplicate:true,same:true});await context.close();
 }finally{await browser.close()}
});
