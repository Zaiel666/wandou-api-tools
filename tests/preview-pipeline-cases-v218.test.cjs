const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http'),fs=require('node:fs');
const root=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(root,'desktop-client/node_modules/playwright'));
const sharp=require(path.join(root,'desktop-client/node_modules/sharp'));
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
let server,browser,origin;const requests=new Map(),fixtures={};
test.before(async()=>{
 fixtures.png=await sharp({create:{width:2048,height:2048,channels:4,background:{r:17,g:83,b:145,alpha:.5}}}).png().toBuffer();
 fixtures.small=await sharp({create:{width:64,height:64,channels:4,background:'#8fd458'}}).png().toBuffer();
 fixtures.jpeg=await sharp({create:{width:2000,height:1000,channels:3,background:'#df5522'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 server=http.createServer((req,res)=>{
  if(req.url.startsWith('/app/')){
   try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname.slice(4)));if(!file.startsWith(path.resolve(app)+path.sep))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}return;
  }
  if(req.url.startsWith('/image/')){
   requests.set(req.url,(requests.get(req.url)||0)+1);
   if(req.url.includes('broken')){res.writeHead(503);res.end('synthetic failure');return;}
   res.setHeader('Content-Type','image/png');setTimeout(()=>{if(!res.destroyed)res.end(fixtures.png);},100);
  }else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>.canvas-wrap{width:900px;height:700px}img{width:32px;height:32px}</style><div class="canvas-wrap" id="host"></div>');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
async function page(){const p=await browser.newPage();await p.route('**/*',r=>r.request().url().startsWith(origin)||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());await p.goto(origin);await p.addScriptTag({path:path.join(app,'canvas-media-preview.js')});return p;}

test('preview keeps PNG transparency and EXIF-oriented dimensions; release revokes preview blobs',async()=>{
 const p=await page();try{
  await p.evaluate(sources=>{for(const [name,source] of Object.entries(sources)){const img=new Image();img.id=name;host.append(img);WandouCanvasPreview.setSource(img,source);}}, {transparent:'data:image/png;base64,'+fixtures.png.toString('base64'),oriented:'data:image/jpeg;base64,'+fixtures.jpeg.toString('base64')});
  await p.waitForFunction(()=>[...host.querySelectorAll('img')].every(i=>i.naturalWidth>0)&&WandouCanvasPreview.stats().inflight===0);
  const result=await p.evaluate(()=>{
   const png=document.getElementById('transparent'),jpg=document.getElementById('oriented'),c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(png,0,0,1,1);
   return {alpha:c.getContext('2d').getImageData(0,0,1,1).data[3],width:WandouCanvasPreview.dimensions(jpg).width,height:WandouCanvasPreview.dimensions(jpg).height,displayWidth:jpg.naturalWidth,displayHeight:jpg.naturalHeight};
  });
  assert.ok(Math.abs(result.alpha-128)<=2,JSON.stringify(result));assert.equal(result.width,1000);assert.equal(result.height,2000);assert.ok(result.displayHeight>result.displayWidth);
  const released=await p.evaluate(async()=>{const urls=[...host.querySelectorAll('img')].map(i=>i.src);WandouCanvasPreview.release(host);host.replaceChildren();return Promise.all(urls.map(url=>fetch(url).then(()=>false,()=>true)));});
  assert.deepEqual(released,[true,true]);
 }finally{await p.close();}
});

test('small local preview bypasses queued originals; duplicate requests coalesce; failed source falls back and frees slots',async()=>{
 const p=await page();try{
  await p.evaluate(({origin,small})=>{
   for(let i=0;i<12;i++){const img=new Image();img.id='remote-'+i;host.append(img);WandouCanvasPreview.setSource(img,origin+'/image/priority-'+(i%9));}
   const failed=new Image();failed.id='fallback';host.append(failed);WandouCanvasPreview.setSource(failed,origin+'/image/broken',[origin+'/image/fallback-ok']);
   const image=new Image();image.id='small';host.append(image);WandouCanvasPreview.setSource(image,small);
  },{origin,small:'data:image/png;base64,'+fixtures.small.toString('base64')});
  await p.waitForFunction(()=>document.getElementById('small').naturalWidth===64);
  assert.ok(await p.evaluate(()=>WandouCanvasPreview.stats().completedDecodes<9),'small preview must not wait behind the remote queue');
  await p.waitForFunction(()=>[...host.querySelectorAll('img')].every(i=>i.naturalWidth>0)&&WandouCanvasPreview.stats().inflight===0,null,{timeout:20000});
  for(let i=0;i<9;i++)assert.equal(requests.get('/image/priority-'+i),1,'same source must share one fetch');
  const stats=await p.evaluate(()=>WandouCanvasPreview.stats());
  assert.equal(stats.remoteActive,0);assert.equal(stats.remoteQueued,0);assert.equal(stats.remoteBufferedBytes,0);
  assert.ok(await p.evaluate(()=>WandouCanvasPreview.dimensions(document.getElementById('fallback')).source.endsWith('fallback-ok')));
 }finally{await p.close();}
});

test('real canvas project switch releases queued previews and reopening preserves original bytes',async()=>{
 const p=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.route('**/*',r=>r.request().url().startsWith(origin)||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());
  await p.goto(origin+'/app/ai-node-canvas-test.html?workspace=production');await p.waitForFunction(()=>document.body.dataset.testReady==='true',null,{timeout:10000}).catch(async error=>{throw new Error(error.message+'; page errors='+JSON.stringify(errors)+'; body='+await p.locator('body').innerText());});
  await p.evaluate(origin=>{
   window.originalProject=activeProjectId;nodes=[];links=[];nodeId=1;view={x:0,y:0,zoom:.25};
   for(let i=0;i<12;i++){const url=origin+'/image/switch-'+i;createNode('result',(i%4)*330,Math.floor(i/4)*330,{_deferRender:true,mediaUrl:url,fullUrl:url,previewUrl:url,width:2048,height:2048});}
   selectedNodeId=null;render({skipSave:true});projects.push({id:'preview-empty',name:'Synthetic empty',createdAt:Date.now(),updatedAt:Date.now()});
  },origin);
  await p.waitForFunction(()=>WandouCanvasPreview.stats().inflight>0);
  await p.evaluate(()=>switchProject('preview-empty'));
  await p.waitForFunction(()=>{const s=WandouCanvasPreview.stats();return !s.inflight&&!s.remoteActive&&!s.remoteQueued&&!s.remoteBufferedBytes;});
  assert.equal(await p.evaluate(()=>activeProjectId),'preview-empty');
  await p.evaluate(()=>switchProject(originalProject));
  await p.waitForFunction(()=>nodes.filter(n=>n.type==='result').length===12);
  const restored=await p.evaluate(async()=>Promise.all(nodes.filter(n=>n.type==='result').map(async n=>{const bytes=await(await fetch(n.fullUrl)).arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return{hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),width:n.width,height:n.height};})));
  const expected=require('node:crypto').createHash('sha256').update(fixtures.png).digest('hex');
  assert.ok(restored.every(n=>n.hash===expected&&n.width===2048&&n.height===2048),'restored original hashes and dimensions must match');
  assert.deepEqual(errors,[]);
 }finally{await p.close();}
});

test('local 4K output sizing preserves GIF, WebP and APNG animation bytes and original dimensions',async()=>{
 const p=await page();try{
  await p.addScriptTag({path:path.join(app,'image-output-resolution.js')});
  const raw=Buffer.alloc(96*192*3);raw.fill(255,0,96*96*3);
  const {deflateSync,crc32}=require('node:zlib');
  const chunk=(name,data)=>{const kind=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);kind.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([kind,data])),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(96);header.writeUInt32BE(96,4);header[8]=8;header[9]=2;
  const animation=Buffer.alloc(8);animation.writeUInt32BE(2);
  const control=sequence=>{const b=Buffer.alloc(26);b.writeUInt32BE(sequence);b.writeUInt32BE(96,4);b.writeUInt32BE(96,8);b.writeUInt16BE(1,20);b.writeUInt16BE(10,22);return b;};
  const rows=color=>{const b=Buffer.alloc(96*(96*3+1),color);for(let row=0;row<96;row++)b[row*(96*3+1)]=0;return deflateSync(b);};
  const sequence=Buffer.alloc(4);sequence.writeUInt32BE(2);
  const apng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('acTL',animation),chunk('fcTL',control(0)),chunk('IDAT',rows(255)),chunk('fcTL',control(1)),chunk('fdAT',Buffer.concat([sequence,rows(0)])),chunk('IEND',Buffer.alloc(0))]);
  for(const format of ['gif','webp','png']){
   const original=format==='png'?apng:await sharp(raw,{raw:{width:96,height:192,channels:3,pageHeight:96}})[format]({loop:0,delay:[100,100]}).toBuffer();
   const result=await p.evaluate(async({bytes,format})=>{const r=await WandouImageOutput.processBlob({blob:new Blob([new Uint8Array(bytes)],{type:'image/'+format}),targetSize:'4096x4096'});return{bytes:Array.from(new Uint8Array(await r.blob.arrayBuffer())),width:r.width,height:r.height,processing:r.processing,nonNative:r.nonNative};},{bytes:Array.from(original),format});
   assert.ok(Buffer.from(result.bytes).equals(original),format+' original animation bytes');assert.equal(result.width,96);assert.equal(result.height,96);assert.equal(result.processing,'original-animation-preserved');assert.equal(result.nonNative,false);
  }
 }finally{await p.close();}
});
