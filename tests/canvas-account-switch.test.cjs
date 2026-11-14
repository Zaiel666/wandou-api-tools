const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {parseHTML} = require('../tools/canvas-ui-test/node_modules/linkedom');
const source = fs.readFileSync(path.join(__dirname, '../app/canvas-account.js'), 'utf8');

function fixture() {
  const {window,document} = parseHTML('<html><body></body></html>');
  document.body.dataset.canvasReady='true';
  const owner='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  let signedIn=owner,saves=0,reloads=0,saveOk=true;
  window.WandouCanvasScope={userId:owner};
  const location={origin:'http://127.0.0.1:8787',href:'http://127.0.0.1:8787/ai-node-canvas-test.html',reload:()=>reloads++};
  const context=vm.createContext({window,document,location,AbortSignal,URL,console,
    fetch:async url=>({ok:true,json:async()=>url.endsWith('/api/me')?{user:signedIn?{id:signedIn,availableCents:100}:null}:{models:[]}}),
    saveCanvasState:async()=>{saves++;return saveOk;},
    setTimeout,clearTimeout,setInterval:()=>0,nodes:[],links:[],showToast:()=>{}
  });
  vm.runInContext(source,context);
  return {api:window.WandouCanvasAccount,document,owner,other,signIn:id=>signedIn=id,failSave:()=>saveOk=false,counts:()=>({saves,reloads})};
}
test('switching accounts masks the old canvas and saves only before a full reload',async()=>{
  const f=fixture();await f.api.refresh(true);f.api.unlock();
  assert.equal(f.document.documentElement.dataset.canvasLocked,undefined);
  f.signIn(f.other);
  await assert.rejects(f.api.refresh(true),/登录账户已变化/);
  assert.equal(f.document.documentElement.dataset.canvasLocked,'true');
  assert.equal(f.api.user,null);
  assert.deepEqual(f.counts(),{saves:1,reloads:1});
  f.api.unlock();assert.equal(f.document.documentElement.dataset.canvasLocked,'true');
});
test('logout cannot leave old account projects visible',async()=>{
  const f=fixture();await f.api.refresh(true);f.signIn(null);
  await assert.rejects(f.api.refresh(true),/登录账户已变化/);
  assert.deepEqual(f.counts(),{saves:1,reloads:1});
  assert.equal(f.api.user,null);
});
test('failed local save remains locked and does not discard the original canvas',async()=>{
  const f=fixture();await f.api.refresh(true);f.failSave();f.signIn(f.other);
  await assert.rejects(f.api.refresh(true),/登录账户已变化/);
  assert.deepEqual(f.counts(),{saves:1,reloads:0});
  assert.match(f.document.getElementById('canvas-account-gate').textContent,/原账户画布尚未保存/);
});
test('locked canvas hides private controls from accessibility and restores them only for the owner',async()=>{
  const f=fixture();
  const content=f.document.createElement('main');
  content.innerHTML='<button style="visibility:visible">私有项目</button>';
  content.inert=false;
  const hidden=f.document.createElement('aside');
  hidden.setAttribute('aria-hidden','true');hidden.inert=true;
  f.document.body.append(content,hidden);
  f.api.gate();
  assert.equal(content.getAttribute('aria-hidden'),'true');assert.equal(content.inert,true);
  const portal=f.document.createElement('div');portal.textContent='私有图片';
  f.document.body.append(portal);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(portal.getAttribute('aria-hidden'),'true');assert.equal(portal.inert,true);
  await f.api.refresh(true);f.api.unlock();
  assert.equal(content.hasAttribute('aria-hidden'),false);assert.equal(content.inert,false);
  assert.equal(portal.hasAttribute('aria-hidden'),false);
  assert.equal(hidden.getAttribute('aria-hidden'),'true');assert.equal(hidden.inert,true);
});
test('all storage-dependent canvas scripts wait behind authenticated bootstrap',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../app/ai-node-canvas-test.html'),'utf8');
  const {document}=parseHTML(page);
  for(const file of ['ai-node-canvas-test-cache.js','export-artifact-store.js','ai-node-canvas-test-skills.js','ai-node-canvas-test.js','ai-node-canvas-test-assistant.js','batch-image.js']){
    assert.equal(document.querySelector(`script[data-canvas-src="./${file}"]`).type,'text/wandou-canvas');
    assert.equal(document.querySelector(`script[src="./${file}"]`),null);
  }
  const main=[...document.querySelectorAll('script')].find(s=>s.textContent.includes('function initApp()'));
  assert.equal(main.type,'text/wandou-canvas');
  const bootstrap=fs.readFileSync(path.join(__dirname,'../app/canvas-bootstrap.js'),'utf8');
  assert.ok(bootstrap.indexOf('await window.WandouCanvasScope.initialize()')<bootstrap.indexOf("document.createElement('script')"));
});
