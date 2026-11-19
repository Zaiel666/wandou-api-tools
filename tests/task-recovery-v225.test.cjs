const wandouQaVersion=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../desktop-client/package.json'),'utf8')).version;
const nativeTest=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const workspace=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(workspace,'desktop-client/node_modules/playwright'));
const source=pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href;
const qa=path.resolve(__dirname,'../../qa'),scope=['image-task-ledger.js','canvas-task-recovery.js','canvas-task-actions.js','ai-node-canvas-test.html'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),hashes=()=>Object.fromEntries(scope.map(file=>[file,hash(fs.readFileSync(path.resolve(__dirname,'../app',file)))]));
const initialHashes=hashes(),startedAt=new Date().toISOString(),checks=[];let registered=0;
function test(name,fn){registered++;nativeTest(name,async t=>{try{await fn(t);checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.stack});throw error;}});}
nativeTest.after(()=>{const after=hashes(),runtimeUnchanged=JSON.stringify(initialHashes)===JSON.stringify(after);fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,'task-recovery-v225.json'),JSON.stringify({version:wandouQaVersion,success:registered===checks.length&&checks.every(c=>c.passed)&&runtimeUnchanged,startedAt,finishedAt:new Date().toISOString(),scopeHashes:initialHashes,scopeHashesAfter:after,runtimeUnchanged,checks,paidCalls:0,productionDataAccessed:false,externalRequests:0,testSha256:hash(fs.readFileSync(__filename))},null,2));assert.equal(runtimeUnchanged,true);});
async function fixture(fn){
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();let external=0;await context.route(/^https?:/,r=>{external++;return r.abort();});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(source);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);
 await configure(page);await page.evaluate(()=>{nodes=[];links=[];nodeId=1;window.generator=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'synthetic only',ratio:'1:1',resolution:'1K',count:1,_deferRender:true});render({skipSave:true});});
 await fn(page,context);assert.deepEqual(errors,[]);assert.equal(external,0);
 }finally{await browser.close();}
}
async function configure(page){await page.evaluate(()=>{
 window.syntheticProfile={id:'channel1',provider:'gateway',label:'合成渠道',url:'https://zexitongxue.com/v1',key:'synthetic-test-key-never-sent'};
 apiProfileForModel=()=>({...syntheticProfile});apiKeyInput.value=syntheticProfile.key;apiUrlInput.value=syntheticProfile.url;
 const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(0,0,64,64);window.syntheticImage=c.toDataURL();window.calls=[];
 window.mockMode='poll-error';
 fetchMaybeProxied=async(url,options={})=>{calls.push({url,method:options.method||'GET',authorization:options.headers?.Authorization||''});
  if(options.method==='POST')return new Response(JSON.stringify({task_id:'aiimg_synthetic_'+calls.length,status:'queued'}),{status:200});
  if(mockMode==='poll-error')throw new Error('synthetic query unavailable');
  if(mockMode==='hold')return new Promise((resolve,reject)=>{window.heldQuery={url,resolve,reject,signal:options.signal};options.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});});
  return new Response(JSON.stringify({status:'completed',result_url:syntheticImage}),{status:200});
 };
 });}

test('accepted async task persists its ID and poll failure never resubmits POST',async()=>fixture(async page=>{
 await page.evaluate(()=>{window.task=generateFromNode(generator.id);});await page.evaluate(()=>task);
 const result=await page.evaluate(async()=>{const node=nodes.find(n=>n.type==='result');return{calls,task:node.imageTask,stored:await imageTaskLedger.get(node.imageTask.id),busy:wandouHasActiveTasks(),status:node.status};});
 assert.equal(result.calls.filter(c=>c.method==='POST').length,1);assert.equal(result.calls.filter(c=>c.method==='GET').length,1);assert.equal(result.task.taskId,'aiimg_synthetic_1');assert.equal(result.stored.taskId,result.task.taskId);assert.equal(result.busy,false);assert.match(result.status,/继续查询原任务/);
 const serialized=JSON.stringify(result.stored);assert.doesNotMatch(serialized,/synthetic-test-key|Authorization|Bearer|synthetic only/);
 assert.equal(await page.locator('[data-resume-image-task]').count(),1);assert.equal(await page.locator('[data-retry-result]').count(),0);
}));

