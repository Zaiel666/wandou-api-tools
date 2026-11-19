'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(process.env.WANDOU_TEST_APP_DIR||path.join(__dirname,'../app')),qa=path.resolve(__dirname,'../../qa');
const checks=[],screenshots=[];let browser,server,origin,initialHashes,startedAt,registered=0;
function hashFiles(){const map={};function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,entry.name);if(entry.isDirectory())visit(p);else if(entry.isFile())map[path.relative(app,p).replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}visit(app);return map;}
function check(name,fn){registered++;test(name,async t=>{try{const detail=await fn(t);checks.push({name,passed:true,...detail});}catch(error){checks.push({name,passed:false,error:error.message});throw error;}});}
test.before(async()=>{
 startedAt=new Date().toISOString();initialHashes=hashFiles();fs.mkdirSync(qa,{recursive:true});
 server=http.createServer((req,res)=>{try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep))throw Error('Outside app');res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));const after=hashFiles(),runtimeUnchanged=JSON.stringify(initialHashes)===JSON.stringify(after);fs.writeFileSync(path.join(qa,'canvas-fit-and-guide-v223.json'),JSON.stringify({success:checks.length===registered&&checks.every(c=>c.passed)&&runtimeUnchanged,startedAt,finishedAt:new Date().toISOString(),appHashes:initialHashes,appHashesAfter:after,runtimeUnchanged,checks,screenshots,paidCalls:0},null,2));assert.equal(runtimeUnchanged,true,'App must remain frozen during final validation');});
async function fixture(t,{width=1024,theme='dark',workbench=false,motion=false}={}){
 const context=await browser.newContext({viewport:{width,height:800},reducedMotion:motion?'no-preference':'reduce'});t.after(()=>context.close());const external=[],errors=[];
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();const url=new URL(route.request().url());external.push({origin:url.origin,path:url.pathname,method:route.request().method()});return route.abort();});
 await context.addInitScript(theme=>{localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);},theme);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+(workbench?'/image-workbench/index.html':'/ai-node-canvas-test.html?workspace=production'));
 if(workbench)await page.waitForSelector('.wd-workbench-generation');else{await page.waitForFunction(()=>document.body.dataset.testReady==='true');await page.evaluate(()=>{nodes=[];links=[];nodeId=1;selectedNodeId=null;boxSelectedIds=[];view={x:0,y:0,zoom:1};render({skipSave:true});applyCanvasTransform();});}
 return{page,external,errors};
}
async function frames(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function setAssistant(page,open){if((await page.locator('#assistantToggleButton').getAttribute('aria-expanded')==='true')!==open)await page.locator('#assistantToggleButton').click();await frames(page);}
async function measure(page){return page.evaluate(()=>{
 const wrap=canvasWrap.getBoundingClientRect(),toolbar=document.querySelector('.test-canvas-toolbar').getBoundingClientRect(),topbar=document.querySelector('.topbar').getBoundingClientRect(),panel=assistantPanel.getBoundingClientRect(),assistantOpen=document.querySelector('.app').classList.contains('assistant-open');
 const bounds=[...canvas.querySelectorAll('.node:not(.selection)')].map(el=>({id:el.dataset.id,...el.getBoundingClientRect().toJSON(),worldWidth:el.offsetWidth,worldHeight:el.offsetHeight,shell:el.dataset.viewportSkipped==='true'}));
 const safe={left:Math.max(0,wrap.left)+23,top:Math.max(0,wrap.top)+23,right:Math.min(innerWidth,wrap.right)-23,bottom:Math.min(innerHeight,wrap.bottom)-23};
 if(assistantOpen&&panel.left<safe.right&&panel.right>safe.left&&panel.top<safe.bottom&&panel.bottom>safe.top)safe.right=Math.min(safe.right,panel.left-23);
 if(topbar.left<safe.right&&topbar.right>safe.left&&topbar.top<safe.bottom&&topbar.bottom>safe.top)safe.top=Math.max(safe.top,topbar.bottom+23);
 if(toolbar.left<safe.right&&toolbar.right>safe.left&&toolbar.top<safe.bottom&&toolbar.bottom>safe.top)safe.bottom=Math.min(safe.bottom,toolbar.top-23);
 return{view:{...view},bounds,safe,assistantOpen,stats:window.WandouCanvasViewport?.stats()};
});}
function contained(sample){for(const b of sample.bounds){assert.ok(b.left>=sample.safe.left&&b.right<=sample.safe.right,JSON.stringify({b,safe:sample.safe}));assert.ok(b.top>=sample.safe.top&&b.bottom<=sample.safe.bottom,JSON.stringify({b,safe:sample.safe}));}}
async function screenshot(page,name){await page.screenshot({path:path.join(qa,name)});screenshots.push(name);}

for(const width of [1024,1440])for(const theme of ['light','dark'])for(const format of ['svg','gif'])check(`one fit reveals complete ${format} controls with assistant open/closed: ${width} ${theme}`,async t=>{
 const{page,external,errors}=await fixture(t,{width,theme});await page.locator(`[data-add-node="${format}"]`).click();await page.locator('.node.generator [data-field="prompt"]').fill('仅测试画布布局，不发送生成请求。');
 const before=await page.evaluate(()=>JSON.stringify(nodes));const states=[];
 for(const open of [true,false]){await setAssistant(page,open);await page.locator('.test-canvas-toolbar [data-tool="fit"]').click();await frames(page);const sample=await measure(page);contained(sample);assert.equal(sample.assistantOpen,open);assert.equal(await page.evaluate(()=>JSON.stringify(nodes)),before,'Fitting changes view only');
  const action=await page.locator('.node.generator [data-generate]').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.equal(action,true,'Generate button is visible and unobscured after a single fit');states.push(sample);
 }
 await page.locator('[data-image-option="imageQuality"]').selectOption('medium');assert.equal(await page.locator('[data-image-option="imageQuality"]').inputValue(),'medium','Visible controls remain usable');
 await screenshot(page,`fit-${format}-${width}-${theme}.png`);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);return{width,theme,format,states};
});

