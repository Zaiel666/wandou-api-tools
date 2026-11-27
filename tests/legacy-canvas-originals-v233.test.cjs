'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="red"/></svg>');
test('compatibility canvas exports original bytes and never upgrades a preview to an original',async()=>{
 const sharp=require('../desktop-client/node_modules/sharp'),raw=Buffer.alloc(4*3*2*4,255);raw[4*3*4]=20;
 const gif=await sharp(raw,{raw:{width:4,height:6,pageHeight:3,channels:4}}).gif({loop:0,delay:[80,120]}).toBuffer();
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(path.join(app,'ai-node-canvas.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async ({gif,svg})=>{
   const exports=[],toasts=[];window.wandouShell={saveFileAs:async(filename,bytes,mime)=>{exports.push({filename,mime,bytes:Array.from(bytes)});return {success:true,filename}}};
   showToast=(message)=>toasts.push(String(message));
   const make=(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,w,h);return c.toDataURL('image/png')};
   const full=make(7,5,'red'),preview=make(2,2,'blue'),gifUrl='data:image/gif;base64,'+gif,svgUrl='data:image/svg+xml;base64,'+svg;
   const base={type:'result',mediaType:'image',title:'test',width:7,height:5};
   await downloadNodeMedia({...base,fullUrl:full,mediaUrl:preview,previewUrl:preview});
   const first=exports[0],bitmap=await createImageBitmap(new Blob([new Uint8Array(first.bytes)],{type:first.mime})),dimensions={width:bitmap.width,height:bitmap.height};bitmap.close();
   const count=exports.length;await downloadNodeMedia({...base,mediaUrl:preview,previewUrl:preview});const previewDenied=exports.length===count;
   await downloadNodeMedia({...base,mediaUrl:preview,previewUrl:'',width:7,height:5});const mismatchDenied=exports.length===count;
   await downloadNodeMedia({...base,deletedAt:1,mediaUrl:preview,previewUrl:preview});const deletedDenied=exports.length===count;
   await downloadNodeMedia({...base,fullUrl:gifUrl,mediaUrl:preview,previewUrl:preview,outputFormat:'gif'});
   await downloadNodeMedia({...base,fullUrl:svgUrl,mediaUrl:preview,previewUrl:preview,outputFormat:'svg'});
   // Older records may retain only a separate media URL; verify its real
   // format and dimensions rather than treating the preview as an original.
   await downloadNodeMedia({...base,mediaUrl:gifUrl,previewUrl:preview,width:4,height:3,outputFormat:'gif'});
   await downloadNodeMedia({...base,mediaUrl:svgUrl,previewUrl:preview,width:4,height:3,outputFormat:'svg'});
   return {exports,dimensions,previewDenied,mismatchDenied,deletedDenied,toasts};
  },{gif:gif.toString('base64'),svg:svg.toString('base64')});
  assert.deepEqual(result.dimensions,{width:7,height:5});assert.equal(result.previewDenied,true);assert.equal(result.mismatchDenied,true);assert.equal(result.deletedDenied,true);
  assert.equal(result.exports.length,5,JSON.stringify({files:result.exports.map(x=>x.filename),toasts:result.toasts}));assert.match(result.exports[1].filename,/\.gif$/);assert.equal(result.exports[1].mime,'image/gif');assert.deepEqual(Buffer.from(result.exports[1].bytes),gif);
  assert.match(result.exports[2].filename,/\.svg$/);assert.equal(result.exports[2].mime,'image/svg+xml');assert.deepEqual(Buffer.from(result.exports[2].bytes),svg);
  assert.deepEqual(Buffer.from(result.exports[3].bytes),gif);assert.deepEqual(Buffer.from(result.exports[4].bytes),svg);
  assert.ok(result.toasts.some(t=>t.includes('预览')));
 }finally{await browser.close()}
});
