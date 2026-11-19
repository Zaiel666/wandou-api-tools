'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_WORKFLOW_AUDIT_APP_ROOT||path.resolve(__dirname,'../app');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const cacheScript=`(()=>{const old={key:'synthetic-old',key2:'synthetic-two',savedAt:'2020-01-01T00:00:00.000Z'};if(!localStorage.getItem('qa-api-durable'))localStorage.setItem('qa-api-durable',JSON.stringify(old));window.qaApi={reads:0,writes:0,failRead:false,holdRead:false,failWrite:false,holdWrite:false};window.WandouLocalCache={readTheme:v=>window.WandouTheme?.get()||v,syncTheme:t=>window.WandouTheme?.set(t),readJson:()=>{const value=JSON.parse(localStorage.getItem('qa-api-durable')),initial=qaApi.reads++===0;if(qaApi.failRead)return Promise.reject(new Error('Synthetic metadata denied'));return new Promise(resolve=>{if(initial)qaApi.resolveRead=()=>resolve(value);if(!initial&&qaApi.holdRead){qaApi.resolveMetadataRead=()=>{qaApi.holdRead=false;resolve(value);};return;}if(!initial||!new URLSearchParams(location.search).has('slowread'))resolve(value);});},writeJson:async(key,value)=>{qaApi.writes++;if(qaApi.failWrite)return{ok:false,error:'synthetic write denied'};if(qaApi.holdWrite)await new Promise(resolve=>qaApi.resolveWrite=resolve);localStorage.setItem('qa-api-durable',JSON.stringify(value));return{ok:true};}};})();`;
async function assertPersistentFeedback(page, message) {
 const feedback=page.locator('[data-api-feedback]');
 await page.waitForFunction(()=>document.querySelector('[data-toast]').style.opacity==='0');
 assert.equal(await feedback.isVisible(),true);
 assert.equal(await feedback.getAttribute('role'),'alert');
 assert.match(await feedback.textContent(),message);
 const bounds=await feedback.boundingBox(),form=await page.locator('[data-api-form]').boundingBox();
 assert.ok(bounds.width>0&&bounds.height>0&&bounds.x>=form.x&&bounds.x+bounds.width<=form.x+form.width+1);
 const viewport=page.viewportSize();
 assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1,'The error text is inside the visible viewport, without scrolling');
}
async function withPage(run,{theme='light',width=1024,file='homepage-test.html',slowread=false,initialApi=null}={}){
 const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');const filePath=path.resolve(app,name);assert.ok(filePath.startsWith(path.resolve(app)+path.sep));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(filePath)]||'application/octet-stream');res.end(fs.readFileSync(filePath));}catch(_){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/`;
 let browser;try{browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath});const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'}),errors=[],external=[];
 await context.addInitScript(({theme,initialApi})=>{localStorage.setItem('ai-tools-theme',theme);if(initialApi&&!localStorage.getItem('qa-api-durable'))localStorage.setItem('qa-api-durable',JSON.stringify(initialApi));},{theme,initialApi});await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():(external.push({method:route.request().method()}),route.abort()));await context.route('**/local-cache.js',route=>route.fulfill({contentType:'text/javascript',body:cacheScript}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+file+(slowread?'?slowread=1':''));await page.waitForFunction(()=>window.qaApi&&typeof openApiModal==='function');await run(page,base);assert.deepEqual(errors,[]);assert.equal(external.filter(r=>r.method!=='GET').length,0,'No paid or outgoing mutation request');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
for(const theme of ['light','dark'])for(const width of [1024,1440])test(`API modal actual focus/Tab/Escape in ${theme} ${width}`,()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-key]').evaluate(e=>e===document.activeElement),true);const last=page.locator('[data-api-form] [data-storage-settings-open]');await last.focus();await page.keyboard.press('Tab');assert.equal(await page.locator('[data-api-close]').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await last.evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-api-modal]').isVisible(),false);assert.equal(await page.locator('[data-api-open]').evaluate(e=>e===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
 },{theme,width}));
