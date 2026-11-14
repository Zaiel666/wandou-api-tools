const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(root,'desktop-client/node_modules/playwright'));
const sharp=require(path.join(root,'desktop-client/node_modules/sharp'));
const out=path.resolve(__dirname,'../../qa');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const png=await sharp({create:{width:4096,height:4096,channels:4,background:{r:17,g:83,b:145,alpha:.5}}}).png().toBuffer();
 const {crc32}=require('node:zlib'),padding=Buffer.alloc(2*1024*1024,65);Buffer.from('Comment\0').copy(padding);
 const chunk=Buffer.alloc(padding.length+12);chunk.writeUInt32BE(padding.length);chunk.write('tEXt',4);padding.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
 const original=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
 const counters=new Map();let origin;
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/image/')){
   const run=req.url.split('/')[2],state=counters.get(run);state.requests++;state.active++;state.maxActive=Math.max(state.maxActive,state.active);
   let done=false;const end=()=>{if(!done){done=true;state.active--;}};res.on('close',end);res.on('finish',end);
   res.setHeader('Content-Type','image/png');res.write(original.subarray(0,64));setTimeout(()=>{if(!res.destroyed)res.end(original.subarray(64));},200);
  } else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>.canvas-wrap{width:900px;height:700px}img{width:32px;height:32px}</style><div class="canvas-wrap" id="host"></div>');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),report={originalBytes:original.length,runs:[]};
 try{
  for(const version of ['v217','v218'])for(const cancel of [false,'download','decode']){
   const key=version+'-'+cancel,state={requests:0,active:0,maxActive:0};counters.set(key,state);
   const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());await page.goto(origin);
   // Real worker decoding, delayed delivery to expose queued full-size blobs.
   await page.evaluate(()=>{const Native=Worker;window.Worker=class{constructor(url){this.worker=new Native(url);this.worker.onmessage=e=>setTimeout(()=>this.onmessage?.(e),250);this.worker.onerror=e=>this.onerror?.(e);}postMessage(...args){this.worker.postMessage(...args)}terminate(){this.worker.terminate()}};});
   await page.addScriptTag({path:path.join(root,`artifacts/release-${version}/source/app/canvas-media-preview.js`)});
   await page.evaluate(({origin,key})=>{for(let i=0;i<12;i++){const img=new Image();img.dataset.original=origin+'/image/'+key+'/'+i;host.append(img);WandouCanvasPreview.setSource(img,img.dataset.original);}}, {origin,key});
   if(cancel){
    if(cancel==='decode')await page.waitForFunction(()=>WandouCanvasPreview.stats().completedDecodes>0);
    else await page.waitForTimeout(100);
    await page.evaluate(()=>{WandouCanvasPreview.release(host);host.replaceChildren();});
    await page.waitForFunction(()=>{const s=WandouCanvasPreview.stats();return s.inflight===0 && s.queuedDecodes===0 && !s.remoteActive;});
    await page.waitForTimeout(300);
   }else{
    await page.waitForFunction(()=>[...host.querySelectorAll('img')].every(img=>img.naturalWidth>0)&&WandouCanvasPreview.stats().inflight===0,null,{timeout:30000});
    const images=await page.evaluate(()=>[...host.querySelectorAll('img')].map(img=>({width:img.naturalWidth,height:img.naturalHeight,original:WandouCanvasPreview.dimensions(img).source===img.dataset.original,reportedWidth:WandouCanvasPreview.dimensions(img).width})));
    assert.equal(images.length,12);assert.ok(images.every(i=>i.width*i.height<=790528&&i.original&&i.reportedWidth===4096),JSON.stringify(images));
   }
   const stats=await page.evaluate(()=>WandouCanvasPreview.stats());report.runs.push({version,cancel,...state,stats});
   await page.close();
  }
  const baseline=report.runs.find(r=>r.version==='v217'&&!r.cancel),fixed=report.runs.find(r=>r.version==='v218'&&!r.cancel),cancelled=report.runs.filter(r=>r.version==='v218'&&r.cancel);
  if(process.env.EXPECT_BOUNDED==='1'){
   assert.ok(baseline.maxActive>3,'baseline must reproduce unbounded downloads');
   assert.ok(fixed.maxActive<=3,'updated pipeline must bound actual concurrent responses');
   assert.equal(fixed.requests,12);assert.ok(cancelled.every(r=>r.requests<=3),'cancel must prevent queued network work');
   assert.equal(fixed.stats.remoteActive,0);assert.equal(fixed.stats.remoteQueued,0);assert.equal(fixed.stats.remoteBufferedBytes,0);
   for(const r of cancelled){assert.equal(r.stats.inflight,0);assert.equal(r.stats.remoteActive,0);assert.equal(r.stats.remoteQueued,0);assert.equal(r.stats.remoteBufferedBytes,0);assert.equal(r.stats.cacheEntries,0);}
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'preview-pipeline-pressure.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
