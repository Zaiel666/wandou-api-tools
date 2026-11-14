const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
test('a render shares task indexes and the next render sees changed retry results',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const stats=await page.evaluate(()=>{
   const runs=[];
   for(const count of [100,500,1000]){
    nodes=[];links=[];
    for(let i=0;i<count;i++){nodes.push({id:'g'+i,type:'generator'},{id:'r'+i,type:'result',mediaType:'image',status:'生成失败'});links.push({from:'g'+i,to:'r'+i});}
    const times=[],old=failedImageResult;let visits=0;failedImageResult=n=>{visits++;return old(n)};
    for(let run=0;run<5;run++){
     activeCanvasRenderIndex=canvasRenderIndex();const start=performance.now();
     for(const n of nodes.filter(n=>n.type==='generator')){canvasTaskRenderKey(n);generatorTaskActionsHtml(n)}
     times.push(performance.now()-start);activeCanvasRenderIndex=null;
    }
    failedImageResult=old;runs.push({count,visits,medianMs:times.sort((a,b)=>a-b)[2]});
   }
   activeCanvasRenderIndex=canvasRenderIndex();const before=failedImageResultsForSource('g0').length;activeCanvasRenderIndex=null;
   nodes.push({id:'retried',type:'result',regeneratedFromId:'r0',mediaType:'image',fullUrl:'data:image/png;base64,test'});links.push({from:'g0',to:'retried'});
   activeCanvasRenderIndex=canvasRenderIndex();const after=failedImageResultsForSource('g0').length;activeCanvasRenderIndex=null;
   return {runs,before,after};
  });
  for(const row of stats.runs)assert.equal(row.visits,row.count*5,'one task scan per render');assert.equal(stats.before,1);assert.equal(stats.after,0);
  fs.writeFileSync(path.resolve(__dirname,'../../qa/task-key-indexed.json'),JSON.stringify(stats,null,2));console.log(JSON.stringify(stats));
 }finally{await browser.close()}
});
