const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const repository=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(repository,'desktop-client/node_modules/playwright'));
function samples(){
 const bytes=Buffer.alloc(54+300*100);bytes.write('BM');bytes.writeUInt32LE(bytes.length,2);bytes.writeUInt32LE(54,10);bytes.writeUInt32LE(40,14);bytes.writeInt32LE(100,18);bytes.writeInt32LE(100,22);bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);
 const first='data:image/bmp;base64,'+bytes.toString('base64'),stride=Math.floor(first.length/4096);
 let offset=121;while(offset%stride===0)offset++;
 const second=first.slice(0,offset)+(first[offset]==='A'?'B':'A')+first.slice(offset+1);
 const legacy=value=>{let hash=0;for(let i=0;i<value.length;i+=stride)hash=((hash<<5)-hash+value.charCodeAt(i))|0;return`${Math.abs(hash).toString(36)}-${value.length}`};
 assert.equal(legacy(first),legacy(second));return{first,second,legacyId:legacy(first)};
}
test('actual browser saves two formerly colliding BMPs, survives reload, and reads legacy/history refs',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  await page.route(/^https?:/,route=>route.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href+'?workspace=hash-regression');
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const data=samples();
  const before=await page.evaluate(async data=>{
   const a=await putLocalMedia(data.first),b=await putLocalMedia(data.second);
   const history=cloneCompactHistoryValue({references:[{url:data.first},{url:data.second}]},new Map());
   const db=await openLocalMediaDb();await new Promise((resolve,reject)=>{const tx=db.transaction(localMediaStoreName,'readwrite');tx.objectStore(localMediaStoreName).put({id:data.legacyId,value:data.first,savedAt:1});tx.oncomplete=resolve;tx.onerror=reject});
   const dimensions=await Promise.all([getImageDimensions(data.first),getImageDimensions(data.second)]);
   return{a,b,history,dimensions,readA:await getLocalMedia(a),readB:await getLocalMedia(b)};
  },data);
  assert.notEqual(before.a,before.b);assert.match(before.a,/^indexed-media:sha256-[a-f0-9]{64}$/);
  assert.equal(before.readA,data.first);assert.equal(before.readB,data.second);
  assert.deepEqual(before.dimensions,[{width:100,height:100},{width:100,height:100}]);
  assert.deepEqual(before.history.references,[{url:before.a},{url:before.b}]);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const after=await page.evaluate(async({a,b,legacyId})=>({a:await getLocalMedia(a),b:await getLocalMedia(b),legacy:await getLocalMedia('indexed-media:'+legacyId)}),{...before,legacyId:data.legacyId});
  assert.equal(after.a,data.first);assert.equal(after.b,data.second);assert.equal(after.legacy,data.first);
  // A failed disk write must keep history's original available for undo, never a dangling ID.
  const failed=await page.evaluate(async()=>{
   persistedLocalMediaIds.clear();const value='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
   window.wandouShell={writeCanvasMedia:async()=>({success:false,error:'synthetic disk full'}),hasCanvasMedia:async()=>({exists:false}),readCanvasMedia:async()=>({success:false})};
   const ref=queueLargeMediaPersist(value);await new Promise(resolve=>setTimeout(resolve,80));
   return{ref,value,resolved:await getLocalMedia(ref),retained:window.WandouMediaUrls.historyValue(ref.slice('indexed-media:'.length))};
  });
  assert.match(failed.ref,/^indexed-media:sha256-/);assert.equal(failed.value,failed.resolved);assert.equal(failed.retained,failed.value);
  await context.close();
 }finally{await browser.close()}
});
