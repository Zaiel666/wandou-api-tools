const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../desktop-client/shell.js'),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const code=part('function notifyTabActivity(', 'async function suspendInactiveCanvasTab(')+part('function safeWebviewCall(', 'function updateNavigation(');
test('new or detached webviews never interrupt tab activation',()=>{
 const ctx=vm.createContext({});vm.runInContext(code,ctx);
 let calls=0;
 const view={isLoading(){throw Error('guest not attached')},executeJavaScript(){calls++;return Promise.resolve()}};
 assert.doesNotThrow(()=>ctx.notifyTabActivity({view,domReady:false},true));
 assert.doesNotThrow(()=>ctx.notifyTabActivity({view,domReady:true},false));
 assert.equal(calls,0);
 view.isLoading=()=>false;
 view.executeJavaScript=()=>{throw Error('guest detached between checks')};
 assert.doesNotThrow(()=>ctx.notifyTabActivity({view,domReady:true},true));
});
test('ready guests still receive activity updates and rejection stays contained',async()=>{
 const ctx=vm.createContext({});vm.runInContext(code,ctx);
 let script;
 ctx.notifyTabActivity({domReady:true,view:{isLoading:()=>false,executeJavaScript:s=>{script=s;return Promise.reject(Error('navigated'))}}},true);
 assert.match(script,/wandouSetDesktopTabActive\(true\)/);
 await new Promise(r=>setImmediate(r));
});
