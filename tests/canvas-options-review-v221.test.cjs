const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url'),{chromium}=require('../desktop-client/node_modules/playwright');
const app=path.resolve(__dirname,'../app'),qa=path.resolve(__dirname,'../../qa');let browser;
const gif=Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,255,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0,...[0,1].flatMap(pixel=>[33,249,4,1,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,pixel?76:68,1,0]),59]);
before(async()=>{browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'})});after(()=>browser?.close());
async function fixture(t,{width=1440,theme='light'}={}){
 const context=await browser.newContext({viewport:{width,height:800}});t.after(()=>context.close());const page=await context.newPage(),calls=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await context.route(/^https?:/,route=>{if(route.request().url()==='https://www.zayapi.top/v1/images/generations'){calls.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({output_format:'gif',data:[{b64_json:gif.toString('base64')}]})})}return route.abort()});
 await page.goto(pathToFileURL(path.join(app,'ai-node-canvas-test.html')).href);await page.waitForFunction(()=>document.body.dataset.canvasReady==='true');
 await page.evaluate(theme=>{WandouTheme.set(theme);nodes=[];links=[];nodeId=1;apiKeyInput.value='synthetic-never-paid';window.qaGenerator=createNode('generator',0,0,{model:'gpt-image-2.6-flare',prompt:'合成测试：循环动作',ratio:'16:9',resolution:'4K',count:4,_deferRender:true});render({skipSave:true});centerOnNode(qaGenerator.id);},theme);
 return{context,page,calls,errors};
}
async function fitNode(page){await page.evaluate(()=>{const el=document.querySelector('.node.generator'),r=canvasWrap.getBoundingClientRect();view.zoom=Math.min(.9,(r.height-90)/el.offsetHeight);view.x=(r.width-el.offsetWidth*view.zoom)/2;view.y=40;applyCanvasTransform();});}
for(const width of [1024,1440])for(const theme of ['light','dark'])test(`main shared controls actual clicks, request capture and reopening ${width} ${theme}`,async t=>{
 const{page,errors}=await fixture(t,{width,theme});await fitNode(page);
 await page.locator('.node.generator [data-image-format="gif"]').click();await fitNode(page);
 await page.locator('.node.generator [data-image-option="imageQuality"]').selectOption('low');
 await page.locator('.node.generator [data-image-option="imageComplexity"]').selectOption('medium');
 await page.locator('.node.generator [data-image-option="gifFrameCount"]').fill('12');await page.locator('.node.generator [data-image-option="gifFrameCount"]').press('Tab');
 await page.locator('.node.generator [data-image-option="gifFrameDurationMs"]').fill('300');await page.locator('.node.generator [data-image-option="gifFrameDurationMs"]').press('Tab');
 assert.equal(await page.locator('.node.generator .resolution-row').isVisible(),false);assert.equal(await page.locator('.node.generator [data-count="4"]').isDisabled(),true);
 assert.equal(await page.locator('.node.generator .image-ratio-row').isVisible(),false);assert.equal(await page.locator('.node.generator [data-transparent-background-toggle]').count(),0);
 const state=await page.evaluate(async()=>({node:{quality:qaGenerator.imageQuality,complexity:qaGenerator.imageComplexity,frames:qaGenerator.gifFrameCount,time:qaGenerator.gifFrameDurationMs,count:qaGenerator.count},body:JSON.parse((await buildApiRequest(qaGenerator,[])).body),saved:await saveCanvasState()}));
 assert.deepEqual(state.node,{quality:'low',complexity:'medium',frames:12,time:300,count:1});assert.equal(state.body.quality,'low');assert.equal(state.body.complexity,'medium');assert.equal(state.body.frame_count,12);assert.equal(state.body.frame_duration_ms,300);assert.equal(state.body.size,'auto');assert.equal(state.body.resolution,undefined);assert.equal(state.body.n,1);assert.ok(state.saved);
 await fitNode(page);fs.mkdirSync(qa,{recursive:true});await page.screenshot({path:path.join(qa,`canvas-options-${width}-${theme}.png`)});
 const layout=await page.locator('.node.generator .wd-generation-options').evaluate(el=>{const r=el.getBoundingClientRect(),inputs=[...el.querySelectorAll('button,select,input')];return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:inputs.some(x=>x.getBoundingClientRect().right>r.right+1)}});assert.ok(layout.left>=0&&layout.right<=width&&layout.top>=0&&layout.bottom<=800);assert.equal(layout.overflow,false);
 await page.reload();await page.waitForFunction(()=>document.body.dataset.canvasReady==='true'&&nodes.some(n=>n.type==='generator'));
 assert.deepEqual(await page.evaluate(()=>{const n=nodes.find(n=>n.type==='generator');return[n.imageOutputFormat,n.imageQuality,n.imageComplexity,n.gifFrameCount,n.gifFrameDurationMs]}),['gif','low','medium',12,300]);assert.deepEqual(errors,[]);
});
test('main generation and regeneration preserve original quality complexity frames and original bytes',async t=>{
 const{page,calls,errors}=await fixture(t);await page.evaluate(async()=>{Object.assign(qaGenerator,{imageOutputFormat:'gif',outputFormat:'gif',imageQuality:'low',imageComplexity:'medium',gifFrameCount:2,gifFrameDurationMs:200,count:1});await generateFromNode(qaGenerator.id);});
 assert.equal(calls.length,1);const first=await page.evaluate(async()=>{const n=nodes.find(n=>n.type==='result');window.qaOriginalId=n.id;return{format:n.imageOutputFormat,quality:n.imageQuality,complexity:n.imageComplexity,frames:n.gifFrameCount,time:n.gifFrameDurationMs,actualFrames:n.animationFrameCount,processing:n.resolutionProcessing,source:await getLocalMedia(n.fullUrl)}});
 assert.equal(first.processing,'native-animation');assert.equal(first.quality,'low');assert.equal(first.complexity,'medium');assert.equal(first.frames,2);assert.equal(first.actualFrames,2);assert.deepEqual(Buffer.from(first.source.split(',')[1],'base64'),gif);
 await page.evaluate(async()=>{Object.assign(qaGenerator,{imageOutputFormat:'png',outputFormat:'png',model:'gpt-image-2.5-1k',imageQuality:'high',imageComplexity:'high',gifFrameCount:16,gifFrameDurationMs:2000});await regenerateResultNode(qaOriginalId);});
 assert.equal(calls.length,2);assert.equal(calls[1].model,'gpt-image-2.6-flare');assert.equal(calls[1].output_format,'gif');assert.equal(calls[1].quality,'low');assert.equal(calls[1].complexity,'medium');assert.equal(calls[1].frame_count,2);assert.equal(calls[1].frame_duration_ms,200);assert.equal(calls[1].size,'auto');
 assert.equal(await page.evaluate(()=>nodes.filter(n=>n.type==='result'&&n.fullUrl).length),2);assert.deepEqual(errors,[]);
});
test('main 2.5 markup supports independent quality and excludes 2.6 complexity',async t=>{
 const{page,errors}=await fixture(t);const result=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(0,0,64,64);const image=c.toDataURL();c.getContext('2d').clearRect(0,0,64,64);c.getContext('2d').fillRect(10,10,20,20);const markup=c.toDataURL();const request=await buildApiRequest({...qaGenerator,model:'gpt-image-2.5-flare',imageOutputFormat:'png',imageQuality:'low',imageComplexity:'medium'},[{url:image,markupUrl:markup,mediaType:'image',width:64,height:64}]);return{form:request.isFormData,quality:request.body.get('quality'),complexity:request.body.get('complexity'),mask:request.body.has('mask'),markup:request.body.get('markup').type,image:request.body.getAll('image').length};});assert.deepEqual(result,{form:true,quality:'low',complexity:null,mask:false,markup:'image/png',image:1});assert.deepEqual(errors,[]);
});
test('GIF regeneration ignores later auto split and invalid frame edits on the generator',async t=>{
 const{page,calls}=await fixture(t);await page.evaluate(async()=>{Object.assign(qaGenerator,{imageOutputFormat:'gif',outputFormat:'gif',gifFrameCount:2,gifFrameDurationMs:200,count:1});await generateFromNode(qaGenerator.id);const original=nodes.find(n=>n.type==='result');window.qaOriginalId=original.id;Object.assign(qaGenerator,{imageOutputFormat:'png',outputFormat:'png',autoSplit:true,gifFrameCount:99,gifFrameDurationMs:13});await regenerateResultNode(original.id);});
 const state=await page.evaluate(()=>({status:qaGenerator.status,outputs:nodes.filter(n=>n.type==='result'&&n.fullUrl).length}));assert.equal(calls.length,2,JSON.stringify(state));assert.equal(calls[1].frame_count,2);assert.equal(calls[1].frame_duration_ms,200);assert.equal(state.outputs,2);
});
test('GIF does not silently flatten into PSD or start paid layer analysis',async t=>{
 const{page}=await fixture(t);const result=await page.evaluate(async original=>{let analyses=0;psdAnalyzeLayers=async()=>{analyses++;return[{name:'合成对象',bounds:[0,0,1,1]}]};const n=createNode('psd',500,0,{references:[{url:original,mediaType:'image',width:1,height:1}],_deferRender:true});await analyzePsdFromNode(n.id);return{analyses,status:n.status,review:Boolean(n.psdReview)}},'data:image/gif;base64,'+gif.toString('base64'));
 assert.equal(result.analyses,0,JSON.stringify(result));assert.equal(result.review,false);assert.match(result.status,/GIF|动画/);
});
test('special formats do not forward unsupported transparent background parameters',async t=>{
 const{page}=await fixture(t);const result=await page.evaluate(async()=>{const requests=[];for(const format of ['gif','svg','png']){const node={...qaGenerator,imageOutputFormat:format,outputFormat:format,transparentBackground:true};requests.push(JSON.parse((await buildApiRequest(node,[])).body));}return requests;});assert.equal(result[0].background,undefined);assert.equal(result[1].background,undefined);assert.equal(result[2].background,'transparent');assert.deepEqual(result.map(r=>r.output_format),['gif','svg','png']);
});
test('restored special format controls display one result and clear stale auto split',async t=>{
 const{page}=await fixture(t);const result=await page.evaluate(()=>{Object.assign(qaGenerator,{imageOutputFormat:'gif',outputFormat:'gif',count:9,autoSplit:true});render({skipSave:true});return{count:qaGenerator.count,split:qaGenerator.autoSplit,label:document.querySelector('.node.generator .test-stepper output').textContent};});assert.deepEqual(result,{count:1,split:false,label:'1'});
});
