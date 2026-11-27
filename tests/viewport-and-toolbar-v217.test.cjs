const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(path.resolve(__dirname,'../../../../desktop-client/node_modules/playwright'));
const file = path.join(process.env.WANDOU_TEST_APP_DIR || path.resolve(__dirname,'../app'),'ai-node-canvas-test.html');
test('offscreen contents retain geometry/data and restore on pan/selection; toolbar remains reachable', async () => {
 const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const page = await browser.newPage({viewport:{width:1024,height:800}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message)); await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(file).href+'?workspace=production');
  await page.waitForFunction(()=>document.body.dataset.testReady==='true' && !!window.WandouCanvasViewport);
  await page.waitForTimeout(350);
  const toolbar = await page.evaluate(()=>{
   const t=document.querySelector('.test-canvas-toolbar'), model=document.querySelector('#assistantPanel .assistant-select-field.model .assistant-picker-trigger');
   const b=model.getBoundingClientRect(), hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
   const tr=t.getBoundingClientRect(),panel=document.querySelector('#assistantPanel'),pr=panel.getBoundingClientRect(); return {modelUncovered:model.contains(hit),toolbarRight:tr.right,modelLeft:b.left,scrollable:t.scrollWidth>t.clientWidth,hit:hit?.outerHTML.slice(0,1000)||null,modelRect:b.toJSON(),toolbarRect:tr.toJSON(),panelRect:pr.toJSON(),toolbarStyle:t.getAttribute('style'),panelStyle:panel.getAttribute('style'),appClass:document.querySelector('.app').className,animations:document.getAnimations().filter(a=>a.effect?.target?.closest?.('#assistantPanel,.app,.test-canvas-toolbar')).map(a=>({target:a.effect.target.id||String(a.effect.target.className),playState:a.playState,currentTime:a.currentTime}))};
  });
  if(!toolbar.modelUncovered && process.env.WANDOU_VIEWPORT_DIAG_DIR){const dir=process.env.WANDOU_VIEWPORT_DIAG_DIR;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({stage:'initial',toolbar},null,2),{flag:'wx'});await page.screenshot({path:path.join(dir,'failure.png')});}
  assert.equal(toolbar.modelUncovered,true,JSON.stringify(toolbar));
  assert.equal(toolbar.scrollable,true,'narrow toolbar scrolls instead of overlapping model button');
  await page.locator('.test-canvas-toolbar [data-tool="redo"]').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.test-canvas-toolbar [data-tool="redo"]').isVisible(),true);
  const viewportReachability=[];
  for (const width of [1024,1280,1440]) for (const dark of [false,true]) {
   await page.setViewportSize({width,height:800});
   await page.evaluate(dark=>document.body.classList.toggle('dark-theme',dark),dark);
   await page.waitForTimeout(100);
   const model=await page.evaluate(()=>{const e=document.querySelector('#assistantPanel .assistant-select-field.model .assistant-picker-trigger'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {reachable:e.contains(hit),hit:hit?.outerHTML.slice(0,1000)||null,rect:r.toJSON(),point:{x,y},stack:document.elementsFromPoint(x,y).slice(0,8).map(n=>({tag:n.tagName,id:n.id,className:String(n.className),zIndex:getComputedStyle(n).zIndex,pointerEvents:getComputedStyle(n).pointerEvents})),animations:document.getAnimations().filter(a=>a.effect?.target?.closest?.('#assistantPanel,.app,.test-canvas-toolbar')).map(a=>({target:a.effect.target.id||String(a.effect.target.className),playState:a.playState,currentTime:a.currentTime}))};});
   viewportReachability.push({width,dark,...model});
   if(!model.reachable && process.env.WANDOU_VIEWPORT_DIAG_DIR){const dir=process.env.WANDOU_VIEWPORT_DIAG_DIR;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({width,dark,model,viewportReachability},null,2),{flag:'wx'});await page.screenshot({path:path.join(dir,'failure.png')});await page.waitForTimeout(200);const later=await page.evaluate(()=>{const e=document.querySelector('#assistantPanel .assistant-select-field.model .assistant-picker-trigger'),r=e.getBoundingClientRect(),launcher=document.querySelector('#assistantToggleButton'),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{reachable:e.contains(hit),hit:hit?.outerHTML.slice(0,1000),modelRect:r.toJSON(),launcherRect:launcher.getBoundingClientRect().toJSON(),panelRect:document.querySelector('#assistantPanel').getBoundingClientRect().toJSON(),appStyle:{transform:getComputedStyle(document.querySelector('.app')).transform,opacity:getComputedStyle(document.querySelector('.app')).opacity,zIndex:getComputedStyle(document.querySelector('.app')).zIndex}}});fs.writeFileSync(path.join(dir,'after-200ms.json'),JSON.stringify(later,null,2),{flag:'wx'});}
   assert.equal(model.reachable,true,`model covered at${width} dark=${dark}: ${JSON.stringify(model)}`);
  }
  await page.setViewportSize({width:1024,height:800});
  await page.evaluate(()=>{
   nodes=[]; links=[]; nodeId=1; selectedNodeId=null; boxSelectedIds=[]; view={x:0,y:0,zoom:1};
   const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(0,0,64,64);const png=c.toDataURL();
   for(let i=0;i<100;i++)createNode('result',(i%10)*400,Math.floor(i/10)*400,{_deferRender:true,mediaUrl:png,fullUrl:png,previewUrl:png,width:64,height:64});
   links=[{from:nodes[0].id,to:nodes[99].id},{from:nodes[90].id,to:nodes[99].id}];
   selectedNodeId=null; render({skipSave:true});
  });
  await page.waitForTimeout(600);
  const before=await page.evaluate(()=>{
   window.qaWrites=0;window.qaOriginalSave=scheduleCanvasSave;scheduleCanvasSave=()=>qaWrites++;
   window.qaNodes=JSON.stringify(nodes);window.qaLinks=JSON.stringify(links);
   const e=canvas.querySelector('[data-id="node-100"]');
   return {stats:WandouCanvasViewport.stats(),height:e.offsetHeight,width:e.offsetWidth,hidden:e.dataset.viewportSkipped==='true',links:[...lines.querySelectorAll('.line-path')].map(e=>e.style.visibility)};
  });
  assert.equal(before.hidden,true);assert.ok(before.stats.skipped>=80,JSON.stringify(before));
  assert.equal(before.links[0],'','curve crossing viewport remains visible');assert.equal(before.links.length,1,'offscreen curve is not mounted');
  await page.evaluate(()=>{view.x=-3600;view.y=-3600;applyCanvasTransform();});
  await page.waitForTimeout(100);
  const after=await page.evaluate(()=>{const e=canvas.querySelector('[data-id="node-100"]');return {hidden:e.dataset.viewportSkipped==='true',height:e.offsetHeight,width:e.offsetWidth,sameNodes:qaNodes===JSON.stringify(nodes),sameLinks:qaLinks===JSON.stringify(links),writes:qaWrites};});
  assert.equal(after.hidden,false);assert.equal(after.width,before.width);assert.equal(after.height,before.height);
  assert.equal(after.sameNodes,true,'pan/restore must not normalize or change saved node data');assert.equal(after.sameLinks,true);assert.equal(after.writes,0);
  await page.evaluate(()=>{view.x=0;view.y=0;selectedNodeId='node-100';updateSelection();applyCanvasTransform();});
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-id="node-100"]').dataset.viewportSkipped),undefined);
  await page.evaluate(()=>{selectedNodeId=null;nodes[99].pending=true;render({skipSave:true});});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>canvas.querySelector('[data-id="node-100"]').dataset.viewportSkipped),undefined);
  await page.evaluate(()=>{nodes[99].pending=false;render({skipSave:true});});await page.waitForTimeout(100);
  await page.evaluate(()=>selectAllCanvasNodes());await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>boxSelectedIds.length),100);
  assert.ok(await page.evaluate(()=>WandouCanvasViewport.stats().skipped)>0,'select-all preserves lightweight offscreen shells');
  assert.equal(await page.evaluate(()=>selectionFrame.classList.contains('open')),true);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.resolve(__dirname,'../../qa/viewport-behavior.json'),JSON.stringify({toolbar,viewportReachability,before,after,errors},null,2));
 } finally {await browser.close();}
});
