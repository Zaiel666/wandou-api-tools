const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=process.env.WANDOU_TEST_APP_ROOT||require('node:path').join(__dirname,'../app');
const source=fs.readFileSync(require('node:path').join(app,'ai-node-canvas-test.html'),'utf8');
function fixture({downloadError=new Error('HTTP 404'),diskError,blob=true}={}){
 let downloads=0,writes=0;
 const env={Date,Map,Promise,console,localMediaPrefix:'indexed-media:',mediaSourceSaveCache:new Map(),sourceToBlob:async()=>{downloads++;if(downloadError)throw downloadError;return blob?{size:10}:null;},blobToDataUrl:async()=> 'data:image/png;base64,AA',putLocalMedia:async()=>{writes++;if(diskError)throw diskError;return 'indexed-media:original';},WandouSavePipeline:require(require('node:path').join(app,'canvas-save-pipeline.js'))};
 const context=vm.createContext(env);
 env.window=env;
 vm.runInContext(source.slice(source.indexOf('    async function persistMediaValue('),source.indexOf('    function updateCanvasMediaSaveNotice')),context);
 vm.runInContext(source.slice(source.indexOf('    async function serializeNodeForStorage('),source.indexOf('    function isLargeDataUrl')),context);
 return {context,counts:()=>({downloads,writes})};
}
test('expired remote images keep exact URLs, node fields and masks in a saveable snapshot',async()=>{
 const f=fixture(),url='https://example.invalid/expired.png';
 const input={id:'a',x:500,y:600,prompt:'保留提示词',mediaUrl:url,fullUrl:url,sourceUrl:url,references:[{url,maskUrl:url,doodleUrl:url,comments:[{text:'批注'}]}]};
 const saved=await f.context.serializeNodeForStorage(input);
 assert.equal(saved.mediaUrl,url);assert.equal(saved.fullUrl,url);assert.equal(saved.x,500);assert.equal(saved.prompt,input.prompt);
 assert.equal(saved.references[0].doodleUrl,url);assert.equal(saved.references[0].comments[0].text,'批注');
 assert.equal(saved.mediaSaveWarnings.length,6);assert.ok(saved.mediaSaveWarnings.every(w=>w.error==='HTTP 404'));
 assert.equal(input.mediaSaveWarnings,undefined);assert.equal(f.counts().downloads,1);
});
test('local disk errors still reject a remote image save',async()=>{
 const f=fixture({downloadError:null,diskError:new Error('ENOSPC')});
 await assert.rejects(f.context.serializeNodeForStorage({mediaUrl:'https://example.invalid/new.png'}),/ENOSPC/);
});
test('blob failures cannot silently become a durable URL',async()=>{
 const f=fixture();await assert.rejects(f.context.serializeNodeForStorage({mediaUrl:'blob:lost'}),/404/);
});
test('remote retry budget bounds many unique URLs and survives reloading a warning',async()=>{
 const f=fixture();vm.runInContext('remoteMediaSaveDeadline=0',f.context);
 const a=await f.context.serializeNodeForStorage({mediaUrl:'https://example.invalid/a'});
 assert.equal(f.counts().downloads,0);assert.match(a.mediaSaveWarnings[0].error,/超时/);
 const g=fixture();await g.context.serializeNodeForStorage(a);assert.equal(g.counts().downloads,0);
});
test('successful retry clears stale warnings, stores the original locally and retains its source identity',async()=>{
 const f=fixture({downloadError:null});
 const saved=await f.context.serializeNodeForStorage({mediaUrl:'https://example.invalid/fixed',mediaSaveWarnings:[{url:'https://example.invalid/fixed',retryAfter:0}]});
 assert.equal(saved.mediaUrl,'indexed-media:original');assert.equal(saved.mediaSourceUrl,'https://example.invalid/fixed');assert.equal(saved.mediaSaveWarnings,undefined);
});
