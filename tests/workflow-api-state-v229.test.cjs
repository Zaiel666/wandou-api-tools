'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=process.env.WANDOU_WORKFLOW_AUDIT_APP_ROOT||path.resolve(__dirname,'../app');
const source=fs.readFileSync(path.join(app,'workflow.js'),'utf8');
const prefix=source.slice(0,source.indexOf('\nfunction setStatus(text)'));
const OLD={key:'synthetic-old',key2:'synthetic-two',savedAt:'2020-01-01T00:00:00.000Z'};
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const flush=()=>new Promise(setImmediate);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(options={}) {
 const state={durable:clone(options.durable===undefined?OLD:options.durable),writes:[],aliasClearFail:false,writeFail:false,nativeDialog:false,events:{}};
 const local=options.local||new Map([['ai-tools-api-config',JSON.stringify(OLD)],['aiCanvasApi',JSON.stringify(OLD)]]);
 let document;
 const element=(name)=>({name,value:'',hidden:false,disabled:false,tabIndex:0,type:'password',isConnected:true,style:{},dataset:{},attrs:{},listeners:{},classList:{add(){},toggle(){},contains(){return false;}},
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},querySelector(){return null;},querySelectorAll(){return[];},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},focus(){document.activeElement=this;},getClientRects(){return[{}];},contains(v){return controls.includes(v);},setSelectionRange(){}});
 const nodes={};for(const name of ['modal','form','key','key2','open','close','clear','submit','storage','toast','outside'])nodes[name]=element(name);
 const controls=[nodes.close,nodes.key,nodes.key2,nodes.clear,nodes.submit,nodes.storage];nodes.modal.hidden=true;nodes.modal.querySelectorAll=()=>controls;nodes.form.querySelector=s=>s==='[type="submit"]'?nodes.submit:s==='[data-api-feedback]'?nodes.feedback||null:null;nodes.form.appendChild=e=>{nodes.feedback=e;};
 const selectors={'[data-api-modal]':nodes.modal,'[data-api-form]':nodes.form,'[data-api-key]':nodes.key,'[data-api-key-2]':nodes.key2,'[data-api-open]':nodes.open,'[data-api-close]':nodes.close,'[data-api-clear]':nodes.clear,'[data-toast]':nodes.toast};
 document={activeElement:nodes.open,documentElement:{dataset:{}},body:{classList:{contains:()=>false}},createElement:element,querySelector:s=>s==='dialog[open]'?(state.nativeDialog?{}:null):(selectors[s]??null),querySelectorAll:()=>[],addEventListener(type,fn){(state.events[type]??=[]).push(fn);}};
 let reads=0;
 const cache={readTheme:v=>v,readJson:()=>reads++===0&&options.read?options.read():Promise.resolve(clone(state.durable)),writeJson:async(_key,value)=>{state.writes.push(clone(value));if(options.write)return options.write(value,state);state.durable=clone(value);return{ok:true};}};
 const context={window:{WandouLocalCache:options.noCache?undefined:cache,addEventListener(){}},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>{if(state.writeFail)throw new Error('synthetic quota');if(state.aliasClearFail&&k==='aiCanvasApi'&&!JSON.parse(v).key&&!JSON.parse(v).key2)throw new Error('synthetic clear alias denied');local.set(k,v);},removeItem:k=>{local.delete(k);}},document,atob:s=>Buffer.from(s,'base64').toString(),URL,setTimeout:()=>1,clearTimeout(){},console:{warn(){}},};
 vm.createContext(context);vm.runInContext(prefix,context,{filename:'workflow.js'});
 const dispatch=async(node,type,event={})=>{for(const listener of node.listeners[type]||[])await listener({preventDefault(){},target:node,...event});};
 return{state,local,nodes,context,dispatch,open(){context.openApiModal();},close(){context.closeApiModal();},input(value){nodes.key.value=value;for(const fn of nodes.form.listeners.input||[])fn({target:nodes.key});},submit(){return dispatch(nodes.form,'submit');},clear(){return dispatch(nodes.clear,'click');},keyboard(key,shiftKey=false){let prevented=false;for(const fn of state.events.keydown||[])fn({key,shiftKey,preventDefault(){prevented=true;}});return prevented;}};
}

