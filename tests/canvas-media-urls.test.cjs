const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
const desktop = process.env.WANDOU_TEST_DESKTOP_ROOT || path.resolve(app, '../desktop-client');
const token = 'a'.repeat(64), runtime = `wandou-media://${token}/image-1`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z08sAAAAASUVORK5CYII=', 'base64');
const data = `data:image/png;base64,${png.toString('base64')}`;
function functionSource(source, name) {
  const start = source.search(new RegExp(`^    (?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `actual function ${name} exists`);
  const match = /\n    (?:async )?function /g; match.lastIndex = start + 1;
  const end = match.exec(source)?.index;
  assert.ok(end > start, `actual function ${name} has next boundary`);
  return source.slice(start, end);
}
const source = fs.readFileSync(path.join(app, 'ai-node-canvas-test.html'), 'utf8');
function run(names, env) {
  if (names.includes('buildApiRequest') && source.includes('function imageEditModelError(')) names = ['imageEditModelError', ...names];
  vm.runInNewContext(names.map(n => functionSource(source, n)).join('\n'), env);
  return env;
}
function helperEnvironment(overrides = {}) {
  const env = { Promise, Map, Blob, Response, ...overrides };
  env.window = env;
  env.fetch ||= async url => { assert.equal(url, runtime); return new Response(png, { headers: { 'content-type': 'image/png' } }); };
  env.FileReader ||= class { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }); } };
  vm.runInNewContext(fs.readFileSync(path.join(app, 'canvas-media-urls.js'), 'utf8'), env);
  return env;
}

test('protocol restricts IDs/session/methods and returns exact PNG and UTF-8 SVG bytes', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'wandou-protocol-test-'));
  const api = require(path.join(desktop, 'canvas-media-protocol.cjs'))({ directory: () => temp });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await fsp.writeFile(path.join(temp, 'image-1.data'), data);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>豌豆测试</text></svg>';
    await fsp.writeFile(path.join(temp, 'svg.data'), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    await fsp.writeFile(path.join(temp, 'audio.data'), 'data:audio/wav;base64,AA==');
    for (const id of ['../image-1', '..', 'a/b', 'a\\b', '%2e%2e', 'a'.repeat(101), '']) assert.equal((await api.getUrl(id)).success, false);
    assert.equal((await api.getUrl('audio')).unsupported, true);
    const image = await api.getUrl('image-1'); assert.equal(image.success, true);
    const response = await api.handle({ url: image.url, method: 'GET' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    const svgResponse = await api.handle({ url: (await api.getUrl('svg')).url, method: 'GET' });
    assert.equal(await svgResponse.text(), svg);
    for (const url of [runtime, `${image.url}?file=../secret`, `${image.url}#x`, `${image.url}/x`, image.url.replace('/image-1', '/%2e%2e%2fimage-1')]) {
      assert.equal((await api.handle({url,method:'GET'})).status, 404);
    }
    assert.equal((await api.handle({url:image.url,method:'POST'})).status, 405);
    const all = await Promise.all(Array.from({length:12}, () => api.handle({url:image.url,method:'GET'})));
    for(const item of all) assert.deepEqual(Buffer.from(await item.arrayBuffer()), png);
    await fsp.unlink(path.join(temp, 'image-1.data'));
    assert.equal((await api.handle({url:image.url,method:'GET'})).status,404, 'no original-byte cache masks missing files');
  } finally { clearInterval(keepAlive); api.dispose(); await fsp.rm(temp, { recursive: true, force: true }); }
});

test('API helper materializes only selected local images, once per request, without mutating live references', async () => {
  let reads = 0;
  const env = helperEnvironment({fetch:async () => { reads++; return new Response(png,{headers:{'content-type':'image/png'}}); }});
  const refs = [{url:runtime,maskUrl:runtime,maskSelectionUrl:runtime,doodleUrl:runtime},{url:'https://example.test/remote.png'}];
  const output = await env.WandouMediaUrls.materializeReferences(refs);
  assert.equal(reads, 1); assert.equal(refs[0].url, runtime);
  for(const field of ['url','maskUrl','maskSelectionUrl','doodleUrl']) assert.equal(output[0][field],data);
  assert.equal(output[1].url,refs[1].url);
  assert.equal(env.WandouMediaUrls.storedReference(runtime),'indexed-media:image-1');
  env.fetch = async () => new Response(null,{status:404});
  await assert.rejects(env.WandouMediaUrls.toDataUrl(runtime), /原图读取失败/);
});