test('reload restores task without network and explicit recovery uses only original GET',async()=>fixture(async page=>{
 await page.evaluate(()=>{window.task=generateFromNode(generator.id);});await page.evaluate(()=>task);
 const before=await page.evaluate(()=>({id:nodes.find(n=>n.type==='result').id,taskId:nodes.find(n=>n.type==='result').imageTask.taskId}));
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await configure(page);
 assert.equal(await page.evaluate(()=>calls.length),0);
 await page.evaluate(()=>{mockMode='complete';const id=nodes.find(n=>n.type==='result').id;window.recovery=resumeTrackedImageTask(id);window.duplicate=resumeTrackedImageTask(id);});await page.evaluate(()=>Promise.all([recovery,duplicate]));
 const after=await page.evaluate(async()=>{const node=nodes.find(n=>n.type==='result');return{id:node.id,calls,state:node.imageTask.state,url:!!node.fullUrl,pending:node.pending,stored:await imageTaskLedger.get(node.imageTask.id),busy:wandouHasActiveTasks()};});
 assert.equal(after.id,before.id);assert.equal(after.calls.filter(c=>c.method==='POST').length,0);assert.equal(after.calls.length,1);assert.match(after.calls[0].url,/\/v1\/images\/tasks\/aiimg_synthetic_1$/);assert.equal(after.url,true);assert.equal(after.state,'completed');assert.equal(after.stored.state,'completed');assert.equal(after.busy,false);assert.equal(after.pending,false);
}));

test('same-origin changed channel path and channel identity cannot receive recovery key',async()=>fixture(async page=>{
 await page.evaluate(()=>generateFromNode(generator.id));
 for(const change of [{url:'https://zexitongxue.com/another-tenant'},{id:'channel2'},{provider:'openai'},{key:'another-synthetic-account-key'}]){
  await configure(page);await page.evaluate(change=>{Object.assign(syntheticProfile,change);mockMode='complete';},change);
  await page.evaluate(()=>resumeTrackedImageTask(nodes.find(n=>n.type==='result').id));assert.equal(await page.evaluate(()=>calls.length),0);
 }
}));

test('pre-submit project persistence failure blocks POST and leaves cancelled record',async()=>fixture(async page=>{
 await page.evaluate(()=>{saveCanvasState=async()=>false;});
 await page.evaluate(()=>generateFromNode(generator.id));
 const value=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');return{calls: calls.length,state:n.imageTask.state,stored:(await imageTaskLedger.get(n.imageTask.id)).state};});
 assert.equal(value.calls,0);assert.equal(value.state,'cancelled');assert.equal(value.stored,'cancelled');
}));

test('ACK persistence failure keeps received ID in project and never resubmits; reopen repairs ACK on explicit GET',async()=>fixture(async page=>{
 await page.evaluate(()=>{imageTaskLedger.acknowledge=async()=>{throw new Error('synthetic ACK persistence unavailable');};});
 await page.evaluate(()=>generateFromNode(generator.id));
 const value=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');return{calls:calls.length,id:n.imageTask.taskId,storedId:(await imageTaskLedger.get(n.imageTask.id)).taskId};});
 assert.equal(value.calls,1);assert.equal(value.id,'aiimg_synthetic_1');assert.equal(value.storedId,'');
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await configure(page);
 await page.evaluate(()=>{mockMode='complete';return resumeTrackedImageTask(nodes.find(n=>n.type==='result').id);});
 assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.method)),['GET']);assert.equal(await page.evaluate(()=>nodes.find(n=>n.type==='result').imageTask.state),'completed');
}));