test('late initial configuration load preserves an unsaved API edit',async()=>{const d=defer(),f=fixture({read:()=>d.promise});f.open();f.input('synthetic-unsaved');d.resolve(OLD);await flush();assert.equal(f.nodes.key.value,'synthetic-unsaved');assert.equal(f.state.writes.length,0);});
test('late hydration cannot restore credentials after a completed clear',async()=>{const d=defer(),f=fixture({read:()=>d.promise});f.open();await f.clear();d.resolve(OLD);await flush();assert.equal(f.context.readApiConfig().key,'');assert.equal(f.nodes.key.value,'');assertEmptyAliases(f);assert.equal(f.state.durable.key,'');});
test('late hydration cannot undo a completed save',async()=>{const d=defer(),f=fixture({read:()=>d.promise});f.open();f.input('synthetic-new');await f.submit();d.resolve(OLD);await flush();f.open();assert.equal(f.nodes.key.value,'synthetic-new');});
for(const kind of ['negative acknowledgement','rejection'])test('durable clear '+kind+' preserves local config and editable form without false success',async()=>{const cause=new Error('synthetic database denied');const f=fixture({write:async()=>{if(kind==='rejection')throw cause;return{ok:false};}});await flush();const before=[...f.local];f.open();await f.clear();assert.match(f.nodes.toast.textContent,/清除未完成/);assert.deepEqual([...f.local],before);assert.deepEqual(f.state.durable,OLD);assert.equal(f.nodes.key.value,OLD.key);assert.equal(f.nodes.clear.disabled,false);assert.equal(f.nodes.key.disabled,false);});
test('partial local clear reports failure, then retries and stays cleared on reopen',async()=>{const f=fixture();await flush();f.open();f.state.aliasClearFail=true;await f.clear();assert.match(f.nodes.toast.textContent,/浏览器副本未能完全清除/);assert.equal(f.nodes.key.value,OLD.key);assert.equal(f.local.has('aiCanvasApi'),true);f.state.aliasClearFail=false;await f.clear();assert.equal(f.nodes.toast.textContent,'API 设置已清除');assertEmptyAliases(f);const reloaded=fixture({local:f.local,durable:f.state.durable});await flush();reloaded.open();assert.equal(reloaded.nodes.key.value,'');});
test('clear failure retains the actual storage cause without leaking it in a success message',async()=>{const cause=new Error('synthetic storage rejected');const f=fixture({write:async()=>{throw cause;}});await flush();await assert.rejects(f.context.clearSharedApiConfig(),error=>error.cause===cause&&/原设置已保留/.test(error.message));});
test('missing durable writer cannot claim a complete clear',async()=>{const f=fixture({noCache:true});await flush();f.open();await f.clear();assert.match(f.nodes.toast.textContent,/清除未完成/);assert.equal(f.local.size,2);});
test('save failure leaves draft, old durable config and retry controls intact',async()=>{const f=fixture({write:async()=>({ok:false})});await flush();f.open();f.input('synthetic-draft');f.state.writeFail=true;await f.submit();assert.match(f.nodes.toast.textContent,/保存失败/);assert.equal(f.nodes.modal.hidden,false);assert.equal(f.nodes.key.value,'synthetic-draft');assert.deepEqual(f.state.durable,OLD);assert.equal(f.nodes.submit.disabled,false);});
test('duplicate and crossed clicks cannot start a second write while clearing',async()=>{const d=defer(),f=fixture({write:async(value,state)=>{await d.promise;state.durable=clone(value);return{ok:true};}});await flush();f.open();const pending=f.clear();await f.clear();await f.submit();assert.equal(f.state.writes.length,1);assert.equal(f.nodes.key.disabled,true);d.resolve();await pending;assert.equal(f.nodes.key.disabled,false);assertEmptyAliases(f);});
test('duplicate and crossed clicks cannot start a second write while saving',async()=>{const d=defer(),f=fixture({write:async(value,state)=>{await d.promise;state.durable=clone(value);return{ok:true};}});await flush();f.open();f.input('synthetic-saved');const pending=f.submit();await f.submit();await f.clear();assert.equal(f.state.writes.length,1);d.resolve();await pending;assert.equal(f.context.readApiConfig().key,'synthetic-saved');assert.equal(f.nodes.clear.disabled,false);});
test('closing and reopening during save is not closed by the older submit completion',async()=>{const d=defer(),f=fixture({write:async(value,state)=>{await d.promise;state.durable=clone(value);return{ok:true};}});await flush();f.open();f.input('synthetic-saved');const pending=f.submit();f.close();f.open();assert.equal(f.nodes.key.disabled,true);d.resolve();await pending;assert.equal(f.nodes.modal.hidden,false);assert.equal(f.nodes.key.value,'synthetic-saved');assert.equal(f.nodes.key.disabled,false);});
test('closing and reopening during clear reflects committed empty values only on completion',async()=>{const d=defer(),f=fixture({write:async(value,state)=>{await d.promise;state.durable=clone(value);return{ok:true};}});await flush();f.open();const pending=f.clear();f.close();f.open();assert.equal(f.nodes.key.value,OLD.key);d.resolve();await pending;assert.equal(f.nodes.modal.hidden,false);assert.equal(f.nodes.key.value,'');});
test('modal focuses input, wraps keyboard traversal and returns focus on Escape',async()=>{const f=fixture();await flush();f.open();assert.equal(f.context.document.activeElement,f.nodes.key);f.nodes.storage.focus();assert.equal(f.keyboard('Tab'),true);assert.equal(f.context.document.activeElement,f.nodes.close);assert.equal(f.keyboard('Tab',true),true);assert.equal(f.context.document.activeElement,f.nodes.storage);assert.equal(f.keyboard('Escape'),true);assert.equal(f.nodes.modal.hidden,true);assert.equal(f.context.document.activeElement,f.nodes.open);assert.equal(f.state.writes.length,0);});
test('native storage dialog keeps keyboard priority over API overlay',async()=>{const f=fixture();await flush();f.open();f.state.nativeDialog=true;assert.equal(f.keyboard('Escape'),false);assert.equal(f.nodes.modal.hidden,false);});
test('cancelled unsaved edit does not change persistent configuration',async()=>{const f=fixture();await flush();f.open();f.input('synthetic-cancelled');f.close();f.open();assert.equal(f.nodes.key.value,OLD.key);assert.deepEqual(f.state.durable,OLD);assert.equal(f.state.writes.length,0);});
test('durable fallback save survives a page restart when browser storage rejects writes',async()=>{const f=fixture();await flush();f.open();f.input('synthetic-new');f.state.writeFail=true;await f.submit();assert.equal(f.nodes.toast.textContent,'API 设置已保存到本地数据库');const reloaded=fixture({local:f.local,durable:f.state.durable});await flush();reloaded.open();assert.equal(reloaded.nodes.key.value,'synthetic-new');});
test('reopening an already visible modal preserves its draft and original focus return',async()=>{const f=fixture();await flush();f.open();f.input('synthetic-in-progress');f.open();assert.equal(f.nodes.key.value,'synthetic-in-progress');f.close();assert.equal(f.context.document.activeElement,f.nodes.open);});
test('partial alias clear reports failure but latest empty durable state is selected consistently after reload',async()=>{
 const f=fixture();await flush();f.open();f.state.aliasClearFail=true;await f.clear();assert.match(f.nodes.toast.textContent,/未能完全清除/);
 assert.equal(JSON.parse(f.local.get('aiCanvasApi')).key,OLD.key,'Failed alias still exists and is not described as fully removed');
 const reloaded=fixture({local:f.local,durable:f.state.durable});await flush();reloaded.open();assert.equal(reloaded.nodes.key.value,'');
 const canvasSource=fs.readFileSync(path.join(app,'ai-node-canvas-test.html'),'utf8');
 const start=canvasSource.indexOf('    function localApiConfig() {'),end=canvasSource.indexOf('    async function persistApiConfig(',start);
 const loadStart=canvasSource.indexOf('    async function loadApiConfig() {'),loadEnd=canvasSource.indexOf('    function updateThemeLabel()',loadStart);
 assert.ok(start>0&&end>start&&loadStart>0&&loadEnd>loadStart);
 let selected;const canvasContext={canvasTestStorage:{getItem:k=>f.local.get(k)||null},normalizedApiConfig:config=>config||{key:'',key2:''},window:{WandouLocalCache:{readJson:async()=>f.state.durable}},durableApiConfigKey:'api-config-v1',apiConfigRevision:0,apiDraftRevision:0,apiConfigBusy:false,applyLoadedApiConfig:value=>{selected=value;}};
 vm.createContext(canvasContext);vm.runInContext(canvasSource.slice(start,end)+'\n'+canvasSource.slice(loadStart,loadEnd),canvasContext);await canvasContext.loadApiConfig();assert.equal(selected.key,reloaded.nodes.key.value);
});
test('a successful browser save wins over older durable data after reload',async()=>{const f=fixture({write:async()=>({ok:false})});await flush();f.open();f.input('synthetic-newer-browser');await f.submit();assert.equal(f.nodes.toast.textContent,'API 设置已保存');const reloaded=fixture({local:f.local,durable:f.state.durable});await flush();reloaded.open();assert.equal(reloaded.nodes.key.value,'synthetic-newer-browser');});
test('one written alias with both stores incomplete reports partial failure and remains visible on reload',async()=>{const f=fixture({write:async()=>({ok:false})});await flush();const original=f.context.localStorage.setItem;f.context.localStorage.setItem=(key,value)=>{if(key==='aiCanvasApi')throw new Error('synthetic alias denied');original(key,value);};f.open();f.input('synthetic-partial-save');await f.submit();assert.match(f.nodes.toast.textContent,/未能完整保存/);const reloaded=fixture({local:f.local,durable:f.state.durable});await flush();reloaded.open();assert.equal(reloaded.nodes.key.value,'synthetic-partial-save');assert.equal(JSON.parse(f.local.get('aiCanvasApi')).key,OLD.key);});
test('equal revision local and durable candidates follow the canvas local-first precedence',async()=>{const durable={...OLD,key:'synthetic-durable-conflict'};const f=fixture({durable});await flush();f.open();assert.equal(f.nodes.key.value,OLD.key);});
test('clear failure remains in the form through reopen and pending retry until committed success',async()=>{const retry=defer();let fail=true;const f=fixture({write:async(value,state)=>{if(fail)return{ok:false};await retry.promise;state.durable=clone(value);return{ok:true};}});await flush();f.open();await f.clear();assert.equal(f.nodes.feedback.getAttribute('role'),'alert');assert.equal(f.nodes.feedback.hidden,false);assert.match(f.nodes.feedback.textContent,/清除未完成/);f.close();f.open();assert.match(f.nodes.feedback.textContent,/清除未完成/);fail=false;const pending=f.clear();assert.equal(f.nodes.feedback.hidden,false);retry.resolve();await pending;assert.equal(f.nodes.feedback.hidden,true);assert.equal(f.nodes.feedback.textContent,'');});
test('save failure remains readable during edits and clears only after a successful retry',async()=>{let fail=true;const f=fixture({write:async(value,state)=>{if(fail)return{ok:false};state.durable=clone(value);return{ok:true};}});await flush();f.open();f.state.writeFail=true;f.input('synthetic-unsaved');await f.submit();assert.match(f.nodes.feedback.textContent,/保存失败/);f.input('synthetic-retry');assert.equal(f.nodes.feedback.hidden,false);fail=false;await f.submit();assert.equal(f.nodes.feedback.hidden,true);assert.equal(f.nodes.modal.hidden,true);f.open();assert.equal(f.nodes.key.value,'synthetic-retry');});
function useActualCacheWithRejectedDiskWrites(f) {
 const fallback=new Map();
 const db={transaction(){const tx={objectStore:()=>({put:value=>{fallback.set(value.path,value.value);setImmediate(()=>tx.oncomplete?.());}})};return tx;}};
 const indexedDB={open(){const request={result:db};setImmediate(()=>request.onsuccess?.());return request;}};
 f.context.indexedDB=f.context.window.indexedDB=indexedDB;
 f.context.window.wandouShell={writeLocalData:async()=>({success:false,error:'Synthetic disk read-only'}),readLocalData:async()=>({success:true,value:JSON.stringify(OLD)})};
 vm.runInContext(fs.readFileSync(path.join(app,'local-cache.js'),'utf8'),f.context,{filename:'local-cache.js'});
 return fallback;
}
test('actual cache disk failure followed by successful IndexedDB fallback cannot claim a durable clear',async()=>{const f=fixture();await flush();const fallback=useActualCacheWithRejectedDiskWrites(f);f.open();await f.clear();assert.equal(JSON.parse(fallback.get('json/api-config-v1.json')).key,'');assert.equal((await f.context.window.WandouLocalCache.readJson('api-config-v1')).key,OLD.key);assert.match(f.nodes.toast.textContent,/清除未完成/);assert.equal(f.local.size,2);assert.equal(f.nodes.key.value,OLD.key);});
test('actual cache fallback with rejected browser aliases cannot claim a durable save',async()=>{const f=fixture();await flush();const fallback=useActualCacheWithRejectedDiskWrites(f);f.open();f.input('synthetic-only-fallback');f.state.writeFail=true;await f.submit();assert.equal(JSON.parse(fallback.get('json/api-config-v1.json')).key,'synthetic-only-fallback');assert.equal((await f.context.window.WandouLocalCache.readJson('api-config-v1')).key,OLD.key);assert.match(f.nodes.toast.textContent,/保存失败/);assert.equal(f.nodes.modal.hidden,false);assert.equal(f.nodes.key.value,'synthetic-only-fallback');});
test('clear readback rejection keeps browser credentials and retry restores consistency',async()=>{const f=fixture();await flush();const reader=f.context.window.WandouLocalCache.readJson,cause=new Error('Synthetic unreadable store');f.context.window.WandouLocalCache.readJson=async()=>{throw cause;};f.open();await f.clear();assert.match(f.nodes.toast.textContent,/清除未完成/);assert.equal(f.local.size,2);assert.equal(f.nodes.key.value,OLD.key);assert.equal(f.state.durable.key,'');f.context.window.WandouLocalCache.readJson=reader;await f.clear();assert.equal(f.nodes.toast.textContent,'API 设置已清除');assertEmptyAliases(f);});
test('an unversioned empty readback cannot certify a committed clear',async()=>{const f=fixture();await flush();f.context.window.WandouLocalCache.readJson=async()=>({key:'',key2:''});f.open();await f.clear();assert.match(f.nodes.toast.textContent,/清除未完成/);assert.equal(f.local.size,2);});
test('a verified browser save wins on reload when the actual cache still reads the older disk file',async()=>{const f=fixture();await flush();useActualCacheWithRejectedDiskWrites(f);f.open();f.input('synthetic-browser-wins');await f.submit();assert.equal(f.nodes.toast.textContent,'API 设置已保存');const reloaded=fixture({local:f.local,durable:OLD});await flush();reloaded.open();assert.equal(reloaded.nodes.key.value,'synthetic-browser-wins');});

