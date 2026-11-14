/* Fixed synthetic benchmark: local-only browser, no production data or API. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../../../..');
const {chromium}=require(path.join(root,'desktop-client/node_modules/playwright'));
const versions=['v218','v219'],counts=[100,500,1000],samples=[],gestures=process.env.WANDOU_GESTURE_BENCH==='1';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const sourceRoot=path.join(root,'artifacts'),fixtureRoot=path.join(root,'artifacts/canvas-performance-20261024/synthetic-4k');
const server=http.createServer((req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean);
  const base=parts[0]==='fixture'?fixtureRoot:path.join(sourceRoot,'release-'+parts[0],'source/app');
  const file=path.resolve(base,...parts.slice(1));
  if(!file.startsWith(base+path.sep)||!['v218','v219','fixture'].includes(parts[0]))throw Error();
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  for(const material of ['256px','4K'])for(const count of counts)for(const version of versions){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>r.request().url().startsWith(origin)||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());
   await page.goto(origin+'/'+version+'/ai-node-canvas-test.html?workspace=production');
   await page.waitForFunction(()=>document.body.dataset.testReady==='true'&&window.WandouCanvasViewport);await page.waitForTimeout(300);
   const result=await page.evaluate(async({count,material,origin,gestures})=>{
    nodes=[];links=[];nodeId=1;view={x:0,y:0,zoom:1};selectedNodeId=null;boxSelectedIds=[];
    const c=document.createElement('canvas');c.width=256;c.height=256;c.getContext('2d').fillRect(0,0,256,256);const png=c.toDataURL('image/png');
    for(let i=0;i<count;i++){
     const source=material==='4K'?origin+'/fixture/'+String(i%24).padStart(3,'0')+'.jpg':png;
     createNode('result',(i%25)*380,Math.floor(i/25)*360,{_deferRender:true,mediaUrl:source,fullUrl:source,previewUrl:source,width:material==='4K'?4096:256,height:material==='4K'?4096:256,pending:false});
     if(i>0&&i%25)links.push({from:nodes[i-1].id,to:nodes[i].id});
    }
    selectedNodeId=null;
    const start=performance.now();render({skipSave:true});const mountMs=performance.now()-start;
    await new Promise(r=>setTimeout(r,1500));
    const initial={domElements:document.querySelectorAll('*').length,nodeElements:canvas.querySelectorAll('.node').length,nodeDescendants:canvas.querySelectorAll('.node *').length,mountedImages:canvas.querySelectorAll('.node img').length,viewport:WandouCanvasViewport.stats()};
    const startUnchanged=performance.now();render({skipSave:true});const unchangedRenderMs=performance.now()-startUnchanged;
    async function frameRun(kind){const times=[];if(gestures)canvasWrap.classList.add(kind==='pan'?'is-panning':'is-zooming');let last=performance.now();for(let i=0;i<90;i++){
      await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-last);last=now;
      if(kind==='pan'){view.x-=13;view.y-=5;}else{view.zoom=.6+Math.abs(45-i)*.009;}
      applyCanvasTransform();
    }canvasWrap.classList.remove('is-panning','is-zooming');times.sort((a,b)=>a-b);return{p50:times[45],p95:times[85],max:times[89],over50ms:times.filter(t=>t>50).length};}
    const pan=await frameRun('pan'),zoom=await frameRun('zoom');
    await new Promise(r=>setTimeout(r,700));
    const previews=WandouCanvasPreview.stats();
    return{count,material,mountMs,unchangedRenderMs,initial,pan,zoom,previews,finalDomElements:document.querySelectorAll('*').length,viewport:WandouCanvasViewport.stats()};
   },{count,material,origin,gestures});
   const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
   const heap=await cdp.send('Runtime.getHeapUsage');const dom=await cdp.send('Memory.getDOMCounters');
   const sample={version,...result,heap,dom,errors};samples.push(sample);console.log(JSON.stringify(sample));await context.close();
  }
 }finally{
  await browser.close();await new Promise(r=>server.close(r));
  const report={gestureClasses:gestures,environment:'Sequential headless Edge, isolated origins/contexts, 1440x1000, 90 pan + 90 zoom frames. 4K uses24 distinct synthetic4096x4096 JPEG originals repeated across nodes. JS heap and DOM counters after forced GC are NOT process/GPU/RAM. Shared machine scheduling may vary.',samples};
  fs.writeFileSync(path.resolve(__dirname,'../../qa/viewport-performance-v219'+(gestures?'-gestures':'')+'.json'),JSON.stringify(report,null,2));
 }
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