for(const file of ['ai-node-canvas-test.html','ai-node-canvas.html']) test(`${file}: restore prefers short URL; persist never stores token`, async () => {
  const env = helperEnvironment({wandouShell:{getCanvasMediaUrl:async () => ({success:true,url:runtime}), readCanvasMedia:async () => assert.fail('must not transfer original bytes')}});
  Object.assign(env,{localMediaPrefix:'indexed-media:',pendingLocalMediaWrites:new Map(),persistedLocalMediaIds:new Set(),putLocalMedia:async () => assert.fail('runtime URL already persisted')});
  const html=fs.readFileSync(path.join(app,file),'utf8');
  vm.runInNewContext(functionSource(html,'getLocalMedia')+'\n'+functionSource(html,'persistMediaValue'),env);
  assert.equal(await env.getLocalMedia('indexed-media:image-1'),runtime);
  assert.equal(await env.persistMediaValue(runtime),'indexed-media:image-1');
});

test('durable save releases generated originals and references without replacing concurrent edits or another project', async () => {
  const node={id:'1',mediaUrl:data,fullUrl:data,references:[{url:data,maskUrl:data}]};
  const snapshot=structuredClone(node), saved={id:'1',mediaUrl:'indexed-media:image-1',fullUrl:'indexed-media:image-1',references:[{url:'indexed-media:image-1',maskUrl:'indexed-media:image-1'}]};
  let refreshed=0,released=0;
  const env=helperEnvironment({wandouShell:{getCanvasMediaUrl:async () => ({success:true,url:runtime})}});
  Object.assign(env,{nodes:[node],activeProjectId:'p1',currentFolderId:'f1',intentionalResetAt:0,localMediaPrefix:'indexed-media:',WandouSavePipeline:require(path.join(app,'canvas-save-pipeline.js')),WandouCanvasPreview:{releaseSource:()=>released++},refreshRenderedNode:()=>refreshed++});
  run(['releaseSavedCanvasMedia'],env);
  const ctx={liveNodes:env.nodes,liveIdentities:new Map([['1',node]]),projectId:'p1',state:{folderId:'f1',intentionalResetAt:0}};
  node.fullUrl='edited';
  await env.releaseSavedCanvasMedia(ctx,[snapshot],[saved]);
  assert.equal(node.mediaUrl,runtime);assert.equal(node.fullUrl,'edited');assert.equal(node.references[0].maskUrl,runtime);assert.equal(refreshed,1);assert.equal(released,3);
  node.mediaUrl=data;env.activeProjectId='p2';
  await env.releaseSavedCanvasMedia(ctx,[snapshot],[saved]);assert.equal(node.mediaUrl,data);
  env.activeProjectId='p1';env.intentionalResetAt=1;
  await env.releaseSavedCanvasMedia(ctx,[snapshot],[saved]);assert.equal(node.mediaUrl,data);
  env.intentionalResetAt=0;env.nodes=[{...node}];
  await env.releaseSavedCanvasMedia(ctx,[snapshot],[saved]);assert.equal(env.nodes[0].mediaUrl,data);
});

