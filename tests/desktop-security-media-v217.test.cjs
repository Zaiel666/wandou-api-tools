const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const desktop = path.resolve(__dirname, '../desktop-client');
const main = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
const createPolicy = require(path.join(desktop, 'ipc-policy.cjs'));
const updatePolicy = require(path.join(desktop, 'update-policy.cjs'));
const createWriter = require(path.join(desktop, 'canvas-media-writer.cjs'));
const fingerprint = require(path.join(desktop, 'canvas-backup-guard.cjs')).fingerprint;
const idFor = value => `sha256-${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
const root = path.resolve(__dirname, '../app');
function event(url) { const frame = {url}; return {senderFrame:frame,sender:{mainFrame:frame}}; }
function slice(start, end) { const a=main.indexOf(start),b=main.indexOf(end,a+start.length); assert.ok(a>=0&&b>a,start);return main.slice(a,b); }

test('all desktop IPC is gated; remote, subframe and fake shell cannot invoke privilege handlers', async () => {
  const shellFile=path.join(desktop,'shell.html'), shellEvent=event(pathToFileURL(shellFile).href);
  const policy=createPolicy({appRoot:()=>root,shellFile,shellContents:()=>shellEvent.sender});
  const local=event(pathToFileURL(path.join(root,'ai-node-canvas-test.html')).href);
  const remote=event('https://wandou-video-workbench.netlify.app/');
  const subframe={...local,senderFrame:{url:local.senderFrame.url}};
  const fake=event(pathToFileURL(shellFile).href);
  const registry=new Map(), events=new Map(), ipc={handle:(k,v)=>registry.set(k,v),on:(k,v)=>events.set(k,v)};
  const channels=[...main.matchAll(/(?:handleDesktop|onDesktop)\(['"](desktop:[^'"]+)/g)].map(m=>m[1]);
  assert.ok(channels.length>35); assert.doesNotMatch(main,/ipcMain\.(?:handle|on)\(/);
  let calls=0;
  for(const channel of channels){
    policy.handle(ipc,channel,()=>{calls++;return{success:true}});
    for(const denied of [remote,subframe,fake,event('file:///C:/private/secret.html')]){
      assert.equal((await registry.get(channel)(denied)).success,false,channel);
    }
    if(['desktop:shell-ready','desktop:cancel-close','desktop:confirm-close','desktop:start-update'].includes(channel)) assert.equal((await registry.get(channel)(local)).success,false);
    else assert.equal((await registry.get(channel)(local)).success,true);
    assert.equal((await registry.get(channel)(shellEvent)).success,true);
    policy.on(ipc,channel,()=>calls++);const before=calls;events.get(channel)(remote);assert.equal(calls,before);
  }
});

test('update metadata and redirects stay in official repository/download hosts', () => {
  const policy=updatePolicy({githubOwner:'Zaiel666',githubRepository:'wandou-api-tools',assetName:'app.zip'});
  const base='https://github.com/Zaiel666/wandou-api-tools/releases/download/v2.0.17/';
  const valid={latestVersion:'2.0.17',downloadUrl:base+'app.zip',checksumUrl:base+'app.zip.sha256'};
  assert.equal(policy.metadata(valid).assetName,'app.zip');
  assert.equal(policy.redirect('https://release-assets.githubusercontent.com/signed-package?token=x'),true);
  for(const url of ['https://evil.test/a','https://github.com/another/repo/releases/download/v2.0.17/app.zip','http://github.com/Zaiel666/wandou-api-tools/releases/a','https://github.com.evil.test/a','https://user:pass@github.com/Zaiel666/wandou-api-tools/releases/a'])assert.throws(()=>policy.initial(url));
  assert.throws(()=>policy.metadata({...valid,downloadUrl:base+'wrong.zip'}));
  assert.throws(()=>policy.metadata({...valid,latestVersion:'2.0.18'}));
  assert.throws(()=>policy.metadata({...valid,packageApiUrl:'https://api.github.com/repos/another/repo/releases/assets/7'}));
  assert.throws(()=>policy.redirect('https://evil.test/download'));
});

test('main updater ignores forged URLs/save flags and refuses incomplete workflows before any download', async () => {
  const config={githubOwner:'Zaiel666',githubRepository:'wandou-api-tools',assetName:'app.zip'};
  const base='https://github.com/Zaiel666/wandou-api-tools/releases/download/v2.0.17/';
  let checked=0,saved=0,downloads=0;
  const env={app:{isPackaged:true},updateInProgress:false,require:p=>p==='./update-policy.cjs'?updatePolicy:require(p),
    checkForUpdates:async()=>{checked++;return{available:true,latestVersion:'2.0.17',downloadUrl:base+'app.zip',checksumUrl:base+'app.zip.sha256'}},
    readClientConfig:()=>config,verifyWorkflowsForUpdate:async()=>{saved++;throw Error('仍在生成')},sendUpdateStatus:()=>{},
    downloadFileWithFallback:async()=>downloads++,fs,path,os,crypto};
  vm.runInNewContext(slice('async function startPortableUpdate(', 'async function verifyWorkflowsForUpdate('),env);
  const result=await env.startPortableUpdate({available:true,latestVersion:'2.0.17',saveVerified:true,saveVerifiedAt:Date.now(),downloadUrl:'https://evil.test/a',checksumUrl:'https://evil.test/b'});
  assert.equal(result.started,false);assert.equal(checked,1);assert.equal(saved,1);assert.equal(downloads,0);assert.equal(env.updateInProgress,false);
});

test('update busy gate obtains save result from shell itself, not caller payload', async()=>{
  let saves=0;const env={activeCanvasApiCount:1,storageMigrationPreparing:false,mainWindow:{isDestroyed:()=>false,webContents:{executeJavaScript:async()=>{saves++;return{success:true}}}}};
  vm.runInNewContext(slice('async function verifyWorkflowsForUpdate(', 'function getAppRoot('),env);
  await assert.rejects(env.verifyWorkflowsForUpdate(),/仍有生成/);assert.equal(saves,0);
  env.activeCanvasApiCount=0;await env.verifyWorkflowsForUpdate();assert.equal(saves,1);
  env.mainWindow.webContents.executeJavaScript=async()=>({success:false});await assert.rejects(env.verifyWorkflowsForUpdate(),/尚未安全保存/);
});

test('official updater verifies checksum, rechecks work after download, and only then hands off', async()=>{
  for(const scenario of ['success','checksum-mismatch','late-generation']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-update-v217-'));
    const config={githubOwner:'Zaiel666',githubRepository:'wandou-api-tools',assetName:'app.zip'};
    const base='https://github.com/Zaiel666/wandou-api-tools/releases/download/v2.0.17/';
    const archive=Buffer.from('synthetic ZIP, never executed'),sources=[],statuses=[];
    let saves=0,spawned=0,quitScheduled=false;
    const env={app:{isPackaged:true,quit:()=>{}},updateInProgress:false,allowWindowClose:false,
      require:p=>p==='./update-policy.cjs'?updatePolicy:require(p),path,os,crypto,Buffer,process:{pid:12345,resourcesPath:dir},
      fs:{existsSync:fs.existsSync,promises:{...fs.promises,mkdtemp:async()=>dir,copyFile:async(_from,to)=>fs.promises.writeFile(to,'stub updater')}},
      readClientConfig:()=>config,checkForUpdates:async()=>({available:true,latestVersion:'2.0.17',downloadUrl:base+'app.zip',checksumUrl:base+'app.zip.sha256'}),
      verifyWorkflowsForUpdate:async()=>{saves++;if(scenario==='late-generation'&&saves===2)throw Error('仍在生成')},
      sendUpdateStatus:(...args)=>statuses.push(args),portableInstallContext:()=>({installDirectory:dir,executable:'fake.exe'}),
      downloadFileWithFallback:async(url,destination)=>{sources.push(url);await fs.promises.writeFile(destination,url.endsWith('.sha256')?(scenario==='checksum-mismatch'?'0'.repeat(64):crypto.createHash('sha256').update(archive).digest('hex')):archive)},
      spawn:(_exe,args)=>{spawned++;fs.writeFileSync(args[args.indexOf('--ready')+1],'ready');const child=new(require('node:events').EventEmitter)();child.unref=()=>{};return child},
      setInterval,clearInterval,setTimeout:()=>{quitScheduled=true}};
    try{
      vm.runInNewContext(slice('async function startPortableUpdate(', 'async function verifyWorkflowsForUpdate('),env);
      const result=await env.startPortableUpdate({available:true,latestVersion:'2.0.17',downloadUrl:'https://evil.test/a',checksumUrl:'https://evil.test/b'});
      assert.deepEqual(sources,[base+'app.zip',base+'app.zip.sha256']);
      assert.equal(result.started,scenario==='success');assert.equal(spawned,scenario==='success'?1:0);assert.equal(quitScheduled,scenario==='success');
      assert.equal(saves,scenario==='checksum-mismatch'?1:2);
      if(scenario!=='success'){assert.equal(env.updateInProgress,false);assert.equal(env.allowWindowClose,false)}
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  }
});

test('network redirects are validated before following, including malicious redirects from official URLs',async()=>{
  const config={githubOwner:'Zaiel666',githubRepository:'wandou-api-tools',assetName:'app.zip'},seen=[];
  const env={AbortController,setTimeout,clearTimeout,URL,readClientConfig:()=>config,require:p=>p==='./update-policy.cjs'?updatePolicy:require(p),
    net:{fetch:async url=>{seen.push(url);return{status:302,headers:{get:()=> 'https://evil.test/payload'}}}}};
  vm.runInNewContext(slice('async function fetchWithTimeout(', 'function normalizeUpdateInfo('),env);
  await assert.rejects(env.fetchWithTimeout('https://github.com/Zaiel666/wandou-api-tools/releases/latest'),/官方仓库/);
  assert.equal(seen.length,1);assert.ok(seen.every(url=>url.startsWith('https://github.com/')));
});

test('hashed media validates direct writes, detects corrupt existing content, and repairs from verified original', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-media-v217-'));
  try{
    const env={fs,path,crypto,process,safeCanvasBackupId:v=>v,canvasMediaPath:id=>path.join(dir,id+'.data'),canvasMediaRootDirectory:()=>dir};
    vm.runInNewContext(slice('async function hasCanvasMedia(', 'function canvasBackupDirectory(')+'\n'+slice('function canvasMediaStorageId(', 'async function compactEmbeddedCanvasMedia('),env);
    const value='data:image/png;base64,aGVsbG8=',id=idFor(value);
    assert.equal((await env.writeCanvasMedia({id,value})).success,true);
    assert.equal((await env.hasCanvasMedia({id})).exists,true);
    assert.equal((await env.writeCanvasMedia({id,value})).deduplicated,true);
    assert.equal((await env.writeCanvasMedia({id,value:value+'a'})).success,false);
    fs.writeFileSync(env.canvasMediaPath(id),'data:corrupt');
    assert.equal((await env.hasCanvasMedia({id})).exists,false);
    assert.equal((await env.readCanvasMedia({id})).corrupt,true);
    assert.equal((await env.writeCanvasMedia({id,value})).success,true);
    assert.equal((await env.readCanvasMedia({id})).value,value);
    fs.writeFileSync(env.canvasMediaPath('legacy-123'),value);
    assert.equal((await env.readCanvasMedia({id:'legacy-123'})).value,value);
    assert.equal((await env.writeCanvasMedia({id:'legacy-123',value:value+'x'})).success,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('chunk writer rejects mismatch, preserves legacy originals, publishes complete SHA media only',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wandou-chunks-v217-'));
  const destination=id=>path.join(dir,id+'.data'),writer=createWriter({directory:()=>dir,destination});
  async function write(id,value){
    const begin=await writer.write('owner',{action:'begin',id,length:value.length});assert.equal(begin.success,true);
    let offset=0;for(const chunk of [value.slice(0,20),value.slice(20)]){const r=await writer.write('owner',{action:'chunk',token:begin.token,offset,chunk});assert.equal(r.success,true);offset+=chunk.length}
    return writer.write('owner',{action:'commit',token:begin.token});
  }
  try{
    const value='data:image/png;base64,'+'A'.repeat(4096),id=idFor(value);
    assert.equal((await write(id,value+'B')).success,false);assert.equal(fs.existsSync(destination(id)),false);
    assert.equal((await write(id,value)).success,true);assert.equal(fs.readFileSync(destination(id),'utf8'),value);
    fs.writeFileSync(destination('legacy-123'),value);
    assert.equal((await write('legacy-123',value+'B')).success,false);assert.equal(fs.readFileSync(destination('legacy-123'),'utf8'),value);
    assert.equal(fs.readdirSync(dir).some(name=>name.endsWith('.tmp')),false);
  }finally{await writer.disposeOwner('owner');fs.rmSync(dir,{recursive:true,force:true})}
});

test('complete content fingerprints distinguish the old sampled-hash collision and preserve ref equivalence',()=>{
  const a='data:image/bmp;base64,'+'A'.repeat(40000),b=a.slice(0,100)+'B'+a.slice(101);
  assert.notEqual(idFor(a),idFor(b));
  const state=value=>({nodes:[{id:'1',mediaUrl:value}]});
  assert.notEqual(fingerprint(state(a)),fingerprint(state(b)));
  assert.equal(fingerprint(state(a)),fingerprint(state('indexed-media:'+idFor(a))));
  assert.equal(fingerprint(state('indexed-media:old-123')),fingerprint(state(`wandou-media://${'a'.repeat(64)}/old-123`)));
});