test('duplicate generation clicks, close/update gate, and project actions while querying do not add requests',async()=>fixture(async page=>{
 await page.evaluate(()=>{mockMode='hold';window.first=generateFromNode(generator.id);window.second=generateFromNode(generator.id);});
 await page.waitForFunction(()=>Boolean(window.heldQuery));
 const before=await page.evaluate(()=>({project:activeProjectId,count:projects.length,results:nodes.filter(n=>n.type==='result').length}));
 const gates=await page.evaluate(async()=>{projects.push({id:'synthetic-other',name:'Other'});return{close:await wandouSaveBeforeClose(),switch:await switchProject('synthetic-other'),create:await createProject(),remove:await deleteProject(activeProjectId),active:activeProjectId,count:projects.length,calls:calls.map(c=>c.method)};});
 assert.equal(gates.close.success,false);assert.equal(gates.close.busy,true);assert.equal(gates.switch,false);assert.equal(gates.create,false);assert.equal(gates.remove,false);assert.equal(gates.active,before.project);assert.equal(gates.count,before.count+1);assert.equal(before.results,1);assert.deepEqual(gates.calls,['POST','GET']);
 await page.evaluate(async()=>{await stopTrackedImageTask(nodes.find(n=>n.type==='result').id);await Promise.all([first,second]);});
 const stopped=await page.evaluate(async()=>({busy:wandouHasActiveTasks(),close:await wandouSaveBeforeClose(),state:nodes.find(n=>n.type==='result').imageTask.state}));
 assert.equal(stopped.busy,false);assert.equal(stopped.close.success,true);assert.equal(stopped.state,'cancelled');
 await page.evaluate(()=>switchProject('synthetic-other'));assert.equal(await page.evaluate(()=>activeProjectId),'synthetic-other');
 assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.method)),['POST','GET']);
}));

test('reloading mid-query does not submit or poll automatically; previous owner expires before manual recovery',async()=>fixture(async page=>{
 await page.evaluate(()=>{mockMode='hold';window.first=generateFromNode(generator.id);});await page.waitForFunction(()=>Boolean(window.heldQuery));
 const old=await page.evaluate(()=>nodes.find(n=>n.type==='result').imageTask.taskId);
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await configure(page);
 const state=await page.evaluate(()=>({calls:calls.length,node:nodes.find(n=>n.type==='result'),busy:wandouHasActiveTasks()}));
 assert.equal(state.calls,0);assert.equal(state.node.imageTask.taskId,old);assert.equal(state.node.pending,false);assert.equal(state.busy,false);
 await page.evaluate(()=>resumeTrackedImageTask(nodes.find(n=>n.type==='result').id));
 assert.equal(await page.evaluate(()=>calls.length),0);assert.match(await page.evaluate(()=>nodes.find(n=>n.type==='result').status),/其他窗口|查询|租约/);
}));

test('deleting a result mid-query cancels tracking and a late response cannot recreate it',async()=>fixture(async page=>{
 await page.evaluate(()=>{mockMode='hold';window.first=generateFromNode(generator.id);});await page.waitForFunction(()=>Boolean(window.heldQuery));
 const removed=await page.evaluate(()=>{const n=nodes.find(n=>n.type==='result');const result={id:n.id,task:n.imageTask.id};deleteNode(n.id);return result;});
 await page.evaluate(()=>first);
 const result=await page.evaluate(async removed=>({exists:nodes.some(n=>n.id===removed.id),stored:(await imageTaskLedger.get(removed.task)).state,calls:calls.map(c=>c.method),busy:wandouHasActiveTasks()}),removed);
 assert.equal(result.exists,false);assert.equal(result.stored,'cancelled');assert.equal(result.busy,false);assert.deepEqual(result.calls,['POST','GET']);
}));

