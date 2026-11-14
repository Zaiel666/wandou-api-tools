const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url');const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
test('completed results fall back from a corrupt preview to the intact original',async()=>{
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await page.evaluate(()=>{nodes=[];links=[];view={x:20,y:20,zoom:.5};const c=document.createElement('canvas');c.width=1600;c.height=2400;c.getContext('2d').fillRect(0,0,c.width,c.height);const full=c.toDataURL();window.expectedOriginal=full;const n=createNode('result',0,0,{_deferRender:true,pending:true,mediaType:'image',width:1600,height:2400});render({skipSave:true});n.pending=false;n.mediaUrl=full;n.fullUrl=full;n.previewUrl='data:image/png;base64,broken';refreshRenderedNode(n.id);});
  await page.waitForFunction(()=>canvas.querySelector('[data-canvas-media]')?.naturalWidth>0,{},{timeout:4000});
  assert.equal(await page.evaluate(()=>favoriteMediaUrl(nodes[0])===window.expectedOriginal),true);
  await page.evaluate(()=>setDeferredNodeMedia(canvas.querySelector('.node.result'),true));
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-canvas-media]').naturalWidth>0),true);
  assert.deepEqual(await page.evaluate(()=>{const meta=WandouCanvasPreview.dimensions(canvas.querySelector('[data-canvas-media]'));return [meta.width,meta.height];}),[1600,2400]);
 }finally{await browser.close();}
});
test('unavailable images show a retry action and recover without changing the saved source',async()=>{
 const sharp=require('../desktop-client/node_modules/sharp');
 const png=await sharp({create:{width:48,height:64,channels:3,background:'#448822'}}).png().toBuffer();let available=false,requests=0;
 const server=http.createServer((_req,res)=>{requests++;res.writeHead(available?200:404,{'Content-Type':'image/png','Access-Control-Allow-Origin':'*'});res.end(available?png:'missing');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage();await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const url='http://127.0.0.1:'+server.address().port+'/result.png';
  await page.evaluate(url=>{nodes=[];links=[];view={x:20,y:20,zoom:1};createNode('result',0,0,{_deferRender:true,mediaType:'image',mediaUrl:url,previewUrl:'data:image/png;base64,broken',fullUrl:url,width:48,height:64});render({skipSave:true});},url);
  const retry=page.locator('.canvas-media-retry');await retry.waitFor({state:'visible',timeout:4000});
  assert.match(await retry.innerText(),/图片未能加载/);const before=requests;available=true;
  await retry.click();await page.waitForFunction(()=>canvas.querySelector('[data-canvas-media]')?.naturalWidth===48,{},{timeout:4000});
  assert.ok(requests>before);assert.equal(await retry.count(),0);
  assert.deepEqual(await page.evaluate(()=>({count:nodes.length,pending:!!nodes[0].pending,url:nodes[0].mediaUrl,download:favoriteMediaUrl(nodes[0])})),{count:1,pending:false,url,download:url});
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('a late remote response cannot replace a newer image on the same element',async()=>{
 const sharp=require('../desktop-client/node_modules/sharp');const png=await sharp({create:{width:80,height:80,channels:3,background:'#448822'}}).png().toBuffer();let finish;
 const server=http.createServer((_req,res)=>{finish=()=>{res.writeHead(200,{'Content-Type':'image/png','Access-Control-Allow-Origin':'*'});res.end(png);};});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage();await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await page.evaluate(url=>{const image=new Image();image.id='replaced-preview';document.body.append(image);WandouCanvasPreview.setSource(image,url);},'http://127.0.0.1:'+server.address().port+'/old.png');
  for(let n=0;!finish&&n<100;n++)await new Promise(r=>setTimeout(r,10));assert.ok(finish);
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=24;WandouCanvasPreview.setSource(document.getElementById('replaced-preview'),c.toDataURL());});
  await page.waitForFunction(()=>document.getElementById('replaced-preview').naturalWidth===32);finish();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.getElementById('replaced-preview').naturalWidth),32);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('a stalled remote preview cannot block a new local generated image',async()=>{
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'image/png','Access-Control-Allow-Origin':'*'});res.flushHeaders();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage();await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await page.evaluate(url=>{const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);for(const id of ['slow','fresh']){const i=new Image();i.id=id;document.body.append(i);}WandouCanvasPreview.setSource(document.getElementById('slow'),url);WandouCanvasPreview.setSource(document.getElementById('fresh'),c.toDataURL());},'http://127.0.0.1:'+server.address().port+'/slow.png');
  await page.waitForFunction(()=>document.getElementById('fresh').naturalWidth===32,{},{timeout:2000});
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