test('actual deferred load preserves typing and saved or cleared settings survive reload',()=>withPage(async(page,base)=>{
 await page.locator('[data-api-open]').click();await page.locator('[data-api-key]').fill('synthetic-edited');await page.evaluate(()=>qaApi.resolveRead());await page.waitForFunction(()=>document.querySelector('[data-api-key]').value==='synthetic-edited');assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-edited');await page.locator('[data-api-form] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-api-modal]').hidden);await page.reload();await page.locator('[data-api-open]').click();await page.evaluate(()=>qaApi.resolveRead());assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-edited');await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent==='API 设置已清除');await page.reload();await page.locator('[data-api-open]').click();await page.evaluate(()=>qaApi.resolveRead());assert.equal(await page.locator('[data-api-key]').inputValue(),'');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aiCanvasApi')).key),'');
 },{slowread:true}));
test('actual rejected clear retains config and shows failure; retry clears both channels across reload',()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();await page.waitForFunction(()=>document.querySelector('[data-api-key]').value==='synthetic-old');await page.evaluate(()=>{qaApi.failWrite=true;});await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent.startsWith('清除未完成'));assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-old');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-api-durable')).key),'synthetic-old');await page.evaluate(()=>{qaApi.failWrite=false;});await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent==='API 设置已清除');await page.reload();await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-key]').inputValue(),'');assert.equal(await page.locator('[data-api-key-2]').inputValue(),'');
 }));
for(const theme of ['light','dark'])test(`persistent API failure remains visible and contained in ${theme} until retry succeeds`,()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();await page.evaluate(()=>{qaApi.failWrite=true;});await page.locator('[data-api-clear]').click();await assertPersistentFeedback(page,/清除未完成/);await page.keyboard.press('Escape');await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-feedback]').isVisible(),true);await page.evaluate(()=>{qaApi.failWrite=false;});await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent==='API 设置已清除');assert.equal(await page.locator('[data-api-feedback]').isVisible(),false);
 },{theme}));
test('actual pending save disables duplicate actions and does not close a reopened dialog',()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();await page.locator('[data-api-key]').fill('synthetic-saved');await page.evaluate(()=>{qaApi.holdWrite=true;});await page.locator('[data-api-form] [type=submit]').click();await page.waitForFunction(()=>qaApi.writes===1);assert.equal(await page.locator('[data-api-clear]').isDisabled(),true);assert.equal(await page.locator('[data-api-key]').isDisabled(),true);await page.keyboard.press('Escape');await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-close]').evaluate(e=>e===document.activeElement),true);await page.evaluate(()=>qaApi.resolveWrite());await page.waitForFunction(()=>!document.querySelector('[data-api-key]').disabled);assert.equal(await page.locator('[data-api-modal]').isVisible(),true);assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-saved');assert.equal(await page.evaluate(()=>qaApi.writes),1);
 }));
test('a native dialog opened over API settings consumes Escape before the API overlay',()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='qa-native-modal';dialog.innerHTML='<button>synthetic close</button>';document.body.append(dialog);dialog.showModal();});await page.keyboard.press('Escape');assert.equal(await page.locator('#qa-native-modal').evaluate(e=>e.open),false);assert.equal(await page.locator('[data-api-modal]').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-api-modal]').isVisible(),false);
 }));
test('shared workflow API keyboard behavior remains available on the compatibility homepage',()=>withPage(async page=>{await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-key]').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-api-modal]').isVisible(),false);},{file:'index.html'}));

