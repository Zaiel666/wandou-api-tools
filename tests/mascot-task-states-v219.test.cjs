const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
for(const reducedMotion of ['reduce','no-preference'])test(`mascot states retain overlapping tasks and settle, motion=${reducedMotion}`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({reducedMotion});await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>!!window.WandouMascotState);
  const state=()=>page.locator('#assistantToggleButton').getAttribute('data-mascot-state');
  assert.equal(await state(),'idle');
  await page.evaluate(()=>{WandouMascotState.set('a','thinking');WandouMascotState.set('b','thinking');WandouMascotState.set('a','complete')});assert.equal(await state(),'thinking');
  await page.evaluate(()=>WandouMascotState.set('b','error'));assert.equal(await state(),'error');
  await page.waitForFunction(()=>document.querySelector('#assistantToggleButton').dataset.mascotState==='idle');
  await page.evaluate(()=>WandouMascotState.set('c','complete'));assert.equal(await state(),'complete');
  await page.waitForFunction(()=>document.querySelector('#assistantToggleButton').dataset.mascotState==='idle');
  const beforeOpen=await page.evaluate(()=>document.querySelector('.app').classList.contains('assistant-open'));
  await page.locator('#assistantToggleButton').click();assert.equal(await page.evaluate(()=>document.querySelector('.app').classList.contains('assistant-open')),!beforeOpen);
  if(reducedMotion==='reduce')assert.notEqual(await page.locator('#assistantToggleButton').getAttribute('data-mascot-animated'),'true');
 }finally{await browser.close()}
});
