const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'})});
test.after(()=>browser?.close());
async function open(t,filename){const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();await page.route(/^https?:/,route=>route.abort());await page.goto(pathToFileURL(path.join(app,filename)).href+'?workspace=production&project=delete-all-regression');await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');await page.evaluate(()=>window.confirm=()=>true);return page;}
async function addSyntheticResult(page){return page.evaluate(async()=>{
 const image=document.createElement('canvas');image.width=8;image.height=6;image.getContext('2d').fillRect(0,0,8,6);const url=image.toDataURL('image/png');
 const result=createNode('result',600,300,{_deferRender:true,title:'Synthetic image',mediaType:'image',mediaUrl:url,fullUrl:url,width:8,height:6});render({skipSave:true});
 return {saved:await saveCanvasState(),id:result.id,ids:nodes.map(n=>n.id),intentionalResetAt,projectId:activeProjectId};
})}
for(const filename of ['ai-node-canvas-test.html','ai-node-canvas.html']){
 test(`${filename}: delete all, undo, redo and reload retain an explicitly empty canvas`,async t=>{
  const page=await open(t,filename),before=await addSyntheticResult(page);assert.equal(before.saved,true);assert.equal(before.intentionalResetAt,0);
  const result=await page.evaluate(async()=>{
   boxSelectedIds=nodes.map(n=>n.id);deleteSelectionNodes();const deleted={count:nodes.length,reset:intentionalResetAt,valid:isUsableCanvasSnapshot(getCanvasSnapshot())};
   await undoCanvas();const undo={ids:nodes.map(n=>n.id),reset:intentionalResetAt};
   await redoCanvas();const redo={count:nodes.length,reset:intentionalResetAt};return{deleted,undo,redo,saved:await saveCanvasState()};
  });
  assert.equal(result.deleted.count,0);assert.ok(result.deleted.reset>0);assert.equal(result.deleted.valid,true);assert.deepEqual(result.undo.ids,before.ids);assert.equal(result.undo.reset,0);
  assert.deepEqual(result.redo,{count:0,reset:result.deleted.reset});assert.equal(result.saved,true);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  const restored=await page.evaluate(()=>({count:nodes.length,reset:intentionalResetAt,projectId:activeProjectId}));assert.deepEqual(restored,{count:0,reset:result.deleted.reset,projectId:before.projectId});
 });
 test(`${filename}: deleting the final node is explicit, and undoing a newly added node can return to that empty state`,async t=>{
  const page=await open(t,filename);await addSyntheticResult(page);
  const result=await page.evaluate(async()=>{
   const ids=nodes.map(n=>n.id);for(const id of ids.slice(0,-1))deleteNode(id);
   const partial={count:nodes.length,reset:intentionalResetAt};deleteNode(ids.at(-1));const deleted={count:nodes.length,reset:intentionalResetAt};
   await undoCanvas();const undo={count:nodes.length,reset:intentionalResetAt};await redoCanvas();
   createNode('generator',20,20);await undoCanvas();const undoneAddition={count:nodes.length,reset:intentionalResetAt};
   return{partial,deleted,undo,undoneAddition,saved:await saveCanvasState()};
  });
  assert.deepEqual(result.partial,{count:1,reset:0});assert.equal(result.deleted.count,0);assert.ok(result.deleted.reset>0);assert.deepEqual(result.undo,{count:1,reset:0});assert.deepEqual(result.undoneAddition,result.deleted);assert.equal(result.saved,true);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');assert.equal(await page.evaluate(()=>nodes.length),0);
 });
 test(`${filename}: malformed/no-intent empty snapshots and no-op deletion do not acquire reset intent`,async t=>{
  const page=await open(t,filename);
  const result=await page.evaluate(()=>{
   nodes=[];links=[];intentionalResetAt=0;historyStack=[];redoStack=[];deleteNode('absent');boxSelectedIds=['absent'];deleteSelectionNodes();
   return{reset:intentionalResetAt,empty:isUsableCanvasSnapshot(JSON.stringify({nodes:[],links:[]})),malformed:isUsableCanvasSnapshot(JSON.stringify({nodes:[null,{}],links:[],intentionalResetAt:Date.now()})),legacy:parseCanvasSnapshot(JSON.stringify({nodes:[{id:'old',type:'image'}],links:[]})).intentionalResetAt};
  });
  assert.deepEqual(result,{reset:0,empty:false,malformed:false,legacy:0});
 });
}
