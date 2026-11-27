'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),files=['ai-node-canvas-test.html','ai-node-canvas.html'];let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>{await browser?.close();});
const matrix=[
 {name:'old seed retains newer selected IDB before another local project; save, switch and reopen read fresh state',local:'seed',idb:'valid',disk:'missing',other:'local',expected:'idb-node',fresh:true},
 {name:'old seed retains selected IDB reset before another local project',local:'seed',idb:'reset',disk:'missing',other:'local',expected:'reset'},
 {name:'old seed retains selected disk content when IDB reads fail',local:'seed',idb:'error',disk:'valid',other:'local',expected:'disk-node'},
 {name:'old seed retains selected disk content with missing IDB',local:'seed',idb:'missing',disk:'valid',other:'local',expected:'disk-node'},
 {name:'missing local state retains IDB without a desktop bridge',local:'missing',idb:'valid',disk:'missing',other:'local',bridge:'absent',expected:'idb-node'},
 {name:'old seed retains IDB when catalog reads fail',local:'seed',idb:'valid',disk:'missing',other:'local',bridge:'catalog-error',expected:'idb-node'},
 {name:'old seed retains IDB with the legacy full catalog response',local:'seed',idb:'valid',disk:'missing',other:'local',bridge:'legacy',expected:'idb-node'},
 {name:'compact pointer retains current IDB before other local state',local:'pointer',idb:'valid',disk:'missing',other:'local',expected:'idb-node'},
 {name:'latest local explicit reset wins over older IDB and disk content',local:'reset',idb:'valid',disk:'valid',other:'local',expected:'reset'},
 {name:'newer IDB reset wins over older meaningful local and disk states',local:'meaningful',idb:'reset',disk:'valid',other:'local',expected:'reset'},
 {name:'latest disk reset wins over older local and IDB content',local:'meaningful',idb:'valid',disk:'reset',other:'local',expected:'reset'},
 {name:'newer meaningful local content wins over an older IDB reset',local:'meaningful-new',idb:'reset',disk:'valid',other:'local',expected:'local-node'},
 {name:'meaningful local state remains usable when both independent sources fail',local:'meaningful',idb:'error',disk:'error',other:'local',expected:'local-node'},
 {name:'true seed without independent content can recover another local project',local:'seed',idb:'missing',disk:'missing',other:'local',expected:'other-node'},
 {name:'true seed without independent content can recover another disk project',local:'seed',idb:'missing',disk:'missing',other:'disk',expected:'other-node'},
 {name:'seed plus an unreadable IDB never falls back or saves an empty project',local:'seed',idb:'error',disk:'missing',other:'local',expected:'error'},
 {name:'seed plus an unreadable disk never falls back or saves an empty project',local:'seed',idb:'missing',disk:'error',other:'local',expected:'error'},
 {name:'pointer plus an unreadable IDB never falls back or saves an empty project',local:'pointer',idb:'error',disk:'missing',other:'local',expected:'error'},
 {name:'missing local content plus failed catalog is not treated as a new empty project',local:'missing',idb:'missing',disk:'missing',other:'local',bridge:'catalog-error',expected:'error'},
 {name:'orphaned compact pointer is not replaced by a new seed',local:'pointer',idb:'missing',disk:'missing',other:'missing',expected:'error'},
 {name:'genuinely absent state permits first-use seed creation',local:'missing',idb:'missing',disk:'missing',other:'missing',expected:'seed'},
 {name:'genuine stored seed remains usable when all independent sources are absent',local:'seed',idb:'missing',disk:'missing',other:'missing',expected:'seed'},
 {name:'valid selected legacy global content survives all three selection stages',local:'seed',idb:'missing',disk:'missing',other:'local',global:true,expected:'global-node'},
 {name:'legacy folder migration cannot displace selected independent IDB content',local:'seed',idb:'valid',disk:'missing',other:'missing',legacy:true,expected:'idb-node'},
 {name:'legacy folder recovery remains available when selected is only a true seed',local:'seed',idb:'missing',disk:'missing',other:'missing',legacy:true,expected:'legacy-node'}
];
async function fixture(t,file,scenario){
 const context=await browser.newContext({viewport:{width:1024,height:800}});t.after(()=>context.close());const page=await context.newPage(),errors=[],network=[];page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(/^(file:|data:|blob:|about:)/.test(route.request().url()))return route.continue();network.push(route.request().method());return route.abort();});
 const folder='qa-selection-folder',project='qa-selected',otherProject='qa-other',firstProject=scenario.legacy?'qa-first':project,prefix='aiCanvasStateV1:'+folder+':'+project;
 const base={folderId:folder,projectId:project,projectName:'Synthetic selected',savedAt:5000,intentionalResetAt:0,nodes:[{id:'idb-node',type:'text',title:'Selected saved text',text:'Synthetic content',x:10,y:10,references:[]}],links:[],nodeId:4,view:{x:20,y:20,zoom:1}};
 const seed={...base,savedAt:1000,nodes:[{id:'seed-image',type:'image',references:[],x:0,y:0},{id:'seed-generator',type:'generator',prompt:'',references:[],x:300,y:0},{id:'seed-result',type:'result',references:[],x:600,y:0}],links:[{from:'seed-image',to:'seed-generator'},{from:'seed-generator',to:'seed-result'}]};
 const local=scenario.local==='missing'?null:scenario.local==='pointer'?{external:true,folderId:folder,projectId:project,savedAt:5000,nodeCount:1}:scenario.local==='seed'?seed:scenario.local==='reset'?{...base,savedAt:8000,nodes:[],intentionalResetAt:8000}:{...base,savedAt:scenario.local==='meaningful-new'?9000:3000,nodes:[{...base.nodes[0],id:'local-node'}]};
 const idb=scenario.idb==='missing'?null:scenario.idb==='reset'?{...base,savedAt:7000,nodes:[],intentionalResetAt:7000}:base;
 const disk=scenario.disk==='valid'?{...base,savedAt:6000,nodes:[{...base.nodes[0],id:'disk-node'}]}:scenario.disk==='reset'?{...base,savedAt:8500,nodes:[],intentionalResetAt:8500}:null;
 const other={...base,projectId:otherProject,projectName:'Synthetic other',savedAt:4000,nodes:[{...base.nodes[0],id:'other-node'}]};
 const legacy=scenario.legacy?{...base,projectId:firstProject,projectName:'Synthetic legacy',savedAt:4500,nodes:[{...base.nodes[0],id:'legacy-node'}]}:null;
 const global=scenario.global?{...base,savedAt:4500,nodes:[{...base.nodes[0],id:'global-node'}]}:null;
 const args={scenario,folder,project,otherProject,firstProject,prefix,local,idb,disk,other,legacy,seed,global};
 await page.addInitScript(({scenario,folder,project,otherProject,firstProject,prefix,local,disk,other,legacy,seed,global})=>{
  if(!localStorage.getItem('qa-selection-seeded')){
   localStorage.setItem('qa-selection-seeded','1');localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:folder,name:'Synthetic folder'}]));
   const projects=[{id:project,name:'Synthetic selected',createdAt:1000,updatedAt:local?5000:1000,nodeCount:local?1:0},{id:otherProject,name:'Synthetic other',createdAt:1000,updatedAt:scenario.other==='missing'?1000:4000,nodeCount:scenario.other==='missing'?0:1}];
   if(legacy)projects.unshift({id:firstProject,name:'Synthetic first',createdAt:1000,updatedAt:1000,nodeCount:3});
   localStorage.setItem('aiCanvasStateV1:project-collection:'+folder,JSON.stringify(projects));localStorage.setItem('aiCanvasStateV1:active-project-collection:'+folder,project);
   if(local)localStorage.setItem(prefix,JSON.stringify(local));if(scenario.other==='local')localStorage.setItem('aiCanvasStateV1:'+folder+':'+otherProject,JSON.stringify(other));
   if(legacy){localStorage.setItem('aiCanvasStateV1:'+folder,JSON.stringify(legacy));localStorage.setItem('aiCanvasStateV1:'+folder+':'+firstProject,JSON.stringify({...seed,projectId:firstProject}));}
   if(global)localStorage.setItem('aiCanvasStateV1',JSON.stringify(global));
  }
  window.qaSelection={reads:[],writes:[],inputLocal:localStorage.getItem(prefix),inputActive:localStorage.getItem('aiCanvasStateV1:active-project-collection:'+folder)};
  const nativeGet=IDBObjectStore.prototype.get;window.qaSelectionOriginalGet=nativeGet;
  IDBObjectStore.prototype.get=function(key){if(scenario.idb==='error'&&this.name==='canvas-state'&&key===prefix)throw new Error('Synthetic selected database read failure');return nativeGet.apply(this,arguments);};
  if(scenario.bridge==='absent')return;
  window.wandouShell={readCanvasBackups:async payload=>{
   qaSelection.reads.push({...payload});
   if(payload.allProjects){
    if(scenario.bridge==='catalog-error')return{success:false,error:'Synthetic catalog read failure'};
    if(scenario.bridge==='legacy')return{success:true,projectStates:[...(disk?[{projectId:project,states:[disk]}]:[]),...(scenario.other==='disk'?[{projectId:otherProject,states:[other]}]:[])]};
    return{success:true,metadataOnly:true,projects:[{projectId:project},{projectId:otherProject},...(legacy?[{projectId:firstProject}]:[])]};
   }
   const committed=localStorage.getItem('qa-selection-disk:'+payload.projectId);if(committed)return{success:true,states:[JSON.parse(committed)]};
   if(payload.projectId===project)return scenario.disk==='error'?{success:false,error:'Synthetic selected disk read failure'}:{success:true,states:disk?[disk]:[]};
   return{success:true,states:payload.projectId===otherProject&&scenario.other==='disk'?[other]:[]};
  },writeCanvasBackup:async payload=>{localStorage.setItem('qa-selection-disk:'+payload.projectId,JSON.stringify(payload.state));qaSelection.writes.push({projectId:payload.projectId,ids:payload.state.nodes.map(n=>n.id)});return{success:true,path:'synthetic-only',savedAt:payload.state.savedAt};}};
 },args);
 await page.route('**/qa-selection-idb.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic selection fixture</title>'}));await page.goto(pathToFileURL(path.join(app,'qa-selection-idb.html')).href);
 await page.evaluate(async({idb,prefix})=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-node-canvas-media-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('media',{keyPath:'id'});r.result.createObjectStore('canvas-state',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('canvas-state','readwrite');if(idb)tx.objectStore('canvas-state').put({id:prefix,state:idb,savedAt:idb.savedAt});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();},args);
 await page.goto(pathToFileURL(path.join(app,file)).href+'?workspace=production&project='+folder,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>['true','error'].includes(document.body.dataset.canvasReady));
 const observed=await page.evaluate(()=>({ready:document.body.dataset.canvasReady,project:activeProjectId,ids:nodes.map(n=>n.id),types:nodes.map(n=>n.type),writes:qaSelection.writes,inputActive:qaSelection.inputActive,startupContext:loadProjects.recovery,catalogContext:readDesktopProjectCatalog.selectedRecovery,status:document.getElementById('canvasStartupStatus')?.textContent}));
 assert.equal(observed.catalogContext,null);assert.equal(observed.startupContext,null);
 if(scenario.expected==='error'){
  assert.equal(observed.ready,'error',JSON.stringify(observed));assert.equal(observed.project,project);assert.deepEqual(observed.ids,[]);assert.deepEqual(observed.writes,[]);assert.match(observed.status,/未覆盖原数据/);assert.doesNotMatch(observed.status,/原数据已保留|原图已保留/);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix)===qaSelection.inputLocal,prefix),true);
  if(idb){const actual=await page.evaluate(async prefix=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-node-canvas-media-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const tx=db.transaction('canvas-state','readonly');let value;const r=qaSelectionOriginalGet.call(tx.objectStore('canvas-state'),prefix);r.onsuccess=()=>value=r.result;tx.oncomplete=()=>{db.close();resolve(value.state);};tx.onerror=()=>reject(tx.error);});},prefix);assert.deepEqual(actual,idb);}
  const close=await page.evaluate(()=>wandouSaveBeforeClose());assert.equal(close.success,true);assert.equal(close.readOnly,true);assert.equal(close.savedAt,0);assert.equal(await page.evaluate(()=>qaSelection.writes.length),0);
 }else{
  assert.equal(observed.ready,'true',JSON.stringify(observed));assert.equal(observed.project,scenario.expected==='other-node'?otherProject:scenario.expected==='legacy-node'?firstProject:project);assert.equal(observed.startupContext,null);
  if(scenario.expected==='seed'){const expectedTypes=['generator','image','result'];if(scenario.local==='missing'&&file==='ai-node-canvas-test.html')expectedTypes.push('style');assert.deepEqual([...observed.types].sort(),expectedTypes);}else assert.deepEqual(observed.ids,scenario.expected==='reset'?[]:[scenario.expected]);
  if(scenario.fresh){
   // canvasReady precedes the modern canvas's first scheduled fit. Wait for
   // that actual completion marker before measuring the drag target; otherwise
   // a stale box can click the empty canvas and pan it instead of the node.
   if(file==='ai-node-canvas-test.html')await page.waitForFunction(()=>document.body.dataset.testReady==='true'&&canvasTestStorage.getItem('test-layout-initialized')==='1');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const handle=await page.locator('[data-id="idb-node"] [data-drag-handle]').boundingBox();assert.ok(handle);const beforeX=await page.evaluate(()=>nodes[0].x);
   const hit=await page.evaluate(({x,y})=>{const target=document.querySelector('[data-id="idb-node"] [data-drag-handle]'),actual=document.elementFromPoint(x,y);return {matched:!!target?.contains(actual),actual:actual?.outerHTML.slice(0,300)};},{x:handle.x+40,y:handle.y+12});assert.equal(hit.matched,true,JSON.stringify(hit));
   await page.mouse.move(handle.x+40,handle.y+12);await page.mouse.down();await page.mouse.move(handle.x+100,handle.y+42,{steps:3});await page.mouse.up();const editedX=await page.evaluate(()=>nodes[0].x);assert.ok(editedX>beforeX+20);assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,true);assert.equal(await page.evaluate(async()=>{const result=await wandouShell.readCanvasBackups({projectId:activeProjectId});return result.states[0].nodes[0].x;}),editedX);
   await page.evaluate(otherProject=>switchProject(otherProject),otherProject);assert.equal(await page.evaluate(()=>activeProjectId),otherProject);assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),['other-node']);
   await page.evaluate(project=>switchProject(project),project);assert.equal(await page.evaluate(()=>nodes[0].x),editedX);assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,true);
   await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(()=>activeProjectId),project);assert.equal(await page.evaluate(()=>nodes[0].x),editedX);assert.equal(await page.evaluate(()=>loadProjects.recovery),null);assert.equal(await page.evaluate(()=>readDesktopProjectCatalog.selectedRecovery),null);
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(network,[],'No network requests or paid retries');
}
for(const file of files)for(const scenario of matrix)test(file+': '+scenario.name,t=>fixture(t,file,scenario));
