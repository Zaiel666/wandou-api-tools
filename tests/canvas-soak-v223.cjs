const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright'),sharp=require('../desktop-client/node_modules/sharp');
const qa=path.resolve(__dirname,'../../qa'),app=path.resolve(__dirname,'../app'),minutes=Number(process.env.WANDOU_SOAK_MINUTES||30),intervalMs=Number(process.env.WANDOU_SOAK_INTERVAL_MS||5000);
const name=minutes>=30?'canvas-soak-v223':'canvas-soak-v223-pilot',hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.ok(Number.isFinite(minutes)&&minutes>0&&minutes<=35,'Bounded soak duration');
function appHashes(directory=app,result={}){for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const item=path.join(directory,entry.name);assert.equal(entry.isSymbolicLink(),false,'No linked runtime resources');if(entry.isDirectory())appHashes(item,result);else if(entry.isFile())result[path.relative(app,item).split(path.sep).join('/')]=hash(fs.readFileSync(item));}return result;}
function appSources(directory=app){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?appSources(path.join(directory,entry.name)):/\.(?:html|js|css)$/i.test(entry.name)?[path.relative(app,path.join(directory,entry.name))]:[]);}
const sourceFiles=appSources().sort();
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,hash(fs.readFileSync(path.join(app,file)))]));
const report={durationRequestedMinutes:minutes,intervalMs,startedAt:new Date().toISOString(),fixed:{nodes:1000,links:960,pngOriginals:24,pngSize:[4096,2304],gifOriginals:3,gifSize:[64,40],reopensRequired:7},zoomTargets:[.12,.25,.5,1,2],saveLimitMs:15000,fullContentLimit:97,performancePassed:false,saves:[],samples:[],reopens:[],errors:[],externalBlocked:0,sourceHashes:hashes(),testSha256:hash(fs.readFileSync(__filename)),method:'Headless isolated Edge, synthetic data in IndexedDB, real mouse pan and wheel zoom through 12/25/50/100/200%; timing includes automation/render/save work and is not FPS. Final regression/build/native checks may run concurrently on this machine; exclusive before/after comparison is the separate five-zoom check. Heap samples are not a leak proof; GC is not forced.'};
fs.mkdirSync(qa,{recursive:true});const record=()=>fs.writeFileSync(path.join(qa,name+'.json'),JSON.stringify(report,null,2));
report.version='2.0.23';report.appHashes=appHashes();report.appFileCount=Object.keys(report.appHashes).length;report.chromiumSandboxRequested=true;report.watchdogMinutes=minutes+5;
assert.equal(report.appFileCount,231,'Frozen v223 resource count');assert.equal(fs.readFileSync(path.join(app,'VERSION.txt'),'utf8').trim(),'v2.0.23');
let browser,watchdog;
async function blankPoint(page){
 return page.evaluate(()=>{const r=canvasWrap.getBoundingClientRect();for(let y=Math.max(r.top+90,100);y<Math.min(r.bottom-140,innerHeight-140);y+=23)for(let x=Math.max(r.left+40,250);x<Math.min(r.right-140,innerWidth-160);x+=29){const el=document.elementFromPoint(x,y);if(el&&canvasWrap.contains(el)&&!el.closest('.node,button,input,textarea,select,.topbar,.project-hub,.context-menu,#assistantPanel,.canvas-bottom-toolbar'))return{x,y};}throw Error('No empty canvas point for actual pan gesture');});
}
async function verifiedSave(page,label){
 const result=await page.evaluate(async()=>{const start=performance.now(),saved=await saveCanvasState();return{saved,ms:performance.now()-start,busy:wandouHasActiveTasks()};});
 report.saves.push({label,...result});assert.equal(result.saved,true,label+' must report successful save');assert.equal(result.busy,false,label+' must be idle');assert.ok(result.ms<report.saveLimitMs,label+' exceeded fixed-canvas save threshold');return result.ms;
}
async function verifyOriginals(page,expected){
 const result=await page.evaluate(async()=>{
  const selected=[...nodes.filter(n=>/^soak-(?:[0-9]|1[0-9]|2[0-3])$/.test(n.id)),...nodes.filter(n=>n.resolutionProcessing==='native-animation')].sort((a,b)=>Number(a.id.slice(5))-Number(b.id.slice(5)));
  const originals=[];for(const n of selected){const url=await getLocalMedia(n.fullUrl),response=await fetch(url);if(!response.ok)throw Error('Missing original '+n.id);const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');originals.push({id:n.id,sha256:digest,width:n.width,height:n.height,format:n.imageOutputFormat||'png',frames:n.animationFrameCount,durations:n.animationFrameDurationsMs,loop:n.animationLoopCount});}
  return{nodes:nodes.length,links:links.length,originals,autoAnimated:Array.from(document.querySelectorAll('.node.result img')).filter(img=>/^data:image\/gif[;,]/i.test(img.src)).length};
 });
 assert.equal(result.nodes,1000);assert.equal(result.links,960);assert.equal(result.autoAnimated,0);assert.deepEqual(result.originals,expected);return result;
}
(async()=>{
 const pngs=[];for(let i=0;i<24;i++)pngs.push(await sharp({create:{width:4096,height:2304,channels:4,background:{r:i*10,g:80,b:155,alpha:.6}}}).png().toBuffer());
 const previews=[];for(const png of pngs)previews.push(await sharp(png).resize({width:640}).png().toBuffer());
 const gifs=[];for(let k=0;k<3;k++){const raw=Buffer.alloc(64*40*2*4);for(let f=0;f<2;f++)for(let y=6;y<34;y++)for(let x=6;x<58;x++){const p=(f*64*40+y*64+x)*4;raw[p]=k*60+40;raw[p+1]=f?180:80;raw[p+2]=160;raw[p+3]=255;}gifs.push(await sharp(raw,{raw:{width:64,height:80,pageHeight:40,channels:4}}).gif({loop:0,delay:[80,120]}).toBuffer());}
 const expected=[...pngs.map((bytes,i)=>({id:'soak-'+i,sha256:hash(bytes),width:4096,height:2304,format:'png',frames:undefined,durations:undefined,loop:undefined})),...gifs.map((bytes,i)=>({id:'soak-'+(997+i),sha256:hash(bytes),width:64,height:40,format:'gif',frames:2,durations:[80,120],loop:0}))];
 report.originals=expected;record();
 browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 report.browserVersion=browser.version();report.browserStartedAt=new Date().toISOString();record();console.log(JSON.stringify({event:'browser-started',version:report.version,browserVersion:report.browserVersion,appFileCount:report.appFileCount,report:path.join(qa,name+'.json'),watchdogMinutes:report.watchdogMinutes}));
 watchdog=setTimeout(()=>{report.errors.push('Overall soak watchdog exceeded '+report.watchdogMinutes+' minutes');browser?.close().catch(()=>{});},report.watchdogMinutes*60000);
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',error=>report.errors.push(error.message));await page.route(/^https?:/,route=>{report.externalBlocked++;return route.abort();});
 await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
 await page.evaluate(async({pngs,previews,gifs})=>{
  nodes=[];links=[];nodeId=1;const animations=[];
  for(const url of [...pngs,...previews,...gifs]){const stored=await putLocalMedia(url);if(!stored.startsWith('indexed-media:'))throw Error('Synthetic original not durably stored');}
  for(const url of gifs){const animation=await WandouAnimatedImage.prepare(url);await putLocalMedia(animation.previewUrl);animations.push(animation);}
  for(let i=0;i<1000;i++){
   const animation=i>=997?animations[i-997]:null,url=animation?animation.dataUrl:pngs[i%24];
   nodes.push({id:'soak-'+i,type:'result',title:'Synthetic '+i,mediaType:'image',mediaUrl:url,fullUrl:url,sourceUrl:url,previewUrl:animation?animation.previewUrl:previews[i%24],width:animation?64:4096,height:animation?40:2304,x:(i%25)*380,y:Math.floor(i/25)*290,frameWidth:360,ratio:animation?'8:5':'16:9',status:'',references:[],...(animation?{imageOutputFormat:'gif',outputFormat:'gif',mimeType:'image/gif',resolutionProcessing:'native-animation',animationFrameCount:animation.frameCount,animationFrameDurationsMs:animation.frameDurationsMs,animationDurationMs:animation.durationMs,animationLoopCount:animation.loopCount}:{imageOutputFormat:'png'})});
   if(i%25)links.push({from:'soak-'+(i-1),to:'soak-'+i});
  }
  render({skipSave:true});centerOnNode('soak-0');
 },{pngs:pngs.map(b=>'data:image/png;base64,'+b.toString('base64')),previews:previews.map(b=>'data:image/png;base64,'+b.toString('base64')),gifs:gifs.map(b=>'data:image/gif;base64,'+b.toString('base64'))});
 report.initialSaveMs=await verifiedSave(page,'initial');await verifyOriginals(page,expected);
 const started=Date.now(),duration=minutes*60000,deadline=started+duration;report.exerciseStartedAt=new Date(started).toISOString();let turn=0;
 while(Date.now()<deadline){
  const cycle=Date.now();
  const before=await page.evaluate(async turn=>{centerOnNode('soak-'+(turn%10===0?997+turn%3:(turn*53)%997));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{view:{...view},fingerprint:JSON.stringify(nodes.map(n=>[n.id,n.x,n.y,n.width,n.height,n.imageOutputFormat,n.animationFrameCount,n.animationFrameDurationsMs,n.animationLoopCount]))};},turn);
  const point=await blankPoint(page);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+60,point.y+35,{steps:8});await page.mouse.up();
  const panned=await page.evaluate(()=>({...view}));assert.ok(Math.abs(panned.x-before.view.x)>20&&Math.abs(panned.y-before.view.y)>10,'actual pointer pan must move viewport');
  const target=report.zoomTargets[turn%report.zoomTargets.length];let zoom=panned.zoom,steps=0;
  while(Math.abs(zoom-target)>.001){assert.ok(++steps<30,'Reach requested zoom');const zoomPoint=await blankPoint(page);await page.mouse.move(zoomPoint.x,zoomPoint.y);await page.mouse.wheel(0,Math.max(-240,Math.min(240,1000*Math.log(zoom/target))));await page.waitForFunction(old=>Math.abs(view.zoom-old)>1e-7,zoom);zoom=await page.evaluate(()=>view.zoom);}
  await page.waitForFunction(()=>WandouCanvasViewport.stats().mountedContents<=97);
  const sample=await page.evaluate(({turn,before})=>{const fingerprint=JSON.stringify(nodes.map(n=>[n.id,n.x,n.y,n.width,n.height,n.imageOutputFormat,n.animationFrameCount,n.animationFrameDurationsMs,n.animationLoopCount]));if(before!==fingerprint)throw Error('Viewport changed node data');return{turn,nodes:nodes.length,links:links.length,dom:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize,preview:WandouCanvasPreview.stats(),viewport:WandouCanvasViewport?.stats?.(),view:{...view},busy:wandouHasActiveTasks(),autoAnimated:Array.from(document.querySelectorAll('.node.result img')).filter(img=>/^data:image\/gif[;,]/i.test(img.src)).length};},{turn,before:before.fingerprint});
  sample.target=target;sample.interactionMs=Date.now()-cycle;sample.at=new Date().toISOString();if(turn%6===0)sample.saveMs=await verifiedSave(page,'periodic '+turn);
  assert.equal(sample.nodes,1000);assert.equal(sample.links,960);assert.equal(sample.busy,false);assert.equal(sample.autoAnimated,0);assert.deepEqual(report.errors,[]);report.samples.push(sample);record();
  if(turn%6===0)console.log(JSON.stringify({event:'sample',turn,at:sample.at,interactionMs:sample.interactionMs,saveMs:sample.saveMs,heap:sample.heap,zoom:sample.view.zoom}));
  const due=Math.min(6,Math.floor((Date.now()-started)/duration*7));
  while(report.reopens.length<due){const reopenStart=Date.now(),saveMs=await verifiedSave(page,'before reopen');await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');const restored=await verifyOriginals(page,expected);report.reopens.push({index:report.reopens.length+1,at:new Date().toISOString(),ms:Date.now()-reopenStart,saveMs,originalsVerified:restored.originals.length,nodes:restored.nodes,links:restored.links});record();console.log(JSON.stringify({event:'reopen',...report.reopens.at(-1)}));}
  turn++;await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,Math.max(0,deadline-Date.now()))));
 }
 while(report.reopens.length<6){const reopenStart=Date.now(),saveMs=await verifiedSave(page,'remaining reopen');await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');const restored=await verifyOriginals(page,expected);report.reopens.push({index:report.reopens.length+1,at:new Date().toISOString(),ms:Date.now()-reopenStart,saveMs,originalsVerified:restored.originals.length,nodes:restored.nodes,links:restored.links});record();}
 const finalSaveMs=await verifiedSave(page,'final');await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');const restored=await verifyOriginals(page,expected);report.reopens.push({index:report.reopens.length+1,at:new Date().toISOString(),final:true,saveMs:finalSaveMs,originalsVerified:restored.originals.length,nodes:restored.nodes,links:restored.links});
 assert.equal(report.reopens.length,7);assert.deepEqual(report.errors,[]);assert.deepEqual(hashes(),report.sourceHashes,'Running source changed during soak');report.appHashesAfter=appHashes();assert.deepEqual(report.appHashesAfter,report.appHashes,'All current app bytes and file set remain frozen');report.appHashesUnchanged=true;assert.equal(hash(fs.readFileSync(__filename)),report.testSha256,'Soak script remains frozen');report.exerciseElapsedSeconds=(Date.now()-started)/1000;assert.ok(report.exerciseElapsedSeconds>=minutes*60);report.performancePassed=report.saves.every(s=>s.saved&&s.ms<report.saveLimitMs)&&report.samples.every(s=>s.viewport.mountedContents<=report.fullContentLimit);assert.equal(report.performancePassed,true);if(minutes>=30)for(const target of report.zoomTargets)assert.ok(report.samples.some(s=>Math.abs(s.view.zoom-target)<.001));report.success=true;
 await page.screenshot({path:path.join(qa,name+'-final.png')});console.log(JSON.stringify({event:'complete',success:true,exerciseElapsedSeconds:report.exerciseElapsedSeconds,samples:report.samples.length,reopens:report.reopens.length}));
})().catch(error=>{report.success=false;report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);report.finishedAt=new Date().toISOString();report.elapsedSeconds=(Date.parse(report.finishedAt)-Date.parse(report.startedAt))/1000;report.appHashesAfter=appHashes();report.appHashesUnchanged=JSON.stringify(report.appHashesAfter)===JSON.stringify(report.appHashes);record();await browser?.close();});
