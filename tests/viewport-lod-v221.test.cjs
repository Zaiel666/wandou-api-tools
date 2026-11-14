const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const qa=path.resolve(__dirname,'../../qa');
test('cold 1000-node mixed overview preserves editing, selection, group drag, ports, normal zoom and saved originals',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&window.WandouCanvasViewport);
  const initial=await page.evaluate(async()=>{
   nodes=[];links=[];nodeId=1;selectedNodeId=null;boxSelectedIds=[];view={x:0,y:0,zoom:.12};const c=document.createElement('canvas');c.width=128;c.height=64;c.getContext('2d').fillRect(8,8,112,48);window.lodOriginal=c.toDataURL('image/png');
   const kinds=['result','image','generator','keyword'];
   for(let i=0;i<1000;i++){const kind=kinds[i%4];createNode(kind,(i%25)*400,Math.floor(i/25)*300,{_deferRender:true,model:'gpt-image-2.6-flare',prompt:'synthetic draft '+i,frameWidth:360,...(kind==='result'?{mediaUrl:lodOriginal,fullUrl:lodOriginal,previewUrl:lodOriginal,mediaType:'image',width:128,height:64}:kind==='image'?{references:[{url:lodOriginal,mediaType:'image',width:128,height:64}],frameHeight:180}:{} )});if(i%25)links.push({from:'node-'+i,to:'node-'+(i+1)});}
   const before=performance.now();render({skipSave:true});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{ms:performance.now()-before,stats:WandouCanvasViewport.stats(),count:nodes.length,links:links.length,dom:document.querySelectorAll('*').length};
  });
  assert.equal(initial.count,1000);assert.equal(initial.links,960);assert.ok(initial.stats.mountedContents<=1,JSON.stringify(initial));assert.ok(initial.ms<15000,'cold overview must not build hundreds of complex editors');assert.ok(initial.dom<15000);
  await page.evaluate(()=>{window.lodWrites=0;window.realScheduleSave=scheduleCanvasSave;scheduleCanvasSave=()=>lodWrites++;selectAllCanvasNodes();});await page.waitForFunction(()=>WandouCanvasViewport.stats().mountedContents<=1);
  assert.equal(await page.evaluate(()=>boxSelectedIds.length),1000);assert.ok(await page.evaluate(()=>WandouCanvasViewport.stats().skipped)>990);
  // A shell restores synchronously on pointerdown before ordinary group dragging.
  const target=await page.evaluate(()=>{for(const element of canvas.querySelectorAll('.viewport-placeholder.result')){const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(x>260&&y>120&&x<1080&&y<820&&hit&&element.contains(hit))return{id:element.dataset.id,x,y};}throw Error('No overview result shell in usable viewport');});
  const beforeDrag=await page.evaluate(()=>nodes.map(n=>({id:n.id,x:n.x,y:n.y})));
  await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x+30,target.y+12,{steps:5});await page.mouse.up();
  const afterDrag=await page.evaluate(()=>({selected:selectedNodeId,shell:canvas.querySelector('[data-id="'+selectedNodeId+'"]').dataset.viewportSkipped,positions:nodes.map(n=>({id:n.id,x:n.x,y:n.y})),stats:WandouCanvasViewport.stats()}));
  assert.equal(afterDrag.selected,target.id);assert.notEqual(afterDrag.shell,'true');for(let i=0;i<1000;i++){assert.ok(Math.abs(afterDrag.positions[i].x-beforeDrag[i].x-250)<.1);assert.ok(Math.abs(afterDrag.positions[i].y-beforeDrag[i].y-100)<.1);}
  await page.evaluate(()=>{clearBoxSelection();view.zoom=1;centerOnNode('node-3');});await page.waitForSelector('[data-id="node-3"] textarea[data-field="prompt"]');
  const field=page.locator('[data-id="node-3"] textarea[data-field="prompt"]');await field.fill('保留的合成编辑草稿');await page.evaluate(()=>{window.focusedLodField=document.activeElement;selectedNodeId=null;view={x:-15000,y:-15000,zoom:.12};applyCanvasTransform();});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>focusedLodField.isConnected&&focusedLodField===document.activeElement&&focusedLodField.value==='保留的合成编辑草稿'),true);assert.notEqual(await page.locator('[data-id="node-3"]').getAttribute('data-viewport-skipped'),'true');
  await field.blur();await page.waitForFunction(()=>canvas.querySelector('[data-id="node-3"]').dataset.viewportSkipped==='true');
  await page.evaluate(()=>{view.zoom=1;centerOnNode('node-3');});await page.waitForSelector('[data-id="node-3"] textarea[data-field="prompt"]');assert.equal(await field.inputValue(),'保留的合成编辑草稿');
  await page.evaluate(()=>{centerOnNode('node-1');drawLinks();});await page.waitForFunction(()=>{const image=canvas.querySelector('[data-id="node-1"] .preview img');return image?.naturalWidth===128;});
  assert.equal(await page.locator('[data-id="node-1"] [data-download]').isVisible(),true);
  const ports=await page.evaluate(()=>Array.from(lines.querySelectorAll('.line-path')).every(p=>p.getAttribute('d')===linkPathData(getPortCenter(p.dataset.from,'out'),getPortCenter(p.dataset.to,'in'))));assert.equal(ports,true);
  await page.evaluate(()=>{scheduleCanvasSave=realScheduleSave;view={x:0,y:0,zoom:.12};selectedNodeId=null;applyCanvasTransform();});await page.waitForFunction(()=>WandouCanvasViewport.stats().mountedContents<=1);
  const save=await page.evaluate(async()=>{const start=performance.now(),saved=await saveCanvasState();return{saved,ms:performance.now()-start,styles:Object.keys(nodes[0]).filter(k=>k.startsWith('viewport')),stats:WandouCanvasViewport.stats()};});assert.equal(save.saved,true);assert.ok(save.ms<15000);assert.deepEqual(save.styles,[]);
  await page.screenshot({path:path.join(qa,'mixed-lod-1440-light.png')});await page.setViewportSize({width:1024,height:800});await page.evaluate(()=>document.body.classList.add('dark-theme'));await page.screenshot({path:path.join(qa,'mixed-lod-1024-dark.png')});
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const restored=await page.evaluate(async()=>({nodes:nodes.length,links:links.length,zoom:view.zoom,prompt:nodes.find(n=>n.id==='node-3').prompt,width:nodes[0].width,height:nodes[0].height,original:await getLocalMedia(nodes[0].fullUrl),stats:WandouCanvasViewport.stats()}));assert.equal(restored.nodes,1000);assert.equal(restored.links,960);assert.ok(Math.abs(restored.zoom-.12)<.001);assert.equal(restored.prompt,'保留的合成编辑草稿');assert.equal(restored.width,128);assert.equal(restored.height,64);assert.match(restored.original,/^data:image\/png/);assert.ok(restored.stats.mountedContents<=1);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(qa,'viewport-lod-v221.json'),JSON.stringify({success:true,initial,save,restored:{...restored,original:undefined},errors},null,2));
 }finally{await browser.close();}
});
