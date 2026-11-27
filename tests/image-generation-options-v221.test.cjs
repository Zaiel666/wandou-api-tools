const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const listenSafe=require('./safe-loopback-v233.cjs');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa');
global.WandouImageCapabilities=require(path.join(app,'image-model-capabilities.js'));
const options=require(path.join(app,'image-generation-options.js'));
const gif=Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,255,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0,...[0,1].flatMap(pixel=>[33,249,4,1,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,pixel?76:68,1,0]),59]);
let browser,server,origin;
test.before(async()=>{
 fs.mkdirSync(qa,{recursive:true});
 server=http.createServer((req,res)=>{try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep))throw Error('outside');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await listenSafe(server);origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function fixture(t,{width=1440,theme='light',model='gpt-image-2.6-flare',saved={}}={}) {
 const context=await browser.newContext({viewport:{width,height:800}});t.after(()=>context.close());
 await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await context.addInitScript(({theme,model,saved})=>{if(localStorage.getItem('qa-options-initialized'))return;localStorage.setItem('qa-options-initialized','1');localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);localStorage.setItem('wd-model',model);localStorage.setItem('wd-quality','high');localStorage.setItem('wd-generation-options-v221',JSON.stringify(saved));},{theme,model,saved});
 const page=await context.newPage();await page.goto(origin+'/image-workbench/index.html');await page.waitForSelector('.wd-workbench-generation');
 return{context,page};
}
test('shared controls keep true quality separate, validate limits, and never infer 2.6 native 4K',()=>{
 const base={model:'gpt-image-2.6-flare',quality:'low'};
 assert.equal(options.normalise(base).quality,'high');
 assert.deepEqual(options.requestFields(base),{quality:'high',complexity:'high',output_format:'png'});
 assert.deepEqual(options.requestFields({...base,imageOutputFormat:'gif'}),{quality:'high',complexity:'high',output_format:'gif',n:1,size:'auto',frame_count:9,frame_duration_ms:200});
 assert.equal(options.validate({...base,imageOutputFormat:'gif',gifFrameCount:16,gifFrameDurationMs:2000}), '');
 for(const fields of [{gifFrameCount:1},{gifFrameCount:17},{gifFrameCount:2.5},{gifFrameDurationMs:19},{gifFrameDurationMs:201},{gifFrameDurationMs:2010}])assert.match(options.validate({...base,imageOutputFormat:'gif',...fields}),/GIF/);
 assert.match(options.validate({...base,imageOutputFormat:'svg'},['synthetic-reference']),/文字生成/);
 assert.match(options.validate({...base,imageOutputFormat:'gif',mask:'synthetic-mask'}),/蒙版/);
 for(const model of ['gpt-image-2','gpt-image-2.5-1k','unknown-4k'])assert.match(options.validate({model,imageOutputFormat:'gif'}),/2\.6/);
 assert.deepEqual(options.requestFields({model:'unknown-4k',imageQuality:'high',imageComplexity:'low'}),{});
 assert.deepEqual(global.WandouImageCapabilities.resolve(base.model).nativeTiers,['1K']);
 assert.equal(global.WandouImageCapabilities.nativeSize(base.model,'4K','4096x4096'),'1024x1024');
});
test('binding invokes history before mutations, validates inputs, and only binds once',async t=>{
 const{page}=await fixture(t);
 const result=await page.evaluate(()=>{
  const host=document.createElement('div'),node={model:'gpt-image-2.6-flare',imageOutputFormat:'png',count:5,autoSplit:true},seen=[];
  host.innerHTML=WandouImageOptions.render(node,{includeFormat:true});document.body.append(host);
  const hooks={onBeforeChange:d=>seen.push(['before',d.field,node.imageOutputFormat]),onChange:d=>seen.push(['after',d.field,node.imageOutputFormat])};
  WandouImageOptions.bind(host,node,hooks);WandouImageOptions.bind(host,node,hooks);host.querySelector('[data-image-format="gif"]').click();
  host.innerHTML=WandouImageOptions.render(node,{includeFormat:true});const frames=host.querySelector('[data-image-option="gifFrameCount"]');frames.value='17';frames.dispatchEvent(new Event('change',{bubbles:true}));
  return{seen,node,error:host.querySelector('.wd-generation-error').textContent,invalid:frames.getAttribute('aria-invalid')};
 });
 assert.deepEqual(result.seen,[['before','imageOutputFormat','png'],['after','imageOutputFormat','gif']]);assert.equal(result.node.count,1);assert.equal(result.node.autoSplit,false);assert.equal(result.node.gifFrameCount,undefined);assert.equal(result.invalid,'true');assert.match(result.error,/2–16/);
});
for(const width of [1440,1024])for(const theme of ['light','dark'])test(`workbench options actual clicks and theme layout ${width} ${theme}`,async t=>{
 const{page}=await fixture(t,{width,theme});
 const host=page.locator('.wd-workbench-generation');
 t.after(()=>page.screenshot({path:path.join(qa,`workbench-options-${width}-${theme}-end.png`),fullPage:true}).catch(()=>{}));
 await host.locator('[data-image-format="gif"]').click();
 await host.getByLabel('生成质量',{exact:true}).selectOption('low');
 await host.getByLabel('内容复杂度',{exact:true}).selectOption('medium');
 await host.getByLabel('GIF 帧数',{exact:true}).fill('12');await host.getByLabel('GIF 帧数',{exact:true}).press('Tab');
 await host.getByLabel('GIF 每帧时长（毫秒）',{exact:true}).fill('300');await host.getByLabel('GIF 每帧时长（毫秒）',{exact:true}).press('Tab');
 const metrics=await host.evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),width:innerWidth,scroll:document.documentElement.scrollWidth,color:getComputedStyle(el.querySelector('select')).color,bg:getComputedStyle(el.querySelector('select')).backgroundColor,saved:JSON.parse(localStorage.getItem('wd-generation-options-v221')),hidden:document.querySelectorAll('.wd-nonpixel-hidden').length}));
 assert.equal(metrics.saved.imageQuality,'low');assert.equal(metrics.saved.imageComplexity,'medium');assert.equal(metrics.saved.gifFrameCount,12);assert.equal(metrics.saved.gifFrameDurationMs,300);assert.ok(metrics.hidden>=2);assert.ok(metrics.rect.x>=0&&metrics.rect.right<=width+1);assert.ok(metrics.scroll<=width);assert.notEqual(metrics.color,metrics.bg);
 await page.screenshot({path:path.join(qa,`workbench-options-${width}-${theme}.png`),fullPage:true});
 await page.reload();assert.equal(await page.locator('[data-image-option="gifFrameCount"]').inputValue(),'12');
 await page.locator('[data-image-format="png"]').click();assert.equal(await page.locator('.wd-nonpixel-hidden').count(),1);
});
test('workbench GIF request is one auto-size call, with exact originals and durable metadata, never upscaled',async t=>{
 const{context,page}=await fixture(t,{saved:{imageOutputFormat:'gif',imageQuality:'medium',imageComplexity:'low',gifFrameCount:2,gifFrameDurationMs:200}});let requests=[];
 await context.route('https://synthetic.invalid/v1/images/generations',route=>{requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{b64_json:gif.toString('base64')}],output_format:'gif'})});});
 const result=await page.evaluate(async()=>{
  let conversions=0;WandouImageOutput={processBlob:async()=>{conversions++;throw Error('must never upscale GIF');}};
  const response=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic',quality:'high',size:'4096x4096',n:8,stream:true,partial_images:3,output_compression:80,background:'transparent'})});
  const value=await response.json(),url=value.data[0].url;localStorage.setItem('qa-gif-original',url);return{status:response.status,url,conversions,metadata:await WandouWorkbenchOutput.metadata(url)};
 });
 assert.equal(requests.length,1);assert.equal(requests[0].n,1);assert.equal(requests[0].size,'auto');assert.equal(requests[0].quality,'medium');assert.equal(requests[0].complexity,'low');assert.equal(requests[0].frame_count,2);assert.equal(requests[0].frame_duration_ms,200);assert.equal(requests[0].output_compression,undefined);assert.equal(requests[0].stream,undefined);assert.equal(requests[0].background,undefined);
 assert.equal(result.status,200);assert.equal(result.conversions,0);assert.deepEqual(Buffer.from(result.url.split(',')[1],'base64'),gif);assert.equal(result.metadata.processing,'native-animation');assert.equal(result.metadata.animationFrameCount,2);assert.equal(result.metadata.animationDurationMs,400);assert.match(result.metadata.previewUrl,/^data:image\/png/);
 await page.reload();assert.equal(await page.evaluate(async()=> (await WandouWorkbenchOutput.metadata(localStorage.getItem('qa-gif-original'))).animationFrameCount),2);assert.equal(requests.length,1);
});
test('workbench quality and complexity are independent from 4K resolution; unsupported format resets explicitly',async t=>{
 const{context,page}=await fixture(t,{saved:{imageQuality:'low',imageComplexity:'medium'}});let requests=[];
 await context.route('https://synthetic.invalid/v1/images/generations',route=>{requests.push(route.request().postDataJSON());return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{message:'synthetic no budget'}})});});
 await page.evaluate(()=>fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic'})}));
 assert.equal(requests[0].quality,'low');assert.equal(requests[0].complexity,'medium');assert.equal(requests[0].size,'1024x1024');
 await page.locator('[data-image-format="gif"]').click();await page.locator('.wd-model-button').click();await page.locator('.wd-model-option[data-model="gpt-image-2.5-1k"]').click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('wd-generation-options-v221')).imageOutputFormat==='png');
 assert.match(await page.locator('.wd-generation-error').textContent(),/已切换为 PNG/);assert.equal(await page.locator('[data-image-format="gif"]').isDisabled(),true);assert.equal(await page.locator('[data-image-option="imageComplexity"]').count(),0);
});
test('workbench SVG references and invalid GIF fail terminally without a second API call; cancellation publishes nothing',async t=>{
 const{context,page}=await fixture(t,{saved:{imageOutputFormat:'svg'}});let requests=0;
 await context.route('https://synthetic.invalid/v1/images/generations',route=>{requests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'gif',data:[{b64_json:Buffer.from('not GIF').toString('base64')}]})});});
 const rejected=await page.evaluate(async()=>{const r=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic',image:['synthetic-reference']})});return{status:r.status,payload:await r.json()};});
 assert.equal(rejected.status,422);assert.equal(requests,0);assert.match(rejected.payload.error.message,/文字生成/);
 await page.locator('[data-image-format="gif"]').click();
 const invalid=await page.evaluate(async()=>{const r=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic'})});return{status:r.status,payload:await r.json()};});
 assert.equal(invalid.status,422);assert.equal(invalid.payload.error.code,'invalid_gif_output');assert.equal(requests,1);
 const canceled=await page.evaluate(async()=>{const controller=new AbortController();controller.abort();let reads=0;try{await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({data:[{url:'synthetic'}]})),{plan:{},outputFormat:'gif',signal:controller.signal,fetch:()=>{reads++;}});return{aborted:false,reads};}catch(e){return{aborted:e.name==='AbortError',reads};}});
 assert.deepEqual(canceled,{aborted:true,reads:0});
});
test('workbench GIF metadata failure keeps original bytes and does not invoke raster conversion',async t=>{
 const{page}=await fixture(t);const result=await page.evaluate(async source=>{
  const native=window.fetch.bind(window),open=indexedDB.open.bind(indexedDB);let reads=0,conversions=0;indexedDB.open=()=>{throw Error('synthetic storage failure');};WandouImageOutput={processBlob:async()=>{conversions++;throw Error('not allowed');}};
  try{const r=await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({output_format:'gif',data:[{url:source}]})),{plan:{},outputFormat:'gif',fetch:async(...args)=>{reads++;return native(...args);}});return{status:r.status,value:await r.json(),reads,conversions};}finally{indexedDB.open=open;}
 },'data:image/gif;base64,'+gif.toString('base64'));
 assert.equal(result.status,200);assert.equal(result.reads,1);assert.equal(result.conversions,0);assert.deepEqual(Buffer.from(result.value.data[0].url.split(',')[1],'base64'),gif);assert.match(result.value.data[0].revised_prompt,/标记保存失败.*未再次请求/);
});
test('workbench SVG explicit selection sends one vector request and rejects a raster fallback without conversion',async t=>{
 const{context,page}=await fixture(t,{saved:{imageOutputFormat:'svg',imageQuality:'medium',imageComplexity:'low'}});let requests=[];
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><path d="M0 0H64V32H0Z" fill="#333"/></svg>';
 await context.route('https://synthetic.invalid/v1/images/generations',route=>{requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{b64_json:Buffer.from(svg).toString('base64')}],output_format:'svg'})});});
 const result=await page.evaluate(async()=>{
  let conversions=0;WandouImageOutput={processBlob:async()=>{conversions++;throw Error('SVG must not upscale');}};
  const response=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic',images:[],n:4,stream:true})});const data=await response.json();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const wrong=await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({data:[{url:canvas.toDataURL()}]})),{plan:{},outputFormat:'svg',fetch:window.fetch.bind(window)});
  return{status:response.status,data,wrongStatus:wrong.status,wrong:await wrong.json(),conversions};
 });
 assert.equal(requests.length,1);assert.equal(requests[0].n,1);assert.equal(requests[0].quality,'medium');assert.equal(requests[0].complexity,'low');assert.equal(requests[0].output_format,'svg');assert.equal(requests[0].stream,undefined);
 assert.equal(result.status,200);assert.deepEqual(Buffer.from(result.data.data[0].url.split(',')[1],'base64'),Buffer.from(svg));assert.equal(result.wrongStatus,422);assert.equal(result.wrong.error.code,'invalid_svg_output');assert.equal(result.conversions,0);
});
test('workbench GIF preview is static, only one plays, reduced motion pauses, and download preserves GIF through cancel',async t=>{
 const{page}=await fixture(t);let browserDownloads=0;page.on('download',()=>browserDownloads++);
 await page.evaluate(async original=>{
  window.qaExports=[];window.wandouShell={saveFileAs:async(name,bytes,mime)=>{qaExports.push({name,bytes:Array.from(bytes),mime});return new Promise(resolve=>window.qaCompleteDownload=resolve);}};
  await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({output_format:'gif',data:[{url:original}]})),{plan:{},outputFormat:'gif',fetch:window.fetch.bind(window)});
  await new Promise((resolve,reject)=>{const r=indexedDB.open('gpt-image-playground',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('images','readwrite');for(const id of ['gif-one','gif-two'])tx.objectStore('images').put({id,dataUrl:original,width:1,height:1});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});
  const wrap=document.createElement('div');wrap.style='display:flex;gap:20px;padding:75px 20px 10px;position:relative;z-index:20;';
  for(const id of ['gif-one','gif-two']){const card=document.createElement('div');card.id=id;card.className='task-card-wrapper';card.style='width:240px';card.innerHTML=`<img class="saveable-image" data-image-id="${id}" style="display:block;width:120px;height:60px"><div><button type="button">收藏</button></div>`;card.querySelector('img').src=original;wrap.append(card);}document.body.prepend(wrap);
 },'data:image/gif;base64,'+gif.toString('base64'));
 await page.locator('#gif-one .wd-animation-toggle').waitFor();await page.locator('#gif-two .wd-animation-toggle').waitFor();
 assert.match(await page.locator('#gif-one img').getAttribute('src'),/^data:image\/png/);
 await page.locator('#gif-one .wd-animation-toggle').click();assert.equal(await page.locator('#gif-one .wd-animation-toggle').getAttribute('aria-pressed'),'true');
 await page.locator('#gif-two .wd-animation-toggle').click();assert.equal(await page.locator('#gif-one .wd-animation-toggle').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#gif-two .wd-animation-toggle').getAttribute('aria-pressed'),'true');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('#gif-two .wd-animation-toggle').getAttribute('aria-pressed')==='false');
 await page.locator('#gif-one .wd-card-download').click();await page.waitForFunction(()=>qaExports.length===1);await page.locator('#gif-one .wd-card-download').click();assert.equal(await page.evaluate(()=>qaExports.length),1);
 const exported=await page.evaluate(()=>qaExports[0]);assert.equal(exported.mime,'image/gif');assert.match(exported.name,/\.gif$/);assert.deepEqual(Buffer.from(exported.bytes),gif);
 await page.evaluate(()=>qaCompleteDownload({success:false,canceled:true}));await page.locator('#gif-one .wd-card-download').click();await page.waitForFunction(()=>qaExports.length===2);await page.evaluate(()=>qaCompleteDownload({success:true}));assert.equal(browserDownloads,0);
});