const imageChannels=require('../app/image-api-channels.js');
for(const officialOnly of [false,true])test(`homepage API save preserves official provider settings (${officialOnly?'official-only':'mixed'} config)`,async()=>{
 const config=imageChannels.normalize({key:officialOnly?'':OLD.key,key2:officialOnly?'':OLD.key2,savedAt:OLD.savedAt});
 config.channels.channel1.provider='openai';config.channels.channel1.openai.key='synthetic-official-one';
 config.channels.channel2.openai.key='synthetic-official-two';
 const f=fixture({local:new Map([['aiCanvasApi',JSON.stringify(config)],['ai-tools-api-config',JSON.stringify(config)]]),durable:config});
 await flush();f.open();assert.equal(f.nodes.key.value,officialOnly?'':OLD.key,'Homepage never shows the official credential as a gateway key');
 f.input('synthetic-updated-gateway');await f.submit();
 const stored=imageChannels.normalize(f.state.durable);
 assert.equal(stored.channels.channel1.provider,'openai');assert.equal(stored.channels.channel1.openai.key,'synthetic-official-one');
 assert.equal(stored.channels.channel2.openai.key,'synthetic-official-two');assert.equal(stored.channels.channel1.gateway.key,'synthetic-updated-gateway');
 for(const name of ['aiCanvasApi','ai-tools-api-config'])assert.deepEqual(imageChannels.normalize(JSON.parse(f.local.get(name))),stored);
 const reopened=fixture({local:f.local,durable:f.state.durable});await flush();reopened.open();assert.equal(reopened.nodes.key.value,'synthetic-updated-gateway');
});

