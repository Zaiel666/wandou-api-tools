const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),vm=require('node:vm');
const desktop=process.env.WANDOU_TEST_DESKTOP_ROOT||path.resolve(__dirname,'../desktop-client');
const createStorage=require(path.join(desktop,'project-storage.cjs'));
const parent=path.resolve(__dirname,'../artifacts/storage-directory-20261025/independent-storage-fixtures');fs.mkdirSync(parent,{recursive:true});
function fixture(fault){const base=fs.mkdtempSync(path.join(parent,'case-')),legacy=path.join(base,'profile'),disk=path.join(base,'disk'),install=path.join(base,'installation');for(const dir of [legacy,disk,install])fs.mkdirSync(dir);fs.mkdirSync(path.join(legacy,'canvas-media'));fs.writeFileSync(path.join(legacy,'canvas-media','original.data'),'data:image/png;base64,AA==');return{base,legacy,disk,install,make:extra=>createStorage({legacyRoot:legacy,installRoot:install,fault,...extra})};}

test('migration preflight rejects each actual canvas job type even between API calls',async()=>{
 const source=fs.readFileSync(path.join(desktop,'main.js'),'utf8');const start=source.indexOf('async function inspectStorageMigrationTabs()'),end=source.indexOf('async function requestProjectStorageMigration(',start);assert.ok(start>=0&&end>start);
 for(const busy of ['none','pending','psd','vector','audio','assistant']){
  const guest={nodes:busy==='pending'?[{pending:true}]:[],psdJobs:new Set(busy==='psd'?['job']:[]),vectorJobs:new Set(busy==='vector'?['job']:[]),audioJobs:new Map(busy==='audio'?[['job',{}]]:[]),assistantSending:busy==='assistant'};
  const tab={url:'file:///app/ai-node-canvas-test.html',title:'Synthetic canvas',domReady:true,view:{executeJavaScript:code=>vm.runInNewContext(code,guest)}};
  const shell={URL,tabs:new Map([['one',tab]]),isNodeCanvasTab:()=>true,safeWebviewCall:()=>false};
  const env={shellReady:true,activeCanvasApiCount:0,mainWindow:{isDestroyed:()=>false,webContents:{executeJavaScript:code=>vm.runInNewContext(code,shell)}}};
  vm.runInNewContext(source.slice(start,end),env);
  if(busy==='none')await env.inspectStorageMigrationTabs();else await assert.rejects(env.inspectStorageMigrationTabs(),/生成|处理|任务/,busy);
 }
});

test('freezing storage drains an already accepted asynchronous write and rejects later writes',async()=>{
 const f=fixture(),storage=f.make();await storage.initialize();let release,started;
 const entered=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);let done=false;
 const writing=storage.write(async()=>{started();await gate;await fsp.writeFile(path.join(f.legacy,'canvas-media','after.data'),'complete');return'committed'});await entered;
 const freezing=storage.freeze().then(()=>done=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
 await assert.rejects(storage.write(()=>{}),/切换|迁移/);release();assert.equal(await writing,'committed');await freezing;assert.equal(done,true);assert.equal(fs.readFileSync(path.join(f.legacy,'canvas-media','after.data'),'utf8'),'complete');
});

test('a fully published verified target finalizes after configuration interruption without needing another full copy',async()=>{
 let published=false;
 const f=fixture(async(phase,{value}={})=>{if(phase==='before-switch')published=true;if(phase==='config-rename'&&published)throw Error('Injected config switch interruption')});
 const first=f.make();await first.initialize();const selection=await first.choose(f.disk);await first.prepare(selection);
 const restart=f.make();const interrupted=await restart.initialize();assert.equal(interrupted.migrated,false);assert.equal(fs.existsSync(path.join(selection.targetDirectory,'canvas-media','original.data')),true);
 const originalStatfs=fsp.statfs;fsp.statfs=async()=>({bavail:1024,bsize:1});
 try{const retry=f.make({fault:async()=>{}});const result=await retry.initialize();assert.equal(result.migrated,true,result.error);assert.equal(retry.root(),selection.targetDirectory);assert.equal(fs.readFileSync(path.join(f.legacy,'canvas-media','original.data'),'utf8'),'data:image/png;base64,AA==');}
 finally{fsp.statfs=originalStatfs;}
});

test('runtime missing external marker latches writes off until a fresh startup validates the original data',async()=>{
 const f=fixture(),storage=f.make();await storage.initialize();const selection=await storage.choose(f.disk);await storage.prepare(selection);const active=f.make();assert.equal((await active.initialize()).migrated,true);
 const marker=path.join(selection.targetDirectory,'.wandou-project-storage.json'),held=path.join(selection.targetDirectory,'.isolated-offline-marker.json');fs.renameSync(marker,held);
 await assert.rejects(active.read(()=> 'must not run'),/不可用|中断|暂停|重启|重新/);fs.renameSync(held,marker);
 let wrote=false;await assert.rejects(active.write(()=>{wrote=true}),/不可用|中断|暂停|重启|重新/);assert.equal(wrote,false);
 const fresh=f.make();await fresh.initialize();assert.equal(await fresh.read(()=>fs.readFileSync(path.join(fresh.root(),'canvas-media','original.data'),'utf8')),'data:image/png;base64,AA==');
 assert.equal(fs.existsSync(path.join(f.legacy,'canvas-media','original.data')),true);
});
