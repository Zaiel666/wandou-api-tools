const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../desktop-client/node_modules/playwright');
const pageUrl = pathToFileURL(path.resolve(__dirname, '../app/ai-node-canvas-test.html')).href + '?workspace=production';
async function fixture(run) {
  const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1024,height:800}}), errors=[];
    const state={requests:[],modelsStatus:200,imageStatus:403,holdModels:false,release:null};
    page.setDefaultTimeout(10000); page.on('pageerror',error=>errors.push(error.message));
    await page.route(/^https?:/, async route => {
      const request=route.request(),url=new URL(request.url());
      if (!['www.zayapi.top','api.openai.com'].includes(url.hostname)) return route.abort();
      state.requests.push({host:url.hostname,path:url.pathname,method:request.method(),auth:request.headers().authorization});
      if(url.pathname==='/v1/models') {
        if(state.holdModels) await new Promise(resolve=>state.release=resolve);
        return route.fulfill({status:state.modelsStatus,contentType:'application/json',body:JSON.stringify({data:(url.hostname==='api.openai.com'?['gpt-image-2.6-flare','gpt-image-2.6-sunburst','gpt-6-astra']:['gpt-image-2.5-1k','gpt-image-2.6-flare']).map(id=>({id}))})});
      }
      return route.fulfill({status:state.imageStatus,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetic unavailable'}})});
    });
    await page.goto(pageUrl);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
    await page.evaluate(()=>{nodes=[];links=[];render({skipSave:true});setSettingsOpen(true);});
    await run(page,state);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
}
async function selectOfficial(page) {
  await page.locator('#imageProvider-channel1').selectOption('openai');
  await page.locator('#apiKey').fill('synthetic-official');
}

test('official-only config saves through real UI and survives project page reload without gateway-key leakage',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);
  await page.locator('#saveApiButton').click();
  await page.waitForFunction(()=>!document.querySelector('#saveApiButton').disabled);
  const saved=await page.evaluate(()=>({local:JSON.parse(canvasTestStorage.getItem('aiCanvasApi')),shared:JSON.parse(canvasTestStorage.getItem('ai-tools-api-config')),profile:apiProfileForModel()}));
  assert.equal(saved.profile.provider,'openai');assert.equal(saved.profile.url,'https://api.openai.com/v1');
  assert.equal(saved.local.channels.channel1.openai.key,'synthetic-official');
  assert.equal(saved.local.key,'');assert.equal(saved.shared.key,'');
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const profile=await page.evaluate(()=>apiProfileForModel());
  assert.equal(profile.provider,'openai');assert.equal(profile.key,'synthetic-official');
  assert.ok(state.requests.every(request=>request.host==='api.openai.com'));
  assert.ok((await page.evaluate(()=>[...imageModelOptions])).every(model=>model.startsWith('gpt-image-2.6')));
}));

test('real settings selector refuses provider change during active task and restores separate credentials afterward',async()=>fixture(async(page)=>{
  await page.locator('#apiKey').fill('synthetic-gateway');
  await selectOfficial(page);
  await page.evaluate(()=>vectorJobs.add('synthetic-active'));
  await page.locator('#imageProvider-channel1').selectOption('gateway');
  assert.equal(await page.locator('#imageProvider-channel1').inputValue(),'openai');
  assert.equal(await page.locator('#apiKey').inputValue(),'synthetic-official');
  await page.evaluate(()=>vectorJobs.clear());
  await page.locator('#imageProvider-channel1').selectOption('gateway');
  assert.equal(await page.locator('#apiKey').inputValue(),'synthetic-gateway');
}));

test('late model-list response from previous provider cannot replace current provider models or cache',async()=>fixture(async(page,state)=>{
  await page.locator('#apiKey').fill('synthetic-gateway');state.holdModels=true;
  await page.evaluate(()=>{window.heldSync=syncImageModelsFromApi({render:false});});
  await page.waitForFunction(()=>imageModelSyncGeneration>0);
  for(let i=0;!state.release&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(state.release,'Synthetic model request reached mock');
  await selectOfficial(page);state.holdModels=false;state.release();
  assert.equal(await page.evaluate(()=>heldSync),false);
  const snapshot=await page.evaluate(()=>({models:[...imageModelOptions],cache:canvasTestStorage.getItem('aiCanvasAllModels'),profile:apiProfileForModel()}));
  assert.equal(snapshot.profile.provider,'openai');assert.equal(snapshot.cache,null);
  assert.ok(snapshot.models.every(model=>model.startsWith('gpt-image-2.6')));
}));

test('third-party model aliases in existing nodes are rejected before official request',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);state.requests.length=0;
  const result=await page.evaluate(async()=>{
    const node=createNode('generator',0,0,{model:'gpt-image-2.5-1k',prompt:'Synthetic prompt',resolution:'1K',ratio:'1:1',_deferRender:true});
    try{await callApi(node);return '';}catch(error){return error.message;}
  });
  assert.match(result,/官方绘图|GPT 图像/);assert.equal(state.requests.length,0);
}));

