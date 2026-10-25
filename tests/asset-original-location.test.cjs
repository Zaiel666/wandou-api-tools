const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('../desktop-client/node_modules/playwright');
const app=process.env.WANDOU_TEST_APP_ROOT||path.resolve(__dirname,'../app');
const screenshots=path.resolve(__dirname,'../artifacts/asset-location-20261025/verification');
let browser,server,origin;
test.before(async()=>{fs.mkdirSync(screenshots,{recursive:true});server=http.createServer((req,res)=>{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data)});});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});});
test.after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
async function open({entry='asset-library.html',theme='light',mode='desktop',count=2,special=false}={}){
 const context=await browser.newContext({viewport:{width:1280,height:900}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await context.addInitScript(({theme,mode,count,special})=>{
  localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);
  const preview='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#7ca866"/></svg>');
  const nodes=Array.from({length:count},(_,i)=>({id:'node-'+i,type:'result',mediaType:'image',title:'图片'+i,previewUrl:preview,mediaUrl:'indexed-media:media-'+i,fullUrl:'indexed-media:full-'+i,width:4096,height:4096,createdAt:1000+i}));
  if(special)nodes.push({id:'remote',type:'result',mediaType:'image',title:'远程原图',previewUrl:preview,mediaUrl:'indexed-media:preview-only',fullUrl:'https://invalid.example/original.png',createdAt:5},{id:'preview',type:'result',mediaType:'image',title:'仅预览',previewUrl:preview,createdAt:4},{id:'fallback',type:'result',mediaType:'image',title:'媒体原图',previewUrl:preview,mediaUrl:'indexed-media:fallback-original',createdAt:3},{id:'runtime',type:'result',mediaType:'image',title:'运行时原图',previewUrl:preview,fullUrl:'wandou-media://'+'a'.repeat(64)+'/runtime-original',createdAt:2});
  localStorage.setItem('aiCanvasProjectsV1',JSON.stringify([{id:'folder',name:'项目目录'}]));localStorage.setItem('aiCanvasStateV1:project-collection:folder',JSON.stringify([{id:'project',name:'测试项目'}]));localStorage.setItem('aiCanvasStateV1:folder:project',JSON.stringify({folderId:'folder',projectId:'project',savedAt:5000,nodes,links:[]}));
  window.locationCalls=[];window.folderCalls=[];window.mediaReads=[];window.locationResolvers={};
  if(mode!=='browser')window.wandouShell={
   readCanvasMedia:async data=>{mediaReads.push(data);return {success:false}},
   getCanvasMediaLocation:async ref=>{locationCalls.push(ref);if(mode==='missing')return{success:false,missing:true,error:'missing'};if(mode==='race'&&ref==='indexed-media:full-1')return await new Promise(resolve=>locationResolvers[ref]=resolve);return{success:true,path:'C:\\SyntheticApp\\canvas-media\\'+ref.split(':').pop().split('/').pop()+'.data',storageFormat:'data-url'};},
   showCanvasMediaInFolder:async ref=>{folderCalls.push(ref);return mode==='moved'?{success:false,missing:true,error:'文件已移走'}:{success:true,shown:true};}
  };
 },{theme,mode,count,special});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin+'/'+entry);await page.locator('[data-filter="image"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-asset-location]').length>0);return{page,context,errors};
}
function card(page,name){return page.locator('.media-card').filter({has:page.locator('.asset-card-title',{hasText:new RegExp('^'+name+'$')})});}
for(const entry of ['asset-library.html','asset-library-test.html'])for(const theme of ['light','dark'])test(entry+' '+theme+' locates only the original and opens its folder without opening the image',async()=>{
 const{page,context,errors}=await open({entry,theme});try{
  assert.equal(await page.locator('#assetTitle').innerText(),'所有图片');assert.equal(await page.locator('.media-card').count(),2,'different originals sharing a preview must both remain');
  assert.deepEqual(await page.evaluate(()=>locationCalls),[],'listing must not query file locations');assert.deepEqual(await page.evaluate(()=>mediaReads),[],'listing thumbnails must not fetch full originals');
  await card(page,'图片1').locator('[data-asset-location]').click();await page.waitForFunction(()=>document.querySelector('#assetLocationPath').value.endsWith('full-1.data'));
  assert.equal(await page.locator('#assetLightbox').evaluate(e=>e.classList.contains('open')),false);assert.deepEqual(await page.evaluate(()=>locationCalls),['indexed-media:full-1']);assert.deepEqual(await page.evaluate(()=>mediaReads),[]);
  assert.match(await page.locator('#assetLocationStatus').innerText(),/项目原图存储文件（\.data）/);assert.equal(await page.locator('#assetLocationPath').inputValue(),'C:\\SyntheticApp\\canvas-media\\full-1.data');
  await page.locator('#assetLocationOpenFolder').click();assert.deepEqual(await page.evaluate(()=>folderCalls),['indexed-media:full-1']);
  const styles=await page.locator('#assetLocationDialog').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,theme:document.documentElement.dataset.theme}));assert.equal(styles.theme,theme);assert.notEqual(styles.background,'rgba(0, 0, 0, 0)');assert.notEqual(styles.background,styles.color);
  await page.screenshot({path:path.join(screenshots,entry.replace('.html','')+'-'+theme+'.png')});assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('remote originals and preview-only records never resolve their thumbnail or export directory as the original',async()=>{
 const{page,context}=await open({special:true});try{
  for(const name of ['远程原图','仅预览']){await card(page,name).locator('[data-asset-location]').click();assert.equal(await page.locator('#assetLocationOpenFolder').isDisabled(),true);assert.equal(await page.locator('#assetLocationDetails').isHidden(),true);await page.locator('#assetLocationClose').click();}
  assert.deepEqual(await page.evaluate(()=>locationCalls),[]);
  await card(page,'媒体原图').locator('[data-asset-location]').click();await page.waitForFunction(()=>document.querySelector('#assetLocationPath').value.endsWith('fallback-original.data'));await page.locator('#assetLocationClose').click();
  await card(page,'运行时原图').locator('[data-asset-location]').click();await page.waitForFunction(()=>document.querySelector('#assetLocationPath').value.endsWith('runtime-original.data'));
  assert.deepEqual(await page.evaluate(()=>locationCalls),['indexed-media:fallback-original','wandou-media://'+'a'.repeat(64)+'/runtime-original']);assert.deepEqual(await page.evaluate(()=>mediaReads),[]);
 }finally{await context.close();}
});
for(const mode of ['browser','missing','moved'])test(mode+' reports unavailable originals without a fabricated path or an enabled reveal action',async()=>{
 const{page,context}=await open({mode});try{await card(page,'图片1').locator('[data-asset-location]').click();if(mode==='moved'){await page.waitForFunction(()=>!document.querySelector('#assetLocationOpenFolder').disabled);await page.locator('#assetLocationOpenFolder').click();}await page.waitForFunction(()=>document.querySelector('#assetLocationOpenFolder').disabled&&document.querySelector('#assetLocationDetails').hidden);assert.match(await page.locator('#assetLocationStatus').innerText(),mode==='browser'?/浏览器版无法查看/:/未找到本机原图/);assert.equal(await page.locator('#assetLightbox').evaluate(e=>e.classList.contains('open')),false);}finally{await context.close();}
});
test('closing and reopening the location dialog ignores a stale metadata response',async()=>{
 const{page,context}=await open({mode:'race'});try{await card(page,'图片1').locator('[data-asset-location]').click();await page.waitForFunction(()=>!!locationResolvers['indexed-media:full-1']);await page.locator('#assetLocationClose').click();await card(page,'图片0').locator('[data-asset-location]').click();await page.waitForFunction(()=>document.querySelector('#assetLocationPath').value.endsWith('full-0.data'));await page.evaluate(()=>locationResolvers['indexed-media:full-1']({success:true,path:'C:\\stale-original.data'}));await page.waitForTimeout(50);assert.match(await page.locator('#assetLocationPath').inputValue(),/full-0\.data$/);await page.locator('#assetLocationOpenFolder').click();assert.deepEqual(await page.evaluate(()=>folderCalls),['indexed-media:full-0']);}finally{await context.close();}
});
test('125-image listing retains pagination and sort order without querying locations or reading original bytes',async()=>{
 const{page,context}=await open({count:125});try{assert.equal(await page.locator('[data-asset-location]').count(),120);assert.equal(await page.locator('.asset-card-title').first().innerText(),'图片124');assert.deepEqual(await page.evaluate(()=>locationCalls),[]);assert.deepEqual(await page.evaluate(()=>mediaReads),[]);await page.locator('.asset-load-more').click();assert.equal(await page.locator('[data-asset-location]').count(),125);await page.locator('#assetSort').selectOption('asc');assert.equal(await page.locator('.asset-card-title').first().innerText(),'图片0');assert.equal(await page.locator('[data-asset-location]').count(),120);assert.deepEqual(await page.evaluate(()=>locationCalls),[]);assert.deepEqual(await page.evaluate(()=>mediaReads),[]);}finally{await context.close();}
});
