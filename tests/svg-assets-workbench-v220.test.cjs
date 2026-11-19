const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa');
const svg='\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><title>中文矢量测试</title><path d="M32 0H64V32H32Z" fill="#ee4433"/></svg>';
const svgUrl='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
let browser,server,origin;
test.before(async()=>{
 server=http.createServer((req,res)=>{try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep))throw Error('outside');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function contextFor(t,options={}){
 const context=await browser.newContext({viewport:{width:options.width||1440,height:800}});t.after(()=>context.close());
 await context.route('**/*',route=>{const url=route.request().url();return url.startsWith(origin)||/^(?:data|blob):/.test(url)?route.continue():route.abort();});
 return context;
}

test('original exports sniff UTF-8 SVG and PSD, preserve exact bytes, and keep cancel terminal',async()=>{
 const source=fs.readFileSync(path.join(app,'image-export.js'),'utf8'),calls=[];
 const window={wandouShell:{saveFileAs:async(...args)=>{calls.push(args);return calls.length===3?{success:false,canceled:true}:{success:true};}}};
 vm.runInNewContext(source,{window,fetch,Blob,Uint8Array,AbortController,setTimeout,clearTimeout,URL:{createObjectURL(){throw Error('no fallback');}}});
 const vectors=new Blob([svg],{type:'image/png'});
 assert.equal((await window.WandouImageExport.save({blob:vectors,filename:'原件.png'})).success,true);
 const psd=Buffer.from('8BPS\0\1synthetic layered document');
 assert.equal((await window.WandouImageExport.save({blob:new Blob([psd],{type:'application/octet-stream'}),filename:'层文件.data'})).success,true);
 assert.equal((await window.WandouImageExport.save({blob:vectors,filename:'原件.png'})).canceled,true);
 assert.equal(calls.length,3);assert.equal(calls[0][0],'原件.svg');assert.equal(calls[0][2],'image/svg+xml');assert.deepEqual(Buffer.from(calls[0][1]),Buffer.from(svg));assert.equal(calls[1][0],'层文件.psd');assert.equal(calls[1][2],'image/vnd.adobe.photoshop');assert.deepEqual(Buffer.from(calls[1][1]),psd);
});

for(const width of [1440,1024])for(const theme of ['light','dark'])test(`SVG asset metadata, original download, cancel and reopen: ${width} ${theme}`,async t=>{
 const context=await contextFor(t,{width});
 await context.addInitScript(({svgUrl,theme})=>{
  localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);
  const c=document.createElement('canvas');c.width=8;c.height=4;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(4,0,4,4);window.pngPreview=c.toDataURL();
  if(!localStorage.getItem('aiCanvasProjectsV1')){
   localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:'vectors',name:'矢量项目',createdAt:10,updatedAt:20}]));
   localStorage.setItem('aiCanvasStateV1:vectors',JSON.stringify({folderId:'vectors',savedAt:20,nodes:[{id:'svg-result',title:'中文原件',type:'result',mediaType:'image',imageOutputFormat:'svg',outputFormat:'svg',mimeType:'image/svg+xml',resolutionProcessing:'native-vector',transparent:true,previewUrl:pngPreview,mediaUrl:pngPreview,fullUrl:'indexed-media:svg-original',width:64,height:32,createdAt:20}],links:[]}));
  }
  window.exports=[];window.reads=[];window.exportMode='success';
  window.wandouShell={readCanvasMedia:async({id})=>{reads.push(id);return{success:true,value:svgUrl};},saveFileAs:async(name,bytes,mime)=>{exports.push({name,bytes:Array.from(bytes),mime});return exportMode==='cancel'?{success:false,canceled:true}:{success:true,path:'X:/synthetic/'+name};}};
 },{svgUrl,theme});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/asset-library-test.html');await page.waitForSelector('[data-asset-info]');
 assert.match(await page.locator('[data-file-meta]').textContent(),/原生 SVG/);assert.deepEqual(await page.evaluate(()=>reads),[]);
 await page.waitForSelector('.media-preview img');assert.equal(await page.locator('.media-preview img').getAttribute('src'),await page.evaluate(()=>pngPreview));
 const stateBefore=await page.evaluate(()=>localStorage.getItem('aiCanvasStateV1:vectors'));
 await page.locator('[data-asset-info]').click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);
 assert.match(await page.locator('#assetFileFacts').textContent(),/SVG · 64 × 32 画布.*模型原生 SVG/);
 assert.match(await page.locator('#assetExportFormatNote').textContent(),/保留可编辑路径/);
 assert.deepEqual(await page.locator('#assetExportFormat option').evaluateAll(options=>options.map(x=>x.disabled)),[false,true,true,true]);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2);
 await page.screenshot({path:path.join(qa,`svg-assets-${width}-${theme}.png`)});
 await page.locator('#assetInfoSave').click();await page.waitForFunction(()=>exports.length===1&&!wandouHasActiveTasks());
 const first=await page.evaluate(()=>exports[0]);assert.equal(first.mime,'image/svg+xml');assert.equal(first.name,'中文原件.svg');assert.deepEqual(Buffer.from(first.bytes),Buffer.from(svg));
 await page.locator('#assetInfoClose').click();await page.evaluate(()=>exportMode='cancel');await page.locator('[data-asset-download]').click();await page.waitForFunction(()=>exports.length===2&&!wandouHasActiveTasks());
 assert.equal(await page.evaluate(()=>localStorage.getItem('aiCanvasStateV1:vectors')),stateBefore);
 await page.reload();await page.waitForSelector('[data-asset-info]');assert.match(await page.locator('[data-file-meta]').textContent(),/原生 SVG/);
 await page.locator('[data-asset-download]').click();await page.waitForFunction(()=>exports.length===1&&!wandouHasActiveTasks());assert.deepEqual(Buffer.from(await page.evaluate(()=>exports[0].bytes)),Buffer.from(svg));assert.deepEqual(errors,[]);
});