test('newer empty shared config from a canvas clear replaces old in-memory gateway credentials',async()=>{
 const f=fixture();await flush();f.open();
 const empty={key:'',key2:'',savedAt:'2099-01-01T00:00:00.000Z'};
 for(const name of ['aiCanvasApi','ai-tools-api-config'])f.local.set(name,JSON.stringify(empty));
 f.close();f.open();assert.equal(f.nodes.key.value,'');assert.equal(f.nodes.key2.value,'');
});

test('readback that loses official channel settings cannot certify a durable-only homepage save',async()=>{
 const config=imageChannels.normalize({...OLD});config.channels.channel1.provider='openai';config.channels.channel1.openai.key='synthetic-official-retained';
 const f=fixture({local:new Map([['aiCanvasApi',JSON.stringify(config)]]),durable:config,write:async(value,state)=>{const {channels,...withoutChannels}=value;state.durable=withoutChannels;return{ok:true};}});
 await flush();f.open();f.input('synthetic-new-gateway');f.state.writeFail=true;await f.submit();assert.match(f.nodes.toast.textContent,/保存失败/);assert.equal(f.nodes.modal.hidden,false);
});

function assertEmptyAliases(f){for(const name of ["aiCanvasApi","ai-tools-api-config"]){const value=JSON.parse(f.local.get(name));assert.equal(value.key,"");assert.equal(value.key2,"");assert.equal(value.savedAt,f.state.durable.savedAt);assert.equal(value.channels,undefined);}}

