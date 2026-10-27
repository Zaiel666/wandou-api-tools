const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const output=path.resolve(__dirname,'../artifacts/portable-storage-20261027/ui-verification');
let server,browser,origin;
test.before(async()=>{fs.mkdirSync(output,{recursive:true});server=http.createServer((req,res)=>{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(app+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(data)});});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
async function open({entry='asset-library.html',theme='light',mode='normal'}={}){
 const context=await browser.newContext({viewport:{width:1360,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await context.addInitScript(({theme,mode})=>{
  localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);window.storageCalls=[];
  const original='C:\\SyntheticProfile\\Projects',target='G:\\豌豆AI数据',portable='G:\\豌豆AI工具\\豌豆AI数据';
  const current=mode==='portable'?portable:mode==='custom'?target:original;
  const storageMode=['portable','custom'].includes(mode)?mode:'legacy';
  if(mode!=='browser')window.wandouShell={
   getProjectStorageInfo:async()=>{storageCalls.push(['info']);if(mode==='lateInfo')return await new Promise(resolve=>window.resolveStorageInfo=resolve);return{success:true,currentDirectory:current,defaultDirectory:mode==='oldDesktop'?original:portable,storageMode:mode==='oldDesktop'?undefined:storageMode,custom:mode==='custom',available:mode!=='unavailable',sizeBytes:mode==='unknownSize'?null:3221225472,fileCount:25,migrationPending:mode==='pending',lastMigration:mode==='previousFailure'?{error:'复制中断，仍保留旧目录'}:undefined};},
   chooseProjectStorageDirectory:async payload=>{storageCalls.push(payload?['choose',payload]:['choose']);if(mode==='cancel')return{success:false,canceled:true};if(mode==='conflict'||mode==='capacity')return{success:false,error:mode==='conflict'?'目标目录已有项目数据，不能覆盖。':'目标磁盘可用空间不足。'};return{success:true,currentDirectory:original,targetDirectory:payload?.useDefault?portable:target,selectionToken:payload?.useDefault?'synthetic-default-selection':'synthetic-selection',sizeBytes:3221225472,requiredBytes:3382286746,availableBytes:10737418240};},
   requestProjectStorageMigration:async payload=>{storageCalls.push(['migrate',payload]);if(mode==='saving')return await new Promise(resolve=>window.finishStorageRequest=resolve);if(mode==='saveFailure')return{success:false,error:'画布保存失败，请处理后重试。'};return{success:true,restarting:true};},
   onProjectStorageProgress:callback=>{window.storageProgress=callback;return()=>{window.storageProgress=null;};}
  };
 },{theme,mode});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin+'/'+entry);await page.waitForTimeout(100);
 assert.deepEqual(await page.evaluate(()=>storageCalls),[],'loading a page must not query or migrate storage');
 if(entry==='index.html'||entry==='homepage-test.html')await page.locator('[data-api-open]').click();
 await page.locator('[data-storage-settings-open]').click();await page.locator('#projectStorageDialog').waitFor();
 if(!['browser','lateInfo'].includes(mode))await page.waitForFunction(()=>document.querySelector('#projectStorageCurrent').value);
 return{page,context,errors};
}
for(const entry of ['index.html','homepage-test.html','asset-library.html','asset-library-test.html'])for(const theme of ['light','dark'])test(entry+' '+theme+' provides a reviewable migration target without starting migration',async()=>{
 const{page,context,errors}=await open({entry,theme});try{
  assert.equal(await page.locator('#projectStorageCurrent').inputValue(),'C:\\SyntheticProfile\\Projects');assert.match(await page.locator('#projectStorageCurrentMeta').innerText(),/3\.00 GB/);
  assert.match(await page.locator('#projectStorageScope').innerText(),/API 密钥.*浏览器存储仍保留在原位置/);assert.match(await page.locator('.storage-settings-retention').innerText(),/旧副本仍占空间/);
  assert.equal(await page.locator('#projectStorageMigrate').isDisabled(),true);await page.locator('#projectStorageChoose').click();await page.waitForFunction(()=>!document.querySelector('#projectStorageMigrate').disabled);
  assert.equal(await page.locator('#projectStorageTarget').inputValue(),'G:\\豌豆AI数据');assert.match(await page.locator('#projectStorageTargetMeta').innerText(),/10\.0 GB/);assert.deepEqual(await page.evaluate(()=>storageCalls.map(c=>c[0])),['info','choose']);
  assert.equal(await page.locator('#projectStorageTarget').getAttribute('readonly'),'');assert.equal(await page.locator('#projectStorageCurrent').getAttribute('readonly'),'');
  const style=await page.locator('#projectStorageDialog').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));assert.equal(style.bg,theme==='dark'?'rgb(27, 27, 29)':'rgb(255, 255, 255)');assert.notEqual(style.color,style.bg);
  await page.screenshot({path:path.join(output,entry.replace('.html','')+'-'+theme+'.png')});assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('only the explicit migration action sends the chooser-issued target and token, with save progress and no double dispatch',async()=>{
 const{page,context}=await open({mode:'saving'});try{await page.locator('#projectStorageChoose').click();await page.waitForFunction(()=>!document.querySelector('#projectStorageMigrate').disabled);
  await page.locator('#projectStorageTarget').evaluate(e=>e.value='C:\\forged-path');await page.locator('#projectStorageMigrate').evaluate(e=>{e.click();e.click();});await page.waitForFunction(()=>!!window.finishStorageRequest);
  assert.deepEqual(await page.evaluate(()=>storageCalls.filter(c=>c[0]==='migrate')), [['migrate',{targetDirectory:'G:\\豌豆AI数据',selectionToken:'synthetic-selection'}]]);
  assert.equal(await page.locator('#projectStorageClose').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#projectStorageDialog').evaluate(e=>e.open),true);
  await page.evaluate(()=>storageProgress({phase:'saving',message:'正在保存打开的画布'}));assert.equal(await page.locator('#projectStorageStatus').innerText(),'正在保存打开的画布');
  await page.evaluate(()=>finishStorageRequest({success:true,restarting:true}));await page.waitForFunction(()=>document.querySelector('#projectStorageStatus').textContent.includes('正在重启'));assert.equal(await page.locator('#projectStorageMigrate').isDisabled(),true);
 }finally{await context.close();}
});
for(const mode of ['cancel','conflict','capacity'])test(mode+' leaves the current directory unchanged and never requests migration',async()=>{
 const{page,context}=await open({mode});try{await page.locator('#projectStorageChoose').click();await page.waitForFunction(()=>!document.querySelector('#projectStorageClose').disabled);assert.equal(await page.locator('#projectStorageTargetSection').isHidden(),true);assert.equal(await page.locator('#projectStorageMigrate').isDisabled(),true);assert.equal(await page.locator('#projectStorageCurrent').inputValue(),'C:\\SyntheticProfile\\Projects');assert.deepEqual(await page.evaluate(()=>storageCalls.map(c=>c[0])),['info','choose']);assert.match(await page.locator('#projectStorageStatus').innerText(),mode==='cancel'?/已取消选择/:mode==='conflict'?/不能覆盖/:/空间不足/);}finally{await context.close();}
});
test('save failure stays on the original path and requires a fresh target selection',async()=>{
 const{page,context}=await open({mode:'saveFailure'});try{await page.locator('#projectStorageChoose').click();await page.locator('#projectStorageMigrate').click();await page.waitForFunction(()=>document.querySelector('#projectStorageStatus').textContent.includes('画布保存失败'));assert.equal(await page.locator('#projectStorageCurrent').inputValue(),'C:\\SyntheticProfile\\Projects');assert.equal(await page.locator('#projectStorageTargetSection').isHidden(),true);assert.equal(await page.locator('#projectStorageMigrate').isDisabled(),true);assert.equal(await page.locator('#projectStorageChoose').isDisabled(),false);}finally{await context.close();}
});
for(const mode of ['browser','unavailable','pending'])test(mode+' cannot choose or start an unsafe migration',async()=>{
 const{page,context}=await open({mode});try{assert.equal(await page.locator('#projectStorageChoose').isDisabled(),true);assert.equal(await page.locator('#projectStorageMigrate').isDisabled(),true);assert.match(await page.locator('#projectStorageStatus').innerText(),mode==='browser'?/桌面版/:mode==='pending'?/等待软件重启/:/不可用/);assert.equal(await page.locator('#projectStorageClose').isDisabled(),false);}finally{await context.close();}
});
test('unknown size is not shown as zero, and theme changes update an already open dialog',async()=>{
 const{page,context}=await open({mode:'unknownSize'});try{assert.match(await page.locator('#projectStorageCurrentMeta').innerText(),/暂时无法统计/);await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});assert.equal(await page.locator('#projectStorageDialog').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 27, 29)');}finally{await context.close();}
});
test('a late storage-info response cannot reopen or repopulate a closed dialog',async()=>{
 const{page,context}=await open({mode:'lateInfo'});try{await page.waitForFunction(()=>!!window.resolveStorageInfo);await page.locator('#projectStorageClose').click();await page.evaluate(()=>resolveStorageInfo({success:true,currentDirectory:'C:\\late-data',available:true}));await page.waitForTimeout(30);assert.equal(await page.locator('#projectStorageDialog').evaluate(e=>e.open),false);assert.equal(await page.locator('#projectStorageCurrent').inputValue(),'');assert.equal(await page.evaluate(()=>window.storageProgress),null);}finally{await context.close();}
});
test('a previous migration failure is shown without claiming the new directory is active',async()=>{
 const{page,context}=await open({mode:'previousFailure'});try{assert.match(await page.locator('#projectStorageStatus').innerText(),/上次迁移未完成/);assert.equal(await page.locator('#projectStorageCurrent').inputValue(),'C:\\SyntheticProfile\\Projects');}finally{await context.close();}
});

for(const mode of ['portable','custom','legacy'])test(mode+' shows actual current path separately from the program default',async()=>{
 const{page,context}=await open({mode});try{
  const portable='G:\\豌豆AI工具\\豌豆AI数据';
  const expected=mode==='portable'?portable:mode==='custom'?'G:\\豌豆AI数据':'C:\\SyntheticProfile\\Projects';
  assert.equal(await page.locator('#projectStorageCurrent').inputValue(),expected);
  assert.equal(await page.locator('#projectStorageDefault').inputValue(),portable);
  assert.equal(await page.locator('#projectStorageDefault').getAttribute('readonly'),'');
  assert.match(await page.locator('#projectStorageCurrentMeta').innerText(),mode==='portable'?/随程序保存/:mode==='custom'?/自定义位置/:/旧版保存位置/);
  assert.equal(await page.locator('#projectStorageDefaultChoose').isDisabled(),mode==='portable');
  assert.equal(await page.locator('#projectStorageChoose').isDisabled(),false);
  assert.match(await page.locator('#projectStorageDefaultSection').innerText(),/移动软件时.*一并保留/);
  assert.deepEqual(await page.evaluate(()=>storageCalls.map(c=>c[0])),['info']);
 }finally{await context.close();}
});

test('using the program directory only prepares a target; migration requires the separate action and native-issued token',async()=>{
 const{page,context}=await open({mode:'custom'});try{
  await page.locator('#projectStorageDefault').evaluate(e=>e.value='C:\\forged-program-path');
  await page.locator('#projectStorageDefaultChoose').click();
  await page.waitForFunction(()=>!document.querySelector('#projectStorageMigrate').disabled);
  assert.equal(await page.locator('#projectStorageCurrent').inputValue(),'G:\\豌豆AI数据');
  assert.equal(await page.locator('#projectStorageTarget').inputValue(),'G:\\豌豆AI工具\\豌豆AI数据');
  assert.deepEqual(await page.evaluate(()=>storageCalls),[['info'],['choose',{useDefault:true}]]);
  await page.locator('#projectStorageMigrate').click();
  await page.waitForFunction(()=>document.querySelector('#projectStorageStatus').textContent.includes('正在重启'));
  assert.deepEqual(await page.evaluate(()=>storageCalls.filter(c=>c[0]==='migrate')),[['migrate',{targetDirectory:'G:\\豌豆AI工具\\豌豆AI数据',selectionToken:'synthetic-default-selection'}]]);
 }finally{await context.close();}
});

test('old desktop metadata never labels the profile directory as a program directory',async()=>{
 const{page,context}=await open({mode:'oldDesktop'});try{
  assert.equal(await page.locator('#projectStorageDefaultSection').isHidden(),true);
  assert.equal(await page.locator('#projectStorageDefaultChoose').isHidden(),true);
  assert.equal(await page.locator('#projectStorageDefault').inputValue(),'');
  assert.equal(await page.locator('#projectStorageChoose').isDisabled(),false);
 }finally{await context.close();}
});