test('workbench 2.6 requests PNG but safely retains an SVG response without resizing or another API call',async t=>{
 const context=await contextFor(t);let requests=[];
 await context.route('https://synthetic.invalid/v1/images/generations',route=>{requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'svg',data:[{b64_json:Buffer.from(svg).toString('base64')}]})});});
 await context.addInitScript(()=>{localStorage.setItem('wd-model','gpt-image-2.6-flare');localStorage.setItem('wd-quality','high');});
 const page=await context.newPage();await page.goto(origin+'/image-workbench/index.html');await page.waitForSelector('.wd-custom-quality-button');
 const result=await page.evaluate(async()=>{
  let conversions=0;window.WandouImageOutput={processBlob:async()=>{conversions++;throw Error('SVG must not be rasterized');}};
  const response=await fetch('https://synthetic.invalid/v1/images/generations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'gpt-image-2.6-flare',prompt:'synthetic',quality:'high',size:'4096x4096'})});
  const value=await response.json(),url=value.data[0].url;localStorage.setItem('test-vector-url',url);
  return{status:response.status,url,conversions,metadata:await WandouWorkbenchOutput.metadata(url),note:value.data[0].revised_prompt};
 });
 assert.equal(requests.length,1);assert.equal(requests[0].model,'gpt-image-2.6-flare');assert.equal(requests[0].output_format,'png');assert.equal(result.status,200);assert.equal(result.conversions,0);assert.match(result.url,/^data:image\/svg\+xml;base64,/);assert.deepEqual(Buffer.from(result.url.split(',')[1],'base64'),Buffer.from(svg));assert.equal(result.metadata.processing,'native-vector');assert.equal(result.metadata.width,64);assert.match(result.note,/未进行位图放大/);
 await page.reload();const restored=await page.evaluate(()=>WandouWorkbenchOutput.metadata(localStorage.getItem('test-vector-url')));assert.equal(restored.processing,'native-vector');assert.equal(requests.length,1);
});

test('workbench invalid SVG returns a non-retryable local failure and abort cannot publish output',async t=>{
 const context=await contextFor(t),page=await context.newPage();await page.goto(origin+'/image-workbench/index.html');
 const result=await page.evaluate(async()=>{
  let reads=0;const nativeFetch=window.fetch.bind(window),bad='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><script>alert(1)</script></svg>';
  const response=await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({output_format:'svg',data:[{b64_json:btoa(bad)}]})),{plan:WandouWorkbenchOutput.plan('gpt-image-2.6-flare','high','4096x4096'),fetch:async(...args)=>{reads++;return nativeFetch(...args);}});
  const controller=new AbortController();controller.abort();let aborted=false;
  try{await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({data:[{url:'data:image/svg+xml,'+encodeURIComponent(bad)}]})),{signal:controller.signal,plan:{},fetch:()=>{reads++;throw Error('must not fetch');}});}catch(e){aborted=e.name==='AbortError';}
  return{status:response.status,payload:await response.json(),reads,aborted};
 });
 assert.equal(result.status,422);assert.equal(result.payload.error.code,'invalid_svg_output');assert.match(result.payload.error.message,/未再次请求/);assert.equal(result.payload.data,undefined);assert.equal(result.reads,1);assert.equal(result.aborted,true);
});

