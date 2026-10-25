const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const source=fs.readFileSync(path.join(app,'asset-state-reader.js'),'utf8');
let browser,server,url;
test.before(async()=>{
 server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><meta charset="utf-8"><title>Isolated asset state test</title>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve))});
async function fixture(t){const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();await page.route(/^https?:/,route=>route.request().url().startsWith(url)?route.continue():route.abort());await page.goto(url);await page.addScriptTag({content:source});return page;}

test('compact pointers discover desktop-only projects and preserve original vs preview references',async t=>{
 const page=await fixture(t);
 const result=await page.evaluate(async()=>{
  localStorage.setItem('aiCanvasStateV1:f:p',JSON.stringify({storageVersion:2,external:true,folderId:'f',projectId:'p',nodeCount:1,savedAt:30}));
  window.calls=[];window.wandouShell={readCanvasBackups:async payload=>{calls.push(payload);return{success:true,projectStates:[{projectId:'p',states:[{savedAt:40,projectName:'Durable project',nodes:[{id:'original',type:'result',mediaType:'image',fullUrl:'indexed-media:original',previewUrl:'indexed-media:preview'}]}]}]}}};
  return{states:await WandouAssetStates.read([]),calls};
 });
 assert.deepEqual(result.calls,[{folderId:'f',allProjects:true}]);assert.equal(result.states.length,1);
 assert.equal(result.states[0].key,'aiCanvasStateV1:f:p');assert.equal(result.states[0].state.projectName,'Durable project');
 assert.equal(result.states[0].state.nodes[0].fullUrl,'indexed-media:original');assert.equal(result.states[0].state.nodes[0].previewUrl,'indexed-media:preview');
});

test('existing IndexedDB reads only canonical canvas-state rows, never media or session history',async t=>{
 const page=await fixture(t);
 const result=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-node-canvas-media-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('canvas-state',{keyPath:'id'});r.result.createObjectStore('media',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['canvas-state','media'],'readwrite');const store=tx.objectStore('canvas-state');
   for(let i=0;i<12;i++)store.put({id:`aiCanvasStateV1:f:p${i}`,state:{folderId:'f',projectId:`p${i}`,savedAt:20,nodes:[{id:`node${i}`,fullUrl:`indexed-media:full${i}`,mediaType:'image',type:'result'}]}});
   store.put({id:'aiCanvasStateV1:f:p0:session-old',state:{folderId:'f',projectId:'p0',savedAt:999,nodes:[{id:'historical'}]}});
   store.put({id:'aiCanvasStateV1:f',state:{folderId:'f',projectId:'p0',savedAt:10,nodes:[{id:'alias-old'}]}});
   tx.objectStore('media').put({id:'unrelated',value:'must not read'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  window.storesRead=[];const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,...args){storesRead.push(stores);if(stores==='media'||Array.isArray(stores)&&stores.includes('media'))throw Error('Unexpected media read');return original.call(this,stores,...args)};
  return{states:await WandouAssetStates.read([{id:'f'}]),stores:storesRead};
 });
 assert.equal(result.states.length,12);assert.equal(result.states.find(row=>row.state.projectId==='p0').state.nodes[0].id,'node0');
 assert.ok(result.stores.length>=2);assert.ok(result.stores.every(store=>store==='canvas-state'));
});

test('latest explicit empty reset wins even when resetAt clock is older; accidental empty snapshots do not hide assets',async t=>{
 const page=await fixture(t);
 const result=await page.evaluate(async()=>{
  for(const projectId of ['reset','accidental'])localStorage.setItem(`aiCanvasStateV1:f:${projectId}`,JSON.stringify({folderId:'f',projectId,savedAt:200,nodes:[{id:'old-image',type:'result',mediaType:'image',fullUrl:'indexed-media:old'}]}));
  window.wandouShell={readCanvasBackups:async()=>({success:true,projectStates:[
   {projectId:'reset',states:[{savedAt:300,intentionalResetAt:5,nodes:[]}]},
   {projectId:'accidental',states:[{savedAt:400,nodes:[]}]}
  ]})};return WandouAssetStates.read([{id:'f'}]);
 });
 assert.equal(result.find(row=>row.state.projectId==='reset').state.nodes.length,0);
 assert.equal(result.find(row=>row.state.projectId==='accidental').state.nodes[0].id,'old-image');
});

test('opening assets does not create a missing database',async t=>{
 const page=await fixture(t);
 const result=await page.evaluate(async()=>({before:await indexedDB.databases(),states:await WandouAssetStates.read([]),after:await indexedDB.databases()}));
 assert.deepEqual(result.before,[]);assert.deepEqual(result.states,[]);assert.deepEqual(result.after,[]);
});

test('a failed desktop folder preserves local assets and does not prevent later folders from loading',async t=>{
 const page=await fixture(t);
 const result=await page.evaluate(async()=>{
  localStorage.setItem('aiCanvasStateV1:failed:p',JSON.stringify({folderId:'failed',projectId:'p',savedAt:20,nodes:[{id:'local-good',type:'result',mediaType:'image',fullUrl:'indexed-media:local-good'}]}));
  window.wandouShell={readCanvasBackups:async({folderId})=>{if(folderId==='failed')throw Error('isolated read failure');return{success:true,projectStates:[{projectId:'p',states:[{savedAt:30,nodes:[{id:'disk-good',type:'result',mediaType:'image',fullUrl:'indexed-media:disk-good'}]}]}]}}};
  return WandouAssetStates.read([{id:'failed'},{id:'healthy'}]);
 });
 assert.deepEqual(result.map(row=>row.state.nodes[0].id).sort(),['disk-good','local-good']);
});

test('account-scoped storage facade never reads unscoped project records',async t=>{
 const page=await fixture(t);
 await page.evaluate(()=>localStorage.setItem('aiCanvasStateV1:private:p',JSON.stringify({folderId:'private',projectId:'p',nodes:[{id:'must-not-leak'}]})));
 await page.addScriptTag({content:`const scopedEntries=new Map([['aiCanvasStateV1:scoped:p',JSON.stringify({folderId:'scoped',projectId:'p',savedAt:3,nodes:[{id:'scoped-image'}]})]]);const canvasTestStorage={get length(){return scopedEntries.size},key:i=>[...scopedEntries.keys()][i]||null,getItem:key=>scopedEntries.get(key)||null};`});
 const states=await page.evaluate(()=>WandouAssetStates.read([]));assert.equal(states.length,1);assert.equal(states[0].state.folderId,'scoped');assert.equal(states[0].state.nodes[0].id,'scoped-image');
});

test('blocked IndexedDB and an accidental latest empty desktop snapshot still allow older successful durable assets',async t=>{
 const page=await fixture(t);
 const result=await page.evaluate(async()=>{
  indexedDB.open=()=>{throw new DOMException('isolated blocked DB','SecurityError')};
  window.calls=[];window.wandouShell={readCanvasBackups:async payload=>{calls.push(payload);return payload.allProjects?{success:true,projectStates:[{projectId:'p',states:[{savedAt:300,nodes:[]}]}]}:{success:true,states:[{savedAt:300,nodes:[]},{savedAt:200,nodes:[{id:'last-good',type:'result',mediaType:'image',fullUrl:'indexed-media:original'}]}]}}};
  return{states:await WandouAssetStates.read([{id:'f'}]),calls};
 });
 assert.equal(result.states[0].state.nodes[0].id,'last-good');assert.deepEqual(result.calls,[{folderId:'f',allProjects:true},{folderId:'f',projectId:'p'}]);
});
