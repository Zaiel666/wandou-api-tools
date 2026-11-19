const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('../desktop-client/node_modules/playwright');
// The historical filename stays in the shared suite. Check the current package
// version and guide behavior, not v221's historical literal-delta provenance.
const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa');
const packageFile=path.resolve(__dirname,'../desktop-client/package.json');
const version=JSON.parse(fs.readFileSync(packageFile,'utf8')).version;
assert.match(version,/^\d+\.\d+\.\d+$/,'Package version must be a release version');
const guideFile='image-workbench/customize.js';
const expectedGuide='工作台支持 PNG 图片、SVG 矢量和 GIF 动图；实际可用格式取决于所选模型与渠道权限。SVG 仅支持文字生成，请移除参考图。圈画标注请在节点画布中选择 PNG 输出后使用。';
const obsoleteGuide='工作台生成 PNG 图片。需要原生 SVG 矢量图时，请在节点画布中选择 SVG 输出。';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function appHashes(){const found={};function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);assert.equal(entry.isSymbolicLink(),false,'No app resource symlinks');if(entry.isDirectory())visit(file);else if(entry.isFile())found[path.relative(app,file).split(path.sep).join('/')]=sha(file);else throw Error('Unexpected resource kind');}}visit(app);return found;}
const frozenAppHashes=appHashes(),startedAt=new Date().toISOString();
const report={version,scope:'Current package version and guide UI behavior; no dependency on historical literal-delta evidence',packageSha256:sha(packageFile),file:guideFile,sha256:frozenAppHashes[guideFile],appHashes:frozenAppHashes,testSha256:sha(__filename),startedAt,appHashesUnchanged:false,success:false};
let browser,server,origin;const samples=[];
function checkSource(){assert.deepEqual(appHashes(),frozenAppHashes,'Current app resources frozen throughout guide check');assert.equal(sha(packageFile),report.packageSha256,'Package version source unchanged during guide check');assert.equal(sha(__filename),report.testSha256,'Guide test unchanged during execution');}
test.before(async()=>{
 fs.writeFileSync(path.join(qa,'workbench-guide-copy-ui.json'),JSON.stringify(report,null,2));
 assert.equal(fs.readFileSync(path.join(app,'VERSION.txt'),'utf8').trim(),'v'+version,'App version must match the current desktop package');
 checkSource();server=http.createServer((req,res)=>{try{const file=path.resolve(app,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(app+path.sep))throw Error('Outside app');res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
});
test.after(async()=>{try{checkSource();report.appHashesUnchanged=true;report.success=samples.length===4&&samples.every(x=>x.success);}catch(error){report.error=error.stack;throw error;}finally{report.samples=samples;report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(qa,'workbench-guide-copy-ui.json'),JSON.stringify(report,null,2));await browser?.close();if(server)await new Promise(r=>server.close(r));}});
for(const width of [1024,1440])for(const theme of ['light','dark'])test(`workbench operation guide actual open and corrected formats ${width} ${theme}`,async()=>{
 const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'}),errors=[];
 try{
  await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await context.addInitScript(theme=>{localStorage.setItem('ai-tools-theme',theme);localStorage.setItem('wd-theme',theme);localStorage.setItem('wd-model','gpt-image-2.6-flare');},theme);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/image-workbench/index.html');await page.waitForSelector('.wd-workbench-generation');
  await page.getByRole('button',{name:'操作指南',exact:true}).click();const panel=page.locator('.wd-operation-guide'),note=panel.locator('.wd-vector-guide');await note.waitFor({state:'visible'});
  assert.equal(await note.innerText(),expectedGuide);assert.equal((await panel.innerText()).includes(obsoleteGuide),false);assert.equal(await note.count(),1);
  await note.scrollIntoViewIfNeeded();const metrics=await note.evaluate(el=>({note:el.getBoundingClientRect().toJSON(),panel:el.closest('.wd-operation-guide').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,color:getComputedStyle(el).color,dark:document.documentElement.classList.contains('dark')}));
  assert.ok(metrics.note.x>=-1&&metrics.note.right<=width+1,'Guide text stays inside viewport width');assert.ok(metrics.note.top>=-1&&metrics.note.bottom<=801,'Guide text can be scrolled fully into view');assert.ok(metrics.panel.width<=width+1);assert.ok(metrics.scrollWidth<=width+1);assert.equal(metrics.dark,theme==='dark');assert.deepEqual(errors,[]);
  const screenshot=`workbench-guide-${width}-${theme}.png`;await page.screenshot({path:path.join(qa,screenshot)});samples.push({width,theme,text:await note.innerText(),metrics,screenshot,success:true});
 }finally{await context.close();}
});
