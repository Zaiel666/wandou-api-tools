const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL,fileURLToPath}=require('node:url');
const desktop=process.env.WANDOU_TEST_DESKTOP_ROOT||path.resolve(__dirname,'../desktop-client');
const createLocation=require(path.join(desktop,'canvas-media-location.cjs'));
const createProtocol=require(path.join(desktop,'canvas-media-protocol.cjs'));
const parent=path.resolve(__dirname,'../artifacts/asset-location-20261025/test-fixtures');
function fixture(){
 fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'location-')),root=path.join(base,'canvas-media');fs.mkdirSync(root);
 fs.writeFileSync(path.join(root,'original-1.data'),'data:image/png;base64,'+'A'.repeat(2*1024*1024));
 fs.writeFileSync(path.join(root,'preview-1.data'),'data:image/png;base64,AA==');
 fs.writeFileSync(path.join(root,'video.data'),'data:video/mp4;base64,AA==');
 const protocol=createProtocol({directory:()=>root}),shown=[];
 const api=createLocation({directory:()=>root,getUrl:protocol.getUrl,showItemInFolder:file=>shown.push(file)});
 return{base,root,api,protocol,shown};
}
test('stored and current runtime refs locate the actual managed original without full image reads or exposing tokens',async()=>{
 const f=fixture(),runtime=(await f.protocol.getUrl('original-1')).url;
 const readFile=fsp.readFile;fsp.readFile=async(file,...args)=>{if(String(file).endsWith('.data'))throw Error('full image read forbidden');return readFile(file,...args)};
 try{
  for(const ref of ['indexed-media:original-1',runtime]){const result=await f.api.get(ref);assert.equal(result.success,true);assert.equal(result.path,path.join(f.root,'original-1.data'));assert.equal(result.filename,'original-1.data');assert.equal(result.directory,f.root);assert.equal(result.storageFormat,'data-url');assert.equal(JSON.stringify(result).includes(new URL(runtime).hostname),false);assert.equal(result.url,undefined)}
  assert.equal(f.shown.length,0,'reading location does not open Explorer');
 }finally{fsp.readFile=readFile;f.protocol.dispose()}
});
test('arbitrary paths, traversal, unsupported refs and stale runtime sessions never open folders',async()=>{
 const f=fixture();
 try{
  const runtime=(await f.protocol.getUrl('original-1')).url;
  const invalid=[null,{},[],{ref:'indexed-media:original-1'},f.root,pathToFileURL(path.join(f.root,'original-1.data')).href,'https://example.test/original.png','data:image/png;base64,AA==','local-media://original-1','indexed-media:../original-1','indexed-media:..\\original-1','indexed-media:original-1.data','indexed-media:%2e%2e','indexed-media:'+'a'.repeat(101),runtime+'?x=1',runtime+'#x',runtime.replace(new URL(runtime).hostname,'0'.repeat(64)),runtime.replace('/original-1','/%2e%2e/original-1')];
  for(const ref of invalid){const r=await f.api.show(ref);assert.equal(r.success,false,String(ref));assert.equal(r.path,undefined,String(ref));}
  assert.equal(f.shown.length,0);
 }finally{f.protocol.dispose()}
});
test('missing/unsupported media is explicit; show rechecks existence and reveals only the selected original',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.api.get('indexed-media:missing')).missing,true);
  assert.equal((await f.api.get('indexed-media:video')).unsupported,true);
  const result=await f.api.show('indexed-media:original-1');assert.equal(result.shown,true);assert.deepEqual(f.shown,[path.join(f.root,'original-1.data')]);
  await f.api.get('indexed-media:preview-1');fs.renameSync(path.join(f.root,'preview-1.data'),path.join(f.root,'preview-1.retired'));
  assert.equal((await f.api.show('indexed-media:preview-1')).missing,true);assert.equal(f.shown.length,1);
 }finally{f.protocol.dispose()}
});
test('redirected root and non-regular targets cannot escape the managed media directory',async()=>{
 const f=fixture();
 try{
  fs.mkdirSync(path.join(f.root,'directory.data'));assert.equal((await f.api.get('indexed-media:directory')).success,false);
  const alias=path.join(f.base,'redirected-media');fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
  const redirected=createLocation({directory:()=>alias,getUrl:f.protocol.getUrl,showItemInFolder:file=>f.shown.push(file)});
  assert.equal((await redirected.show('indexed-media:original-1')).success,false);assert.equal(f.shown.length,0);
 }finally{f.protocol.dispose()}
});
test('actual IPC handlers only permit app main frames; preload wraps the raw reference and keeps older APIs',async()=>{
 const source=fs.readFileSync(path.join(desktop,'main.js'),'utf8'),handlers=new Map(),calls=[];
 const appRoot=path.resolve(desktop,'../app');
 const env={URL,path,fileURLToPath,getAppRoot:()=>appRoot,canvasMediaRootDirectory:()=>'',canvasMediaProtocol:{getUrl:()=>{}},shell:{},withProjectStorage:async(_kind,task)=>task(),ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},require:()=>()=>({get:ref=>{calls.push(['get',ref]);return{success:true}},show:ref=>{calls.push(['show',ref]);return{success:true}}})};
 const localStart=source.indexOf('function isLocalAppPage('),localEnd=source.indexOf('\nfunction ',localStart+1);
 const start=source.indexOf("const canvasMediaLocation = require("),end=source.indexOf('ipcMain.handle("desktop:write-export-artifact"',start);
 assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(localStart,localEnd)+'\n'+source.slice(start,end),env);
 for(const name of ['desktop:get-canvas-media-location','desktop:show-canvas-media-in-folder']){
  const handler=handlers.get(name);assert.equal(typeof handler,'function');
  for(const url of ['https://example.test/assets.html',pathToFileURL(path.join(parent,'untrusted.html')).href]){const frame={url};assert.equal((await handler({senderFrame:frame,sender:{mainFrame:frame}},{ref:'indexed-media:original-1'})).success,false)}
  const frame={url:pathToFileURL(path.join(appRoot,'asset-library.html')).href};assert.equal((await handler({senderFrame:frame,sender:{mainFrame:{url:frame.url}}},{ref:'indexed-media:original-1'})).success,false);
  assert.equal((await handler({senderFrame:frame,sender:{mainFrame:frame}},{ref:'indexed-media:original-1'})).success,true);
 }
 assert.equal(calls.length,2);
 const exposed={},invocations=[];
 vm.runInNewContext(fs.readFileSync(path.join(desktop,'preload.js'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(key,value)=>exposed[key]=value},ipcRenderer:{invoke:(...args)=>invocations.push(args)},webUtils:{}})});
 exposed.wandouShell.getCanvasMediaLocation('indexed-media:original-1');exposed.wandouShell.showCanvasMediaInFolder('indexed-media:original-1');
 assert.deepEqual(JSON.parse(JSON.stringify(invocations)),[['desktop:get-canvas-media-location',{ref:'indexed-media:original-1'}],['desktop:show-canvas-media-in-folder',{ref:'indexed-media:original-1'}]]);
 assert.equal(typeof exposed.wandouShell.writeCanvasMedia,'function');assert.equal(typeof exposed.wandouShell.writeSaveFile,'function');
});
