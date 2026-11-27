'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
test('legacy canvas sends standard PNG dimensions and chosen quality through its actual request path',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();const external=[];await page.route(/^https?:/,route=>{external.push(route.request().url());return route.abort()});
  await page.goto(pathToFileURL(path.join(app,'ai-node-canvas.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const observed=await page.evaluate(async()=>{
   const calls=[];let refs=[];apiProfileForModel=()=>({url:'https://example.invalid/v1/images/generations',key:'synthetic-test-key',provider:'gateway'});
   getInputMedia=()=>null;getInputMediaList=()=>[];collectReferenceItems=()=>refs;
   fetchMaybeProxied=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({data:[{b64_json:'aGVsbG8='}]}),{status:200,headers:{'content-type':'application/json'}})};
   const node={id:'synthetic',type:'generator',model:'gpt-image-2.6-flare',resolution:'4K',ratio:'16:9',_apiTargetSize:'3840x2160',prompt:'synthetic',imageQuality:'medium',imageComplexity:'low'};
   const result=await callApi(node);const normalCount=calls.length;
   let svgError='',gifError='',markupError='';
   try{await callApi({...node,outputFormat:'svg'})}catch(e){svgError=e.message}
   try{await callApi({...node,outputFormat:'gif'})}catch(e){gifError=e.message}
   refs=[{url:'data:image/png;base64,eA==',markupUrl:'data:image/png;base64,eQ=='}];
   try{await callApi(node)}catch(e){markupError=e.message}
   return {calls,normalCount,svgError,gifError,markupError,result:{mediaType:result.mediaType,fromApi:result.fromApi}};
  });
  assert.deepEqual(external,[]);assert.equal(observed.normalCount,1);assert.equal(observed.calls.length,1);
  assert.equal(observed.calls[0].body.size,'1536x1024');assert.equal(observed.calls[0].body.quality,'medium');assert.equal(observed.calls[0].body.complexity,'low');assert.equal(observed.calls[0].body.output_format,'png');
  assert.match(observed.svgError,/未发送生成请求/);assert.match(observed.gifError,/未发送生成请求/);assert.match(observed.markupError,/未发送生成请求/);assert.equal(observed.result.fromApi,true);
 }finally{await browser.close()}
});
