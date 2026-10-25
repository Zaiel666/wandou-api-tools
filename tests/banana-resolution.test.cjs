const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const source=fs.readFileSync(path.join(app,'ai-node-canvas-test.html'),'utf8');
const extract=name=>{const start=source.indexOf('    function '+name+'(')>=0?source.indexOf('    function '+name+'('):source.indexOf('    async function '+name+'(');assert.ok(start>=0,name);const end=source.slice(start+1).search(/\n    (?:async )?function /);return source.slice(start,start+1+end);};
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
test('Banana 2 and Pro expose selectable 1K, 2K and 4K without resetting saved precision',async()=>{
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage();await page.route(/^https?:/,route=>route.abort());await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  for(const model of ['Nano Banana2','Nano BananaPro']){
   await page.evaluate(model=>{nodes=[];links=[];view={x:20,y:20,zoom:.6};createNode('generator',0,0,{_deferRender:true,model,ratio:'1:1 方图',resolution:'2K',prompt:'测试'});render({skipSave:true});},model);
   const choices=page.locator('.node.generator [data-resolution]');assert.deepEqual(await choices.evaluateAll(elements=>elements.map(e=>e.dataset.resolution)),['1K','2K','4K']);
   assert.equal(await page.evaluate(()=>nodes[0].resolution),'2K');
   for(const resolution of ['1K','4K','2K']){await page.locator('.test-resolution-picker .node-select-trigger').click();await page.locator(`[data-resolution-value="${resolution}"]`).click();await page.evaluate(()=>render({skipSave:true}));assert.equal(await page.evaluate(()=>nodes[0].resolution),resolution);assert.equal(await page.locator('[data-resolution].active').getAttribute('data-resolution'),resolution);}
  }
  for(const type of ['style','outpaint','png']){
   const resolutions=await page.evaluate(type=>{nodes=[];links=[];createNode(type,0,0,{_deferRender:true,model:type==='png'?'GPT-image-2':'Nano Banana2',resolution:'2K'});render({skipSave:true});return imageResolutionOptionsForModel('Nano Banana2');},type);
   assert.deepEqual(resolutions,['1K','2K','4K']);assert.deepEqual(await page.locator('button[data-resolution], button[data-style-resolution], button[data-outpaint-resolution]').evaluateAll(elements=>[...new Set(elements.map(e=>e.dataset.resolution||e.dataset.styleResolution||e.dataset.outpaintResolution))]),['1K','2K','4K'],type);
  }
 }finally{await browser.close();}
});
test('workbench native adapter forwards 1K, 2K and 4K instead of relying on prompt text',async()=>{
 const code=fs.readFileSync(path.join(app,'image-workbench/customize.js'),'utf8');const start=code.indexOf('  async function requestNanoBananaImage('),end=code.indexOf('\n  function ',start+1);let payload;
 const c=vm.createContext({Headers,Response,normalizeImageBody:body=>body,readModel:()=> 'Nano Banana2',modelToApiModel:()=> 'gemini-3.1-flash-image-preview',collectImageDataUrls:()=>[],dataUrlToGeminiPart:value=>value,normalizeGeminiGenerateEndpoint:()=> 'https://example.invalid/generateContent',nativeFetch:async(_url,options)=>{payload=JSON.parse(options.body);return new Response('{}',{status:200});},extractNanoBananaImage:()=> 'data:image/png;base64,AA=='});
 const helperStart=code.indexOf('  function nanoBananaImageConfig('),helperEnd=code.indexOf('\n  async function ',helperStart+1);
 const parseStart=code.indexOf('  function parseSizeText('),parseEnd=code.indexOf('\n  function ',parseStart+1);
 vm.runInContext(code.slice(parseStart,parseEnd)+'\n'+code.slice(helperStart,helperEnd)+'\n'+code.slice(start,end),c);
 for(const resolution of ['1k','2k','4k']){const response=await c.requestNanoBananaImage('',{}, {resolution,prompt:'test',targetSize:'1920x1080'});assert.equal(response.status,200);assert.equal(payload.generationConfig.imageConfig.imageSize,resolution.toUpperCase());assert.equal(payload.generationConfig.imageConfig.aspectRatio,'16:9');}
});
test('native Banana requests send each selected tier as imageConfig.imageSize with matching square pixels',async()=>{
 let request;
 const env={imageResolutionOptions:['1K','2K','4K'],modelToApiModel:model=>model==='Nano Banana2'?'gemini-3.1-flash-image-preview':'gemini-3-pro-image-preview',defaultApiBaseUrl:()=>'',sizeFromRatio:()=>'',parseSize:size=>{const [width,height]=size.split('x').map(Number);return {width,height};},ratioKey:ratio=>String(ratio).split(' ')[0],ratioLabelFromSize:(w,h)=>w===h?'1:1':w>h?'16:9':'9:16',fetchMaybeProxied:async(url,options)=>{request={url,payload:JSON.parse(options.body)};return {ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'AA=='}}]}}]})};},extractMediaUrl:()=> 'data:image/png;base64,AA==',extractMediaUrls:()=>['data:image/png;base64,AA==']};
 const names=['normalizeGeminiGenerateEndpoint','callNanoBananaApi'];if(source.includes('function nanoBananaImageSettings('))names.unshift('nanoBananaImageSettings');
 const c=vm.createContext(env);vm.runInContext(names.map(extract).join('\n'),c);
 for(const model of ['Nano Banana2','Nano BananaPro'])for(const [resolution,size] of [['1K','1024x1024'],['2K','2048x2048'],['4K','4096x4096']]){
  await c.callNanoBananaApi({model,ratio:'1:1 方图',resolution,_targetSize:resolution==='4K'?'3840x3840':size,prompt:'draw'},[],'https://example.invalid/v1',{});
  assert.deepEqual(request.payload.generationConfig.imageConfig,{imageSize:resolution,aspectRatio:'1:1'});
  assert.ok(request.payload.contents[0].parts[0].text.includes(size));assert.ok(request.url.includes(':generateContent'));
 }
});
test('Banana aspect pixels scale by tier while custom sizes and other model constraints stay intact',()=>{
 assert.ok(source.includes('function nanoBananaImageSettings('));
 const c=vm.createContext({imageResolutionOptions:['1K','2K','4K'],modelToApiModel:v=>v,parseSize:size=>{const [width,height]=size.split('x').map(Number);return {width,height};},ratioKey:r=>String(r).split(' ')[0]});
 vm.runInContext(['greatestCommonDivisor','ratioLabelFromSize','nanoBananaImageSettings','isOneKOnlyImageModel','imageResolutionOptionsForModel'].map(extract).join('\n'),c);
 for(const [resolution,expected] of [['1K','1376x768'],['2K','2752x1536'],['4K','5504x3072']]){
  const got=c.nanoBananaImageSettings({resolution,ratio:'16:9 横屏'},'1920x1080');assert.equal(got.size,expected);assert.equal(got.imageConfig.aspectRatio,'16:9');
 }
 assert.equal(c.nanoBananaImageSettings({resolution:'2K',ratio:'自定义尺寸'},'1200x1800').size,'1200x1800');
 assert.equal(c.nanoBananaImageSettings({resolution:'2K'},'1000x700').imageConfig.aspectRatio,undefined);
 const wide=c.nanoBananaImageSettings({resolution:'4K'},'2520x1080');
 assert.equal(wide.size,'6336x2688');assert.equal(c.nanoBananaImageSettings({resolution:'4K'},wide.size).imageConfig.aspectRatio,'21:9');
 assert.deepEqual(Array.from(c.imageResolutionOptionsForModel('grok-imagine-image-2.0')),['1K','2K']);
});
test('generation orchestration keeps each Banana tier in the request and pending result target',async()=>{
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage();await page.route(/^https?:/,route=>route.abort());await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const requests=await page.evaluate(async()=>{
   const seen=[];apiProfileForModel=()=>({id:'main',key:'offline-test',label:'test'});loadAutoSaveDirectoryHandle=async()=>null;
   const c=document.createElement('canvas');c.width=c.height=32;const image=c.toDataURL();
   callApi=async request=>{seen.push({model:request.model,resolution:request.resolution,size:request._targetSize});return {url:image,urls:[image],mediaType:'image',fromApi:true};};
   for(const model of ['Nano Banana2','Nano BananaPro'])for(const resolution of ['1K','2K','4K']){nodes=[];links=[];const n=createNode('generator',0,0,{_deferRender:true,model,ratio:'1:1 方图',resolution,prompt:'offline test',count:1,autoSplit:false});render({skipSave:true});await generateFromNode(n.id);}
   return seen;
  });
  assert.deepEqual(requests,['Nano Banana2','Nano BananaPro'].flatMap(model=>[['1K','1024x1024'],['2K','2048x2048'],['4K','4096x4096']].map(([resolution,size])=>({model,resolution,size}))));
 }finally{await browser.close();}
});
