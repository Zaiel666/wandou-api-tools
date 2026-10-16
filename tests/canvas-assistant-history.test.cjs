const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/ai-node-canvas-test-assistant.js'),'utf8');
function harness() {
  const storage=new Map(),notices=[];
  const c=vm.createContext({window:{},document:{body:{dataset:{}}},setTimeout:()=>{},
    assistantSending:false,assistantMessages:[{role:'user',text:'海报创意',images:['blob:test']}],
    key:'project-a',assistantConversationStorageKey:()=>c.key,
    canvasTestStorage:{getItem:key=>storage.get(key),setItem:(key,v)=>storage.set(key,v)},
    persistMediaValue:async()=>'local-media:test',showToast:text=>notices.push(text)});
  vm.runInContext(source,c);return {c,storage,notices,archive:c.window.WandouAssistantHistory.archive};
}
test('archives messages and persisted media by project, deduplicates without clearing current chat',async()=>{
  const {c,storage,archive}=harness();
  assert.equal(await archive(),true);assert.equal(await archive(),true);
  const a=JSON.parse(storage.get('project-a:history'));
  assert.equal(a.length,1);assert.equal(a[0].messages[0].images[0],'local-media:test');
  assert.equal(c.assistantMessages.length,1);
  c.key='project-b';await archive();assert.equal(storage.size,2);
});
test('failed writes, pending requests and project switches cannot clear current conversation',async()=>{
  const {c,archive,notices}=harness();
  c.assistantSending=true;assert.equal(await archive(),false);
  c.assistantSending=false;c.canvasTestStorage.setItem=()=>{throw new Error('quota');};
  assert.equal(await archive(),false);assert.equal(c.assistantMessages.length,1);assert.equal(notices.length,1);
  const next=harness();next.c.persistMediaValue=async()=>{next.c.key='project-b';return 'local-media:test';};
  assert.equal(await next.archive(),false);assert.equal(next.c.assistantMessages.length,1);
  assert.ok(next.storage.has('project-a:history'));assert.ok(!next.storage.has('project-b:history'));
});
test('invalid archive is preserved rather than overwritten',async()=>{
  const {c,storage,archive}=harness();storage.set('project-a:history','broken');
  assert.equal(await archive(),false);assert.equal(storage.get('project-a:history'),'broken');assert.equal(c.assistantMessages.length,1);
});
test('history UI opens, safely displays text and restores archived conversations without running nodes',async()=>{
  const {parseHTML}=require('../tools/canvas-ui-test/node_modules/linkedom');
  const page=fs.readFileSync(require('node:path').join(__dirname,'../app/ai-node-canvas-test.html'),'utf8');
  const {document,window}=parseHTML(page);document.body.dataset.testReady='true';
  const storage=new Map([['project-a:history',JSON.stringify([{title:'<b>old</b>',messages:[{role:'user',text:'previous',images:[]}]}])]]);
  let saves=0,renders=0;
  const c=vm.createContext({document,window,setInterval:()=>{},setTimeout:()=>{},MutationObserver:window.MutationObserver,
    assistantSending:false,assistantMessages:[],assistantAttachments:[],assistantInput:document.getElementById('assistantInput'),
    assistantConversationStorageKey:()=>'project-a',canvasTestStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    persistMediaValue:async v=>v,localMediaPrefix:'local-media:',getLocalMedia:async v=>v,showToast:()=>{},
    saveAssistantConversation:()=>saves++,renderAssistantConversation:()=>renders++});
  vm.runInContext(source,c);
  document.querySelector('.assistant-history-toggle').click();
  const history=document.getElementById('assistantHistoryPanel');
  assert.equal(history.hidden,false);assert.equal(history.querySelector('summary').textContent,'<b>old</b>');
  assert.equal(history.querySelector('summary b'),null);
  await history.querySelector('details button').onclick();
  assert.equal(c.assistantMessages[0].text,'previous');assert.equal(saves,1);assert.equal(renders,1);assert.equal(history.hidden,true);
});
