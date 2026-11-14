const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');const{chromium}=require('../desktop-client/node_modules/playwright');
test('synced Gemini 2.5 exposes only its native resolution and sends aspectRatio without unsupported imageSize',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async()=>{
   applySyncedImageModels(['gemini-2.5-flash-image']);nodes=[];links=[];
   const n=createNode('generator',0,0,{model:'gemini-2.5-flash-image',resolution:'4K',ratio:'16:9 横屏',prompt:'offline',_deferRender:true});render({skipSave:true});
   apiProfileForModel=()=>({key:'fake',url:'https://offline.invalid/v1'});let req;
   fetchMaybeProxied=async(url,options)=>{req={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'AA=='}}]}}]}));};
   await callApi(n,new AbortController().signal);
   return {native:isNanoBananaModel(n.model),options:imageResolutionOptionsForModel(n.model),resolution:n.resolution,settings:nanoBananaImageSettings(n,'2560x1440'),req};
  });
  assert.equal(result.native,true);assert.deepEqual(result.options,['1K']);assert.equal(result.resolution,'1K');assert.equal(result.settings.size,'1344x768');
  assert.match(result.req.url,/v1beta\/models\/gemini-2\.5-flash-image:generateContent$/);assert.deepEqual(result.req.body.generationConfig.imageConfig,{aspectRatio:'16:9'});
 }finally{await browser.close();}
});
