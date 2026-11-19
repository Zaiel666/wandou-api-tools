'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),files=['ai-node-canvas-test.html','ai-node-canvas.html'];
const folder='qa-startup-folder',project='qa-startup-project',prefix='aiCanvasStateV1:'+folder+':'+project;
const state={folderId:folder,projectId:project,projectName:'Synthetic project',savedAt:5000,nodes:[{id:'saved-node',type:'text',title:'Saved synthetic text',text:'Synthetic text',x:10,y:10,references:[]}],links:[],nodeId:2,view:{x:20,y:20,zoom:1}};
const extract=(file,start,end)=>{const s=fs.readFileSync(path.join(app,file),'utf8');const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a);return s.slice(a,b);};
async function fixture(file,mode,run,{theme='light',width=1024}={}){
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const ctx=await browser.newContext({viewport:{width,height:800}}),page=await ctx.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{if(/^(file:|data:|blob:|about:)/.test(r.request().url()))return r.continue();requests.push(r.request().method());return r.abort();});
  await page.addInitScript(({state,folder,project,prefix,mode,theme})=>{
   for(const key of ['ai-tools-theme','wd-theme','pea-theme'])localStorage.setItem(key,theme);
   if(!localStorage.getItem('qa-seeded')){
    localStorage.setItem('qa-seeded','1');localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:folder,name:'Synthetic folder'}]));
    const projects=[{id:project,name:'Synthetic project',createdAt:1000,updatedAt:5000,nodeCount:1}];
    if(mode==='catalog')for(let i=0;i<50;i++)projects.push({id:'inactive-'+i,name:'Inactive '+i,createdAt:1000,nodeCount:1});
    if(mode.startsWith('mixed-'))projects.push({id:'other-project',name:'Other project',createdAt:1000,updatedAt:4000,nodeCount:1});
    localStorage.setItem('aiCanvasStateV1:project-collection:'+folder,JSON.stringify(projects));localStorage.setItem('aiCanvasStateV1:active-project-collection:'+folder,project);
    if(mode==='held'||mode==='catalog')localStorage.setItem(prefix,JSON.stringify(state));
    if(mode.startsWith('mixed-'))localStorage.setItem(prefix,JSON.stringify({external:true,folderId:folder,projectId:project,savedAt:5000,nodeCount:1}));
   }
   const qa=window.qaStartup={reads:[],writes:[],mode};
   window.wandouShell={
    readCanvasBackups:async payload=>{
     qa.reads.push({...payload});
     if(sessionStorage.getItem('qa-retry-ready'))return payload.allProjects?{success:true,metadataOnly:true,projects:[{projectId:project}]}:{success:true,states:[state]};
     if(mode==='held'){
      if(payload.allProjects)await new Promise(resolve=>qa.release=resolve);
      return{success:false,error:'Synthetic unavailable disk'};
     }
     if(mode==='catalog'){
      if(payload.allProjects)return{success:true,metadataOnly:true,projects:[{projectId:project},...Array.from({length:50},(_,i)=>({projectId:'inactive-'+i})),{projectId:'recovered-project'}]};
      return{success:true,states:[payload.projectId===project?state:{...state,projectId:payload.projectId,projectName:'Recovered original name',savedAt:2000}]};
     }
     if(mode.startsWith('mixed-')){
      if(payload.allProjects)return{success:true,metadataOnly:true,projects:[{projectId:project},{projectId:'other-project'}]};
      if(payload.projectId===project)return mode==='mixed-broken'?{success:false,error:'Synthetic broken current backup'}:{success:true,states:[]};
      return{success:true,states:[{...state,projectId:'other-project',projectName:'Other project',nodes:[{...state.nodes[0],id:'other-node'}]}]};
     }
     if(payload.allProjects)return{success:false,metadataOnly:true,projects:[],error:'Synthetic inaccessible catalog'};
     return{success:true,states:[]};
    },
    writeCanvasBackup:async payload=>{qa.writes.push({projectId:payload.projectId,nodes:payload.state.nodes.map(n=>n.id)});return{success:true,path:'synthetic-only',savedAt:payload.state.savedAt};}
   };
  },{state,folder,project,prefix,mode,theme});
  if(mode==='idb'||mode==='range'||mode.startsWith('mixed-')){
   await page.route('**/qa-startup-storage.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic IndexedDB setup</title>'}));
   await page.goto(pathToFileURL(path.join(app,'qa-startup-storage.html')).href);
   await page.evaluate(async({state,prefix,mode})=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-node-canvas-media-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('media',{keyPath:'id'});r.result.createObjectStore('canvas-state',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('canvas-state','readwrite'),s=tx.objectStore('canvas-state');s.put({id:prefix,state:mode==='mixed-reset'?{...state,nodes:[],intentionalResetAt:5000}:state,savedAt:state.savedAt});if(mode==='range'){
     s.put({id:prefix+':session-current',state:{...state,savedAt:6000,nodes:[{...state.nodes[0],id:'session-node'}]}});
     s.put({id:'aiCanvasStateV1:'+state.folderId,state:{...state,projectId:'foreign',savedAt:99999}});
     for(let i=0;i<300;i++)s.put({id:'unrelated-'+i,state:{...state,savedAt:99999,nodes:[{id:'unrelated-'+i}]}});
    }tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});db.close();
   },{state,prefix,mode});
  }
  if(mode==='range')await page.addInitScript(()=>{
   window.qaRange={gets:[],ranges:[],getAll:0};const get=IDBObjectStore.prototype.get,cursor=IDBObjectStore.prototype.openCursor,all=IDBObjectStore.prototype.getAll;
   IDBObjectStore.prototype.get=function(key){if(this.name==='canvas-state')qaRange.gets.push(key);return get.apply(this,arguments);};
   IDBObjectStore.prototype.openCursor=function(range){if(this.name==='canvas-state')qaRange.ranges.push({lower:range?.lower,upper:range?.upper});return cursor.apply(this,arguments);};
   IDBObjectStore.prototype.getAll=function(){if(this.name==='canvas-state'){qaRange.getAll++;throw new Error('Full canvas store read is forbidden');}return all.apply(this,arguments);};
  });
  await page.goto(pathToFileURL(path.join(app,file)).href+'?workspace=production&project='+folder,{waitUntil:'domcontentloaded'});
  await run(page);assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'No external requests, including paid requests');
 }finally{await browser.close();}
}
for(const file of files){
 test(file+': held local restore blocks paste/keyboard/drop/close, then independently restores compact state',()=>fixture(file,'held',async page=>{
  await page.waitForFunction(()=>typeof qaStartup.release==='function');
  assert.equal(await page.evaluate(()=>document.querySelector('.app').inert),true);
  assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,false);
  const original=await page.evaluate(prefix=>localStorage.getItem(prefix),prefix);
  await page.keyboard.press('Control+v');await page.keyboard.press('Delete');
  const eventResults=await page.evaluate(()=>{
   const data=new DataTransfer();data.items.add(new File(['synthetic'],'fixture.png',{type:'image/png'}));
   return ['paste','drop'].map(type=>{const e=type==='paste'?new ClipboardEvent(type,{bubbles:true,cancelable:true,clipboardData:data}):new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data});document.body.dispatchEvent(e);return e.defaultPrevented;});
  });
  assert.deepEqual(eventResults,[true,true]);assert.equal(await page.evaluate(()=>nodes.length),0);assert.equal(await page.evaluate(()=>qaStartup.writes.length),0);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix),prefix),original);
  await page.evaluate(()=>qaStartup.release());await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),['saved-node']);assert.equal(await page.evaluate(()=>document.querySelector('.app').inert),false);
  await page.locator('#settingsButton').click();assert.equal(await page.locator('#settingsPopover').isVisible(),true);await page.locator('#closeSettingsButton').click();
  assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,true);
 }));
 test(file+': unavailable catalog preserves valid IndexedDB state',()=>fixture(file,'idb',async page=>{
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),['saved-node']);assert.equal(await page.evaluate(()=>canvasRecoveryBlocked),false);
 }));
 for(const mode of ['mixed-missing','mixed-broken','mixed-reset'])test(file+': '+mode+' preserves the explicitly selected IndexedDB project over another disk project',()=>fixture(file,mode,async page=>{
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(()=>activeProjectId),project);assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),mode==='mixed-reset'?[]:['saved-node']);
  assert.deepEqual(await page.evaluate(()=>qaStartup.reads.filter(x=>!x.allProjects).map(x=>x.projectId)),[project]);
 }));
 for(const theme of ['light','dark'])test(file+': '+theme+' unreadable storage never seeds, allows strict read-only exit, and retry is accessible',()=>fixture(file,'error',async page=>{
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='error');assert.equal(await page.evaluate(()=>nodes.length),0);assert.equal(await page.evaluate(()=>qaStartup.writes.length),0);
  const status=await page.locator('#canvasStartupStatus').evaluate(el=>({background:getComputedStyle(el).backgroundColor,role:el.getAttribute('role'),width:el.getBoundingClientRect().width}));assert.equal(status.background,theme==='dark'?'rgb(22, 22, 22)':'rgb(245, 245, 245)');assert.equal(status.role,'alert');assert.equal(status.width,theme==='dark'?1440:1024);
  const retry=page.getByRole('button',{name:'重新读取项目',exact:true});assert.equal(await retry.evaluate(el=>el===document.activeElement),true);
  await page.evaluate(()=>document.querySelector('#settingsButton').focus());assert.equal(await retry.evaluate(el=>el===document.activeElement),true);
  const close=await page.evaluate(()=>wandouSaveBeforeClose());assert.equal(close.success,true);assert.equal(close.readOnly,true);assert.equal(close.skipped,true);assert.equal(close.savedAt,0);
  await page.evaluate(()=>pendingLocalMediaWrites.set('synthetic-pending',Promise.resolve()));assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,false);await page.evaluate(()=>pendingLocalMediaWrites.clear());
  await page.evaluate(()=>audioJobs.set('synthetic-pending',{}));assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,false);await page.evaluate(()=>audioJobs.clear());
  await page.evaluate(()=>saveCanvasStateNow.started=1);assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,false);await page.evaluate(()=>saveCanvasStateNow.started=0);
  assert.equal(await page.evaluate(()=>qaStartup.writes.length),0);assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix),prefix),null);
  await page.evaluate(()=>sessionStorage.setItem('qa-retry-ready','1'));if(theme==='dark')await retry.press('Enter');else await retry.click();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),['saved-node']);assert.equal(await page.evaluate(()=>wandouCanCloseReadOnlyStartup()),false);assert.equal((await page.evaluate(()=>wandouSaveBeforeClose())).success,true);
 },{theme,width:theme==='dark'?1440:1024}));
 test(file+': catalog reads active once, skips 50 known inactive histories, recovers unknown project name',()=>fixture(file,'catalog',async page=>{
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');const reads=await page.evaluate(()=>qaStartup.reads);assert.equal(reads.filter(x=>x.allProjects&&x.metadataOnly).length,1);assert.deepEqual(reads.filter(x=>!x.allProjects).map(x=>x.projectId),[project,'recovered-project']);
  assert.equal(await page.evaluate(()=>projects.find(p=>p.id==='recovered-project').name),'Recovered original name');assert.equal(await page.evaluate(()=>activeProjectId),project);
 }));
 test(file+': range reads select current session, isolate foreign folder record, preserve all unrelated records',()=>fixture(file,'range',async page=>{
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.deepEqual(await page.evaluate(()=>nodes.map(n=>n.id)),['session-node']);
  const ranges=await page.evaluate(()=>qaRange);assert.equal(ranges.getAll,0);assert.deepEqual(ranges.gets,[prefix,'aiCanvasStateV1:'+folder]);assert.equal(ranges.ranges.length,2);assert.ok(ranges.ranges.every(r=>r.lower.endsWith(':session-')&&r.upper===r.lower+'\uffff'));
  const preserved=await page.evaluate(async()=>{const db=await openLocalMediaDb();return new Promise((resolve,reject)=>{const tx=db.transaction('canvas-state','readonly'),store=tx.objectStore('canvas-state'),values=[];for(let i=0;i<300;i++){const r=store.get('unrelated-'+i);r.onsuccess=()=>values.push(r.result);}tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(tx.error);});});assert.equal(preserved.length,300);for(let i=0;i<300;i++)assert.deepEqual(preserved[i],{id:'unrelated-'+i,state:{...state,savedAt:99999,nodes:[{id:'unrelated-'+i}]}});
 }));
 test(file+': a database-open failure is not mistaken for an empty database',async()=>{
  const ctx={activeProjectId:project,openLocalMediaDb:async()=>null};vm.createContext(ctx);vm.runInContext(extract(file,'async function readCanvasStateBackup(', 'function warnCanvasStorageSkipped('),ctx);await assert.rejects(ctx.readCanvasStateBackup(),/画布数据库暂时无法读取/);
 });
 test(file+': failed recovery drains sibling workers then rethrows the original failure',async()=>{
  let release,finished=false;const failure=new Error('Synthetic original media error'),gate=new Promise(r=>release=r),ctx={cleanLoadedNode:async node=>{if(node.id===1)throw failure;if(node.id===2)await gate;},updateCanvasMediaSaveNotice(){}};
  vm.createContext(ctx);vm.runInContext(extract(file,'async function cleanLoadedNodes(', 'function mergeCanvasRecoveryState('),ctx);
  const running=ctx.cleanLoadedNodes([{id:1},{id:2},{id:3}]).then(()=>{finished=true;return null},error=>{finished=true;return error});
  await Promise.resolve();await Promise.resolve();assert.equal(finished,false);release();assert.equal(await running,failure);
 });
}
