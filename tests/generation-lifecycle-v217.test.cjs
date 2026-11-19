const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const workspace=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(workspace,'desktop-client/node_modules/playwright'));
const source=path.resolve(__dirname,'../app/ai-node-canvas-test.html');

async function fixture(count,fn){
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(source).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
  await page.evaluate(count=>{
   apiKeyInput.value='synthetic-key-never-sent';nodes=[];links=[];nodeId=1;
   window.calls=[];window.tasks=[];
   const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(0,0,64,64);window.png=c.toDataURL('image/png');
   callApi=(node,signal)=>new Promise((resolve,reject)=>calls.push({node,signal,resolve,reject}));
   window.generator=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'synthetic only',ratio:'1:1',resolution:'1K',count,_deferRender:true});
   render({skipSave:true});centerOnNode(generator.id);
  },count);
  await fn(page);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}
const failAll=page=>page.evaluate(()=>calls.forEach(c=>c.reject(new Error('HTTP 403: {"error":{"message":"预扣费额度失败, 用户剩余额度: ¥0.009396, 需要预扣费额度: ¥0.090000"}}'))));

test('double submission claims node before asynchronous preparation and releases after failure',async()=>fixture(1,async page=>{
 await page.evaluate(()=>{tasks.push(generateFromNode(generator.id));tasks.push(generateFromNode(generator.id));});
 await page.waitForFunction(()=>calls.length===1);
 assert.equal(await page.locator('[data-id="node-1"] [data-generate]').isDisabled(),true);
 assert.equal(await page.evaluate(()=>nodes.filter(n=>n.type==='result').length),1);
 await failAll(page);await page.evaluate(()=>Promise.all(tasks));
 const state=await page.evaluate(()=>({status:generator.status,busy:wandouHasActiveTasks(),result:nodes.find(n=>n.type==='result').status}));
 assert.match(state.status,/均未生成成功/);assert.doesNotMatch(state.status,/其余图片已/);assert.equal(state.busy,false);
 assert.match(state.result,/余额不足/);assert.match(state.result,/0.009396/);assert.doesNotMatch(state.result,/HTTP|request id|new_api_error/);
 assert.equal(await page.locator('[data-id="node-1"] [data-generate]').isDisabled(),false);
 await page.evaluate(()=>{calls=[];tasks=[generateFromNode(generator.id)];});await page.waitForFunction(()=>calls.length===1);
 await failAll(page);await page.evaluate(()=>Promise.all(tasks));
}));

test('switch/create/import/delete/reset/undo are blocked during work; source result survives',async()=>fixture(1,async page=>{
 await page.evaluate(()=>{window.originalProject=activeProjectId;projects.push({id:'test-b',name:'B'});tasks.push(generateFromNode(generator.id));});
 await page.waitForFunction(()=>calls.length===1);
 const guarded=await page.evaluate(async()=>{
  const originalCount=projects.length;await switchProject('test-b');await createProject();
  await importProjectFile(new File([JSON.stringify({format:'wandou-node-project',project:{name:'Imported'},canvas:{nodes:[],links:[]}})],'fixture.json'));
  await deleteProject(originalProject);clearCanvas();await undoCanvas();await redoCanvas();
  return {sameProject:activeProjectId===originalProject,count:projects.length,originalCount,generatorStillPresent:nodes.includes(generator)};
 });
 assert.equal(guarded.sameProject,true);assert.equal(guarded.count,guarded.originalCount);assert.equal(guarded.generatorStillPresent,true);
 await page.evaluate(()=>calls[0].resolve({url:png,mediaType:'image',fromApi:true}));await page.evaluate(()=>Promise.all(tasks));
 assert.equal(await page.evaluate(()=>nodes.some(n=>n.type==='result'&&!!n.fullUrl)),true);
 await page.evaluate(()=>switchProject('test-b'));assert.equal(await page.evaluate(()=>activeProjectId),'test-b');
 await page.evaluate(()=>switchProject(originalProject));assert.equal(await page.evaluate(()=>nodes.some(n=>n.type==='result'&&!!n.fullUrl)),true);
}));

test('deleting a generator aborts sent requests and never dispatches remaining six',async()=>fixture(9,async page=>{
 await page.evaluate(()=>tasks.push(generateFromNode(generator.id)));await page.waitForFunction(()=>calls.length===3);
 await page.evaluate(()=>deleteNode(generator.id));assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.signal.aborted)),[true,true,true]);
 // A provider response can arrive despite cancellation; it must not revive deleted work.
 await page.evaluate(()=>calls.forEach(c=>c.resolve({url:png,mediaType:'image',fromApi:true})));await page.evaluate(()=>Promise.all(tasks));
 const state=await page.evaluate(()=>({calls:calls.length,busy:wandouHasActiveTasks(),pending:nodes.filter(n=>n.pending).length,images:nodes.filter(n=>n.fullUrl).length}));
 assert.deepEqual(state,{calls:3,busy:false,pending:0,images:0});
}));

