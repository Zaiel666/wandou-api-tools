const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require(path.resolve(__dirname,'../../../../desktop-client/node_modules/playwright'));
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>browser?.close());
async function open(){const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href+'?workspace=production');await page.waitForFunction(()=>document.body.dataset.testReady==='true'&&window.WandouCanvasViewport);await page.waitForTimeout(350);return{page,errors};}
async function populate(page,count=100){await page.evaluate(count=>{
 nodes=[];links=[];nodeId=1;view={x:0,y:0,zoom:1};selectedNodeId=null;boxSelectedIds=[];
 const c=document.createElement('canvas');c.width=128;c.height=64;c.getContext('2d').fillRect(10,10,50,30);window.fixture=c.toDataURL();
 for(let i=0;i<count;i++)createNode('result',(i%10)*500,Math.floor(i/10)*400,{_deferRender:true,mediaUrl:fixture,fullUrl:fixture,previewUrl:fixture,width:128,height:64,ratio:'2:1',prompt:'synthetic-'+i});
 selectedNodeId=null;render({skipSave:true});
 },count);await page.waitForTimeout(500);}
test('100 offscreen nodes unload real contents; overview stays lightweight and readable zoom restores within budget without writes',async()=>{
 const{page,errors}=await open();try{
  await populate(page);
  const initial=await page.evaluate(()=>{window.qaSnapshot=JSON.stringify(nodes);window.qaWrites=0;scheduleCanvasSave=()=>qaWrites++;return{stats:WandouCanvasViewport.stats(),children:canvas.querySelector('[data-id="node-100"]').childElementCount};});
  assert.equal(initial.children,2);assert.ok(initial.stats.skipped>80);
  const sweep=await page.evaluate(async()=>{for(let i=0;i<5;i++){view.x=i%2?-4500:0;view.y=i%2?-3600:0;applyCanvasTransform();await new Promise(r=>setTimeout(r,150));}return{same:JSON.stringify(nodes)===qaSnapshot,writes:qaWrites,pending:WandouCanvasPreview.stats().inflight};});
  assert.equal(sweep.same,true);assert.equal(sweep.writes,0);assert.equal(sweep.pending,0);
  await page.evaluate(()=>{view={x:0,y:0,zoom:.1};applyCanvasTransform();});await page.waitForFunction(()=>WandouCanvasViewport.stats().mountedContents<=1);
  const overview=await page.evaluate(()=>WandouCanvasViewport.stats());assert.equal(overview.nodes,100);assert.ok(overview.overviewImages<=96);
  const growth=await page.evaluate(async()=>{view={x:-280,y:-300,zoom:.4};applyCanvasTransform();const counts=[];for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);counts.push(canvas.querySelectorAll('.node:not(.viewport-placeholder)').length);}return counts;});
  assert.ok(growth.at(-1)>=80&&growth.at(-1)<=96);assert.ok(growth.some(n=>n<growth.at(-1)));
  assert.ok(growth.slice(1).every((n,i)=>n-growth[i]<=12),'at most12 real node contents restore per animation frame');
  assert.equal(await page.evaluate(()=>qaSnapshot===JSON.stringify(nodes)),true);assert.equal(await page.evaluate(()=>qaWrites),0);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../../qa/viewport-windowing-growth.json'),JSON.stringify({initial,sweep,overview,growth},null,2));
 }finally{await page.close();}
});
test('marquee, select-all group dragging, curve endpoints and disconnect remain correct across shells',async()=>{
 const{page,errors}=await open();try{
  await populate(page);
  await page.evaluate(()=>{links=[{from:'node-1',to:'node-100'},{from:'node-91',to:'node-100'}];drawLinks();});await page.waitForTimeout(100);
  const linesBefore=await page.evaluate(()=>({ids:[...lines.querySelectorAll('.line-path')].map(e=>e.dataset.from+':'+e.dataset.to),path:lines.querySelector('.line-path').getAttribute('d')}));
  assert.deepEqual(linesBefore.ids,['node-1:node-100'],'crossing curve remains; entirely offscreen curve has no SVG DOM');
  // Right-button marquee uses each retained shell's real world geometry.
  await page.evaluate(()=>{const a=worldToScreen({x:4450,y:3550}),b=worldToScreen({x:4850,y:3800});beginBoxSelection({button:2,target:canvasWrap,clientX:a.x,clientY:a.y,preventDefault(){},stopPropagation(){}});boxSelectState.moved=true;updateSelectionBox(b.x,b.y);finishBoxSelection({clientX:b.x,clientY:b.y});});
  assert.deepEqual(await page.evaluate(()=>boxSelectedIds),['node-100']);
  await page.evaluate(()=>{clearBoxSelection();selectAllCanvasNodes();});
  assert.equal(await page.evaluate(()=>boxSelectedIds.length),100);
  const start=await page.evaluate(()=>nodes.map(n=>({id:n.id,x:n.x,y:n.y})));
  const p=await page.evaluate(()=>worldToScreen({x:8,y:40}));
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+50,p.y+25,{steps:5});await page.mouse.up();await page.waitForTimeout(150);
  const moved=await page.evaluate(()=>nodes.map(n=>({id:n.id,x:n.x,y:n.y})));
  for(let i=0;i<100;i++){assert.equal(moved[i].x,start[i].x+50);assert.equal(moved[i].y,start[i].y+25);}
  await page.evaluate(()=>{clearBoxSelection();selectedNodeId=null;view.x=-4500;view.y=-3600;applyCanvasTransform();});await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>lines.querySelectorAll('.line-path').length),2);
  const correct=await page.evaluate(()=>[...lines.querySelectorAll('.line-path')].every(p=>p.getAttribute('d')===linkPathData(getPortCenter(p.dataset.from,'out'),getPortCenter(p.dataset.to,'in'))));assert.equal(correct,true);
  await page.locator('.line-cut[data-from="node-91"]').evaluate(e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.deepEqual(await page.evaluate(()=>links),[{from:'node-1',to:'node-100'}]);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
test('focused editor, duplicate, task status, custom geometry and saved project survive unload/reopen',async()=>{
 const{page,errors}=await open();try{
  await populate(page);
  await page.evaluate(()=>{window.gen=createNode('generator',0,4500,{prompt:'synthetic draft',_deferRender:true,frameWidth:520});window.keyword=createNode('keyword',600,4500,{prompt:'keyword draft',_deferRender:true});selectedNodeId=null;render({skipSave:true});});await page.waitForTimeout(200);
  const geometry=await page.evaluate(()=>[gen,keyword].map(n=>{const e=canvas.querySelector(`[data-id="${n.id}"]`);return{id:n.id,width:e.offsetWidth,height:e.offsetHeight,shell:e.classList.contains('viewport-placeholder')};}));assert.ok(geometry.every(e=>e.shell));
  await page.evaluate(()=>centerOnNode(gen.id));await page.waitForTimeout(150);
  const field=page.locator('.node[data-id="node-101"] textarea[data-field="prompt"]');await field.fill('edited persistent synthetic prompt');
  await page.evaluate(()=>{selectedNodeId=null;view.x=0;view.y=0;applyCanvasTransform();});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-id="node-101"]').classList.contains('viewport-placeholder')),false,'focused editor stays mounted while offscreen');
  await field.blur();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-id="node-101"]').classList.contains('viewport-placeholder')),true);
  await page.evaluate(()=>centerOnNode(gen.id));await page.waitForTimeout(150);
  assert.equal(await field.inputValue(),'edited persistent synthetic prompt');
  const geometryAfter=await page.evaluate(()=>[gen,keyword].map(n=>{const e=canvas.querySelector(`[data-id="${n.id}"]`);return{id:n.id,width:e.offsetWidth,height:e.offsetHeight};}));
  assert.equal(geometryAfter[0].width,520,'Custom generator width survives an estimated initial shell');
  assert.equal(geometryAfter[1].width,geometry[1].width,'Keyword shell width follows actual v2 CSS');
  assert.equal(geometryAfter[1].width,400);
  // Cold overview/offscreen editors start with runtime-only estimated bounds.
  // After their first real mount, subsequent shells retain measured geometry.
  await page.evaluate(()=>{selectedNodeId=null;view={x:0,y:0,zoom:1};applyCanvasTransform();});await page.waitForTimeout(150);
  const measuredShells=await page.evaluate(()=>[gen,keyword].map(n=>{const e=canvas.querySelector(`[data-id="${n.id}"]`);return{id:n.id,width:e.offsetWidth,height:e.offsetHeight,shell:e.classList.contains('viewport-placeholder')};}));
  assert.ok(measuredShells.every(e=>e.shell));assert.deepEqual(measuredShells.map(({shell,...size})=>size),geometryAfter);
  await page.evaluate(()=>centerOnNode(gen.id));await page.waitForTimeout(150);
  await page.locator('.node[data-id="node-101"] [data-duplicate]').click();
  assert.equal(await page.evaluate(()=>nodes.filter(n=>n.type==='generator'&&n.prompt==='edited persistent synthetic prompt').length),2);
  await page.evaluate(()=>{selectedNodeId=null;view={x:0,y:0,zoom:1};localResolutionJobs.set('node-100',{synthetic:true});nodes[99].status='正在本地处理尺寸';render({skipSave:true});});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-id="node-100"]').classList.contains('viewport-placeholder')),false);
  await page.evaluate(()=>{localResolutionJobs.delete('node-100');nodes[99].status='';render({skipSave:true});});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-id="node-100"]').classList.contains('viewport-placeholder')),true);
  const saved=await page.evaluate(async()=>{await saveCanvasState();window.savedProject=activeProjectId;window.savedIds=nodes.map(n=>n.id);projects.push({id:'qa-empty-v219',name:'Synthetic empty',createdAt:Date.now(),updatedAt:Date.now()});await switchProject('qa-empty-v219');const empty=nodes.filter(n=>n.mediaUrl).length;await switchProject(savedProject);return{empty,ids:nodes.map(n=>n.id),original:savedIds,edited:nodes.find(n=>n.id==='node-101').prompt,originalImage:nodes[99].fullUrl===fixture,width:nodes[99].width,height:nodes[99].height};});
  assert.equal(saved.empty,0);assert.deepEqual(saved.ids,saved.original);assert.equal(saved.edited,'edited persistent synthetic prompt');assert.equal(saved.originalImage,true);assert.equal(saved.width,128);assert.equal(saved.height,64);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
