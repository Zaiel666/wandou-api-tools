'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('../tools/canvas-ui-test/node_modules/linkedom');
const read=name=>fs.readFileSync(path.join(__dirname,'../app',name),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const png=()=>new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')],{type:'image/png'});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function fixture(){
 const {window,document}=parseHTML(read('type-motion.html')),store=new Map(),downloads=[];let failStorage=false;
 const ctx=new Proxy({measureText:t=>({width:t.length*50})},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 window.HTMLCanvasElement.prototype.getContext=()=>ctx;
 document.querySelectorAll('select').forEach(el=>Object.defineProperty(el,'value',{writable:true,value:el.querySelector('option').value}));
 const create=document.createElement.bind(document);document.createElement=name=>{const el=create(name);if(name==='a')el.click=()=>downloads.push(decodeURIComponent(el.download));return el;};
 document.fonts={add(){},delete(){}};
 const sandbox=vm.createContext({window,document,Blob,Uint8Array,DataView,Image:class{constructor(){this.width=this.height=100;}async decode(){}},FontFace:class{async load(){return this;}},MutationObserver:window.MutationObserver,matchMedia:()=>({matches:true}),localStorage:{getItem:k=>store.get(k),setItem(k,v){if(failStorage)throw new Error('synthetic quota');store.set(k,v);}},URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},btoa:s=>Buffer.from(s,'binary').toString('base64'),requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},console});
 vm.runInContext(read('type-motion.js'),sandbox);vm.runInContext(read('type-motion-workbench.js'),sandbox);await tick();
 return{window,document,store,downloads,sandbox,api:window.WandouTypeMotion,close:()=>window.wandouSaveBeforeClose(),failStorage:value=>{failStorage=value;}};
}

test('storage failure cannot become successful close and a retry persists the latest state',async()=>{
 const f=await fixture();await f.api.update({title:'saved version'});const before=f.store.get('wandou-type-motion-v1');f.failStorage(true);await f.api.update({title:'unsaved version'});
 assert.equal((await f.close()).success,false);assert.equal(f.store.get('wandou-type-motion-v1'),before);assert.equal(f.api.getState().title,'unsaved version');f.failStorage(false);assert.equal((await f.close()).success,true);assert.equal(JSON.parse(f.store.get('wandou-type-motion-v1')).title,'unsaved version');
});

test('async preparation blocks close and exports until settled; a rejected prepare releases the gate',async()=>{
 for(const reject of [false,true]){const f=await fixture(),gate=deferred();f.api.prepare=()=>gate.promise;const editing=f.api.update({title:'prepared title'});assert.equal((await f.close()).busy,true);assert.equal(f.api.externalExport(()=>{}),null);let recorderProbes=0;f.window.MediaRecorder={isTypeSupported(){recorderProbes++;return false;}};await f.document.querySelector('#video').onclick();assert.equal(recorderProbes,0,'Video export must not begin during preparation');if(reject){gate.reject(Error('synthetic font failure'));await assert.rejects(editing,/font failure/);}else{gate.resolve();await editing;}assert.equal(f.api.busy(),false);assert.equal((await f.close()).success,true);}
});

test('PNG holds busy through toBlob and cancellation suppresses a late download',async()=>{
 const f=await fixture();let encoded,calls=0;f.window.HTMLCanvasElement.prototype.toBlob=resolve=>{calls++;encoded=resolve;};const saving=f.document.querySelector('#png').onclick();await tick();assert.equal(calls,1);assert.equal((await f.close()).busy,true);await f.document.querySelector('#png').onclick();assert.equal(calls,1);f.document.querySelector('#cancel').onclick();encoded(png());await saving;assert.deepEqual(f.downloads,[]);assert.equal(f.api.busy(),false);assert.equal((await f.close()).success,true);
});

test('PNG successful encoding hands exactly one download to main and releases the local gate',async()=>{
 const f=await fixture();let encoded;f.window.HTMLCanvasElement.prototype.toBlob=resolve=>{encoded=resolve;};const saving=f.document.querySelector('#png').onclick();await tick();assert.equal((await f.close()).busy,true);encoded(png());await saving;assert.deepEqual(f.downloads,['文字海报.png']);assert.equal(f.api.busy(),false);
});

test('HTML font packaging blocks close and duplicate export, then cancel prevents a late download',async()=>{
 const f=await fixture();await f.api.update({font:'notosanssc'});const gate=deferred();let requests=0;f.sandbox.fetch=()=>{requests++;return gate.promise;};const packing=f.document.querySelector('#html').onclick();assert.equal((await f.close()).busy,true);await f.document.querySelector('#html').onclick();assert.equal(requests,1);f.document.querySelector('#cancel').onclick();gate.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(16)});await packing;assert.deepEqual(f.downloads,[]);assert.match(f.document.querySelector('#status').textContent,/已取消/);assert.equal(f.api.busy(),false);
});

test('HTML read failure restores the gate and a retry can hand off a valid download',async()=>{
 const f=await fixture();await f.api.update({font:'notosanssc'});f.sandbox.fetch=async()=>{throw Error('synthetic font read failure');};await f.document.querySelector('#html').onclick();assert.equal((await f.close()).success,true);assert.deepEqual(f.downloads,[]);f.sandbox.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(16)});await f.document.querySelector('#html').onclick();assert.deepEqual(f.downloads,['文字动态海报.html']);
});

test('import reading/preparation blocks close and does not replace state when preparation fails',async()=>{
 const f=await fixture(),gate=deferred();f.api.prepare=()=>gate.promise;const before=f.api.getState().title,event={target:{files:[{size:50,text:async()=>JSON.stringify({title:'imported'})}],value:'synthetic'}};const importing=f.document.querySelector('#loadProject').onchange(event);await tick();assert.equal((await f.close()).busy,true);gate.reject(Error('synthetic subject decode failure'));await importing;assert.equal(f.api.getState().title,before);assert.equal((await f.close()).success,true);assert.equal(event.target.value,'');
});

test('recording/APNG external job gate cannot be cleared by an old release function',async()=>{
 const f=await fixture(),first=f.api.externalExport(()=>{});assert.equal((await f.close()).busy,true);first();const second=f.api.externalExport(()=>{});first();assert.equal((await f.close()).busy,true);second();assert.equal((await f.close()).success,true);
});
