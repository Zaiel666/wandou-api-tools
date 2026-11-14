const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'../../../..'),{chromium}=require(path.join(root,'desktop-client/node_modules/playwright'));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}), samples=[];
 try {
  for(const version of ['2.0.16','2.0.17'])for(const count of [100,500,1000]){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage();
   await page.route(/^https?:/,r=>r.abort());
   const source=version==='2.0.16'?'artifacts/publish-v216/source/app/ai-node-canvas-test.html':'artifacts/release-v217/source/app/ai-node-canvas-test.html';
   await page.goto(pathToFileURL(path.join(root,source)).href);
   await page.waitForFunction(()=>document.body.dataset.testReady==='true');
   samples.push({version,...await page.evaluate(async count=>{
    nodes=[];links=[];nodeId=1;view={x:0,y:0,zoom:1};selectedNodeId=null;boxSelectedIds=[];
    const c=document.createElement('canvas');c.width=256;c.height=256;c.getContext('2d').fillRect(0,0,256,256);const png=c.toDataURL('image/png');
    for(let i=0;i<count;i++)createNode('result',(i%25)*300,Math.floor(i/25)*340,{_deferRender:true,mediaUrl:png,fullUrl:png,previewUrl:png,width:256,height:256,pending:false});
    selectedNodeId=null;
    const t=performance.now();render({skipSave:true});const mountMs=performance.now()-t;
    await new Promise(r=>setTimeout(r,700));
    const unchangedStart=performance.now();render({skipSave:true});const unchangedRenderMs=performance.now()-unchangedStart;
    const frames=[];let last=performance.now();
    for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-last);last=now;view.x-=7;view.y-=2;applyCanvasTransform();}
    frames.sort((a,b)=>a-b);
    return {count,mountMs,unchangedRenderMs,domNodes:document.querySelectorAll('.node').length,totalElements:document.querySelectorAll('*').length,panFrameP50:frames[45],panFrameP95:frames[85],panFrameMax:frames[89],viewport:window.WandouCanvasViewport?.stats()};
   },count)});
   await context.close();
  }
 } finally {
  await browser.close();const report={environment:'Same-process sequential headless Edge synthetic repeated256px PNGs;90 pan frames; not real Electron4K or a benchmark guarantee',samples};
  fs.writeFileSync(path.resolve(__dirname,'../../qa/viewport-performance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