test('real 4096px originals display after viewport jumps and release work on project switch without changing original bytes',async()=>{
 const http=require('node:http'),crypto=require('node:crypto');
 const fixtureRoot=path.resolve(__dirname,'../../../../artifacts/canvas-performance-20261024/synthetic-4k');
 const originals=Array.from({length:24},(_,i)=>fs.readFileSync(path.join(fixtureRoot,String(i).padStart(3,'0')+'.jpg')));
 const server=http.createServer((req,res)=>{const index=Number(req.url.slice(1));if(!Number.isInteger(index)||index<0||index>=24){res.writeHead(404);res.end();return;}res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','image/jpeg');res.end(originals[index]);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const{page,errors}=await open();try{
  await page.unroute(/^https?:/);await page.route(/^https?:/,r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.evaluate(origin=>{nodes=[];links=[];nodeId=1;view={x:0,y:0,zoom:1};selectedNodeId=null;boxSelectedIds=[];for(let i=0;i<100;i++){const source=origin+'/'+i%24;createNode('result',(i%10)*400,Math.floor(i/10)*400,{_deferRender:true,mediaUrl:source,fullUrl:source,previewUrl:source,width:4096,height:4096});}selectedNodeId=null;render({skipSave:true});},origin);
  const readings=[];
  for(const offset of [0,-1800,-3600,0]){
   const expectedIds=await page.evaluate(async offset=>{
    view.x=offset;view.y=offset;applyCanvasTransform();
    // The fixture uses 320px square result cards at zoom 1. Independently
    // calculate the target viewport plus its 280px preload margin, so a fully
    // loaded previous viewport cannot satisfy readiness after a pan.
    const ids=nodes.filter(n=>n.x+offset+320>=-280&&n.x+offset<=canvasWrap.clientWidth+280&&n.y+offset+320>=-280&&n.y+offset<=canvasWrap.clientHeight+280).map(n=>n.id).sort();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return ids;
   },offset);
   assert.ok(expectedIds.length>0);
   const ready=await page.waitForFunction(({offset,expectedIds})=>{
    if(view.x!==offset||view.y!==offset||view.zoom!==1)return false;
    const images=[...canvas.querySelectorAll('.node .preview>img')];
    const ids=images.map(image=>image.closest('.node').dataset.id).sort();
    if(ids.length!==expectedIds.length||ids.some((id,index)=>id!==expectedIds[index]))return false;
    const samples=images.map(image=>{
     const record=WandouCanvasPreview.dimensions(image);
     return {id:image.closest('.node').dataset.id,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:record?.width,height:record?.height};
    });
    if(!samples.every(s=>s.complete&&s.naturalWidth>0&&s.naturalHeight>0&&s.width===4096&&s.height===4096))return false;
    const stats=WandouCanvasPreview.stats();
    if(stats.inflight!==0)return false;
    // Capture readiness and its plain-data evidence in this same browser tick.
    // A later viewport refresh cannot invalidate this already captured sample.
    return {offset,expectedIds,mounted:images.length,ids,images:samples,original:{width:samples[0].width,height:samples[0].height},stats};
   },{offset,expectedIds},{timeout:20000});
   try{readings.push(await ready.jsonValue());}finally{await ready.dispose();}
  }
  fs.writeFileSync(path.resolve(__dirname,'../../qa/viewport-4k-readings-debug.json'),JSON.stringify(readings,null,2));
  assert.ok(readings.every(r=>r.original?.width===4096&&r.original?.height===4096),JSON.stringify(readings));
  for(const reading of readings){assert.deepEqual(reading.ids,reading.expectedIds);assert.ok(reading.images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0&&image.width===4096&&image.height===4096));}
  assert.ok(readings.every(r=>r.stats.remoteBufferedBytes===0&&r.stats.remoteActive===0&&r.stats.remoteQueued===0));
  const originalHash=await page.evaluate(async()=>{const bytes=await fetch(nodes[99].fullUrl).then(r=>r.arrayBuffer());return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');});
  assert.equal(originalHash,crypto.createHash('sha256').update(originals[99%24]).digest('hex'));
  await page.evaluate(async()=>{projects.push({id:'qa-4k-empty',name:'Synthetic empty',createdAt:Date.now(),updatedAt:Date.now()});await switchProject('qa-4k-empty');});
  await page.waitForFunction(()=>{const s=WandouCanvasPreview.stats();return!s.inflight&&!s.queuedDecodes&&!s.remoteActive&&!s.remoteQueued&&!s.remoteBufferedBytes;});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../../qa/viewport-4k-display.json'),JSON.stringify({readings,originalHash,final:await page.evaluate(()=>WandouCanvasPreview.stats()),errors},null,2));
 }finally{await page.close();await new Promise(r=>server.close(r));}
});
