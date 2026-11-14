const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const svg='<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><title>独立下载复核</title><path d="M32 16H96V48H32Z" fill="#b35"/></svg>';
const svgUrl='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
async function fixture(run){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],external=[];page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:/,route=>{external.push(route.request().url());return route.abort();});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await page.evaluate(async svgUrl=>{
   nodes=[];links=[];nodeId=1;apiKeyInput.value='synthetic-isolated';window.requestCount=0;window.saved=[];
   callApi=async()=>{requestCount++;return{url:svgUrl,mediaType:'image',fromApi:true};};
   const generator=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'synthetic',imageOutputFormat:'svg',outputFormat:'svg',count:1,_deferRender:true});
   await generateFromNode(generator.id);window.resultNode=nodes.find(node=>node.type==='result');
   window.wandouShell={saveFileAs:async(name,bytes,mime)=>{saved.push({name,bytes:Array.from(bytes),mime});return{success:true,filename:name};}};
   render({skipSave:true});centerOnNode(resultNode.id);
  },svgUrl);
  await run(page);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>requestCount),1);
 }finally{await browser.close();}
}

test('independent: transparent native result button and full-screen download preserve original SVG bytes',()=>fixture(async page=>{
 await page.locator('.node.result [data-download]').first().click();await page.waitForFunction(()=>saved.length===1);
 await page.locator('.node.result [data-result-transfer]').click();await page.locator('#lightbox.open').waitFor();await page.locator('#lightboxDownload').click();await page.waitForFunction(()=>saved.length===2);
 const result=await page.evaluate(async()=>({saved,full:await getLocalMedia(resultNode.fullUrl),preview:await getLocalMedia(resultNode.previewUrl),shown:await getLocalMedia(activeLightbox.src),transparent:resultNode.transparent}));
 assert.equal(result.transparent,true);assert.equal(Buffer.from(result.full.split(',')[1],'base64').toString(),svg);assert.match(result.preview,/^data:image\/png/);assert.match(result.shown,/^data:image\/svg\+xml/);
 for(const item of result.saved){assert.equal(item.mime,'image/svg+xml');assert.match(item.name,/\.svg$/);assert.deepEqual(Buffer.from(item.bytes),Buffer.from(svg));}
}));

test('independent: recovered transparent SVG with a raster media preview opens the original full-screen',()=>fixture(async page=>{
 await page.evaluate(()=>{resultNode.mediaUrl=resultNode.previewUrl;render({skipSave:true});centerOnNode(resultNode.id);});
 await page.locator('.node.result [data-download]').first().click();await page.waitForFunction(()=>saved.length===1);
 await page.locator('.node.result [data-result-transfer]').click();await page.locator('#lightbox.open').waitFor();await page.locator('#lightboxDownload').click();await page.waitForFunction(()=>saved.length===2);
 const result=await page.evaluate(async()=>({saved,shown:await getLocalMedia(activeLightbox.src)}));
 for(const item of result.saved)assert.deepEqual(Buffer.from(item.bytes),Buffer.from(svg));
 assert.match(result.shown,/^data:image\/svg\+xml/,'Full-screen image selection must prefer fullUrl for a native vector');
}));

test('independent: SVG to PNG reference conversion keeps alpha and original; rejected preview never becomes a reference',()=>fixture(async page=>{
 const result=await page.evaluate(async()=>{
  const original=await getLocalMedia(resultNode.fullUrl),file=await referenceToFile({url:original},0),bitmap=await createImageBitmap(file);
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
  const dimensions=[bitmap.width,bitmap.height],alpha=ctx.getImageData(0,0,1,1).data[3];bitmap.close();
  const native=WandouNativeSvg;window.WandouNativeSvg={prepare:async()=>({previewFallback:true,previewUrl:original})};let rejected='';
  try{await referenceToFile({url:original},1);}catch(error){rejected=error.message;}finally{window.WandouNativeSvg=native;}
  return{mime:file.type,name:file.name,dimensions,alpha,unchanged:await getLocalMedia(resultNode.fullUrl)===original,rejected};
 });
 assert.equal(result.mime,'image/png');assert.equal(result.name,'reference-1.png');assert.deepEqual(result.dimensions,[128,64]);assert.equal(result.alpha,0);assert.equal(result.unchanged,true);assert.match(result.rejected,/参考图转换失败/);
}));
