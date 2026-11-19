const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require(path.join(path.resolve(__dirname,'../../../..'),'desktop-client/node_modules/playwright'));
for(const deleted of ['generator','pending','original'])test(`regeneration preparation cancels without API dispatch when ${deleted} is deleted`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
  await page.evaluate(()=>{
   apiKeyInput.value='synthetic-key-never-transmitted';nodes=[];links=[];nodeId=1;window.reviewCalls=0;
   const c=document.createElement('canvas');c.width=64;c.height=64;window.reviewPng=c.toDataURL();
   window.reviewSource=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'review only',ratio:'1:1',resolution:'1K',count:1,_deferRender:true});
   window.reviewOriginal=createNode('result',500,0,{model:reviewSource.model,fullUrl:reviewPng,mediaUrl:reviewPng,mediaType:'image',width:64,height:64,_deferRender:true});
   links.push({from:reviewSource.id,to:reviewOriginal.id});render({skipSave:true});
   ensureReferenceDimensions=()=>new Promise(resolve=>{window.reviewPrepare=resolve});
   callApi=async()=>{reviewCalls++;throw new Error('HTTP 403: denied')};
   window.reviewTask=regenerateResultNode(reviewOriginal.id);
  });
  await page.waitForFunction(()=>typeof reviewPrepare==='function');
  const before=await page.evaluate(deleted=>{
   const pending=nodes.find(n=>n.pending);deleteNode(deleted==='generator'?reviewSource.id:deleted==='original'?reviewOriginal.id:pending.id);
   return{calls:reviewCalls,pending:!!pending};
  },deleted);
  assert.equal(before.calls,0);assert.equal(before.pending,true);
  await page.evaluate(async()=>{reviewPrepare([]);await reviewTask});
  if(deleted==='original'){
   // The regeneration task does not own the deleted-result archive promise.
   // Require durable original preservation before asserting that all work ended.
   await page.waitForFunction(()=>deletedResultArchiveJobs.size===0);
   const archived=await page.evaluate(async()=>{
    const matches=deletedResults.filter(n=>n.originalId===reviewOriginal.id),entry=matches[0];
    return{count:matches.length,version:entry?.archiveVersion,originalPresent:nodes.includes(reviewOriginal),
     idPresent:nodes.some(n=>n.id===reviewOriginal.id),full:await getLocalMedia(entry?.fullUrl),original:reviewPng,
     width:entry?.width,height:entry?.height,calls:reviewCalls};
   });
   const digest=data=>crypto.createHash('sha256').update(Buffer.from(data.split(',')[1],'base64')).digest('hex');
   assert.equal(archived.count,1);assert.equal(archived.version,2);assert.equal(archived.originalPresent,false);
   assert.equal(archived.idPresent,false);assert.equal(digest(archived.full),digest(archived.original));
   assert.equal(archived.width,64);assert.equal(archived.height,64);assert.equal(archived.calls,0);
  }
  const after=await page.evaluate(()=>({calls:reviewCalls,busy:wandouHasActiveTasks(),pending:nodes.filter(n=>n.pending).length}));
  assert.deepEqual(after,{calls:0,busy:false,pending:0});
 }finally{await browser.close()}
});
