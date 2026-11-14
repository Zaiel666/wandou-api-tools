const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
test('compact save indexes cannot hide durable project previews, while an explicit empty canvas stays empty',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   localStorage.setItem('aiCanvasProjectsV1',JSON.stringify(['compact','reset'].map(id=>({id,name:id,createdAt:100,updatedAt:100}))));
   localStorage.setItem('aiCanvasStateV1:compact',JSON.stringify({savedAt:3000,nodeCount:23,desktopBackup:true}));
   localStorage.setItem('aiCanvasStateV1:reset',JSON.stringify({savedAt:3000,nodes:[],links:[],intentionalResetAt:3000}));
   const source="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='16' height='9' fill='green'/%3E%3C/svg%3E";
   window.wandouShell={readCanvasBackups:async()=>({success:true,states:[{savedAt:2000,nodes:Array.from({length:23},(_,i)=>({id:'n'+i,type:i===22?'result':'image',mediaType:'image',mediaUrl:i===22?source:''}))}]})};
  });
  await page.goto(pathToFileURL(path.join(app,'project-hub.html')).href);
  await page.waitForFunction(()=>document.querySelector('[data-cover="compact"] img')?.naturalWidth>0,{},{timeout:4000});
  assert.equal(await page.locator('[data-node-count="compact"]').textContent(),'23 个节点');
  assert.equal(await page.locator('[data-node-count="reset"]').textContent(),'0 个节点');
  assert.equal(await page.locator('[data-cover="reset"] img').count(),0);
 }finally{await browser.close();}
});
