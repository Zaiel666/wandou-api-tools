'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
for(const scenario of ['same','distinct','second-fails'])test('archive verifies originals: '+scenario,{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href+'?workspace=archive-dedup-'+scenario);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const fixture=await page.evaluate(scenario=>{
   nodes=[];links=[];deletedResults=[];nodeId=1;
   const make=color=>{const c=document.createElement('canvas');c.width=8;c.height=6;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,8,6);return c.toDataURL();};
   const original=make('red'),source=scenario==='same'?original:make('blue');
   const n=createNode('result',200,200,{_deferRender:true,title:'fixture',mediaType:'image',mediaUrl:original,previewUrl:original,fullUrl:original,sourceUrl:source,width:8,height:6});render({skipSave:true});
   window.archiveCalls=[];window.realPersistDeletedOriginal=persistDeletedOriginal;persistDeletedOriginal=async value=>{archiveCalls.push(value);if(scenario==='second-fails'&&archiveCalls.length===2)throw Error('synthetic source failure');return realPersistDeletedOriginal(value)};
   deleteNode(n.id);return{id:n.id,original,source};
  },scenario);
  await page.waitForFunction(()=>deletedResultArchiveJobs.size===0,{timeout:15000});
  const result=await page.evaluate(async id=>{const archived=deletedResults.find(x=>x.originalId===id);return{calls:archiveCalls.length,restored:nodes.some(n=>n.id===id),archived:!!archived,full:archived&&await getLocalMedia(archived.fullUrl),source:archived&&await getLocalMedia(archived.sourceUrl)};},fixture.id);
  if(scenario==='second-fails'){assert.equal(result.calls,2);assert.equal(result.restored,true);assert.equal(result.archived,false);}else{assert.equal(result.calls,scenario==='same'?1:2);assert.equal(result.restored,false);assert.equal(result.archived,true);assert.equal(result.full,fixture.original);assert.equal(result.source,fixture.source);}
  await context.close();
 }finally{await browser.close();}
});
