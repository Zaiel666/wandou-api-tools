const test=require('node:test'),assert=require('node:assert/strict'),path=require('path');
const {pathToFileURL}=require('url');const {chromium}=require('../desktop-client/node_modules/playwright');const sharp=require('../desktop-client/node_modules/sharp');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
test('canvas thumbnails bound decoded pixels while editing and persisted sources keep full originals',async()=>{
 const full='data:image/png;base64,'+(await sharp({create:{width:2048,height:8192,channels:4,background:'#42b66b'}}).png().toBuffer()).toString('base64');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route(/^https?:/,r=>r.abort());await p.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);
  await p.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await p.evaluate(full=>{nodes=[];links=[];view={x:40,y:30,zoom:.4};createNode('result',0,0,{_deferRender:true,mediaType:'image',mediaUrl:full,fullUrl:full,width:2048,height:8192});render({skipSave:true});},full);
  await p.waitForFunction(()=>{const img=canvas.querySelector('.node.result .preview img');return img?.naturalWidth>0&&img.src.startsWith('blob:');});
  const result=await p.evaluate(()=>{const n=nodes[0],img=canvas.querySelector('.node.result .preview img');return {pixels:img.naturalWidth*img.naturalHeight,width:n.width,height:n.height,original:n.mediaUrl,download:favoriteMediaUrl(n)};});
  assert.ok(result.pixels<=786432);assert.equal(result.width,2048);assert.equal(result.height,8192);assert.equal(result.original,full);assert.equal(result.download,full);
  // Recycled visibility must restore the preview, never a revoked blob URL.
  await p.evaluate(()=>setDeferredNodeMedia(canvas.querySelector('.node.result'),false));
  await p.evaluate(()=>setDeferredNodeMedia(canvas.querySelector('.node.result'),true));
  await p.waitForFunction(()=>canvas.querySelector('.node.result .preview img').naturalWidth>0);
  await p.evaluate(()=>{canvasWrap.classList.add('is-panning');const img=canvas.querySelector('.node.result .preview img');window.WandouCanvasPreview.setSource(img,'');window.WandouCanvasPreview.setSource(img,nodes[0].mediaUrl);});
  assert.equal(await p.evaluate(()=>canvas.querySelector('.node.result .preview img').hasAttribute('src')),false);
  await p.evaluate(()=>canvasWrap.classList.remove('is-panning'));
  await p.waitForFunction(()=>canvas.querySelector('.node.result .preview img').naturalWidth>0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('large animated GIF, WebP and APNG previews preserve every frame',async()=>{
 const raw=Buffer.alloc(1600*3200*3);raw.fill(255,0,1600*1600*3);
 const {deflateSync,crc32}=require('node:zlib');
 const chunk=(name,data)=>{const kind=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);kind.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([kind,data])),out.length-4);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(1600);header.writeUInt32BE(1600,4);header[8]=8;header[9]=2;
 const animation=Buffer.alloc(8);animation.writeUInt32BE(2);
 const control=sequence=>{const b=Buffer.alloc(26);b.writeUInt32BE(sequence);b.writeUInt32BE(1600,4);b.writeUInt32BE(1600,8);b.writeUInt16BE(1,20);b.writeUInt16BE(10,22);return b;};
 const rows=color=>{const b=Buffer.alloc(1600*(1600*3+1),color);for(let row=0;row<1600;row++)b[row*(1600*3+1)]=0;return deflateSync(b);};
 const sequence=Buffer.alloc(4);sequence.writeUInt32BE(2);
 const apng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('acTL',animation),chunk('fcTL',control(0)),chunk('IDAT',rows(255)),chunk('fcTL',control(1)),chunk('fdAT',Buffer.concat([sequence,rows(0)])),chunk('IEND',Buffer.alloc(0))]);
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const p=await browser.newPage();
  await p.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);
  await p.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  for(const format of ['gif','webp','png']){
   const original=format==='png'?apng:await sharp(raw,{raw:{width:1600,height:3200,channels:3,pageHeight:1600}})[format]({loop:0,delay:[100,100]}).toBuffer();
   const url='data:image/'+format+';base64,'+original.toString('base64');
   await p.evaluate(url=>{document.getElementById('animated-preview-test')?.remove();const image=new Image();image.id='animated-preview-test';document.body.append(image);window.WandouCanvasPreview.setSource(image,url);},url);
   await p.waitForFunction(()=>document.getElementById('animated-preview-test').naturalWidth>0);
   const bytes=await p.evaluate(async()=>Array.from(new Uint8Array(await (await fetch(document.getElementById('animated-preview-test').src)).arrayBuffer())));
   assert.ok(Buffer.from(bytes).equals(original),format+' must retain its animated container');
   if(format!=='png')assert.equal((await sharp(Buffer.from(bytes),{animated:true}).metadata()).pages,2);
  }
 }finally{await browser.close();}
});
