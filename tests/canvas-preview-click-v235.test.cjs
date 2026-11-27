'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
for(const file of ['ai-node-canvas-test.html','ai-node-canvas.html']) for(const width of [1024,1440]) for(const theme of ['light','dark']) test(file+' '+width+' '+theme+' actual node click shows loaded preview while original loads',{timeout:40000},async()=>{
 console.error('stage launch',file);const browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000,args:['--disable-gpu'],executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({viewport:{width,height:width===1024?800:900}});await context.addInitScript(theme=>{localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);},theme);const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://preview-fixture.invalid/**',async route=>{await new Promise(r=>setTimeout(r,1200));await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>'}).catch(()=>{});});
  await page.route(/^https?:\/\/(?!preview-fixture\.invalid)/,r=>r.abort());
  console.error('stage goto',file);await page.goto(pathToFileURL(path.resolve(__dirname,'../app',file)).href+'?workspace=preview-ui',{waitUntil:'domcontentloaded',timeout:8000});
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  assert.equal(await page.evaluate(()=>document.body.classList.contains('dark-theme')),theme==='dark');
  const original='https://preview-fixture.invalid/original.svg';
  console.error('stage seed',file);const id=await page.evaluate(original=>{nodes=[];links=[];nodeId=1;const c=document.createElement('canvas');c.width=20;c.height=20;c.getContext('2d').fillRect(0,0,20,20);const preview=c.toDataURL();const n=createNode('result',300,200,{_deferRender:true,title:'fixture',mediaType:'image',mediaUrl:preview,previewUrl:preview,fullUrl:original,width:40,height:40});view={x:0,y:0,zoom:1};render({skipSave:true});return n.id;},original);
  const image=page.locator(`.node[data-id="${id}"] [data-preview] img`);await image.waitFor();await page.waitForFunction(id=>{const e=document.querySelector(`.node[data-id="${id}"] [data-preview] img`);return e&&e.complete&&e.naturalWidth>0;},id,{timeout:6000});
  console.error('stage click',file);await page.locator(`.node[data-id="${id}"] [data-result-transfer]`).click();
  const opened=await page.evaluate(()=>({open:lightbox.classList.contains('open'),display:lightboxImage.getAttribute('src'),download:activeLightbox.downloadSrc,complete:lightboxImage.complete,width:lightboxImage.naturalWidth}));
  assert.equal(opened.open,true);assert.match(opened.display,/^data:image\/png/);assert.equal(opened.download,original);assert.equal(opened.complete,true);assert.ok(opened.width>0);
  await page.waitForFunction(original=>lightboxImage.getAttribute('src')===original,original,{timeout:5000});assert.deepEqual(errors,[]);
  await context.close();
 }finally{await browser.close();}
});
