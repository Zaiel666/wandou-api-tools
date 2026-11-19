const wandouQaVersion=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../desktop-client/package.json'),'utf8')).version;
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa'),scope=['storage-settings.js','storage-settings.css'];
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashes=()=>Object.fromEntries(scope.map(file=>['app/'+file,sha(path.join(app,file))]));
const report={version:wandouQaVersion,success:false,productionDataAccessed:false,paidCalls:0,chromiumSandbox:true,scopeHashes:hashes(),testSha256:sha(__filename),checks:[],screenshots:[]};
let browser;
test.before(async()=>{fs.mkdirSync(qa,{recursive:true});browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>{await browser?.close();report.scopeHashesAfter=hashes();report.runtimeUnchanged=JSON.stringify(report.scopeHashes)===JSON.stringify(report.scopeHashesAfter);report.success=report.checks.length===9&&report.checks.every(c=>c.passed)&&report.runtimeUnchanged;fs.writeFileSync(path.join(qa,'storage-usage-ui-v228.json'),JSON.stringify(report,null,2));});
function check(name,fn){test(name,async()=>{try{const details=await fn();report.checks.push({name,passed:true,...details});}catch(error){report.checks.push({name,passed:false,error:error.message});throw error;}});}
async function open(theme='light',width=1024){
 const context=await browser.newContext({viewport:{width,height:800},colorScheme:theme}),errors=[],requests=[];
 await context.route(/^https?:/,route=>{requests.push(route.request().method());return route.abort();});
 await context.addInitScript(theme=>{
  localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);window.usageCalls=[];window.usageMode='normal';window.finishUsage=null;
  window.usageResult={success:true,sizes:{originals:1024+2048+64+128+32,backups:4096,projects:256,exports:0,temporary:16,profile:512,browserSession:8192},originalBreakdown:{standard:1024,compatibility:2048,metadata:64,recovery:128,other:32},cacheBytes:256,partial:false,partialReasons:[]};
  window.wandouShell={
   getProjectStorageInfo:async()=>({success:true,available:true,storageMode:'portable',currentDirectory:'D:\\Synthetic\\豌豆AI数据',defaultDirectory:'D:\\Synthetic\\豌豆AI数据',profileDirectory:'C:\\SyntheticProfile',browserSessionDirectory:'D:\\Synthetic\\豌豆AI数据\\browser-session',originalFiles:{originalDirectory:'D:\\Synthetic\\豌豆AI数据\\canvas-media\\originals',converted:0,skipped:0},sizeBytes:4096}),
   chooseProjectStorageDirectory:async()=>({canceled:true}),requestProjectStorageMigration:async()=>{usageCalls.push('migration');return{success:false};},
   getStorageUsage:async()=>{usageCalls.push('usage');if(usageMode==='delayed')return new Promise(resolve=>finishUsage=resolve);if(usageMode==='failure')throw Error('合成目录暂不可用');return structuredClone(usageResult);},
   clearNetworkCache:async()=>{usageCalls.push('clear');return{canceled:true};},
   getCanvasMediaLocation:async()=>{usageCalls.push('standardize');throw Error('Inventory must not standardize originals');}
  };
 },theme);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(path.join(app,'asset-library-test.html')).href);await page.locator('[data-storage-settings-open]').click();await page.waitForFunction(()=>document.querySelector('#projectStorageCurrent').value);
 return{context,page,errors,requests};
}
async function measure(page){await page.locator('#storageUsageRefresh').click();await page.waitForFunction(()=>document.querySelector('#storageUsageList').hidden===false&&!document.querySelector('#storageUsageRefresh').disabled);}
for(const theme of ['light','dark'])for(const width of [1024,1440])check(`retained storage breakdown actual controls ${theme} ${width}x800`,async()=>{
 const f=await open(theme,width),{page,context}=f;try{
  assert.deepEqual(await page.evaluate(()=>usageCalls),[]);await measure(page);
  const rows=await page.locator('#storageUsageList').evaluate(e=>Array.from(e.querySelectorAll('dt')).map(dt=>({label:dt.firstChild.textContent,value:dt.nextElementSibling.textContent,note:dt.querySelector('span')?.textContent,detail:dt.classList.contains('storage-usage-detail')})));
  const find=label=>rows.find(row=>row.label===label);assert.equal(find('标准原图文件').value,'1.00 KB');assert.equal(find('.data 兼容原件').value,'2.00 KB');assert.match(find('.data 兼容原件').note,/可能是唯一原件/);assert.equal(find('恢复保留件').value,'128 B');assert.match(find('校验与发布记录').note,/中断恢复/);assert.match(find('项目备份').note,/不会删除/);assert.match(find('写入临时文件（保留）').note,/不按文件名/);assert.equal(rows.filter(row=>row.detail).length,5);
  const status=await page.locator('#storageUsageStatus').innerText();assert.match(status,/未校验内容或项目引用/);assert.match(status,/不代表可释放空间/);assert.match(status,/旧程序备份.*不计入/);
  await page.locator('#storageUsageRefresh').scrollIntoViewIfNeeded();const bounds=await page.locator('#projectStorageDialog').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=801);
  assert.equal(await page.locator('#storageUsageList').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  assert.equal(await page.locator('#projectStorageDialog').evaluate(e=>getComputedStyle(e).backgroundColor),theme==='dark'?'rgb(27, 27, 29)':'rgb(255, 255, 255)');
  const screenshot=`storage-usage-${theme}-${width}.png`;await page.screenshot({path:path.join(qa,screenshot)});report.screenshots.push(screenshot);
  await page.locator('#storageUsageStatus').scrollIntoViewIfNeeded();
  const statusBounds=await page.locator('#storageUsageStatus').boundingBox();assert.ok(statusBounds.y>=bounds.y && statusBounds.y+statusBounds.height<=bounds.y+bounds.height+1);
  const bottomScreenshot=`storage-usage-${theme}-${width}-details.png`;await page.screenshot({path:path.join(qa,bottomScreenshot)});report.screenshots.push(bottomScreenshot);
  assert.deepEqual(await page.evaluate(()=>usageCalls),['usage']);await page.locator('#storageCacheClear').click();await page.waitForFunction(()=>document.querySelector('#storageUsageStatus').textContent.includes('已取消'));assert.deepEqual(await page.evaluate(()=>usageCalls),['usage','clear']);await page.locator('#projectStorageClose').click();assert.equal(await page.locator('#projectStorageDialog').isVisible(),false);assert.deepEqual(f.errors,[]);
  return{width,theme,actualClick:true,classificationVisible:true,retentionExplained:true,cleanupCanceled:true,externalRequestsBlocked:f.requests.length};
 }finally{await context.close();}
});
check('partial details expose reasons and unavailable cache remains unknown instead of zero',async()=>{
 const f=await open();try{await f.page.evaluate(()=>{usageResult.partial=true;usageResult.cacheBytes=null;usageResult.partialReasons=['changed-during-scan','missing-directory','cache-unavailable','unrecognized-value'];});await measure(f.page);assert.match(await f.page.locator('#storageUsageStatus').innerText(),/部分统计.*扫描期间文件发生变化.*部分目录不存在.*网络缓存大小暂不可用/);assert.doesNotMatch(await f.page.locator('#storageUsageStatus').innerText(),/unrecognized/);assert.match(await f.page.locator('#storageUsageList').innerText(),/可重建网络缓存\s*暂时无法统计/);assert.deepEqual(await f.page.evaluate(()=>usageCalls),['usage']);}finally{await f.context.close();}
});
check('older or inconsistent detail contracts fall back to existing totals without inventing a breakdown',async()=>{
 const f=await open();try{await f.page.evaluate(()=>delete usageResult.originalBreakdown);await measure(f.page);assert.equal(await f.page.locator('#storageUsageList .storage-usage-detail').count(),0);assert.match(await f.page.locator('#storageUsageList').innerText(),/当前桌面版本未提供分类明细/);await f.page.evaluate(()=>usageResult.originalBreakdown={standard:1,compatibility:2,metadata:3,recovery:4,other:5});await measure(f.page);assert.equal(await f.page.locator('#storageUsageList .storage-usage-detail').count(),0);}finally{await f.context.close();}
});
check('scan failures hide stale rows, release busy controls and permit an explicit retry',async()=>{
 const f=await open();try{await measure(f.page);await f.page.evaluate(()=>usageMode='failure');await f.page.locator('#storageUsageRefresh').click();await f.page.waitForFunction(()=>document.querySelector('#storageUsageStatus').textContent.includes('合成目录暂不可用'));assert.equal(await f.page.locator('#storageUsageList').isHidden(),true);assert.equal(await f.page.locator('#storageUsageRefresh').isDisabled(),false);assert.equal(await f.page.locator('#projectStorageDialog').getAttribute('aria-busy'),'false');await f.page.evaluate(()=>usageMode='normal');await measure(f.page);assert.deepEqual(await f.page.evaluate(()=>usageCalls),['usage','usage','usage']);}finally{await f.context.close();}
});
check('duplicate clicks are gated; closed-dialog responses cannot overwrite a newly opened inspection',async()=>{
 const f=await open();try{await f.page.evaluate(()=>usageMode='delayed');await f.page.locator('#storageUsageRefresh').click();await f.page.waitForFunction(()=>typeof finishUsage==='function');assert.equal(await f.page.locator('#projectStorageDialog').getAttribute('aria-busy'),'true');await f.page.evaluate(()=>document.querySelector('#storageUsageRefresh').click());assert.deepEqual(await f.page.evaluate(()=>usageCalls),['usage']);await f.page.locator('#projectStorageClose').click();await f.page.locator('[data-storage-settings-open]').click();await f.page.waitForFunction(()=>document.querySelector('#projectStorageCurrent').value);assert.match(await f.page.locator('#storageUsageStatus').innerText(),/按需统计/);await f.page.evaluate(()=>{finishUsage({...usageResult,partial:true,partialReasons:['entry-limit']});usageMode='normal';});await measure(f.page);assert.doesNotMatch(await f.page.locator('#storageUsageStatus').innerText(),/数量限制/);assert.deepEqual(await f.page.evaluate(()=>usageCalls),['usage','usage']);}finally{await f.context.close();}
});
check('zero is a measured file size, while an older partial result remains explicitly incomplete',async()=>{
 const f=await open();try{await f.page.evaluate(()=>{Object.keys(usageResult.sizes).forEach(k=>usageResult.sizes[k]=0);Object.keys(usageResult.originalBreakdown).forEach(k=>usageResult.originalBreakdown[k]=0);usageResult.partial=true;delete usageResult.partialReasons;});await measure(f.page);assert.match(await f.page.locator('#storageUsageStatus').innerText(),/部分统计.*部分文件暂不可读或扫描达到限制/);assert.equal(await f.page.locator('#storageUsageList dd').first().innerText(),'0 B');assert.equal(await f.page.locator('#storageUsageList dt.storage-usage-detail').count(),5);}finally{await f.context.close();}
});