test('batch source deletion stops unsubmitted items and preserves already acknowledged task records',async()=>fixture(async page=>{
 await page.evaluate(()=>{generator.count=5;mockMode='hold';window.first=generateFromNode(generator.id);});await page.waitForFunction(()=>calls.filter(c=>c.method==='GET').length===3);
 await page.evaluate(()=>deleteNode(generator.id));await page.evaluate(()=>first);
 const result=await page.evaluate(async()=>({calls:calls.map(c=>c.method),states:await Promise.all(nodes.filter(n=>n.imageTask).map(async n=>(await imageTaskLedger.get(n.imageTask.id)).state)),busy:wandouHasActiveTasks()}));
 assert.equal(result.calls.filter(c=>c==='POST').length,3);assert.equal(result.calls.filter(c=>c==='GET').length,3);assert.ok(result.states.every(s=>s==='cancelled'));assert.equal(result.busy,false);
}));

test('terminal provider failure is retained without POST retry or misleading continue action',async()=>fixture(async page=>{
 await page.evaluate(()=>{const post=fetchMaybeProxied;fetchMaybeProxied=async(url,options={})=>options.method==='POST'?post(url,options):(calls.push({method:'GET'}),new Response(JSON.stringify({status:'expired',error:{message:'synthetic expired'}}),{status:200}));});
 await page.evaluate(()=>generateFromNode(generator.id));
 const result=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');return{state:n.imageTask.state,stored:(await imageTaskLedger.get(n.imageTask.id)).state,calls:calls.map(c=>c.method)};});
 assert.equal(result.state,'failed');assert.equal(result.stored,'failed');assert.deepEqual(result.calls,['POST','GET']);assert.equal(await page.locator('[data-resume-image-task]').count(),0);
}));

test('stopped tracking survives reopen and copied result identity cannot query another node task',async()=>fixture(async page=>{
 await page.evaluate(()=>generateFromNode(generator.id));
 const count=await page.evaluate(async()=>{calls=[];const n=nodes.find(n=>n.type==='result');const copy={...n,id:n.id+1000};nodes.push(copy);await resumeTrackedImageTask(copy.id);nodes=nodes.filter(item=>item!==copy);await stopTrackedImageTask(n.id);return calls.length;});assert.equal(count,0);
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&apiInitialConfigReady);await configure(page);await page.evaluate(()=>resumeTrackedImageTask(nodes.find(n=>n.type==='result').id));
 assert.equal(await page.evaluate(()=>calls.length),0);assert.equal(await page.evaluate(()=>nodes.find(n=>n.type==='result').imageTask.state),'cancelled');
}));

test('atomic two-instance lease rejects concurrent claims, stale owners and terminal transitions',async()=>fixture(async page=>{
 await page.evaluate(()=>generateFromNode(generator.id));
 const result=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result'),id=n.imageTask.id;let tick=Date.now();const a=WandouImageTaskLedger.create({now:()=>tick}),b=WandouImageTaskLedger.create({now:()=>tick});const claims=await Promise.allSettled([a.claim(id,'A'),b.claim(id,'B')]);const owner=claims[0].status==='fulfilled'?'A':'B';const old=owner==='A'?a:b,other=owner==='A'?b:a;tick+=31000;await other.claim(id,'C');const stale=await Promise.allSettled([old.renew(id,owner),old.state(id,'completed',owner)]);await other.state(id,'cancelled','C');const done=await old.state(id,'completed');await a.close();await b.close();return{claims:claims.map(x=>x.status),stale:stale.map(x=>x.status),done:done.state};});
 assert.equal(result.claims.filter(s=>s==='fulfilled').length,1);assert.deepEqual(result.stale,['rejected','rejected']);assert.equal(result.done,'cancelled');
}));