test('save failure never replaces live originals; successful committed snapshot stores stable references', async () => {
  const node={id:'1',mediaUrl:data};let releaseCalls=0, diskSuccess=false;
  const env={window:{wandouShell:{writeCanvasBackup:()=>{},getCanvasMediaUrl:()=>{}}},canvasRecoveryBlocked:false,saveTimer:null,clearTimeout,remoteMediaSaveDeadline:0,WandouSavePipeline:require(path.join(app,'canvas-save-pipeline.js')),serializeNodeForStorage:async n=>({...n,mediaUrl:'indexed-media:image-1'}),projects:[{id:'p1'}],activeProjectId:'p1',writeDesktopCanvasBackup:async ctx=>{assert.equal(ctx.state.nodes[0].mediaUrl,'indexed-media:image-1');return {success:diskSuccess}},saveProjects:()=>{},updateCanvasMediaSaveNotice:()=>{},releaseSavedCanvasMedia:()=>{releaseCalls++},showToast:()=>{},console:{warn:()=>{}}};
  run(['saveCanvasStateNow'],env);
  assert.equal(await env.saveCanvasStateNow({projectId:'p1',state:{nodes:[node]}}),false);assert.equal(releaseCalls,0);assert.equal(node.mediaUrl,data);
  diskSuccess=true;assert.equal(await env.saveCanvasStateNow({projectId:'p1',state:{nodes:[node]}}),true);assert.equal(releaseCalls,1);
});

test('keyword, video first/last, native Banana and masked-edit requests materialize local references before the remote boundary', async () => {
  const env=helperEnvironment();
  Object.assign(env,{FormData,File,promptWithSize:p=>p,modelToApiModel:m=>m,imageGenerationApiModel:m=>m,isOneKOnlyImageModel:()=>false,isGptImageModel:()=>true,isGrokImageModel:()=>false,promptRequestsTransparentPng:()=>false,apiSafeGenerationSize:()=> '1024x1024',apiSizeFromTarget:()=> '1024x1024',videoModeForNode:n=>n.videoMode,videoCapabilitiesForModel:()=>({}),fixedVideoAspectRatio:()=>'',ratioKey:r=>r,videoDefaultDurationForModel:()=>8,keywordModelForNode:n=>n.model});
  run(['buildApiRequest','messageContentFor'],env);
  env.modelToPromptModel = m => m;
  const base={model:'gpt-image-2',prompt:'test',_apiTargetSize:'1024x1024',ratio:'1:1',resolution:'1K'};
  const keyword=JSON.parse((await env.buildApiRequest({...base,type:'keyword'},[{url:runtime}])).body);
  assert.equal(keyword.messages[1].content[1].image_url.url,data);
  const video=JSON.parse((await env.buildApiRequest({...base,type:'video',videoMode:'firstLast'},[{url:runtime},{url:runtime}])).body);
  assert.equal(video.first_frame_image,data);assert.equal(video.last_frame_image,data);assert.ok(!JSON.stringify(video).includes('wandou-media:'));
  env.referenceToPngFile=async ref=>{assert.equal(ref.url,data);assert.equal(ref.maskSelectionUrl,data);return new File([png],'image.png',{type:'image/png'})};
  env.referenceToFile=async ref=>{assert.equal(ref.url,data);return new File([png],'mask.png',{type:'image/png'})};
  const masked=await env.buildApiRequest({...base,type:'generator'},[{url:runtime,maskUrl:runtime,maskSelectionUrl:runtime}]);
  assert.equal(masked.isFormData,true);assert.deepEqual(Buffer.from(await masked.body.get('image').arrayBuffer()),png);assert.deepEqual(Buffer.from(await masked.body.get('mask').arrayBuffer()),png);
  Object.assign(env,{nanoBananaImageSettings:()=>({imageConfig:{imageSize:'1K'},size:'1024x1024'}),sizeFromRatio:()=> '1024x1024',referenceToGeminiImagePart:async ref=>{assert.equal(ref.url,data);return {inlineData:{mimeType:'image/png',data:png.toString('base64')}}},normalizeGeminiGenerateEndpoint:u=>u,fetchMaybeProxied:async (url,opts)=>{const body=JSON.parse(opts.body);assert.equal(body.contents[0].parts[1].inlineData.data,png.toString('base64'));assert.ok(!opts.body.includes('wandou-media:'));return new Response(JSON.stringify({url:'https://example.test/output.png'}))},extractMediaUrl:r=>r.url,extractMediaUrls:r=>[r.url]});
  run(['callNanoBananaApi'],env);
  assert.equal((await env.callNanoBananaApi({...base,type:'generator'},[{url:runtime}],'https://example.test/api',{},undefined)).url,'https://example.test/output.png');
});