check('fit during assistant opening remains visible when its slide finishes',async t=>{
 const{page,external,errors}=await fixture(t,{motion:true});await setAssistant(page,false);await page.waitForFunction(()=>Number(getComputedStyle(assistantPanel).opacity)===0);
 await page.locator('[data-add-node="gif"]').click();await page.locator('#assistantToggleButton').click();await page.locator('.test-canvas-toolbar [data-tool="fit"]').click();await page.waitForFunction(()=>getComputedStyle(assistantPanel).transform==='none');await frames(page);const sample=await measure(page);contained(sample);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);return{sample};
});

check('fit handles negative coordinates, resized long editors, preserves content, and survives save/reopen',async t=>{
 const{page,external,errors}=await fixture(t,{width:1440});await setAssistant(page,false);
 await page.evaluate(()=>{createNode('generator',-1400,-1000,{model:'gpt-image-2.6-flare',imageOutputFormat:'gif',outputFormat:'gif',prompt:'synthetic long editor',promptHeight:600,frameWidth:620,frameHeight:1800,_deferRender:true});createNode('keyword',-100,-150,{prompt:'synthetic keyword',frameWidth:520,_deferRender:true});selectedNodeId=null;render({skipSave:true});});await frames(page);
 const before=await page.evaluate(()=>JSON.stringify(nodes));await page.locator('.test-canvas-toolbar [data-tool="fit"]').click();await frames(page);const first=await measure(page);contained(first);assert.equal(await page.evaluate(()=>JSON.stringify(nodes)),before);assert.ok(first.bounds.some(b=>b.worldHeight>=1800));
 const saved=await page.evaluate(async()=>{await saveCanvasState();return{view:{...view},fields:nodes.map(({id,x,y,type,prompt,promptHeight,frameWidth,frameHeight})=>({id,x,y,type,prompt,promptHeight,frameWidth,frameHeight}))};});await page.reload();await page.waitForFunction(()=>document.body.dataset.testReady==='true');await frames(page);
 const reopened=await page.evaluate(()=>({view:{...view},fields:nodes.map(({id,x,y,type,prompt,promptHeight,frameWidth,frameHeight})=>({id,x,y,type,prompt,promptHeight,frameWidth,frameHeight}))}));assert.deepEqual(reopened.fields,saved.fields);assert.deepEqual(reopened.view,saved.view);
 await page.locator('.test-canvas-toolbar [data-tool="fit"]').click();await frames(page);contained(await measure(page));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);return{first,saved,reopened};
});