test('deleting a result does not let its late response overwrite a replacement with the same id',async()=>fixture(1,async page=>{
 await page.evaluate(()=>tasks.push(generateFromNode(generator.id)));await page.waitForFunction(()=>calls.length===1);
 await page.evaluate(()=>{const result=nodes.find(n=>n.type==='result');window.oldResultId=result.id;deleteNode(result.id);window.replacement={id:oldResultId,type:'result',x:0,y:400,status:'replacement'};nodes.push(replacement);});
 await page.evaluate(()=>calls[0].resolve({url:png,mediaType:'image',fromApi:true}));await page.evaluate(()=>Promise.all(tasks));
 assert.deepEqual(await page.evaluate(()=>({status:replacement.status,hasImage:!!replacement.fullUrl})),{status:'replacement',hasImage:false});
}));

test('close saves current state but cannot claim completion while generation is active',async()=>fixture(1,async page=>{
 await page.evaluate(()=>tasks.push(generateFromNode(generator.id)));await page.waitForFunction(()=>calls.length===1);
 const close=await page.evaluate(()=>wandouSaveBeforeClose());assert.equal(close.success,false);assert.equal(close.busy,true);assert.match(close.error,/等待任务完成/);
 const suspend=await page.evaluate(()=>wandouPrepareTabSuspend());assert.equal(suspend.safe,false);
 await failAll(page);await page.evaluate(()=>Promise.all(tasks));
 const idle=await page.evaluate(()=>wandouSaveBeforeClose());assert.equal(idle.success,true);assert.equal(idle.busy,false);
}));

test('error categories distinguish credit failures, generic forbidden, invalid key and rate limits',async()=>fixture(1,async page=>{
 const messages=await page.evaluate(()=>['HTTP 403: forbidden','HTTP 401: invalid api key','HTTP 429: rate limit','HTTP 403: {"error":{"message":"insufficient_quota"}}'].map(x=>friendlyApiError(new Error(x))));
 assert.match(messages[0],/权限|拒绝/);assert.doesNotMatch(messages[0],/余额/);assert.match(messages[1],/密钥/);assert.match(messages[2],/限流/);assert.match(messages[3],/余额/);
}));

test('regeneration claims preparation before await and blocks duplicate, project switch and close',async()=>fixture(1,async page=>{
 await page.evaluate(()=>{
  window.originalProject=activeProjectId;
  projects.push({id:'regeneration-b',name:'B'});
  window.original=createNode('result',500,0,{model:generator.model,fullUrl:png,mediaUrl:png,mediaType:'image',width:64,height:64,_deferRender:true});
  links.push({from:generator.id,to:original.id});
  ensureReferenceDimensions=()=>new Promise(resolve=>{window.finishPreparation=resolve;});
  tasks.push(regenerateResultNode(original.id));
  tasks.push(regenerateResultNode(original.id));
 });
 await page.waitForFunction(()=>typeof finishPreparation==='function');
 const preparing=await page.evaluate(async()=>{
  await switchProject('regeneration-b');
  const close=await wandouSaveBeforeClose();
  return {calls:calls.length,pending:nodes.filter(n=>n.pending).length,sourceProject:activeProjectId===originalProject,busy:close.busy,success:close.success};
 });
 assert.deepEqual(preparing,{calls:0,pending:1,sourceProject:true,busy:true,success:false});
 await page.evaluate(()=>finishPreparation());await page.waitForFunction(()=>calls.length===1);
 await failAll(page);await page.evaluate(()=>Promise.all(tasks));
 assert.equal(await page.evaluate(()=>wandouHasActiveTasks()),false);
 assert.equal(await page.evaluate(()=>original.regenerating),false);
 await page.evaluate(()=>{ensureReferenceDimensions=async()=>{};calls=[];tasks=[regenerateResultNode(original.id)];});
 await page.waitForFunction(()=>calls.length===1);
 await page.evaluate(()=>calls[0].resolve({url:png,mediaType:'image',fromApi:true}));await page.evaluate(()=>Promise.all(tasks));
 assert.deepEqual(await page.evaluate(()=>({originalPreserved:original.fullUrl===png,successfulNewResults:nodes.filter(n=>n.regeneratedFromId===original.id&&!!n.fullUrl).length,busy:wandouHasActiveTasks()})),{originalPreserved:true,successfulNewResults:1,busy:false});
}));
