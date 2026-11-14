const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright'),sharp=require('../desktop-client/node_modules/sharp');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
after(async()=>{await browser?.close();});
async function fixture(run,{width=1024,height=800,theme='light',actual=false}={}){
 const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:/,r=>r.abort());
 if(actual){await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');const dark=await page.evaluate(()=>document.body.classList.contains('dark-theme'));if(dark!==(theme==='dark'))await page.locator('#themeToggleButton').click();}
 else await page.setContent('<html><body><button id="return-focus">Open</button></body></html>');
 await page.addStyleTag({path:path.resolve(__dirname,'../app/image-markup.css')});await page.addScriptTag({path:path.resolve(__dirname,'../app/image-markup.js')});
 await page.evaluate(()=>{window.makeImage=(w=128,h=64,kind='original')=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');if(kind==='original'){x.fillStyle='#dce9e2';x.fillRect(0,0,w,h);x.fillStyle='#283d35';x.fillRect(w*.3,h*.25,w*.4,h*.5);}if(kind==='opaque'){x.fillStyle='red';x.fillRect(0,0,w,h);}if(kind==='overlay'){x.strokeStyle='red';x.lineWidth=4;x.strokeRect(w*.2,h*.2,w*.6,h*.6);}return c.toDataURL('image/png');};window.toBlob=url=>fetch(url).then(r=>r.blob());});
 try{await run(page);assert.deepEqual(errors,[]);}finally{await page.close();}
}
test('markup request preserves original bytes, PNG alpha and dimensions; rejects mask combination',()=>fixture(async page=>{
 const r=await page.evaluate(async()=>{const original=await toBlob(makeImage()),overlay=await toBlob(makeImage(128,64,'overlay'));const before=Array.from(new Uint8Array(await original.arrayBuffer()));const p=await WandouImageMarkup.prepare(original,overlay);let conflict='';try{await WandouImageMarkup.prepare(original,overlay,{mask:'something'})}catch(e){conflict=e.message}return{before,after:Array.from(new Uint8Array(await p.imageFile.arrayBuffer())),overlayBefore:Array.from(new Uint8Array(await overlay.arrayBuffer())),overlayAfter:Array.from(new Uint8Array(await p.markupFile.arrayBuffer())),width:p.width,height:p.height,type:p.markupFile.type,name:p.markupFile.name,conflict};});
 assert.deepEqual(r.after,r.before);assert.deepEqual(r.overlayAfter,r.overlayBefore);assert.equal(r.type,'image/png');assert.equal(r.name,'markup-overlay.png');assert.deepEqual([r.width,r.height],[128,64]);assert.match(r.conflict,/不能同时/);
}));
test('blank, opaque, mismatched and malformed overlays fail before API submission',()=>fixture(async page=>{
 const r=await page.evaluate(async()=>{const original=await toBlob(makeImage()),out=[];for(const overlay of [await toBlob(makeImage(128,64,'blank')),await toBlob(makeImage(128,64,'opaque')),await toBlob(makeImage(64,64,'overlay')),new Blob(['not png'],{type:'image/png'})]){try{await WandouImageMarkup.prepare(original,overlay);out.push('accepted')}catch(e){out.push(e.message)}}return out});
 assert.match(r[0],/请先/);assert.match(r[1],/透明/);assert.match(r[2],/尺寸/);assert.match(r[3],/完整/);
}));
test('oversized file and pixel headers are rejected before image decoding',()=>fixture(async page=>{
 const r=await page.evaluate(async()=>{const valid=await toBlob(makeImage(128,64,'overlay')),original=await toBlob(makeImage());let calls=0;const real=createImageBitmap;window.createImageBitmap=(...args)=>{calls++;return real(...args)};const bytes=new Uint8Array(await original.arrayBuffer());new DataView(bytes.buffer).setUint32(16,65535);new DataView(bytes.buffer).setUint32(20,65535);const results=[];for(const item of [new Blob([bytes],{type:'image/png'}),new Blob([new Uint8Array(50*1024*1024+1)],{type:'image/png'})]){try{await WandouImageMarkup.prepare(item,valid)}catch(e){results.push(e.message)}}window.createImageBitmap=real;return{calls,results}});
 assert.equal(r.calls,0);assert.match(r.results[0],/像素/);assert.match(r.results[1],/50 MB/);
}));
test('JPEG EXIF orientation uses oriented dimensions while preserving JPEG original bytes',async()=>{
 const jpeg=await sharp({create:{width:80,height:40,channels:3,background:'#dce9e2'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 await fixture(async page=>{const r=await page.evaluate(async bytes=>{const b=new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}),p=await WandouImageMarkup.prepare(b,await toBlob(makeImage(40,80,'overlay')));let mismatch='';try{await WandouImageMarkup.prepare(b,await toBlob(makeImage(80,40,'overlay')))}catch(e){mismatch=e.message}return{bytes:Array.from(new Uint8Array(await p.imageFile.arrayBuffer())),width:p.width,height:p.height,mismatch};},Array.from(jpeg));assert.deepEqual(Buffer.from(r.bytes),jpeg);assert.deepEqual([r.width,r.height],[40,80]);assert.match(r.mismatch,/尺寸/);});
});
test('abort during decoder load closes bitmap and rejects with AbortError',()=>fixture(async page=>{
 const r=await page.evaluate(async()=>{const original=await toBlob(makeImage()),overlay=await toBlob(makeImage(128,64,'overlay')),controller=new AbortController();const real=createImageBitmap;let closed=0;window.createImageBitmap=async(...args)=>{const b=await real(...args);const close=b.close.bind(b);b.close=()=>{closed++;close()};controller.abort();return b;};let name;try{await WandouImageMarkup.prepare(original,overlay,{signal:controller.signal})}catch(e){name=e.name}window.createImageBitmap=real;return{name,closed}});assert.deepEqual(r,{name:'AbortError',closed:1});
}));
async function start(page,extra={}){await page.evaluate(extra=>{window.originalUrl=makeImage(1600,900);window.markupTask=WandouImageMarkup.open({imageUrl:originalUrl,...extra});},extra);await page.locator('.image-markup-dialog').waitFor();await page.locator('.image-markup-overlay').waitFor();}
async function draw(page,tool='circle'){
 await page.locator(`[data-markup-tool="${tool}"]`).click();const rect=await page.locator('.image-markup-overlay').boundingBox();await page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.65,{steps:12});await page.mouse.up();
}
for(const width of [1024,1440])for(const theme of ['light','dark'])test(`actual themed annotation UI draws circle/arrow at ${width}x800 ${theme}`,()=>fixture(async page=>{
 await start(page);await draw(page);await draw(page,'arrow');
 const geometry=await page.locator('.image-markup-dialog').boundingBox();assert.ok(geometry.x>=0&&geometry.x+geometry.width<=width);assert.ok(geometry.y>=0&&geometry.y+geometry.height<=800);
 const qa=path.resolve(__dirname,'../../qa');fs.mkdirSync(qa,{recursive:true});await page.screenshot({path:path.join(qa,`markup-${width}-${theme}.png`)});
 await page.locator('[data-markup-apply]').click();const result=await page.evaluate(async()=>{const r=await markupTask;const b=await createImageBitmap(r.markupBlob);const c=document.createElement('canvas');c.width=b.width;c.height=b.height;const x=c.getContext('2d');x.drawImage(b,0,0);let painted=0,clear=0;for(const a of x.getImageData(0,0,c.width,c.height).data.filter((_,i)=>i%4===3)){if(a)painted++;else clear++;}b.close();return{width:r.width,height:r.height,mime:r.markupBlob.type,painted,clear,originalUnchanged:originalUrl===makeImage(1600,900),dialogs:document.querySelectorAll('.image-markup-dialog').length};});assert.equal(result.width,1600);assert.equal(result.height,900);assert.equal(result.mime,'image/png');assert.ok(result.painted>1000&&result.clear>100000);assert.ok(result.originalUnchanged);assert.equal(result.dialogs,0);
},{width,theme,actual:true}));
test('undo/reset are reversible, cancel retains prior overlay, duplicate open yields one dialog',()=>fixture(async page=>{
 await page.evaluate(()=>{window.existing=makeImage(1600,900,'overlay');window.first=WandouImageMarkup.open({imageUrl:makeImage(1600,900),existingMarkup:existing});window.second=WandouImageMarkup.open({imageUrl:makeImage(10,10)});});await page.locator('.image-markup-dialog').waitFor();assert.equal(await page.locator('.image-markup-dialog').count(),1);
 await page.locator('[data-markup-reset]').click();assert.equal(await page.locator('[data-markup-apply]').isDisabled(),true);await page.locator('[data-markup-undo]').click();assert.equal(await page.locator('[data-markup-apply]').isDisabled(),false);await page.locator('[data-markup-cancel]').click();const r=await page.evaluate(async()=>({a:await first,b:await second,unchanged:existing===makeImage(1600,900,'overlay'),dialogs:document.querySelectorAll('.image-markup-dialog').length}));assert.deepEqual(r,{a:null,b:null,unchanged:true,dialogs:0});
}));
test('empty erasure cannot be applied and Escape cancels without file output',()=>fixture(async page=>{
 await start(page);await draw(page,'eraser');await page.locator('[data-markup-apply]').click();await page.locator('.image-markup-error').filter({hasText:'请先'}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>markupTask),null);assert.equal(await page.locator('.image-markup-dialog').count(),0);
}));
test('external abort and failed resolver remove modal and permit reopening',()=>fixture(async page=>{
 const failed=await page.evaluate(async()=>{try{await WandouImageMarkup.open({imageUrl:'local:missing',resolve:async()=>{throw Error('synthetic read failure')}})}catch(e){return e.message}});assert.match(failed,/synthetic read failure/);
 await page.evaluate(()=>{window.abortEditor=new AbortController();window.markupTask=WandouImageMarkup.open({imageUrl:makeImage(),signal:abortEditor.signal}).catch(e=>e.name)});await page.locator('.image-markup-dialog').waitFor();await page.evaluate(()=>abortEditor.abort());assert.equal(await page.evaluate(()=>markupTask),'AbortError');assert.equal(await page.locator('.image-markup-dialog').count(),0);await start(page);await page.locator('[data-markup-cancel]').click();assert.equal(await page.evaluate(()=>markupTask),null);
}));
test('WebP references remain WebP with exact bytes and matching PNG overlay',async()=>{
 const webp=await sharp({create:{width:80,height:40,channels:4,background:'#dce9e280'}}).webp({lossless:true}).toBuffer();
 await fixture(async page=>{const r=await page.evaluate(async bytes=>{const b=new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'}),p=await WandouImageMarkup.prepare(b,await toBlob(makeImage(80,40,'overlay')));return{bytes:Array.from(new Uint8Array(await p.imageFile.arrayBuffer())),type:p.imageFile.type,width:p.width,height:p.height};},Array.from(webp));assert.deepEqual(Buffer.from(r.bytes),webp);assert.equal(r.type,'image/webp');assert.deepEqual([r.width,r.height],[80,40]);});
});
test('native dialog traps keyboard focus, restores trigger focus and handles external close',()=>fixture(async page=>{
 await page.locator('#return-focus').focus();await start(page);assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')?.className),'image-markup-dialog');
 for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('dialog'))),true);}
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>markupTask),null);assert.equal(await page.evaluate(()=>document.activeElement?.id),'return-focus');
 await start(page);await page.evaluate(()=>document.querySelector('.image-markup-dialog').close());assert.equal(await page.evaluate(()=>markupTask),null);assert.equal(await page.locator('.image-markup-dialog').count(),0);
}));
test('pointer cancellation discards unfinished stroke and local resolver opens without network',()=>fixture(async page=>{
 await page.evaluate(()=>{window.resolveCount=0;window.markupTask=WandouImageMarkup.open({imageUrl:'wandou-media://synthetic',resolve:async(source,{signal})=>{resolveCount++;if(signal.aborted)throw new Error('unexpected abort');return toBlob(makeImage());}})});await page.locator('.image-markup-dialog').waitFor();
 const rect=await page.locator('.image-markup-overlay').boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.locator('.image-markup-overlay').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();assert.equal(await page.locator('[data-markup-apply]').isDisabled(),true);assert.equal(await page.evaluate(()=>resolveCount),1);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>markupTask),null);
}));