test('workbench SVG metadata write failure preserves the original instead of re-generating',async t=>{
 const context=await contextFor(t),page=await context.newPage();await page.goto(origin+'/image-workbench/index.html');
 const result=await page.evaluate(async svgUrl=>{
  const nativeFetch=window.fetch.bind(window);let reads=0;const open=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw Error('synthetic storage unavailable');};
  try{const response=await WandouWorkbenchOutput.processResponse(new Response(JSON.stringify({output_format:'svg',data:[{url:svgUrl}]})),{plan:{},fetch:async(...args)=>{reads++;return nativeFetch(...args);}});return{status:response.status,value:await response.json(),reads};}finally{indexedDB.open=open;}
 },svgUrl);
 assert.equal(result.status,200);assert.equal(result.reads,1);assert.deepEqual(Buffer.from(result.value.data[0].url.split(',')[1],'base64'),Buffer.from(svg));assert.match(result.value.data[0].revised_prompt,/标记保存失败.*未再次请求/);
});

test('workbench structured channels never copy the official key to the gateway, even from stale profiles',()=>{
 const source=fs.readFileSync(path.join(app,'image-workbench/customize.js'),'utf8').replace(/\r\n/g,'\n');
 function extract(name){const start=new RegExp('^  function '+name+'\\(','m').exec(source).index;return source.slice(start,source.indexOf('\n  }',start)+4);}
 for(const gatewayKey of ['synthetic-gateway-key','']){
  const data=new Map([['ai-tools-api-config',JSON.stringify({key:'must-not-use-top-level',channels:{channel1:{provider:'openai',gateway:{key:gatewayKey},openai:{key:'synthetic-official-key'}}}})],['gpt-image-playground',JSON.stringify({state:{settings:{apiKey:'stale-credential',profiles:[{apiKey:'stale-credential'}]}}})]]);
  const context={localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},API_URL:'https://synthetic-gateway.invalid/v1',normalizeModelName:v=>v,modelToApiModel:v=>v,defaultModel:()=> 'gpt-image-2.6-flare'};
  vm.createContext(context);vm.runInContext(extract('readSharedWorkbenchApiConfig')+'\n'+extract('readGlobalApiKey')+'\n'+extract('syncWorkbenchApiConfig'),context);context.syncWorkbenchApiConfig();
  const settings=JSON.parse(data.get('gpt-image-playground')).state.settings;assert.equal(settings.apiKey,gatewayKey);assert.ok(settings.profiles.every(p=>p.apiKey===gatewayKey));assert.equal(settings.baseUrl,'https://synthetic-gateway.invalid/v1');
 }
});

test('workbench explicit download chooses original SVG bytes once, cancellation does not fall through',async t=>{
 const context=await contextFor(t);
 await context.addInitScript(()=>{window.exports=[];window.wandouShell={saveFileAs:async(name,bytes,mime)=>{exports.push({name,bytes:Array.from(bytes),mime});return new Promise(resolve=>window.completeDownload=resolve);}};});
 const page=await context.newPage();let automaticDownloads=0;page.on('download',()=>automaticDownloads++);
 await page.goto(origin+'/image-workbench/index.html');await page.waitForSelector('.wd-custom-quality-button');
 await page.evaluate(async svgUrl=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.open('gpt-image-playground',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('images','readwrite');tx.objectStore('images').put({id:'vector-download',dataUrl:svgUrl,width:64,height:32});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});
  const card=document.createElement('div');card.id='vector-download-card';card.className='task-card-wrapper';card.innerHTML='<img class="saveable-image" data-image-id="vector-download" style="width:160px;height:80px"><div><button type="button">收藏</button><button type="button">复用配置</button></div>';
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=4;card.querySelector('img').src=canvas.toDataURL();document.body.prepend(card);
 },svgUrl);
 await page.locator('#vector-download-card .wd-card-download').waitFor();await page.locator('#vector-download-card .wd-card-download').click();await page.waitForFunction(()=>exports.length===1);
 await page.locator('#vector-download-card .wd-card-download').click();assert.equal(await page.evaluate(()=>exports.length),1);
 const item=await page.evaluate(()=>exports[0]);assert.equal(item.mime,'image/svg+xml');assert.match(item.name,/\.svg$/);assert.deepEqual(Buffer.from(item.bytes),Buffer.from(svg));
 await page.evaluate(()=>completeDownload({success:false,canceled:true}));
 await page.locator('#vector-download-card .wd-card-download').click();await page.waitForFunction(()=>exports.length===2);await page.evaluate(()=>completeDownload({success:true}));
 assert.equal(automaticDownloads,0);
});
