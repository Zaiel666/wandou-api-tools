const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');const {chromium}=require('../desktop-client/node_modules/playwright');
let browser;const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa/storage-ui');
test.before(async()=>{fs.mkdirSync(qa,{recursive:true});browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>await browser?.close());
async function open(theme,width,mode='normal'){
 const context=await browser.newContext({viewport:{width,height:800},colorScheme:theme});await context.route(/^https?:/,route=>route.abort());
 await context.addInitScript(({theme,mode})=>{
  window.calls=[];localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);
  if(mode!=='browser')window.wandouShell={getProjectStorageInfo:async()=>({success:true,available:true,currentDirectory:'D:\\Tools\\豌豆AI数据',defaultDirectory:'D:\\Tools\\豌豆AI数据',profileDirectory:'C:\\SyntheticProfile\\豌豆AI',storageMode:'portable',sizeBytes:1024}),chooseProjectStorageDirectory:async()=>({canceled:true}),requestProjectStorageMigration:async()=>({success:false}),getStorageUsage:async()=>{calls.push('usage');if(mode==='delayed')return new Promise(resolve=>window.finishUsage=resolve);return {success:true,sizes:{originals:1048576,backups:2048,projects:1024,exports:0,temporary:11,profile:4096},cacheBytes:512,partial:false};},clearNetworkCache:async()=>{calls.push('clear');return mode==='cancel'?{canceled:true}:{success:true,freedBytes:512};}};
 },{theme,mode});const page=await context.newPage();await page.goto(pathToFileURL(path.join(app,'asset-library-test.html')).href);await page.locator('[data-storage-settings-open]').click();return{context,page};
}
for(const theme of ['light','dark'])for(const width of [1360,1024])test(`storage controls ${theme} ${width}x800: paths, on-demand measurement and confirmed cleanup`,async()=>{
 const {context,page}=await open(theme,width);try{
  await page.waitForFunction(()=>document.querySelector('#projectStorageProfile').value);assert.match(await page.locator('#projectStorageProfile').inputValue(),/SyntheticProfile/);assert.deepEqual(await page.evaluate(()=>calls),[]);
  await page.locator('#storageUsageRefresh').click();await page.locator('#storageUsageList').waitFor({state:'visible'});assert.match(await page.locator('#storageUsageList').innerText(),/1\.00 MB/);
  const bounds=await page.locator('#projectStorageDialog').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=801);
  const style=await page.locator('#projectStorageDialog').evaluate(e=>({background:getComputedStyle(e).backgroundColor,text:getComputedStyle(e).color,scroll:e.scrollHeight>e.clientHeight}));assert.notEqual(style.background,style.text);assert.equal(style.background,theme==='dark'?'rgb(27, 27, 29)':'rgb(255, 255, 255)');
  await page.screenshot({path:path.join(qa,`${theme}-${width}.png`)});await page.locator('#storageCacheClear').click();await page.waitForFunction(()=>document.querySelector('#storageUsageStatus').textContent.includes('清理完成'));assert.deepEqual(await page.evaluate(()=>calls),['usage','clear']);
  await page.locator('#projectStorageClose').click();assert.equal(await page.locator('#projectStorageDialog').isVisible(),false);
 }finally{await context.close();}
});
test('cancel is visible and browser-only mode explains independent storage with cleanup disabled',async()=>{
 let f=await open('light',1024,'cancel');try{await f.page.locator('#storageCacheClear').click();await f.page.waitForFunction(()=>document.querySelector('#storageUsageStatus').textContent.includes('已取消'));}finally{await f.context.close();}
 f=await open('dark',1024,'browser');try{assert.match(await f.page.locator('#projectStorageStatus').innerText(),/不共享桌面版项目/);assert.equal(await f.page.locator('#storageCacheClear').isDisabled(),true);}finally{await f.context.close();}
});
test('closing and reopening during measurement does not render late old results or duplicate calls',async()=>{
 const {page,context}=await open('light',1024,'delayed');try{
  await page.locator('#storageUsageRefresh').click();assert.equal(await page.locator('#storageUsageRefresh').isDisabled(),true);await page.locator('#projectStorageClose').click();await page.locator('[data-storage-settings-open]').click();await page.evaluate(()=>finishUsage({success:true,sizes:{originals:999,backups:0,projects:0,exports:0,temporary:0,profile:0},cacheBytes:0}));await page.waitForTimeout(40);assert.equal(await page.locator('#storageUsageList').isHidden(),true);assert.deepEqual(await page.evaluate(()=>calls),['usage']);
 }finally{await context.close();}
});
