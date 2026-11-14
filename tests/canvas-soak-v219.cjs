const fs=require('fs'),path=require('path'),assert=require('assert/strict'),http=require('http'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const root=path.resolve(__dirname,'../../../..'),{chromium}=require(path.join(root,'desktop-client/node_modules/playwright'));
const sharp=require(path.join(root,'desktop-client/node_modules/sharp'));
const qa=path.resolve(__dirname,'../../qa'),minutes=Number(process.env.WANDOU_SOAK_MINUTES||30);
const report={durationRequestedMinutes:minutes,startedAt:new Date().toISOString(),samples:[],errors:[],sourceHashes:{}};
for(const f of ['ai-node-canvas-test.html','ai-node-canvas-test.js','canvas-task-actions.js','canvas-media-preview.js'])report.sourceHashes[f]=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../app',f))).digest('hex');
const record=()=>fs.writeFileSync(path.join(qa,'canvas-soak-v219.json'),JSON.stringify(report,null,2));
(async()=>{
 const originals=await Promise.all(Array.from({length:24},(_,i)=>sharp({create:{width:4096,height:2304,channels:4,background:{r:i*10,g:80,b:155,alpha:.6}}}).png().toBuffer()));
 const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','image/png');res.end(originals[Number(req.url.slice(1))%24]||originals[0])});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--js-flags=--expose-gc']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>report.errors.push(error.message));
  await page.route(/^https?:/,route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);
  await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await page.evaluate(origin=>{nodes=[];links=[];nodeId=1;for(let i=0;i<1000;i++){const url=origin+'/'+(i%24);nodes.push({id:'soak-'+i,type:'result',title:'Synthetic '+i,mediaType:'image',mediaUrl:url,fullUrl:url,sourceUrl:url,width:4096,height:2304,x:(i%25)*380,y:Math.floor(i/25)*290,frameWidth:360,ratio:'16:9',status:'',references:[]});if(i%25)links.push({from:'soak-'+(i-1),to:'soak-'+i});}render({skipSave:true});centerOnNode(nodes[0].id);},origin);
  const deadline=Date.now()+minutes*60000;let turn=0;
  while(Date.now()<deadline){
   const sample=await page.evaluate(async turn=>{
    const before=JSON.stringify(nodes.map(n=>[n.id,n.width,n.height,n.ratio,n.references?.length]));
    for(let i=0;i<24;i++){const id='soak-'+((turn*53+i*7)%1000);centerOnNode(id);await new Promise(requestAnimationFrame);}
    const after=JSON.stringify(nodes.map(n=>[n.id,n.width,n.height,n.ratio,n.references?.length]));
    if(before!==after)throw Error('Viewport changed project data');
    let save;if(turn%6===0){const start=performance.now();await saveCanvasState();save=performance.now()-start;}
    await new Promise(r=>setTimeout(r,150));globalThis.gc?.();
    return{turn,nodes:nodes.length,links:links.length,dom:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize,preview:WandouCanvasPreview.stats(),viewport:WandouCanvasViewport?.stats?.(),saveMs:save,busy:wandouHasActiveTasks()};
   },turn);
   sample.at=new Date().toISOString();report.samples.push(sample);assert.equal(sample.nodes,1000);assert.equal(sample.links,960);assert.equal(sample.busy,false);assert.deepEqual(report.errors,[]);record();
   if(turn%6===0)console.log(JSON.stringify({at:sample.at,turn,nodes:sample.nodes,dom:sample.dom,heap:sample.heap,saveMs:sample.saveMs}));
   if(turn>0&&turn%30===0){await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(()=>nodes.length),1000);report.reopens=(report.reopens||0)+1;}
   turn++;await new Promise(resolve=>setTimeout(resolve,5000));
  }
  await page.evaluate(()=>saveCanvasState());await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(()=>nodes.length),1000);
  report.success=true;
 } finally {report.finishedAt=new Date().toISOString();report.elapsedSeconds=(Date.parse(report.finishedAt)-Date.parse(report.startedAt))/1000;record();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{report.error=error.stack;record();console.error(error);process.exitCode=1});
