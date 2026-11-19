const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const createWriter=require('../desktop-client/canvas-media-writer.cjs');
const createProtocol=require('../desktop-client/canvas-media-protocol.cjs');
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><title>独立复核</title><g id="foreground"><path fill="#7b9" d="M20 20H140V76H20Z"/></g></svg>';
const encoded=Buffer.from(svg).toString('base64');
const dataUrl='data:image/svg+xml;base64,'+encoded;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(fn,respond){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:800}}),calls=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https?:/,async route=>{
   if(route.request().url()==='https://www.zayapi.top/v1/images/generations'){
    calls.push(route.request().postDataJSON());
    if(respond)return respond(route,calls);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'svg',data:[{b64_json:encoded}]})});
   }
   return route.abort();
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
  await page.evaluate(()=>{
   nodes=[];links=[];nodeId=1;apiKeyInput.value='synthetic-not-a-real-key';
   window.syntheticGenerator=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'synthetic vector',imageOutputFormat:'svg',count:1,_deferRender:true});
   render({skipSave:true});
  });
  await fn(page,calls);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}

test('SVG regeneration keeps original bytes and original model/format even after the generator changes',()=>fixture(async(page,calls)=>{
 const result=await page.evaluate(async()=>{
  await generateFromNode(syntheticGenerator.id);
  const first=nodes.find(node=>node.type==='result');const original=await getLocalMedia(first.fullUrl);
  syntheticGenerator.model='gpt-image-2.5-1k';syntheticGenerator.imageOutputFormat='png';syntheticGenerator.outputFormat='png';
  await regenerateResultNode(first.id);
  const replacement=nodes.find(node=>node.regeneratedFromId===first.id);
  await saveCanvasState();
  return {original,retained:await getLocalMedia(first.fullUrl),replacement:replacement&&{format:replacement.outputFormat,processing:replacement.resolutionProcessing,full:await getLocalMedia(replacement.fullUrl)},busy:wandouHasActiveTasks()};
 });
 assert.equal(calls.length,2);for(const request of calls){assert.equal(request.model,'gpt-image-2.6-flare');assert.equal(request.output_format,'svg');assert.equal(request.n,1);}
 assert.equal(result.original,result.retained);assert.equal(result.retained,dataUrl);
 assert.deepEqual(result.replacement,{format:'svg',processing:'native-vector',full:dataUrl});assert.equal(result.busy,false);
}));

test('SVG service failure sends one request and manual retry retains SVG intent',()=>fixture(async(page,calls)=>{
 const result=await page.evaluate(async()=>{
  await generateFromNode(syntheticGenerator.id);const failed=nodes.find(node=>node.type==='result');
  const first={format:failed.outputFormat,status:failed.status,hasOriginal:Boolean(failed.fullUrl)};
  syntheticGenerator.imageOutputFormat='png';syntheticGenerator.outputFormat='png';
  await regenerateResultNode(failed.id);const second=nodes.find(node=>node.regeneratedFromId===failed.id);
  return {first,second:{format:second.outputFormat,status:second.status,hasOriginal:Boolean(second.fullUrl)},busy:wandouHasActiveTasks()};
 });
 assert.equal(calls.length,2,'one initial request plus exactly one explicit retry');
 assert.ok(calls.every(request=>request.output_format==='svg'));
 assert.equal(result.first.format,'svg');assert.equal(result.second.format,'svg');assert.equal(result.first.hasOriginal,false);assert.equal(result.second.hasOriginal,false);assert.equal(result.busy,false);
 assert.match(result.first.status,/未自动重复/);assert.match(result.second.status,/未自动重复/);
},route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'synthetic service unavailable'}})})));

test('a raster body returned for an SVG request is rejected without rasterization or automatic retry',()=>fixture(async(page,calls)=>{
 const result=await page.evaluate(async()=>{
  await generateFromNode(syntheticGenerator.id);const node=nodes.find(node=>node.type==='result');return{full:node.fullUrl,status:node.status,busy:wandouHasActiveTasks()};
 });
 assert.equal(calls.length,1);assert.ok(!result.full);assert.match(result.status,/失败/);assert.match(result.status,/未自动重复/);assert.equal(result.busy,false);
},route=>route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'png',data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}]})})));

test('saved SVG data URL survives chunked disk write and protocol reopen with correct MIME and byte hash',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wandou-svg-v220-'));
 let api=createProtocol({directory:()=>directory});const writer=createWriter({directory:()=>directory,destination:id=>path.join(directory,id+'.data')});
 const keepAlive=setInterval(()=>{},1000);
 try{
  const id='sha256-'+digest(dataUrl),begin=await writer.write(17,{action:'begin',id,length:dataUrl.length});assert.equal(begin.success,true);
  const middle=Math.floor(dataUrl.length/2);
  assert.equal((await writer.write(17,{action:'chunk',token:begin.token,offset:0,chunk:dataUrl.slice(0,middle)})).success,true);
  assert.equal((await writer.write(17,{action:'chunk',token:begin.token,offset:middle,chunk:dataUrl.slice(middle)})).success,true);
  assert.equal((await writer.write(17,{action:'commit',token:begin.token})).success,true);
  assert.equal(await fs.readFile(path.join(directory,id+'.data'),'utf8'),dataUrl);
  for(let index=0;index<2;index++){
   const url=await api.getUrl(id);assert.equal(url.success,true);
   const response=await api.handle({url:url.url,method:'GET'});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(digest(Buffer.from(await response.arrayBuffer())),digest(Buffer.from(svg)));
   if(index===0){api.dispose();api=createProtocol({directory:()=>directory});}
  }
  const url=(await api.getUrl(id)).url;
  await fs.writeFile(path.join(directory,id+'.data'),dataUrl.replace(/.$/,'A'));
  assert.equal((await api.handle({url,method:'GET'})).status,404,'modified SVG must fail the stored content digest');
 }finally{
  api.dispose();await writer.disposeOwner(17);clearInterval(keepAlive);
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^wandou-svg-v220-/);
  await fs.rm(directory,{recursive:true,force:true});
 }
});

test('incomplete SVG write fails atomically and leaves an existing original intact',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wandou-svg-v220-'));
 const writer=createWriter({directory:()=>directory,destination:id=>path.join(directory,id+'.data')});
 try{
  await fs.writeFile(path.join(directory,'existing.data'),dataUrl);
  const begin=await writer.write(18,{action:'begin',id:'existing',length:dataUrl.length});
  assert.equal((await writer.write(18,{action:'chunk',token:begin.token,offset:0,chunk:dataUrl.slice(0,40)})).success,true);
  assert.equal((await writer.write(18,{action:'commit',token:begin.token})).success,false);
  assert.equal(await fs.readFile(path.join(directory,'existing.data'),'utf8'),dataUrl);
  assert.deepEqual(await fs.readdir(directory),['existing.data']);
 }finally{
  await writer.disposeOwner(18);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^wandou-svg-v220-/);await fs.rm(directory,{recursive:true,force:true});
 }
});