test('portable project export contains original bytes for all image fields and no session token', async () => {
  const env=helperEnvironment();Object.assign(env,{getLocalMedia:async x=>x});
  run(['portableProjectMedia','serializeNodeForProjectExport'],env);
  const result=await env.serializeNodeForProjectExport({mediaUrl:runtime,fullUrl:runtime,previewUrl:runtime,sourceUrl:runtime,outpaintSourceUrl:runtime,references:[{url:runtime,maskUrl:runtime,maskSelectionUrl:runtime,doodleUrl:runtime}]});
  assert.ok(!JSON.stringify(result).includes('wandou-media:'));
  for(const value of Object.values(result).filter(x=>typeof x==='string')) assert.equal(value,data);
  for(const value of Object.values(result.references[0]))assert.equal(value,data);
});

test('restored assistant conversation images are materialized before chat JSON is sent', async () => {
  const env=helperEnvironment();
  Object.assign(env,{normalizeApiEndpoint:u=>u,extractText:r=>r.text,fetchMaybeProxied:async (url,opts)=>{
    const body=JSON.parse(opts.body);assert.equal(body.messages[1].content[0].image_url.url,data);assert.ok(!opts.body.includes('wandou-media:'));
    return new Response(JSON.stringify({text:'ok'}));
  }});
  run(['postChatCompletion'],env);
  const body={messages:[{role:'system',content:'test'},{role:'user',content:[{type:'image_url',image_url:{url:runtime,detail:'high'}}]}]};
  await env.postChatCompletion('https://example.test/chat',{},body);
  assert.equal(body.messages[1].content[0].image_url.url,runtime,'live conversation stays compact');
});

test('failed background undo writes retain recoverable media without an unhandled rejection; retention is bounded', async () => {
  const env=helperEnvironment();
  Object.assign(env,{localMediaPrefix:'indexed-media:',persistedLocalMediaIds:new Set(),pendingLocalMediaWrites:new Map(),pendingHistoryMediaPersistIds:new Set(),mediaStorageId:()=> 'image-1',putLocalMedia:async()=>{throw new Error('disk full')},openLocalMediaDb:async()=>null,console:{warn:()=>{}}});
  run(['queueLargeMediaPersist','getLocalMedia'],env);
  assert.equal(env.queueLargeMediaPersist(data),'indexed-media:image-1');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(env.pendingHistoryMediaPersistIds.size,0);
  assert.equal(await env.getLocalMedia('indexed-media:image-1'),data);
  env.putLocalMedia=async()=> 'indexed-media:image-1';
  env.queueLargeMediaPersist(data);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(env.WandouMediaUrls.historyValue('image-1'),'');
  const big='data:image/png;base64,'+'A'.repeat(34*1024*1024);
  assert.equal(env.queueLargeMediaPersist(big),big,'oversized history remains inline instead of losing its original');
  assert.equal(env.WandouMediaUrls.historyValue('image-1'),'');
});

test('live image edits made while a short URL resolves are never overwritten', async () => {
  let unlock;
  const node={id:'1',mediaUrl:data};
  const env=helperEnvironment();
  env.WandouMediaUrls.resolve=()=>new Promise(resolve=>unlock=resolve);
  Object.assign(env,{nodes:[node],activeProjectId:'p1',currentFolderId:'f1',intentionalResetAt:0,localMediaPrefix:'indexed-media:',WandouSavePipeline:require(path.join(app,'canvas-save-pipeline.js')),refreshRenderedNode:()=>assert.fail('changed node must not be refreshed')});
  run(['releaseSavedCanvasMedia'],env);
  const ctx={liveNodes:env.nodes,liveIdentities:new Map([['1',node]]),projectId:'p1',state:{folderId:'f1',intentionalResetAt:0}};
  const task=env.releaseSavedCanvasMedia(ctx,[{...node}],[{id:'1',mediaUrl:'indexed-media:image-1'}]);
  node.mediaUrl='new edit';unlock(runtime);await task;
  assert.equal(node.mediaUrl,'new edit');
});
