const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require('../desktop-client/node_modules/playwright');
const qa=path.resolve(__dirname,'../../qa'),file=path.resolve(__dirname,'../desktop-client/shell.html');
for(const theme of ['light','dark'])for(const width of [1024,1440])test(`update dialog actual controls ${theme} ${width}x800`,async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());
  await page.addInitScript(({theme})=>{
   window.__counts={check:0,open:0,update:0,save:0,quit:0};window.__openFails=false;
   window.__fixture={available:false,configured:true,currentVersion:'2.0.23',manualRequired:true,retryable:false,manualReason:'安全更新通道尚未开放，可前往官方发布页下载安装包。',error:'安全更新通道尚未开放'};
   window.wandouShell=new Proxy({
    getTheme:async()=>({theme,revision:1}),getClientConfig:async()=>({version:'2.0.23'}),getCanvasBackupDirectory:async()=>({directory:'synthetic-only'}),
    checkForUpdates:async()=>{window.__counts.check++;return window.__fixture;},
    openUpdateDownloads:async()=>{window.__counts.open++;if(window.__openFails)throw Error('synthetic open failure');return {success:true};},
    startUpdate:async()=>{window.__counts.update++;return{started:false,error:'合成更新校验失败'};},confirmClose:()=>window.__counts.quit++
   },{get:(object,key)=>key in object?object[key]:()=>{}});
  },{theme});
  await page.goto(pathToFileURL(file).href+`?version=2.0.23&theme=${theme}`);
  await page.waitForFunction(()=>window.__counts.check>=1);
  await page.evaluate(()=>{for(let i=0;i<6;i++)openTab({url:'file:///synthetic-tool-'+i+'.html',title:'合成工具 '+i});});
  const versionBounds=await page.locator('#versionText').boundingBox();assert.ok(versionBounds&&versionBounds.x>=0&&versionBounds.x+versionBounds.width<=width-145,'Update control remains visible beside multiple tabs and native caption area');
  assert.equal(await page.locator('#dialogOverlay').isVisible(),false,'No unsolicited manual download modal on launch');
  assert.equal(await page.locator('#updateBadge').innerText(),'更新说明');
  await page.locator('#versionText').click();await page.locator('#dialogOverlay').waitFor({state:'visible'});
  assert.equal(await page.locator('#dialogTitle').innerText(),'安装更新说明');
  assert.equal(await page.locator('#dialogDownload').innerText(),'打开官方下载页');
  assert.doesNotMatch(await page.locator('#dialogVersion').innerText(),/undefined|最新/);
  const bounds=await page.locator('.update-dialog').first().boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=800);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
  await page.screenshot({path:path.join(qa,`update-manual-${theme}-${width}.png`)});
  await page.locator('#dialogDownload').click();assert.deepEqual(await page.evaluate(()=>({open:__counts.open,update:__counts.update,quit:__counts.quit})),{open:1,update:0,quit:0});
  await page.evaluate(()=>window.__openFails=true);await page.locator('#dialogDownload').click();assert.equal(await page.locator('#dialogDownload').isEnabled(),true);
  assert.match(await page.locator('#desktopToast').innerText(),/无法打开/);
  await page.locator('#dialogCancel').click();assert.equal(await page.locator('#dialogOverlay').isVisible(),false);
  await page.evaluate(()=>{window.__fixture={available:true,configured:true,currentVersion:'2.0.23',latestVersion:'2.0.24',updaterProtocol:2,notes:'合成安全更新'};});
  await page.locator('#versionText').click();assert.equal(await page.locator('#dialogDownload').innerText(),'立即更新');
  // In Edge these are ordinary elements, not Electron guests. Verify the real
  // readiness gate before installing explicit, isolated guest API fixtures.
  await page.locator('#dialogDownload').click();
  await page.waitForFunction(()=>!updateStarted&&document.querySelector('#dialogNotes').textContent.includes('页面仍在加载，尚未确认保存状态'));
  assert.equal(await page.evaluate(()=>window.__counts.update),0,'Unready tool tabs must not authorize an update');
  assert.equal(await page.locator('#dialogDownload').innerText(),'重新保存并更新');
  assert.equal(await page.locator('#dialogDownload').isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('update-in-progress')),false);
  const guestCount=await page.evaluate(()=>{
   window.__savedTabIds=[];
   for(const tab of tabs.values()){
    const guest={};
    tab.view.isLoading=()=>false;
    tab.view.executeJavaScript=async script=>{
     if(script.includes('typeof window.wandouSaveBeforeClose')){window.__counts.save++;window.__savedTabIds.push(tab.id);}
     return Function('window','return '+script)(guest);
    };
    tab.view.dispatchEvent(new Event('dom-ready'));
   }
   return tabs.size;
  });
  assert.equal(guestCount,6,'The original fixture opens six tools and supplies no home URL');
  await page.locator('#dialogDownload').click();await page.waitForFunction(()=>window.__counts.update===1);
  assert.equal(await page.evaluate(()=>window.__counts.save),guestCount,'Every ready tab executes the actual shell save probe');
  assert.equal(await page.evaluate(()=>new Set(window.__savedTabIds).size),guestCount);
  assert.match(await page.locator('#dialogNotes').innerText(),/合成更新校验失败/);assert.equal(await page.locator('#dialogDownload').isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('update-in-progress')),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
