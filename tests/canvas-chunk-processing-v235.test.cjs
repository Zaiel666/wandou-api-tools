'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright'),sharp=require('../desktop-client/node_modules/sharp');
test('chunked hashing matches independent SHA256 for large ASCII, Unicode fallback, concurrency and missing encodeInto',{timeout:45000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const values=['data:image/png;base64,'+'A'.repeat(1048576-22),'data:image/png;base64,'+'B'.repeat(1572869),'data:image/png;base64,'+'C'.repeat(1048580)+'图😀'];
  const expected=values.map(value=>'sha256-'+crypto.createHash('sha256').update(value).digest('hex'));
  const got=await page.evaluate(async values=>{const results=[];for(const value of values){WandouMediaHash.clear();results.push(await WandouMediaHash.idAsync(value));}WandouMediaHash.clear();const concurrent=await Promise.all([WandouMediaHash.idAsync(values[1]),WandouMediaHash.idAsync(values[1])]);WandouMediaHash.clear();const old=TextEncoder.prototype.encodeInto;let fallback;try{TextEncoder.prototype.encodeInto=undefined;fallback=await WandouMediaHash.idAsync(values[1]);}finally{TextEncoder.prototype.encodeInto=old;}return{results,concurrent,fallback};},values);
  assert.deepEqual(got.results,expected);assert.deepEqual(got.concurrent,[expected[1],expected[1]]);assert.equal(got.fallback,expected[1]);await context.close();
 }finally{await browser.close()}
});
test('chunked archive image conversion preserves exact bytes and falls back for noncanonical input',{timeout:45000},async()=>{
 const raw=Buffer.alloc(900*600*3);let x=0x17263849;for(let i=0;i<raw.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;raw[i]=x&255;}const png=await sharp(raw,{raw:{width:900,height:600,channels:3}}).png().toBuffer();assert.ok(png.length>1024*1024);const url='data:image/png;base64,'+png.toString('base64'),expected=crypto.createHash('sha256').update(png).digest('hex');
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  const context=await browser.newContext(),page=await context.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const result=await page.evaluate(async url=>{const blob=await verifiedDeletedMediaBlob(url),hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const spaced=url.slice(0,1000)+'\n'+url.slice(1000);const fallback=await verifiedDeletedMediaBlob(spaced);const fallbackHash=await crypto.subtle.digest('SHA-256',await fallback.arrayBuffer());const hex=buf=>Array.from(new Uint8Array(buf),n=>n.toString(16).padStart(2,'0')).join('');return{size:blob.size,type:blob.type,hash:hex(hash),fallbackHash:hex(fallbackHash)};},url);
  assert.equal(result.size,png.length);assert.equal(result.type,'image/png');assert.equal(result.hash,expected);assert.equal(result.fallbackHash,expected);await context.close();
 }finally{await browser.close()}
});
