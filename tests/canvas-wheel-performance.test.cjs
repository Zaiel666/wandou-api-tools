const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../app/ai-node-canvas-test.html'),'utf8');
function setup() {
  const frames = [], counts = {reads:0,draws:0,saves:0};
  const view = {x:0,y:0,zoom:1};
  const context = vm.createContext({view,window:{innerHeight:800},canvasWrap:{getBoundingClientRect(){counts.reads++;return {left:0,top:0};}},requestAnimationFrame:fn=>(frames.push(fn),frames.length),markZoomInteraction(){},applyCanvasTransform(){counts.draws++;},scheduleCanvasSave(){counts.saves++;}});
  vm.runInContext(source.slice(source.indexOf('    let pendingWheelZoom = null;'),source.indexOf('    canvasWrap.addEventListener("wheel"')),context);
  return {view,counts,frames,wheel:(delta,mode=0)=>context.queueWheelZoom({deltaY:delta,deltaMode:mode,clientX:200,clientY:100})};
}
test('high-frequency wheel events coalesce into one layout read and one draw',()=>{
  const t=setup();for(let i=0;i<100;i++)t.wheel(1);
  assert.equal(t.frames.length,1);assert.equal(t.counts.reads,0);
  t.frames.shift()();assert.equal(t.counts.reads,1);assert.equal(t.counts.draws,1);assert.equal(t.counts.saves,1);
  assert.ok(Math.abs((200-t.view.x)/t.view.zoom-200)<1e-9);
});
test('small deltas are gentle and zoom direction is reversible',()=>{
  const t=setup();t.wheel(1);t.frames.shift()();assert.ok(t.view.zoom>.998);
  t.wheel(-1);t.frames.shift()();assert.ok(Math.abs(t.view.zoom-1)<1e-9);
});
test('line units normalize and zoom limits remain enforced',()=>{
  const a=setup(),b=setup();a.wheel(1,1);b.wheel(16);a.frames.shift()();b.frames.shift()();assert.equal(a.view.zoom,b.view.zoom);
  for(let i=0;i<100;i++)a.wheel(-240);a.frames.shift()();assert.equal(a.view.zoom,2.5);
  for(let i=0;i<100;i++)a.wheel(240);a.frames.shift()();assert.equal(a.view.zoom,.12);
});
test('media visibility churn waits for gestures and applies latest state in bounded batches',()=>{
  const timers=[],applied=[];let interacting=true;
  const context=vm.createContext({canvasWrap:{classList:{contains:()=>interacting}},clearTimeout(){},setTimeout:fn=>(timers.push(fn),timers.length),setDeferredNodeMedia:(el,on)=>applied.push([el.id,on])});
  const start=source.indexOf('    const pendingCanvasMedia = new Map();');
  vm.runInContext(source.slice(start,source.indexOf('    function canvasMediaSourceFor',start)),context);
  vm.runInContext('for(let id=0;id<5;id++){const el={id,isConnected:true};pendingCanvasMedia.set(el,false);pendingCanvasMedia.set(el,true);}flushDeferredCanvasMedia();',context);
  assert.equal(applied.length,0);
  interacting=false;timers.shift()();assert.equal(applied.length,2);
  timers.shift()();assert.equal(applied.length,4);
  timers.shift()();assert.equal(applied.length,5);
  assert.ok(applied.every(([,on])=>on));
});