for(const operation of ['save','clear'])test(`pending homepage API ${operation} blocks close and update until completion`,async()=>{
 const barrier=defer(),f=fixture({write:async(value,state)=>{await barrier.promise;state.durable=clone(value);return{ok:true};}});await flush();f.open();f.input('synthetic-pending-close');
 const pending=operation==='save'?f.submit():f.clear();const before=await f.context.window.wandouSaveBeforeClose();assert.equal(before.success,false);assert.equal(before.busy,true);
 barrier.resolve();await pending;const after=await f.context.window.wandouSaveBeforeClose();assert.equal(after.success,true);assert.equal(after.busy,false);
});

test('failed homepage API clear releases the close guard while retaining the failure message',async()=>{
 const f=fixture({write:async()=>({ok:false})});await flush();f.open();await f.clear();assert.match(f.nodes.feedback.textContent,/清除未完成/);assert.equal((await f.context.window.wandouSaveBeforeClose()).success,true);
});
test('saving during initial hydration preserves durable-only official metadata and the untouched second channel',async()=>{
 const config=imageChannels.normalize({...OLD,key:'',key2:'synthetic-unseen-second'});config.channels.channel1.provider='openai';config.channels.channel1.openai.key='synthetic-unseen-official';const late=defer();
 const f=fixture({local:new Map(),durable:config,read:()=>late.promise});f.open();f.input('synthetic-new-gateway');await f.submit();late.resolve(config);await flush();
 assert.equal(f.state.durable.channels.channel1.openai.key,'synthetic-unseen-official');assert.equal(f.state.durable.channels.channel1.provider,'openai');assert.equal(f.state.durable.channels.channel1.gateway.key,'synthetic-new-gateway');assert.equal(f.state.durable.key2,'synthetic-unseen-second');f.open();assert.equal(f.nodes.key2.value,'synthetic-unseen-second');
});
test('failed homepage metadata read preserves every stored copy and keeps the draft for retry',async()=>{
 const f=fixture();await flush();const before=[...f.local],reader=f.context.window.WandouLocalCache.readJson;f.context.window.WandouLocalCache.readJson=async()=>{throw Error('Synthetic metadata read failure');};f.open();f.input('synthetic-draft');await f.submit();assert.equal(f.state.writes.length,0);assert.deepEqual([...f.local],before);assert.deepEqual(f.state.durable,OLD);assert.match(f.nodes.feedback.textContent,/读取现有 API 配置失败/);assert.equal(f.nodes.key.value,'synthetic-draft');assert.equal((await f.context.window.wandouSaveBeforeClose()).success,true);f.context.window.WandouLocalCache.readJson=reader;await f.submit();assert.equal(f.state.durable.key,'synthetic-draft');
});
for(const explicit of [false,true])test(`homepage distinguishes untouched channel two from explicit empty edit (${explicit})`,async()=>{
 const f=fixture();await flush();f.open();f.state.durable={...OLD,key2:'synthetic-newer-second',savedAt:'2022-01-01T00:00:00.000Z'};f.input('synthetic-first-edited');if(explicit){f.nodes.key2.value='';await f.dispatch(f.nodes.form,'input',{target:f.nodes.key2});}await f.submit();assert.equal(f.state.durable.key2,explicit?'':'synthetic-newer-second');
});
test('slow homepage metadata read keeps captured edits across close/reopen and rejects duplicate actions',async()=>{
 const f=fixture();await flush();const barrier=defer(),reader=f.context.window.WandouLocalCache.readJson;let calls=0;f.context.window.WandouLocalCache.readJson=()=>calls++===0?barrier.promise:reader();f.open();f.input('synthetic-captured');const pending=f.submit();await f.submit();await f.clear();assert.equal(f.state.writes.length,0);assert.equal((await f.context.window.wandouSaveBeforeClose()).busy,true);f.close();f.open();barrier.resolve(OLD);await pending;assert.equal(f.state.writes.length,1);assert.equal(f.nodes.modal.hidden,false);assert.equal(f.nodes.key.value,'synthetic-captured');assert.equal(f.nodes.key.disabled,false);
});
test('undated channels-only durable metadata is not mistaken for an absent homepage base',async()=>{
 const config={channels:{channel1:{provider:'openai',gateway:{key:''},openai:{key:'synthetic-legacy-official'}},channel2:{provider:'gateway',gateway:{key:'synthetic-legacy-second'},openai:{key:''}}}},late=defer();const f=fixture({local:new Map(),durable:config,read:()=>late.promise});f.open();f.input('synthetic-new-first');await f.submit();late.resolve(config);await flush();assert.equal(f.state.durable.channels.channel1.openai.key,'synthetic-legacy-official');assert.equal(f.state.durable.key2,'synthetic-legacy-second');assert.equal(f.state.durable.channels.channel2.gateway.key,'synthetic-legacy-second');
});
for(const kind of ['denied','malformed'])test(`actual desktop cache cannot conceal ${kind} metadata from the strict homepage reader`,async()=>{
 const f=fixture();await flush();const before=[...f.local],fallback=useActualCacheWithRejectedDiskWrites(f);f.context.window.wandouShell.readLocalData=async()=>kind==='denied'?{success:false,error:'Synthetic disk denial'}:{success:true,value:'{broken-json'};f.open();f.input('synthetic-draft');await f.submit();assert.match(f.nodes.feedback.textContent,/读取现有 API 配置失败/);assert.deepEqual([...f.local],before);assert.equal(fallback.size,0);assert.equal(f.nodes.key.value,'synthetic-draft');
});
test('a desktop missing response permits a first save and verifies the actual cache disk write',async()=>{
 const f=fixture({local:new Map(),durable:null});await flush();const fallback=useActualCacheWithRejectedDiskWrites(f);let disk=null,writes=0;f.context.window.wandouShell.readLocalData=async input=>{assert.equal(input.path,'json/api-config-v1.json');return{success:true,missing:disk===null,value:disk};};f.context.window.wandouShell.writeLocalData=async input=>{assert.equal(input.path,'json/api-config-v1.json');disk=input.value;writes++;return{success:true,path:input.path};};f.open();f.input('synthetic-first-save');await f.submit();assert.equal(writes,1);assert.equal(JSON.parse(disk).key,'synthetic-first-save');assert.equal(fallback.size,0);assert.match(f.nodes.toast.textContent,/已保存/);
});
