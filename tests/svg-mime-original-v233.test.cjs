'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app'),svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3"/></svg>');
for(const file of ['ai-node-canvas.html','ai-node-canvas-test.html'])for(const mime of ['image/svg+xml','Image/SVG+XML; charset=utf-8'])test(`${file}: restored SVG result retains vector bytes when MIME is ${mime}`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(app,file)).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async ({base64,mime})=>{const writes=[];window.wandouShell={saveFileAs:async(filename,bytes,mime)=>{writes.push({filename,mime,bytes:Array.from(bytes)});return{success:true,filename}}};
   await downloadNodeMedia({type:'result',mediaType:'image',mimeType:mime,title:'synthetic SVG',fullUrl:'data:image/svg+xml;base64,'+base64,width:4,height:3});
   return {writes,generatorDetected:nativeSvgRequested({type:'generator',mimeType:'image/svg+xml'})};
  },{base64:svg.toString('base64'),mime});
  assert.equal(result.writes.length,1);assert.match(result.writes[0].filename,/\.svg$/);assert.equal(result.writes[0].mime,'image/svg+xml');assert.deepEqual(Buffer.from(result.writes[0].bytes),svg);assert.equal(result.generatorDetected,false,'an SVG input must not force a generator output format');
 }finally{await browser.close()}
});
for(const file of ['ai-node-canvas.html','ai-node-canvas-test.html'])test(`${file}: a PNG local result is not mislabeled by an older SVG MIME`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(app,file)).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async()=>{const writes=[];window.wandouShell={saveFileAs:async(filename,bytes,mime)=>{writes.push({filename,mime,bytes:Array.from(bytes)});return{success:true,filename}}};const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;canvas.getContext('2d').fillRect(0,0,4,3);await downloadNodeMedia({type:'result',mediaType:'image',mimeType:'image/svg+xml',outputAdjustment:{nonNative:true},fullUrl:canvas.toDataURL('image/png'),width:4,height:3,title:'synthetic PNG'});return writes;});
  assert.equal(result.length,1);assert.match(result[0].filename,/\.png$/);assert.equal(result[0].mime,'image/png');assert.deepEqual(result[0].bytes.slice(0,8),[137,80,78,71,13,10,26,10]);
 }finally{await browser.close()}
});
for(const file of ['ai-node-canvas.html','ai-node-canvas-test.html'])test(`${file}: browser download keeps PNG extension when an old SVG MIME conflicts`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(app,file)).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const downloads=await page.evaluate(async()=>{const downloads=[],old=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,bytes:fetch(this.href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))})};delete window.wandouShell;delete window.showSaveFilePicker;let blobUrl;try{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;canvas.getContext('2d').fillRect(0,0,4,3);const data=canvas.toDataURL('image/png');blobUrl=URL.createObjectURL(await (await fetch(data)).blob());for(const fullUrl of [data,blobUrl])await downloadNodeMedia({type:'result',mediaType:'image',mimeType:'image/svg+xml',outputAdjustment:{nonNative:true},fullUrl,width:4,height:3,title:'synthetic PNG'});return await Promise.all(downloads.map(async d=>({name:d.name,bytes:await d.bytes})));}finally{HTMLAnchorElement.prototype.click=old;if(blobUrl)URL.revokeObjectURL(blobUrl)}});
  assert.equal(downloads.length,2);for(const result of downloads){assert.match(result.name,/\.png$/);assert.deepEqual(result.bytes.slice(0,8),[137,80,78,71,13,10,26,10]);}
 }finally{await browser.close()}
});
for(const file of ['ai-node-canvas.html','ai-node-canvas-test.html'])test(`${file}: browser keeps remote fallback and video download`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(app,file)).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async()=>{const names=[],opened=[],old=HTMLAnchorElement.prototype.click,oldOpen=window.open;HTMLAnchorElement.prototype.click=function(){names.push(this.download)};window.open=(url)=>opened.push(url);delete window.wandouShell;delete window.showSaveFilePicker;try{const remote=await triggerDownload('https://example.invalid/image.svg','original.svg','image/svg+xml');const video=await triggerDownload('data:video/mp4;base64,AAAA','movie.mp4','video/mp4');return {remote,video,names,opened};}finally{HTMLAnchorElement.prototype.click=old;window.open=oldOpen}});
  assert.equal(result.remote,true);assert.equal(result.video,true);assert.deepEqual(result.names,['movie.mp4']);assert.equal(result.opened.length,1);assert.match(result.opened[0],/^https:\/\/example\.invalid/);
 }finally{await browser.close()}
});
for(const file of ['ai-node-canvas.html','ai-node-canvas-test.html'])test(`${file}: locally processed PNG without fullUrl downloads its output instead of an old SVG source`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(app,file)).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async(base64)=>{const writes=[];window.wandouShell={saveFileAs:async(filename,bytes,mime)=>{writes.push({filename,mime,bytes:Array.from(bytes)});return {success:true,filename}}};const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;canvas.getContext('2d').fillRect(0,0,4,3);const mediaUrl=canvas.toDataURL('image/png');await downloadNodeMedia({type:'result',mediaType:'image',mimeType:'image/svg+xml',outputAdjustment:{nonNative:true},sourceUrl:'data:image/svg+xml;base64,'+base64,mediaUrl,width:4,height:3,title:'processed PNG'});return writes;},svg.toString('base64'));
  assert.equal(result.length,1);assert.match(result[0].filename,/\.png$/);assert.equal(result[0].mime,'image/png');assert.deepEqual(result[0].bytes.slice(0,8),[137,80,78,71,13,10,26,10]);
 }finally{await browser.close()}
});
