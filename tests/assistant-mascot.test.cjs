const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/assistant-mascot.js'), 'utf8');
function setup(saved = null) {
  const handlers = {}, events = {}, writes = [];
  const button = {style:{},dataset:{},getBoundingClientRect:()=>({left:parseFloat(button.style.left)||500,top:parseFloat(button.style.top)||400,width:132,height:132}),addEventListener:(name,fn)=>handlers[name]=fn};
  const window = {innerWidth:800,innerHeight:600,localStorage:{getItem:()=>saved,setItem:(k,v)=>writes.push(JSON.parse(v))},addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(source,{window,document:{getElementById:()=>button}});
  const fire = (name,extra={}) => {
    const e = {button:0,pointerId:1,clientX:510,clientY:410,detail:1,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;},...extra};
    handlers[name](e);return e;
  };
  return {button,window,writes,events,fire};
}
test('mascot drag clamps, persists, and suppresses only the resulting pointer click',()=>{
  const t=setup();t.fire('pointerdown');t.fire('pointermove',{clientX:1200,clientY:1000});t.fire('pointerup');
  assert.equal(t.button.style.left,'668px');assert.equal(t.button.style.top,'468px');assert.equal(t.writes.length,1);
  assert.ok(t.fire('click').stopped);assert.ok(!t.fire('click',{detail:0}).stopped);
  t.fire('pointerdown');t.fire('pointerup');assert.ok(!t.fire('click').stopped);
});
test('mascot restores safely and remains visible after viewport resize',()=>{
  const t=setup(JSON.stringify({left:2000,top:2000}));assert.equal(t.button.style.left,'668px');
  t.window.innerWidth=300;t.window.innerHeight=250;t.events.resize();
  assert.equal(t.button.style.left,'168px');assert.equal(t.button.style.top,'118px');
  assert.doesNotThrow(()=>setup('invalid'));
});
test('small pointer movement remains a click and Alt arrows reposition accessibly',()=>{
  const t=setup();t.fire('pointerdown');t.fire('pointermove',{clientX:512});t.fire('pointerup');
  assert.equal(t.writes.length,0);assert.ok(!t.fire('click').stopped);
  assert.ok(t.fire('keydown',{altKey:true,key:'ArrowLeft'}).prevented);
  assert.equal(t.button.style.left,'488px');
});
