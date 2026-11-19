const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const caps=require('../app/image-model-capabilities.js');
const {chromium}=require(path.join(path.resolve(__dirname,'../../../..'),'desktop-client/node_modules/playwright'));
test('capability table distinguishes official native tiers, channel alias and unknown',()=>{
 assert.deepEqual(caps.resolve('Nano Banana2').nativeTiers,['1K','2K','4K']);
 assert.deepEqual(caps.resolve('gemini-2.5-flash-image').nativeTiers,['1K']);
 assert.deepEqual(caps.resolve('gemini-3.1-flash-lite-image').nativeTiers,['1K']);
 assert.deepEqual(caps.resolve('grok-imagine-image-2.0').nativeTiers,['1K','2K']);
 assert.equal(caps.resolve('gpt-image-2.5-1k').verified,false);assert.equal(caps.resolve('custom-image-4k').verified,false);
 for(const tier of ['1K','2K','4K'])for(const ratio of ['1:1','16:9','9:16','3:1','1:3','21:9']){
  const [w,h]=ratio.split(':').map(Number);const output=caps.nativeSize('gpt-image-2.5-flare',tier,`${w*1000}x${h*1000}`);const size=caps.dimensions(output);
  assert.equal(size.width%16,0);assert.equal(size.height%16,0);assert.ok(Math.max(size.width,size.height)<=3840);assert.ok(size.width*size.height<=8294400&&size.width*size.height>=655360);assert.ok(Math.max(size.width/size.height,size.height/size.width)<=3);
 }
 assert.equal(caps.nativeSize('Nano Banana2','4K','1920x1080'),'5504x3072');
 assert.equal(caps.nativeSize('GPT-image-2','4K','4096x4096'),'2880x2880');
});
async function pageTest(run){const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await run(page);assert.deepEqual(errors,[]);}finally{await browser.close();}}
test('actual request bodies use native tiers, leave gateway extensions and keep all output options',()=>pageTest(async page=>{
 const requests=await page.evaluate(async()=>{
  const output=[];
  for(const [model,endpoint] of [['GPT-image-2','https://api.openai.com/v1'],['gpt-image-2.5-1k','https://gateway.invalid'],['grok-imagine-image-2.0','https://api.x.ai/v1'],['custom-image','https://gateway.invalid']])for(const resolution of ['1K','2K','4K']){
   // Inject only the provider under test; UI channel selection is covered separately.
   apiProfileForModel=()=>({id:'channel1',url:endpoint,key:'synthetic',provider:endpoint==='https://api.openai.com/v1'?'openai':'gateway'});
   const request=await buildApiRequest({id:'synthetic',type:'generator',model,prompt:'test',ratio:'1:1',resolution,count:1},[]);
   output.push({model,resolution,options:imageResolutionOptionsForModel(model),body:JSON.parse(request.body),hint:imageResolutionHint({model,ratio:'1:1',resolution})});
  }
  return output;
 });
 for(const row of requests){assert.deepEqual(row.options,['1K','2K','4K']);if(row.model==='GPT-image-2'){assert.equal(row.body.resolution,undefined);assert.equal(row.body.response_format,undefined);if(row.resolution==='4K'){assert.equal(row.body.size,'2880x2880');assert.match(row.hint,/4096×4096.*非原生/);}}if(row.model==='gpt-image-2.5-1k'){assert.equal(row.body.resolution,'1k');assert.equal(row.body.size,'1024x1024');}if(row.model==='grok-imagine-image-2.0'){assert.equal(row.body.size,undefined);assert.equal(row.body.resolution,row.resolution==='1K'?'1k':'2k');assert.equal(row.body.aspect_ratio,'1:1');}if(row.model==='custom-image'){assert.equal(row.body.resolution,undefined);assert.match(row.body.size,/^(1024x1024|1536x1024|1024x1536)$/);assert.match(row.hint,/待验证/);}}
 const banana=await page.evaluate(()=>['gemini-2.5-flash-image','gemini-3.1-flash-lite-image','Nano Banana2','Nano BananaPro'].flatMap(model=>['1K','2K','4K'].map(resolution=>({model,resolution,...nanoBananaImageSettings({model,resolution,ratio:'16:9'},'1920x1080')}))));
 for(const row of banana){if(row.model==='gemini-2.5-flash-image'){assert.equal(row.imageConfig.imageSize,undefined);assert.equal(row.size,'1344x768');}else if(row.model==='gemini-3.1-flash-lite-image')assert.equal(row.imageConfig.imageSize,'1K');else assert.equal(row.imageConfig.imageSize,row.resolution);}
}));
test('4K output is actual transparent 4096x2048, provenance survives save and re-generation uses one request',()=>pageTest(async page=>{
 await page.evaluate(()=>{
  apiKeyInput.value='synthetic-only';nodes=[];links=[];nodeId=1;window.apiCount=0;
  const c=document.createElement('canvas');c.width=128;c.height=64;c.getContext('2d').fillRect(20,20,30,20);window.nativeImage=c.toDataURL('image/png');
  callApi=async()=>{apiCount++;return{url:nativeImage,mediaType:'image',fromApi:true};};
  window.source=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'synthetic',ratio:'16:9',resolution:'4K',count:1,_deferRender:true});
  render({skipSave:true});window.generation=generateFromNode(source.id);
 });
 await page.evaluate(()=>generation);
 const result=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');const dims=await getImageDimensions(n.fullUrl);const bitmap=await createImageBitmap(await fetch(n.fullUrl).then(r=>r.blob()));const c=document.createElement('canvas');c.width=1;c.height=1;c.getContext('2d').drawImage(bitmap,0,0);const alpha=c.getContext('2d').getImageData(0,0,1,1).data[3];bitmap.close();await saveCanvasState();window.resultId=n.id;return{dims,alpha,requests:apiCount,original:n.sourceUrl===nativeImage,processing:n.resolutionProcessing,tier:n.requestedResolution,status:n.status};});
 assert.deepEqual(result.dims,{width:4096,height:2048});assert.equal(result.alpha,0);assert.equal(result.requests,1);assert.equal(result.original,true);assert.equal(result.processing,'local-upscale');assert.equal(result.tier,'4K');assert.match(result.status,/非原生生成/);
 const regeneration=await page.evaluate(async()=>{source.resolution='1K';await regenerateResultNode(resultId);const n=nodes.find(n=>n.regeneratedFromId===resultId);return{requests:apiCount,width:n.width,height:n.height,tier:n.requestedResolution};});
 assert.deepEqual(regeneration,{requests:2,width:4096,height:2048,tier:'4K'});
}));
