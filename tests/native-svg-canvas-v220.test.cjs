const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(path.join(__dirname,'../desktop-client/node_modules/playwright'));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><title>豌豆测试</title><g id="subject"><path fill="#6a8" d="M20 20H140V76H20Z"/></g></svg>';
const b64=Buffer.from(svg).toString('base64');
async function fixture(fn,{width=1440,theme='dark',respond}={}){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width,height:800}});page.setDefaultTimeout(15000);
  const calls=[],errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,async route=>{
   if(route.request().url()==='https://www.zayapi.top/v1/images/generations'){
    calls.push(route.request().postDataJSON());
    if(respond)return respond(route,calls);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'svg',data:[{b64_json:b64}]})});
   }
   external.push(route.request().url());return route.abort();
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
  await page.evaluate(({theme})=>{
   document.body.classList.toggle('dark-theme',theme==='dark');document.documentElement.dataset.theme=theme;
   apiKeyInput.value='synthetic-never-paid';nodes=[];links=[];nodeId=1;
   window.generator=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'synthetic vector only',ratio:'16:9',resolution:'4K',count:1,_deferRender:true});
   render({skipSave:true});centerOnNode(generator.id);
  },{theme});
  await fn(page,calls,external);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}

for(const theme of ['light','dark']) test(`SVG format controls and native request at 1024x800 ${theme}`,()=>fixture(async(page,calls)=>{
 await page.locator('[data-image-format="svg"]').click();
 assert.equal(await page.locator('.node.generator .resolution-row').isVisible(),false);
 assert.equal(await page.locator('[data-auto-split-toggle]').isDisabled(),true);
 await page.locator('.node.generator [data-generate]').click();
 await page.waitForFunction(()=>!wandouHasActiveTasks());
 assert.equal(calls.length,1);assert.equal(calls[0].output_format,'svg');assert.equal(calls[0].n,1);
 for(const key of ['resolution','response_format','stream','partial_images','output_compression'])assert.equal(calls[0][key],undefined,key);
 const result=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');return{format:n.imageOutputFormat,processing:n.resolutionProcessing,width:n.width,height:n.height,full:await getLocalMedia(n.fullUrl),preview:await getLocalMedia(n.previewUrl),transparent:n.transparent};});
 assert.equal(result.format,'svg');assert.equal(result.processing,'native-vector');assert.equal(result.width,160);assert.equal(result.height,96);
 assert.equal(Buffer.from(result.full.split(',')[1],'base64').toString('utf8'),svg);assert.match(result.preview,/^data:image\/png/);assert.equal(result.transparent,true);
},{width:1024,theme}));

test('SVG save/reopen and download cancellation preserve original UTF8 bytes and no extra API calls',()=>fixture(async(page,calls)=>{
 await page.evaluate(async()=>{generator.imageOutputFormat='svg';await generateFromNode(generator.id);await saveCanvasState();});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
 const output=await page.evaluate(async()=>{
  const n=nodes.find(n=>n.type==='result');window.exported=[];
  window.wandouShell={saveFileAs:async(name,bytes,mime)=>{exported.push({name,mime,bytes:Array.from(bytes)});return{success:false,canceled:true}}};
  await downloadNodeMedia(n);
  return{exported,format:n.imageOutputFormat,processing:n.resolutionProcessing,status:document.getElementById('toast').textContent};
 });
 assert.equal(calls.length,1);assert.equal(output.exported.length,1);assert.match(output.exported[0].name,/\.svg$/);assert.equal(output.exported[0].mime,'image/svg+xml');
 assert.equal(Buffer.from(output.exported[0].bytes).toString('utf8'),svg);assert.equal(output.processing,'native-vector');assert.match(output.status,/取消/);
}));

test('SVG references and unsupported model reject before any request',()=>fixture(async(page,calls)=>{
 const result=await page.evaluate(async()=>{
  generator.imageOutputFormat='svg';generator.references=[{url:'data:image/png;base64,AA==',mediaType:'image'}];
  await generateFromNode(generator.id);const referenceStatus=generator.status;
  generator.references=[];generator.model='gpt-image-2.5-1k';await generateFromNode(generator.id);
  return{referenceStatus,modelStatus:generator.status,count:nodes.filter(n=>n.type==='result').length};
 });
 assert.equal(calls.length,0);assert.match(result.referenceStatus,/参考图/);assert.match(result.modelStatus,/2\.6/);assert.equal(result.count,0);
}));

test('invalid SVG response never becomes a visible result or retries a paid request',()=>fixture(async(page,calls,external)=>{
 await page.evaluate(async()=>{generator.imageOutputFormat='svg';await generateFromNode(generator.id);});
 const result=await page.evaluate(()=>{const n=nodes.find(n=>n.type==='result');return{full:n.fullUrl,status:n.status,busy:wandouHasActiveTasks()};});
 assert.equal(calls.length,1);assert.ok(!result.full);assert.match(result.status,/失败/);assert.match(result.status,/未自动重复/);assert.equal(result.busy,false);
 assert.ok(external.every(url=>!url.includes('malicious.invalid')));
},{respond:route=>route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'svg',data:[{b64_json:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="https://malicious.invalid/a.png"/></svg>').toString('base64')}]})})}));

test('duplicate clicks and cancel during SVG preview do not attach late result',()=>fixture(async(page,calls)=>{
 await page.evaluate(()=>{
  generator.imageOutputFormat='svg';window.originalPrepare=WandouNativeSvg.prepare;
  window.WandouNativeSvg={prepare:async(input,options)=>{const valid=await originalPrepare(input,{preview:false});return new Promise(resolve=>window.finishVector=()=>resolve(valid));}};
  window.tasks=[generateFromNode(generator.id),generateFromNode(generator.id)];
 });
 await page.waitForFunction(()=>!!window.finishVector);
 assert.equal(calls.length,1);assert.equal(await page.evaluate(()=>wandouHasActiveTasks()),true);
 await page.evaluate(async()=>{stopCanvasImageTask(generator.id);finishVector();await Promise.all(tasks)});
 assert.deepEqual(await page.evaluate(()=>({count:nodes.filter(n=>n.type==='result').length,attached:nodes.some(n=>n.type==='result'&&n.fullUrl),busy:wandouHasActiveTasks()})),{count:1,attached:false,busy:false});
}));

test('2.6 raster 4K remains local upscaling with original alpha retained',()=>fixture(async(page)=>{
 const result=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=128;c.height=64;c.getContext('2d').fillRect(32,16,64,32);const original=c.toDataURL();
  let count=0;callApi=async()=>{count++;return{url:original,mediaType:'image',fromApi:true}};
  await generateFromNode(generator.id);const n=nodes.find(n=>n.type==='result');
  return{count,width:n.width,height:n.height,processing:n.resolutionProcessing,original:await getLocalMedia(n.sourceUrl)===original,transparent:await imageHasTransparentPixels(n.fullUrl)};
 });
 assert.deepEqual(result,{count:1,width:4096,height:2048,processing:'local-upscale',original:true,transparent:true});
}));
