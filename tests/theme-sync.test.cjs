const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve('app');
const executablePath='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const source=fs.readFileSync(path.join(app,'theme-sync.js'),'utf8');
test('a delayed desktop preference cannot undo a newer click; stale revisions and blocked storage are safe',async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<body></body>');
  await page.evaluate(()=>{window.sent=[];window.wandouShell={getTheme:()=>new Promise(r=>window.resolveTheme=r),setTheme:t=>sent.push(t),onThemeChanged:f=>window.receiveTheme=f};});
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{WandouTheme.set('dark');resolveTheme({theme:'light',revision:1});});
  await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>WandouTheme.get()),'dark');
  await page.evaluate(()=>{receiveTheme({theme:'dark',revision:10});receiveTheme({theme:'light',revision:9});});
  assert.deepEqual(await page.evaluate(()=>({theme:WandouTheme.get(),root:document.documentElement.dataset.theme,body:document.body.classList.contains('dark-theme'),sent})),{theme:'dark',root:'dark',body:true,sent:['dark']});
 }finally{await browser.close();}
});
test('all 18 local pages follow actual theme controls without reload or canvas edits',async()=>{
 const server=http.createServer((req,res)=>{try{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');
  const file=path.resolve(app,relative||'index.html');if(!file.startsWith(path.resolve(app)+path.sep))throw Error('outside root');
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';
  res.setHeader('Content-Type',mime+'; charset=utf-8');res.end(fs.readFileSync(file));
 }catch(_){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({executablePath,headless:true}),context=await browser.newContext();
 const files=['homepage-test.html','index.html','project-hub.html','ai-node-canvas-test.html?workspace=production','ai-node-canvas.html','asset-library-test.html','asset-library.html','image-workbench/index.html','gridform.html','type-motion.html','prompt-mind-map.html','daily-news/index.html','plain-to-pro.html','keyword-reverse.html','upscale-4k.html','watermark-remove.html','video-prompt-pro.html','png-workflow.html'];
 const pages=new Map(),snapshots=[];
 try{
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  for(const file of files){const page=await context.newPage();await page.goto(base+file,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.WandouTheme&&document.body);pages.set(file,page);}
  const home=pages.get('homepage-test.html'),canvas=pages.get('ai-node-canvas-test.html?workspace=production');
  await canvas.waitForFunction(()=>document.body.dataset.canvasReady==='true');
  await canvas.evaluate(()=>{window.themeSaveCalls=0;window.themeSaveStacks=[];window.themeBeforeState=JSON.stringify({nodes,links,view});window.themeBeforeHTML=document.querySelector('#canvas')?.innerHTML;scheduleCanvasSave=()=>{window.themeSaveCalls++;window.themeSaveStacks.push(new Error().stack);};});
  const checks=[['homepage-test.html','[data-theme-toggle]','dark'],['ai-node-canvas-test.html?workspace=production','#themeToggleButton','light'],['project-hub.html','#themeToggle','dark'],['image-workbench/index.html','.wd-theme-toggle','light'],['gridform.html','#studioTheme','dark'],['type-motion.html','#theme','light'],['daily-news/index.html','#themeToggle','dark']];
  for(const [file,selector,expected]of checks){
   await pages.get(file).locator(selector).click();
   for(const [name,page]of pages){await page.waitForFunction(t=>window.WandouTheme.get()===t&&document.documentElement.dataset.theme===t&&document.body.classList.contains('dark-theme')===(t==='dark'),expected,{timeout:10000});}
   const value={control:file,theme:expected,pages:[]};
   for(const [name,page]of pages)value.pages.push({file:name,...await page.evaluate(()=>({theme:WandouTheme.get(),background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color,colorScheme:getComputedStyle(document.documentElement).colorScheme}))});
   snapshots.push(value);
  }
  assert.deepEqual(await canvas.evaluate(()=>({unchanged:window.themeBeforeState===JSON.stringify({nodes,links,view}),saves:window.themeSaveCalls})),{unchanged:true,saves:0},JSON.stringify(await canvas.evaluate(()=>window.themeSaveStacks)));
  const extra=await context.newPage();await extra.goto(base+'plain-to-pro.html');assert.equal(await extra.evaluate(()=>WandouTheme.get()),'dark');
  await home.reload();assert.equal(await home.evaluate(()=>WandouTheme.get()),'dark');
  assert.equal(await pages.get('project-hub.html').locator('#themeText').textContent(),'白天');
  assert.equal(await canvas.locator('[data-theme-text]').textContent(),'白');
  assert.equal(await pages.get('gridform.html').locator('#studioTheme').textContent(),'切换浅色');
  const report=process.env.WANDOU_THEME_REPORT;if(report)fs.writeFileSync(report,JSON.stringify({passed:true,pages:files.length,actualControls:checks.length,snapshots},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
