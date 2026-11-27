'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(path.resolve(__dirname,'../../../../desktop-client/node_modules/playwright'));
const file=path.resolve(__dirname,'../app/ai-node-canvas-test.html');
test('assistant panel remains interactive above an overlapping launcher and launcher still toggles it',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{for(const width of [1024,1280,1440])for(const dark of [false,true]){
  const page=await browser.newPage({viewport:{width,height:800}});await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(file).href+'?workspace=production');await page.waitForFunction(()=>document.body.dataset.testReady==='true'&&!!window.WandouCanvasViewport);await page.waitForTimeout(400);
  await page.evaluate(d=>document.body.classList.toggle('dark-theme',d),dark);
  const originalStyle=await page.evaluate(()=>{const button=document.querySelector('#assistantToggleButton'),e=document.querySelector('#assistantPanel .model .assistant-picker-trigger'),r=e.getBoundingClientRect(),old=button.getAttribute('style');Object.assign(button.style,{left:`${r.x}px`,top:`${r.y}px`,right:'auto',bottom:'auto',width:`${r.width}px`,height:`${r.height}px`,transform:'none',transition:'none'});return old});
  const hit=await page.evaluate(()=>{const e=document.querySelector('#assistantPanel .model .assistant-picker-trigger'),r=e.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:e.contains(target),target:target?.outerHTML.slice(0,300),rect:r.toJSON()}});
  assert.equal(hit.hit,true,`${width} dark=${dark}: ${JSON.stringify(hit)}`);
  await page.locator('#assistantPanel .model .assistant-picker-trigger').click();assert.equal(await page.locator('#assistantPanel .model .assistant-picker-trigger').getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');
  await page.evaluate(old=>{const b=document.querySelector('#assistantToggleButton');if(old===null)b.removeAttribute('style');else b.setAttribute('style',old)},originalStyle);
  await page.locator('#assistantPanel .assistant-close').click();await page.locator('#assistantToggleButton').click();
  assert.equal(await page.locator('#assistantToggleButton').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#assistantPanel .model .assistant-picker-trigger').isVisible(),true);
  const panel=page.locator('#assistantPanel'),before=await panel.boundingBox(),head=await page.locator('#assistantPanel .assistant-head').boundingBox();
  await page.mouse.move(head.x+70,head.y+head.height/2);await page.mouse.down();await page.mouse.move(head.x+35,head.y+head.height/2+25,{steps:6});await page.mouse.up();
  const after=await panel.boundingBox();assert.ok(Math.abs(after.x-before.x)>10||Math.abs(after.y-before.y)>10,`assistant panel drag failed: ${width}, dark=${dark}`);
  await page.close();
 }}finally{await browser.close()}
});