test('lost lease during held GET prevents late successful response from changing result',async()=>fixture(async page=>{
 await page.evaluate(()=>{mockMode='hold';window.first=generateFromNode(generator.id);});await page.waitForFunction(()=>Boolean(window.heldQuery));
 await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');const other=WandouImageTaskLedger.create({now:()=>Date.now()+31000});await other.claim(n.imageTask.id,'other-window');await other.close();heldQuery.resolve(new Response(JSON.stringify({status:'completed',result_url:syntheticImage}),{status:200}));});await page.evaluate(()=>first);
 const value=await page.evaluate(()=>({url:nodes.find(n=>n.type==='result').fullUrl,calls:calls.map(c=>c.method),busy:wandouHasActiveTasks(),leases:imageTaskLeases.size}));assert.ok(!value.url);assert.deepEqual(value.calls,['POST','GET']);assert.equal(value.busy,false);assert.equal(value.leases,0);
}));

test('long held GET renews its lease before another instance could take over',async()=>fixture(async page=>{
 await page.evaluate(()=>{mockMode='hold';window.first=generateFromNode(generator.id);});await page.waitForFunction(()=>imageTaskLeases.size===1&&window.heldQuery?.url.includes('/images/tasks/'));
 const initial=await page.evaluate(async()=>(await imageTaskLedger.get(nodes.find(n=>n.type==='result').imageTask.id)).leaseUntil);
 assert.ok(initial>Date.now());await page.waitForTimeout(11000);
 const renewed=await page.evaluate(async()=>(await imageTaskLedger.get(nodes.find(n=>n.type==='result').imageTask.id)).leaseUntil);assert.ok(renewed>initial+5000,JSON.stringify({initial,renewed}));
 const denied=await page.evaluate(async initial=>{const other=WandouImageTaskLedger.create({now:()=>initial+1000});try{await other.claim(nodes.find(n=>n.type==='result').imageTask.id,'other-window');return false;}catch{return true;}finally{await other.close();}},initial);assert.equal(denied,true);
 await page.evaluate(async()=>{await stopTrackedImageTask(nodes.find(n=>n.type==='result').id);await first;});assert.equal(await page.evaluate(()=>imageTaskLeases.size),0);
}));

test('resuming an ordinary image ignores newly edited source format and never creates another paid request',async()=>fixture(async page=>{
 await page.evaluate(()=>generateFromNode(generator.id));await page.evaluate(()=>{generator.imageOutputFormat='svg';generator.outputFormat='svg';generator.model='gpt-image-2.6-flare';generator.resolution='4K';calls=[];mockMode='complete';return resumeTrackedImageTask(nodes.find(n=>n.type==='result').id);});
 const value=await page.evaluate(()=>{const n=nodes.find(n=>n.type==='result');return{format:n.imageOutputFormat,state:n.imageTask.state,calls:calls.map(c=>c.method),url:n.fullUrl,requested:n.requestedResolution};});assert.equal(value.format,'png');assert.equal(value.state,'completed');assert.deepEqual(value.calls,['GET']);assert.ok(value.url);assert.equal(value.requested,'1K');
}));

test('transparent PNG output contract and alpha survive interrupted-query recovery after source options change',async()=>fixture(async page=>{
 await page.evaluate(()=>{generator.transparentBackground=true;generator.imageQuality='medium';generator.imageComplexity='low';const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(16,16,32,32);syntheticImage=c.toDataURL();return generateFromNode(generator.id);});
 const before=await page.evaluate(()=>nodes.find(n=>n.type==='result').imageTask.output);assert.equal(before.background,'transparent');assert.equal(before.quality,'medium');assert.equal(before.complexity,'low');
 await page.evaluate(()=>{generator.transparentBackground=false;generator.imageQuality='high';generator.imageComplexity='high';generator.imageOutputFormat='gif';generator.outputFormat='gif';calls=[];mockMode='complete';return resumeTrackedImageTask(nodes.find(n=>n.type==='result').id);});
 const result=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');return{format:n.imageOutputFormat,quality:n.imageQuality,complexity:n.imageComplexity,transparent:n.transparent,alpha:await imageHasTransparentPixels(await getLocalMedia(n.fullUrl)),source:await getLocalMedia(n.sourceUrl),original:syntheticImage,state:n.imageTask.state,contract:n.outputRequest,calls:calls.map(c=>c.method)};});
 assert.equal(result.format,'png');assert.equal(result.quality,'medium');assert.equal(result.complexity,'low');assert.equal(result.transparent,true);assert.equal(result.alpha,true);assert.equal(result.source,result.original);assert.equal(result.state,'completed');assert.equal(result.contract.size,before.size);assert.deepEqual(result.calls,['GET']);
}));