test('official HTTP failures each make one request and never fall back to third-party or another endpoint',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);
  for(const status of [401,403,429,500]){
    state.imageStatus=status;state.requests.length=0;
    const error=await page.evaluate(async()=>{const node=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'Synthetic prompt',resolution:'1K',ratio:'1:1',_deferRender:true});try{await callApi(node);return '';}catch(error){return error.message;}});
    assert.match(error,new RegExp('HTTP '+status));assert.equal(state.requests.length,1);
    assert.equal(state.requests[0].host,'api.openai.com');assert.equal(state.requests[0].path,'/v1/images/generations');
  }
}));

test('official config with unavailable model endpoint cannot revive stale third-party cached model aliases',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);
  await page.evaluate(async()=>{
    await persistApiConfig();
    canvasTestStorage.setItem('aiCanvasAllModels',JSON.stringify(['gpt-image-2.5-1k','gemini-3-pro-image-preview','gpt-6-astra']));
    canvasTestStorage.setItem('aiCanvasImageModels',JSON.stringify(['gpt-image-2.5-1k','gemini-3-pro-image-preview']));
  });
  state.modelsStatus=503;
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const snapshot=await page.evaluate(()=>({models:[...imageModelOptions],assistant:[...assistantModelOptions],profile:apiProfileForModel()}));
  assert.equal(snapshot.profile.provider,'openai');
  assert.ok(!snapshot.models.some(model=>/2\.5-1k|gemini/.test(model)),JSON.stringify(snapshot.models));
  assert.equal(snapshot.assistant.length,0);
}));

test('channel 2 official-only configuration can save, sync and reopen without a channel 1 key',async()=>fixture(async(page,state)=>{
  await page.locator('#imageProvider-channel2').selectOption('openai');
  await page.locator('#apiKey2').fill('synthetic-official-channel2');
  await page.locator('#saveApiButton').click();
  await page.waitForFunction(()=>!document.querySelector('#saveApiButton').disabled);
  const snapshot=await page.evaluate(()=>({local:JSON.parse(canvasTestStorage.getItem('aiCanvasApi')||'null'),profile:apiProfileForModel('gpt-image-2.6-flare · 渠道 2')}));
  assert.ok(snapshot.local,'Configuration must be persisted with only channel 2 present');
  assert.equal(snapshot.local.channels.channel2.openai.key,'synthetic-official-channel2');
  assert.equal(snapshot.local.key,'');assert.equal(snapshot.local.key2,'');
  assert.ok(state.requests.some(request=>request.host==='api.openai.com'&&request.path==='/v1/models'));
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const restored=await page.evaluate(()=>({models:[...imageModelOptions],profile:apiProfileForModel('gpt-image-2.6-flare · 渠道 2')}));
  assert.equal(restored.profile.provider,'openai');assert.equal(restored.profile.key,'synthetic-official-channel2');
  assert.ok(restored.models.includes('gpt-image-2.6-flare · 渠道 2'));
}));

test('existing audio node refuses image-only official channel before any API request',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);state.requests.length=0;
  const error=await page.evaluate(async()=>{const node=createNode('audio',0,0,{model:'tts-1',prompt:'Synthetic speech',audioVoice:'alloy',audioFormat:'mp3',_deferRender:true});try{await callAudioApi(node);return '';}catch(error){return error.message;}});
  assert.match(error,/仅.*绘图|只.*绘图/);assert.equal(state.requests.length,0);
}));

test('chat assistant refuses image-only official channel before any API request',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);state.requests.length=0;
  await page.evaluate(()=>sendAssistantMessage('Synthetic text, no network permitted'));
  assert.equal(state.requests.length,0,'Image-only official channel must not call chat endpoint');
}));

test('shared browser request boundary blocks direct non-image helpers and invalid official URLs',async()=>fixture(async(page,state)=>{
  await selectOfficial(page);state.requests.length=0;
  const failures=await page.evaluate(async()=>{
    const attempts=[
      ['https://api.openai.com/v1/chat/completions','POST'],
      ['https://api.openai.com/v1/audio/speech','POST'],
      ['https://api.openai.com/v1/videos','POST'],
      ['https://api.openai.com/v1/images/generations','GET'],
      ['https://api.openai.com/v1/models','POST'],
      ['https://api.openai.com:8443/v1/models','GET'],
      ['https://key@api.openai.com/v1/models','GET'],
      ['https://api.openai.com/v1/models?redirect=other','GET'],
      ['http://api.openai.com/v1/models','GET']
    ];
    return Promise.all(attempts.map(async([url,method])=>{try{await fetchMaybeProxied(url,{method});return '';}catch(error){return error.message;}}));
  });
  assert.ok(failures.every(message=>/仅用于绘图/.test(message)),JSON.stringify(failures));
  assert.equal(state.requests.length,0);
}));
