'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
test('later image replacement does not retain more than the intended memory budget in history',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(()=>{const a='data:image/png;base64,'+'A'.repeat(60*1024*1024),b='data:image/png;base64,'+'B'.repeat(60*1024*1024),c='data:image/png;base64,'+'C'.repeat(60*1024*1024);nodes=[{id:'a',type:'result',fullUrl:a},{id:'b',type:'result',fullUrl:b}];links=[];historyStack=[];redoStack=[];const snapshot=getDeleteHistorySnapshot(new Set(['a']));historyStack.push(snapshot);nodes=[{id:'b',type:'result',fullUrl:c}];const live=new Set([c]);return{bytes:[...new Set(snapshot.originals.filter(value=>!live.has(value)))].reduce((sum,value)=>sum+value.length*2,0),overflow:getDeleteHistorySnapshot(new Set(['b']))===null};});
  assert.ok(result.bytes<=256*1024*1024,`historical-only retained bytes ${result.bytes} exceed budget`);assert.equal(result.overflow,true);await context.close();
 }finally{await browser.close()}
});