test('malformed task IDs, unsupported adapter and mismatched project identity never issue GET',async()=>fixture(async page=>{
 await page.evaluate(()=>generateFromNode(generator.id));
 const values=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result'),record={...n.imageTask};const outputs=[];for(const change of [{taskId:'../wrong/path'},{adapter:'unknown-provider-v1'},{projectId:'other-project'},{endpoint:'https://user:pass@zexitongxue.com/v1'}]){calls=[];n.imageTask={...record,...change};await resumeTrackedImageTask(n.id);outputs.push(calls.length);}n.imageTask=record;return outputs;});assert.deepEqual(values,[0,0,0,0]);
}));

test('blocked or timed-out IndexedDB open closes a late successful connection',async()=>{
 const ledger=require('../app/image-task-ledger.js');
 for(const mode of ['blocked','timeout']){let request,closed=0;const instance=ledger.create({indexedDB:{open(){request={};return request;}},openTimeoutMs:10});const promise=instance.get('synthetic-id');if(mode==='blocked')request.onblocked();await assert.rejects(promise);request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);}
});

for(const width of [1024,1440])for(const theme of ['light','dark'])test(`manual resume and stop controls work at ${width}px ${theme}`,async()=>fixture(async page=>{
 await page.setViewportSize({width,height:800});
 await page.evaluate(theme=>{document.body.classList.toggle('dark-theme',theme==='dark');document.documentElement.dataset.theme=theme;},theme);
 await page.evaluate(()=>generateFromNode(generator.id));
 await page.evaluate(()=>{const n=nodes.find(n=>n.type==='result');n.x=40;n.y=20;generator.x=-800;view={x:0,y:0,zoom:1};render({skipSave:true});applyCanvasTransform();});
 const button=page.locator('[data-resume-image-task]');await button.waitFor({state:'visible'});
 const qa=path.resolve(__dirname,'../../qa');fs.mkdirSync(qa,{recursive:true});await page.screenshot({path:path.join(qa,`task-recovery-${width}-${theme}.png`)});
 await page.evaluate(()=>{calls=[];mockMode='hold';});await button.click();await page.waitForFunction(()=>Boolean(window.heldQuery));
 assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.method)),['GET']);
 await page.locator('[data-stop-image-tracking]').click();await page.waitForFunction(()=>!wandouHasActiveTasks());
 assert.equal(await page.evaluate(()=>nodes.find(n=>n.type==='result').imageTask.state),'cancelled');assert.equal(await page.locator('[data-resume-image-task]').count(),0);
}));

test('ledger or pre-submit project save failure blocks POST before spending',async()=>fixture(async page=>{
 await page.evaluate(()=>{imageTaskLedger.begin=async()=>{throw new Error('synthetic disk unavailable');};});
 await page.evaluate(()=>generateFromNode(generator.id));assert.equal(await page.evaluate(()=>calls.length),0);
}));

test('ordinary synchronous response loss does not trigger another paid POST',async()=>fixture(async page=>{
 await page.evaluate(()=>{syntheticProfile.url='https://gateway.example.invalid/v1';fetchMaybeProxied=async(url,options)=>{calls.push({url,method:options.method});throw new Error('synthetic connection lost after submission');};});
 await page.evaluate(()=>generateFromNode(generator.id));assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='POST').length),1);
 assert.match(await page.evaluate(()=>nodes.find(n=>n.type==='result').status),/未自动重复/);
}));
