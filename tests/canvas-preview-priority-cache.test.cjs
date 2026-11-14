const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const sharp=require('../desktop-client/node_modules/sharp');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const corpus=path.resolve(__dirname,'../artifacts/canvas-performance-20261024/synthetic-4k');
const full=index=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(corpus,String(index).padStart(3,'0')+'.jpg')).toString('base64');
let server,browser,origin,paddedPng;
test.before(async()=>{
 const png=await sharp({create:{width:320,height:320,channels:3,background:'#8fd458'}}).png().toBuffer();
 const {crc32}=require('node:zlib'),text=Buffer.alloc(2*1024*1024,65);Buffer.from('Comment\0').copy(text);
 const chunk=Buffer.alloc(text.length+12);chunk.writeUInt32BE(text.length);chunk.write('tEXt',4);text.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
 paddedPng=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
 server=http.createServer((req,res)=>{if(req.url.startsWith('/image/')){res.setHeader('Content-Type','image/png');res.end(paddedPng);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>.canvas-wrap{width:1000px;height:800px;overflow:auto}img{width:32px;height:32px}</style><div class="canvas-wrap" id="host"></div>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
async function page(){const p=await browser.newPage();await p.goto(origin);await p.addScriptTag({path:path.join(app,'canvas-media-preview.js')});return p;}

test('a verified 320px preview displays ahead of queued 4K images; more than 64 expensive thumbnails stay reusable',async()=>{
 const p=await page();try{
  const urls=Array.from({length:67},(_,i)=>full(i));
  const small='data:image/webp;base64,'+fs.readFileSync(path.join(corpus,'199-preview.webp')).toString('base64');
  await p.evaluate(({urls,small})=>{window.sources=urls;for(const [i,url]of urls.entries()){const img=new Image();img.id='large-'+i;host.append(img);WandouCanvasPreview.setSource(img,url);}const img=new Image();img.id='small';host.append(img);WandouCanvasPreview.setSource(img,small);},{urls,small});
  await p.waitForFunction(()=>document.getElementById('small').naturalWidth===320,null,{timeout:5000});
  const atSmall=await p.evaluate(()=>WandouCanvasPreview.stats());assert.ok(atSmall.completedDecodes<10,JSON.stringify(atSmall));
  await p.waitForFunction(()=>[...host.querySelectorAll('img')].every(img=>img.naturalWidth>0)&&WandouCanvasPreview.stats().inflight===0,null,{timeout:45000});
  const before=await p.evaluate(()=>{const stats=WandouCanvasPreview.stats();WandouCanvasPreview.release(host);host.replaceChildren();const image=new Image();image.id='reused';host.append(image);WandouCanvasPreview.setSource(image,sources[0]);return stats;});
  assert.equal(before.completedDecodes,67);assert.equal(before.cacheEntries,67);assert.ok(before.cacheBytes<before.cacheBudget);
  await p.waitForFunction(()=>document.getElementById('reused').naturalWidth>0);
  const after=await p.evaluate(()=>WandouCanvasPreview.stats());assert.equal(after.completedDecodes,before.completedDecodes,'first original must remain cached beyond 64 entries');
 }finally{await p.close();}
});

test('release cancels waiting large images and source eviction survives asynchronous digest/decode completion',async()=>{
 const p=await page();try{
  await p.evaluate(urls=>{for(const url of urls){const img=new Image();host.append(img);WandouCanvasPreview.setSource(img,url);}},Array.from({length:30},(_,i)=>full(i+80)));
  await p.waitForFunction(()=>WandouCanvasPreview.stats().queuedDecodes>10);
  const before=await p.evaluate(()=>{const s=WandouCanvasPreview.stats();WandouCanvasPreview.release(host);host.replaceChildren();return s;});
  await p.waitForFunction(()=>WandouCanvasPreview.stats().queuedDecodes===0&&WandouCanvasPreview.stats().inflight===0);
  const after=await p.evaluate(()=>WandouCanvasPreview.stats());assert.ok(after.completedDecodes<=before.completedDecodes+1);assert.equal(after.cacheEntries,0);
  for(const [index,when]of [[160,'before-digest'],[161,'during-decode']]){
   await p.evaluate(({url,when})=>{window.lastSource=url;const image=new Image();image.id=when;host.append(image);WandouCanvasPreview.setSource(image,url);if(when==='before-digest')WandouCanvasPreview.releaseSource(url);},{url:full(index),when});
   if(when==='during-decode'){await p.waitForFunction(()=>WandouCanvasPreview.stats().inflight>0&&WandouCanvasPreview.stats().queuedDecodes===0);await p.evaluate(()=>WandouCanvasPreview.releaseSource(lastSource));}
   await p.waitForFunction(when=>document.getElementById(when).naturalWidth>0&&WandouCanvasPreview.stats().inflight===0,when);
   assert.equal(await p.evaluate(()=>WandouCanvasPreview.stats().cacheEntries),0,when+' must not refill a released source');
  }
 }finally{await p.close();}
});

test('remote small images bypass decode and cache remains below 24 MiB with padded valid PNG inputs',async()=>{
 const p=await page();try{
  await p.evaluate(origin=>{for(let i=0;i<15;i++){const image=new Image();host.append(image);WandouCanvasPreview.setSource(image,origin+'/image/'+i+'.png');}},origin);
  await p.waitForFunction(()=>host.querySelectorAll('img').length===15&&[...host.querySelectorAll('img')].every(img=>img.naturalWidth===320)&&WandouCanvasPreview.stats().inflight===0,null,{timeout:15000});
  const stats=await p.evaluate(()=>WandouCanvasPreview.stats());assert.equal(stats.completedDecodes,0);assert.ok(stats.cacheEntries<15);assert.ok(stats.cacheBytes<=24*1024*1024);assert.equal(stats.cacheBudget,24*1024*1024);
 }finally{await p.close();}
});

test('small animated GIF and WebP bypass the queue without changing their bytes',async()=>{
 const raw=Buffer.alloc(96*192*3);raw.fill(255,0,96*96*3);
 const p=await page();try{for(const format of ['gif','webp']){
  const original=await sharp(raw,{raw:{width:96,height:192,channels:3,pageHeight:96}})[format]({loop:0,delay:[100,100]}).toBuffer();
  await p.evaluate(url=>{WandouCanvasPreview.release(host);host.replaceChildren();const image=new Image();image.id='animated';host.append(image);WandouCanvasPreview.setSource(image,url);},'data:image/'+format+';base64,'+original.toString('base64'));
  await p.waitForFunction(()=>document.getElementById('animated').naturalWidth===96);
  const bytes=await p.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(document.getElementById('animated').src)).arrayBuffer())));assert.ok(Buffer.from(bytes).equals(original));assert.equal(await p.evaluate(()=>WandouCanvasPreview.stats().completedDecodes),0);
 }}finally{await p.close();}
});
