const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),crypto=require('node:crypto');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa');
function fixture(frames=2){
 const bytes=[...Buffer.from('GIF89a'),4,0,2,0,0x81,0,0,0,0,0,255,0,0,0,255,0,0,0,255,0x21,0xff,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0];
 for(let i=0;i<frames;i++){
  const codes=[];for(const pixel of [0,i%2+1,i%2+1,0,0,i%2+1,i%2+1,0])codes.push(4,pixel);codes.push(5);
  const compressed=Array(Math.ceil(codes.length*3/8)).fill(0);codes.forEach((c,j)=>{for(let b=0;b<3;b++)compressed[(j*3+b)>>3]|=((c>>b)&1)<<((j*3+b)&7);});
  bytes.push(0x21,0xf9,4,9,i?12:8,0,0,0,0x2c,0,0,0,0,4,0,2,0,0,2,compressed.length,...compressed,0);
 }
 bytes.push(0x3b);return Buffer.from(bytes);
}
const gif=fixture(),gifUrl='data:image/gif;base64,'+gif.toString('base64'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function moduleFor(){const scope={Blob,Uint8Array,ArrayBuffer,DOMException,atob,btoa};vm.runInNewContext(fs.readFileSync(path.join(app,'animated-image-output.js'),'utf8'),scope);return scope.WandouAnimatedImage;}
test('GIF parser checks every frame, timing, loop, transparency and exact original bytes',async()=>{
 const api=moduleFor(),metadata=api.validate(new Uint8Array(gif));
 assert.equal(metadata.frameCount,2);assert.equal(metadata.width,4);assert.equal(metadata.height,2);assert.deepEqual(Array.from(metadata.frameDurationsMs),[80,120]);assert.equal(metadata.durationMs,200);assert.equal(metadata.loopCount,0);assert.equal(metadata.hasTransparency,true);
 for(const input of [new Uint8Array(gif),new Blob([gif],{type:'image/png'}),gifUrl]){
  const output=await api.prepare(input,{preview:false});assert.equal(hash(Buffer.from(await output.blob.arrayBuffer())),hash(gif));assert.equal(hash(Buffer.from(output.dataUrl.split(',')[1],'base64')),hash(gif));assert.equal(output.mimeType,'image/gif');
 }
 assert.throws(()=>api.validate(new Uint8Array(fixture(1))),/2 至 16/);assert.equal(api.validate(new Uint8Array(fixture(1)),{allowStatic:true}).frameCount,1);
 assert.throws(()=>api.validate(new Uint8Array(fixture(17))),/16 帧/);
 assert.equal(api.validate(new Uint8Array(fixture(17)),{allowStatic:true}).frameCount,17);assert.throws(()=>api.validate(new Uint8Array(fixture(257)),{allowStatic:true}),/256 帧/);
 assert.throws(()=>api.validate(new Uint8Array(gif.subarray(0,-1))),/结尾/);
 const bad=Buffer.from(gif);bad[bad.length-3]=0;assert.throws(()=>api.validate(new Uint8Array(bad)),/压缩|像素/);
 const huge=Buffer.from(gif);huge[6]=255;huge[7]=255;assert.throws(()=>api.validate(new Uint8Array(huge)),/尺寸/);
 assert.throws(()=>api.validate(new Uint8Array(Buffer.from('not a GIF payload'))),/不是 GIF/);
 const controller=new AbortController();controller.abort();await assert.rejects(api.prepare(gifUrl,{signal:controller.signal}),{name:'AbortError'});
});
test('GIF exports correct the suffix, retain exact bytes and never fall back after cancel/failure',async()=>{
 const calls=[],window={wandouShell:{saveFileAs:async(...args)=>{calls.push(args);return calls.length===1?{success:true}:calls.length===2?{success:false,canceled:true}:{success:false,error:'synthetic disk unavailable'};}}};
 vm.runInNewContext(fs.readFileSync(path.join(app,'image-export.js'),'utf8'),{window,fetch,Blob,Uint8Array,AbortController,setTimeout,clearTimeout,URL:{createObjectURL(){throw Error('must not silently download');}}});
 for(let i=0;i<3;i++) {const out=await window.WandouImageExport.save({blob:new Blob([gif],{type:'image/png'}),filename:'动画.png'});assert.equal(i===0?out.success:i===1?out.canceled:out.error.includes('disk'),true);}
 assert.equal(calls.length,3);for(const [name,bytes,mime] of calls){assert.equal(name,'动画.gif');assert.equal(mime,'image/gif');assert.equal(hash(bytes),hash(gif));}
 const failed=await window.WandouImageExport.save({blob:new Blob(['not gif'],{type:'image/gif'}),filename:'fake.gif'});assert.equal(failed.success,false);assert.equal(calls.length,3);
});
test('real GIF encoder exercises dictionary growth, resets, local palettes and animation pixels',async()=>{
 const sharp=require('../desktop-client/node_modules/sharp'),api=moduleFor(),width=192,height=128,frames=3,raw=Buffer.alloc(width*height*frames*4);
 let random=92341;for(let i=0;i<raw.length;i+=4){random=(Math.imul(random,1664525)+1013904223)>>>0;raw[i]=random&255;raw[i+1]=(random>>8)&255;raw[i+2]=(random>>16)&255;raw[i+3]=i%32===0?0:255;}
 const original=await sharp(raw,{raw:{width,height:height*frames,pageHeight:height,channels:4}}).gif({loop:0,delay:[80,120,160],colours:256,dither:0}).toBuffer();
 const parsed=api.validate(new Uint8Array(original)),decoded=await sharp(original,{animated:true}).metadata();
 assert.equal(parsed.frameCount,3);assert.equal(parsed.width,width);assert.equal(parsed.height,height);assert.deepEqual(Array.from(parsed.frameDurationsMs),[80,120,160]);assert.equal(decoded.pages,3);assert.equal(decoded.pageHeight,height);
 const prepared=await api.prepare(new Uint8Array(original),{preview:false});assert.equal(hash(Buffer.from(await prepared.blob.arrayBuffer())),hash(original));
 fs.writeFileSync(path.join(qa,'gif-real-encoder-synthetic.gif'),original);
});
let browser,server,origin;
test.before(async()=>{
 fs.mkdirSync(qa,{recursive:true});
 server=http.createServer((req,res)=>{try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep))throw Error('outside');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function contextFor(t,options={}){
 const context=await browser.newContext({viewport:{width:options.width||1440,height:800},reducedMotion:'reduce'});t.after(()=>context.close());
 await context.route('**/*',route=>{const url=route.request().url();return url.startsWith(origin)||/^(?:data|blob):/.test(url)?route.continue():route.abort();});return context;
}
test('GIF preview decodes real frames, retains alpha, handles preview failure and abort releases bitmap',async t=>{
 const context=await contextFor(t),page=await context.newPage();await page.goto(origin+'/asset-library-test.html');
 const result=await page.evaluate(async gifUrl=>{
  const api=WandouAnimatedImage,output=await api.prepare(gifUrl,{previewMaxEdge:4}),bitmap=await createImageBitmap(await(await fetch(output.previewUrl)).blob());
  const c=document.createElement('canvas');c.width=4;c.height=2;const x=c.getContext('2d');x.drawImage(bitmap,0,0);const pixels=Array.from(x.getImageData(0,0,4,2).data);bitmap.close();
  const original=createImageBitmap;let closed=0;const controller=new AbortController();window.createImageBitmap=async()=>{controller.abort();return{width:4,height:2,close(){closed++;}};};
  let canceled=false;try{await api.prepare(gifUrl,{signal:controller.signal});}catch(e){canceled=e.name==='AbortError';}
  window.createImageBitmap=async()=>{throw Error('synthetic decode unavailable');};const fallback=await api.prepare(gifUrl);window.createImageBitmap=original;
  return{url:output.previewUrl,width:output.width,height:output.height,pixels,canceled,closed,fallback:{previewUrl:fallback.previewUrl,previewFallback:fallback.previewFallback,dataUrl:fallback.dataUrl}};
 },gifUrl);
 assert.match(result.url,/^data:image\/png;/);assert.equal(result.pixels[3],0);assert.deepEqual(result.pixels.slice(4,8),[255,0,0,255]);assert.equal(result.canceled,true);assert.equal(result.closed,1);assert.equal(result.fallback.previewFallback,true);assert.equal(result.fallback.previewUrl,'');assert.equal(result.fallback.dataUrl,gifUrl);
});
for(const width of [1440,1024])for(const theme of ['light','dark'])test(`GIF assets static grid, explicit playback, original save, cancellation/failure and reopen: ${width} ${theme}`,async t=>{
 const context=await contextFor(t,{width});
 await context.addInitScript(({gifUrl,theme})=>{
  localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);
  if(!localStorage.getItem('aiCanvasProjectsV1')){
   localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:'animations',name:'动图测试项目',createdAt:10,updatedAt:20}]));
   localStorage.setItem('aiCanvasStateV1:animations',JSON.stringify({folderId:'animations',savedAt:20,nodes:[{id:'gif-result',title:'测试动图',type:'result',mediaType:'image',imageOutputFormat:'gif',outputFormat:'gif',mimeType:'image/gif',resolutionProcessing:'native-animation',transparent:true,previewUrl:gifUrl,mediaUrl:'data:image/png;base64,not-the-original',fullUrl:'indexed-media:gif-original',width:4,height:2,animationFrameCount:2,animationFrameDurationsMs:[80,120],animationDurationMs:200,animationLoopCount:0,createdAt:20}],links:[]}));
  }
  window.exports=[];window.reads=[];window.exportMode='success';window.wandouShell={readCanvasMedia:async({id})=>{reads.push(id);return{success:true,value:gifUrl};},saveFileAs:async(name,bytes,mime)=>{exports.push({name,bytes:Array.from(bytes),mime});await new Promise(r=>setTimeout(r,80));return exportMode==='cancel'?{success:false,canceled:true}:exportMode==='fail'?{success:false,error:'合成磁盘不可用'}:{success:true,path:'X:/synthetic/'+name};}};
 },{gifUrl,theme});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/asset-library-test.html');await page.waitForSelector('.media-preview img');
 assert.match(await page.locator('.media-preview img').getAttribute('src'),/^data:image\/png;/);assert.match(await page.locator('[data-file-meta]').textContent(),/GIF 动图 · 2 帧/);
 const stateBefore=await page.evaluate(()=>localStorage.getItem('aiCanvasStateV1:animations'));
 await page.locator('[data-open-media]').click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);
 assert.match(await page.locator('#assetFileFacts').textContent(),/GIF · 4 × 2 像素.*2 帧 · 0.20 秒 · 循环播放/);assert.match(await page.locator('#assetAnimationNote').textContent(),/减少动态效果/);
 assert.match(await page.locator('#assetAnimationImage').getAttribute('src'),/^data:image\/png;/);assert.equal(await page.locator('#assetAnimationToggle').getAttribute('aria-pressed'),'false');
 assert.deepEqual(await page.locator('#assetExportFormat option').evaluateAll(options=>options.map(o=>o.disabled)),[false,true,true,true]);
 await page.locator('#assetAnimationToggle').click();assert.equal(await page.locator('#assetAnimationImage').getAttribute('src'),gifUrl);
 await page.locator('#assetAnimationToggle').click();assert.match(await page.locator('#assetAnimationImage').getAttribute('src'),/^data:image\/png;/);
 await page.locator('#assetAnimationToggle').click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.locator('#assetAnimationToggle').getAttribute('aria-pressed'),'false');await page.evaluate(()=>{delete document.hidden;});
 await page.locator('#assetAnimationToggle').click();await page.locator('#assetAnimationPreview').evaluate(element=>element.style.transform='translateY(5000px)');await page.waitForFunction(()=>document.getElementById('assetAnimationToggle').getAttribute('aria-pressed')==='false');await page.locator('#assetAnimationPreview').evaluate(element=>element.style.transform='');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2);await page.screenshot({path:path.join(qa,`gif-assets-${width}-${theme}.png`)});
 await page.evaluate(()=>{document.getElementById('assetInfoSave').click();document.getElementById('assetInfoSave').click();});await page.waitForFunction(()=>exports.length===1&&!wandouHasActiveTasks());
 const first=await page.evaluate(()=>exports[0]);assert.equal(first.name,'测试动图.gif');assert.equal(first.mime,'image/gif');assert.equal(hash(Buffer.from(first.bytes)),hash(gif));
 await page.locator('#assetInfoClose').click();await page.waitForFunction(()=>!document.getElementById('assetAnimationImage').hasAttribute('src'));
 await page.evaluate(()=>exportMode='cancel');await page.locator('[data-asset-download]').click();await page.waitForFunction(()=>exports.length===2&&!wandouHasActiveTasks());
 await page.evaluate(()=>exportMode='fail');await page.locator('[data-asset-download]').click();await page.waitForFunction(()=>exports.length===3&&!wandouHasActiveTasks());assert.match(await page.locator('#assetToast').textContent(),/合成磁盘不可用/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('aiCanvasStateV1:animations')),stateBefore);
 await page.reload();await page.waitForSelector('.media-preview img');assert.match(await page.locator('.media-preview img').getAttribute('src'),/^data:image\/png;/);await page.locator('[data-asset-download]').click();await page.waitForFunction(()=>exports.length===1&&!wandouHasActiveTasks());assert.equal(hash(Buffer.from(await page.evaluate(()=>exports[0].bytes))),hash(gif));assert.deepEqual(errors,[]);
});
test('indexed PNG preview remains visible and untyped legacy GIF is static without changing original',async t=>{
 const context=await contextFor(t),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAGUlEQVR4AWJiAIL/DAz/QRjIZAALgBgwDAAAAP//tX8RkQAAAAZJREFUAwBmIgQBgI2krQAAAABJRU5ErkJggg==','base64');
 await context.route(origin+'/synthetic/*',route=>route.fulfill({contentType:'application/octet-stream',body:route.request().url().endsWith('/preview')?png:gif}));
 await context.addInitScript(({origin,gifUrl})=>{
  localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:'gif-legacy',name:'兼容性测试'}]));
  localStorage.setItem('aiCanvasStateV1:gif-legacy',JSON.stringify({folderId:'gif-legacy',savedAt:20,nodes:[
   {id:'png-preview',title:'PNG静态预览',type:'result',mediaType:'image',imageOutputFormat:'gif',resolutionProcessing:'native-animation',previewUrl:'indexed-media:preview',fullUrl:'indexed-media:original',width:4,height:2,createdAt:20},
   {id:'legacy',title:'旧格式未知GIF',type:'result',mediaType:'image',fullUrl:'indexed-media:legacy',width:4,height:2,createdAt:10}
  ],links:[]}));
  window.wandouShell={readCanvasMedia:async({id})=>({success:true,value:id==='original'?gifUrl:origin+'/synthetic/'+id}),saveFileAs:async()=>({success:true})};
 },{origin,gifUrl});
 const page=await context.newPage();await page.goto(origin+'/asset-library-test.html');await page.waitForFunction(()=>document.querySelectorAll('.media-preview img').length===2&&Array.from(document.querySelectorAll('.media-preview img')).every(i=>i.naturalWidth===4));
 const sources=await page.locator('.media-preview img').evaluateAll(images=>images.map(i=>i.src));assert.equal(sources[0],origin+'/synthetic/preview');assert.match(sources[1],/^data:image\/png;/);
 await page.locator('[data-open-media]').nth(1).click();await page.waitForFunction(()=>!document.getElementById('assetInfoSave').disabled);assert.match(await page.locator('#assetFileFacts').textContent(),/2 帧/);assert.equal(await page.locator('#assetAnimationToggle').getAttribute('aria-pressed'),'false');
});