check('empty canvas and only-shrink keep view stable; the same view centers after deliberate fit',async t=>{
 const{page,external,errors}=await fixture(t);await setAssistant(page,false);
 const empty=await page.evaluate(()=>{view={x:143,y:-87,zoom:.5};applyCanvasTransform();const before={...view};fitCanvasToContent(false);return{before,after:{...view}};});assert.deepEqual(empty.after,empty.before);
 const shrink=await page.evaluate(()=>{createNode('generator',-500,-700,{prompt:'synthetic',promptHeight:600,frameHeight:1800});view={x:183,y:-211,zoom:.2};applyCanvasTransform();const before={...view};fitCanvasToContent(true);return{before,after:{...view}};});assert.deepEqual(shrink.after,shrink.before);
 await page.evaluate(()=>{view={x:9000,y:-9000,zoom:.9};applyCanvasTransform();fitCanvasToContent(true);});await frames(page);const sample=await measure(page);contained(sample);assert.ok(sample.view.zoom<.9);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);return{empty,shrink,sample};
});

check('1000-node fit keeps LOD budgets/originals, explains minimum zoom, and still pans normally',async t=>{
 const{page,external,errors}=await fixture(t,{width:1440});await setAssistant(page,false);
 await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(10,10,40,40);window.qaOriginal=c.toDataURL();for(let i=0;i<1000;i++)createNode('result',(i%50)*400,Math.floor(i/50)*350,{mediaUrl:qaOriginal,fullUrl:qaOriginal,previewUrl:qaOriginal,width:64,height:64,_deferRender:true});selectedNodeId=null;render({skipSave:true});});await frames(page);
 const before=await page.evaluate(()=>JSON.stringify(nodes));const start=Date.now();await page.locator('.test-canvas-toolbar [data-tool="fit"]').click();await frames(page);const elapsedMs=Date.now()-start;const sample=await measure(page);
 assert.equal(sample.view.zoom,.12);assert.match(await page.locator('#toast').innerText(),/12%.*超出窗口.*拖动/);assert.ok(sample.stats.mountedContents<=96,JSON.stringify(sample.stats));assert.ok(sample.stats.overviewImages<=96);assert.equal(await page.evaluate(()=>JSON.stringify(nodes)),before);assert.equal(await page.evaluate(()=>nodes.every(n=>n.fullUrl===qaOriginal)),true);
 await page.locator('.test-canvas-toolbar [data-tool="pan"]').click();const point=await page.evaluate(()=>{const r=canvasWrap.getBoundingClientRect();return{x:r.left+110,y:r.top+130};});const viewBefore=await page.evaluate(()=>({...view}));await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+80,point.y+60,{steps:4});await page.mouse.up();await frames(page);const viewAfter=await page.evaluate(()=>({...view}));assert.ok(Math.abs(viewAfter.x-viewBefore.x-80)<1);assert.ok(Math.abs(viewAfter.y-viewBefore.y-60)<1);assert.equal(viewAfter.zoom,viewBefore.zoom);assert.equal(await page.evaluate(()=>JSON.stringify(nodes)),before);
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);return{elapsedMs,sample,viewBefore,viewAfter};
});

function luminance(color){const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;}
for(const width of [1024,1440])for(const theme of ['light','dark'])check(`operation guide shortcut text has readable theme colors: ${width} ${theme}`,async t=>{
 const{page,external,errors}=await fixture(t,{width,theme,workbench:true});await page.getByRole('button',{name:'操作指南',exact:true}).click();const keys=page.locator('.wd-operation-guide kbd');await keys.first().waitFor();await keys.first().scrollIntoViewIfNeeded();
 const samples=await keys.evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return{text:el.textContent,color:s.color,background:s.backgroundColor,border:s.borderColor,bounds:el.getBoundingClientRect().toJSON(),theme:document.documentElement.dataset.wdTheme};}));assert.ok(samples.length>=2);
 for(const s of samples){const a=luminance(s.color),b=luminance(s.background);s.contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(s.contrast>=4.5,JSON.stringify(s));assert.equal(s.theme,theme);assert.ok(s.bounds.left>=0&&s.bounds.right<=width);assert.ok(s.bounds.top>=0&&s.bounds.bottom<=800);}
 await screenshot(page,`guide-kbd-${width}-${theme}.png`);assert.ok(external.every(r=>r.method==='GET'&&['https://fontsapi.zeoseven.com','https://cdn.jsdelivr.net','https://api.github.com'].includes(r.origin)),JSON.stringify(external));assert.deepEqual(errors,[]);return{width,theme,samples,blockedExternal:external};
});