test('a late actual initial read cannot restore a successfully cleared configuration',()=>withPage(async page=>{await page.locator('[data-api-open]').click();await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent==='API 设置已清除');await page.evaluate(()=>qaApi.resolveRead());await page.waitForFunction(()=>readApiConfig().key==='');assert.equal(await page.locator('[data-api-key]').inputValue(),'');await page.locator('[data-api-close]').click();await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-key]').inputValue(),'');},{slowread:true}));
test('actual partial clear reports the failed alias while reload selects the latest empty value and retry repairs both copies',()=>withPage(async page=>{await page.locator('[data-api-open]').click();await page.waitForFunction(()=>document.querySelector('[data-api-key]').value==='synthetic-old');await page.evaluate(()=>{const value=localStorage.getItem('qa-api-durable');localStorage.setItem('ai-tools-api-config',value);localStorage.setItem('aiCanvasApi',value);const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='aiCanvasApi'&&!JSON.parse(value).key)throw new DOMException('Synthetic access failure','SecurityError');return original.call(this,key,value);};});await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent.includes('浏览器副本未能完全清除'));await page.reload();await page.locator('[data-api-open]').click();await page.waitForFunction(()=>document.querySelector('[data-api-key]').value==='');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aiCanvasApi')).key),'synthetic-old');await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent==='API 设置已清除');await page.reload();await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-key]').inputValue(),'');}));
test('actual failed save keeps the draft and reports failure without closing the modal',()=>withPage(async page=>{await page.locator('[data-api-open]').click();await page.waitForFunction(()=>document.querySelector('[data-api-key]').value==='synthetic-old');await page.locator('[data-api-key]').fill('synthetic-unsaved-after-failure');await page.evaluate(()=>{qaApi.failWrite=true;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(['ai-tools-api-config','aiCanvasApi'].includes(key))throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.call(this,key,value);};});await page.locator('[data-api-form] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-toast]').textContent.startsWith('保存失败'));assert.equal(await page.locator('[data-api-modal]').isVisible(),true);assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-unsaved-after-failure');assert.equal(await page.locator('[data-api-form] [type=submit]').isDisabled(),false);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-api-durable')).key),'synthetic-old');}));

test('homepage saves gateway credentials without losing canvas official credentials or provider on reopen',()=>withPage(async(page,base)=>{
 await page.addScriptTag({url:base+'image-api-channels.js'});
 await page.evaluate(()=>{const value=WandouImageChannels.normalize({key:'synthetic-gateway-before',savedAt:'2020-01-01T00:00:00.000Z'});value.channels.channel1.provider='openai';value.channels.channel1.openai.key='synthetic-official-separate';for(const name of ['aiCanvasApi','ai-tools-api-config','qa-api-durable'])localStorage.setItem(name,JSON.stringify(value));});
 await page.reload();await page.locator('[data-api-open]').click();await page.waitForFunction(()=>document.querySelector('[data-api-key]').value==='synthetic-gateway-before');
 await page.locator('[data-api-key]').fill('synthetic-gateway-after');await page.locator('[data-api-form] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-api-modal]').hidden);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-api-durable')));assert.equal(stored.channels.channel1.provider,'openai');assert.equal(stored.channels.channel1.openai.key,'synthetic-official-separate');assert.equal(stored.channels.channel1.gateway.key,'synthetic-gateway-after');
 await page.reload();await page.locator('[data-api-open]').click();assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-gateway-after');
 await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>!apiConfigBusy);const empty=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-tools-api-config')));assert.equal(empty.key,'');assert.equal(empty.key2,'');assert.equal(empty.channels,undefined);assert.ok(empty.savedAt);
}));

test('actual pending homepage write prevents the desktop close or update gate and releases after completion',()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();await page.evaluate(()=>{qaApi.holdWrite=true;});await page.locator('[data-api-clear]').click();await page.waitForFunction(()=>qaApi.writes===1);
 const before=await page.evaluate(()=>window.wandouSaveBeforeClose());assert.equal(before.success,false);assert.equal(before.busy,true);
 await page.evaluate(()=>qaApi.resolveWrite());await page.waitForFunction(()=>!apiConfigBusy);const after=await page.evaluate(()=>window.wandouSaveBeforeClose());assert.equal(after.success,true);assert.equal(after.busy,false);
}));

