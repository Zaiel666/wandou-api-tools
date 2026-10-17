const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const source=fs.readFileSync(path.join(__dirname,'../app/ai-node-canvas-test.html'),'utf8');

test('large canvas retains unrelated nodes and limits motion to visible nodes',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,route=>route.abort());
  await page.goto(pathToFileURL(path.join(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForSelector('body[data-test-ready=true]');
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true' && canvasTestStorage.getItem('test-layout-initialized')==='1');
  await page.evaluate(()=>{
   nodes=[];links=[];view={x:40,y:50,zoom:.75};
   for(let i=0;i<80;i++)createNode('generator',i%10*680,Math.floor(i/10)*1100,{_deferRender:true,prompt:'测试'});
   render();
  });
  await page.waitForFunction(()=>canvas.querySelector('.motion-visible') && nodes.every(n=>canvas.querySelector(`[data-id="${n.id}"]`).dataset.renderKey===nodeRenderKey(n)));
  const retention=await page.evaluate(()=>{
   const before=[...canvas.querySelectorAll('.node')];
   nodes[0].count=2;render();
   return {retained:before.slice(1).every(el=>el.isConnected),changed:!before[0].isConnected,count:canvas.querySelector('.test-stepper output').textContent};
  });
  assert.equal(retention.retained,true);assert.equal(retention.changed,true);assert.equal(retention.count,'2');
  const motion=await page.evaluate(()=>({visible:canvas.querySelectorAll('.motion-visible').length,offscreen:canvas.querySelectorAll('.node:not(.motion-visible)').length,offscreenAnimations:[...canvas.querySelectorAll('.node:not(.motion-visible)')].reduce((sum,el)=>sum+el.getAnimations({subtree:true}).length,0)}));
  assert.ok(motion.visible>0 && motion.visible<10);assert.ok(motion.offscreen>60);assert.equal(motion.offscreenAnimations,0);
  await page.evaluate(()=>{view.y=-7*1100*.75+50;applyCanvasTransform();});
  await page.waitForFunction(()=>canvas.querySelector(`[data-id="${nodes[70].id}"]`).classList.contains('motion-visible')&&!canvas.querySelector(`[data-id="${nodes[0].id}"]`).classList.contains('motion-visible'));
  await page.evaluate(()=>wandouSetDesktopTabActive(false));
  assert.equal(await page.evaluate(()=>canvas.getAnimations({subtree:true}).length),0);
  await page.evaluate(()=>wandouSetDesktopTabActive(true));
  await page.waitForFunction(()=>canvas.querySelector(`[data-id="${nodes[70].id}"] .test-refine-button`).getAnimations().length>0);
  // An edit between mount and height measurement must not be absorbed into its cached key.
  await page.evaluate(()=>{createNode('generator',0,0,{_deferRender:true,prompt:'before'});render();nodes[nodes.length-1].prompt='after';});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>{const n=nodes[nodes.length-1];return canvas.querySelector(`[data-id="${n.id}"]`).dataset.renderKey===nodeRenderKey(n);}),false);
  await page.evaluate(()=>render());
  assert.equal(await page.locator('.node.generator textarea[data-field=prompt]').last().inputValue(),'after');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('repeated tab signals do not save or rebuild again; resume is cancellable',()=>{
 const start=source.indexOf('    window.__wandouDesktopTabActive = true;');
 const code=source.slice(start,source.indexOf('    window.wandouPrepareTabSuspend',start));
 const frames=new Map(),calls={save:0,render:0};let id=0;
 const env={window:{},document:{body:{classList:{toggle(){}}}},nodes:[],pausePerformanceMonitor(){},scheduleCanvasSave(){calls.save++;},requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);},render(options){assert.equal(options.skipSave,true);calls.render++;}};
 vm.runInNewContext(code,env);
 env.window.wandouSetDesktopTabActive(true);assert.equal(frames.size,0);
 env.window.wandouSetDesktopTabActive(false);env.window.wandouSetDesktopTabActive(false);assert.equal(calls.save,1);
 env.window.wandouSetDesktopTabActive(true);env.window.wandouSetDesktopTabActive(true);assert.equal(frames.size,1);assert.equal(calls.render,0);
 env.window.wandouSetDesktopTabActive(false);assert.equal(frames.size,0);
 env.window.wandouSetDesktopTabActive(true);[...frames.values()][0]();assert.equal(calls.render,1);
});