const startupApi={channels:{channel1:{provider:'openai',gateway:{key:'synthetic-gateway-before'},openai:{key:'synthetic-official-hidden'}},channel2:{provider:'gateway',gateway:{key:'synthetic-channel-two'},openai:{key:'synthetic-official-two'}}}};
test('actual early homepage save reads full undated metadata and retains captured intent across close and reopen',()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();
 assert.equal(await page.locator('[data-api-key-2]').inputValue(),'');
 await page.locator('[data-api-key]').fill('synthetic-early-draft');
 await page.evaluate(()=>{qaApi.holdRead=true;});
 await page.locator('[data-api-form] [type=submit]').click();
 await page.waitForFunction(()=>typeof qaApi.resolveMetadataRead==='function');
 assert.equal(await page.evaluate(()=>qaApi.writes),0);
 assert.equal(await page.locator('[data-api-clear]').isDisabled(),true);
 assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,false);
 await page.evaluate(()=>{document.querySelector('[data-api-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelector('[data-api-clear]').click();});
 await page.keyboard.press('Escape');await page.locator('[data-api-open]').click();
 await page.evaluate(()=>qaApi.resolveMetadataRead());await page.waitForFunction(()=>!apiConfigBusy);
 assert.equal(await page.locator('[data-api-modal]').isVisible(),true);
 assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-early-draft');
 assert.equal(await page.locator('[data-api-key-2]').inputValue(),'synthetic-channel-two');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-api-durable')));
 assert.equal(saved.key,'synthetic-early-draft');assert.equal(saved.key2,'synthetic-channel-two');
 assert.equal(saved.channels.channel1.provider,'openai');assert.equal(saved.channels.channel1.openai.key,'synthetic-official-hidden');assert.equal(saved.channels.channel2.openai.key,'synthetic-official-two');
 assert.equal(await page.evaluate(()=>qaApi.writes),1);
 await page.evaluate(()=>qaApi.resolveRead());
 assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-early-draft');
 await page.reload();await page.locator('[data-api-open]').click();await page.evaluate(()=>qaApi.resolveRead());
 assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-early-draft');assert.equal(await page.locator('[data-api-key-2]').inputValue(),'synthetic-channel-two');
},{slowread:true,initialApi:startupApi}));

test('actual homepage metadata failure writes nothing and a deliberate retry preserves the displayed second channel',()=>withPage(async page=>{
 await page.locator('[data-api-open]').click();await page.waitForFunction(()=>document.querySelector('[data-api-key-2]').value==='synthetic-two');
 await page.locator('[data-api-key]').fill('synthetic-retry-draft');
 const before=await page.evaluate(()=>['qa-api-durable','ai-tools-api-config','aiCanvasApi'].map(key=>localStorage.getItem(key)));
 await page.evaluate(()=>{qaApi.failRead=true;});await page.locator('[data-api-form] [type=submit]').click();
 await page.waitForFunction(()=>!apiConfigBusy&&document.querySelector('[data-api-feedback]').textContent.includes('读取现有 API 配置失败'));
 assert.deepEqual(await page.evaluate(()=>['qa-api-durable','ai-tools-api-config','aiCanvasApi'].map(key=>localStorage.getItem(key))),before);
 assert.equal(await page.evaluate(()=>qaApi.writes),0);assert.equal(await page.locator('[data-api-key]').inputValue(),'synthetic-retry-draft');
 await assertPersistentFeedback(page,/读取现有 API 配置失败/);
 await page.evaluate(()=>{qaApi.failRead=false;});await page.locator('[data-api-form] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-api-modal]').hidden);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-api-durable')));assert.equal(saved.key,'synthetic-retry-draft');assert.equal(saved.key2,'synthetic-two');assert.equal(await page.evaluate(()=>qaApi.writes),1);
}));
