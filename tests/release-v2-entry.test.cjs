const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('release entry preserves project and director parameters',()=>{
 let target;
 const html=read('app/ai-node-canvas-v2.html');
 const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 vm.runInNewContext(script,{URL,location:{href:'file:///app/ai-node-canvas-v2.html',search:'?project=existing&open=director',hash:'#view',replace:url=>target=new URL(url)}});
 assert.equal(target.searchParams.get('project'),'existing');assert.equal(target.searchParams.get('open'),'director');assert.equal(target.searchParams.get('workspace'),'production');assert.equal(target.hash,'#view');
});
test('shell save checks recognize old, new and prototype canvas URLs',()=>{
 const source=read('desktop-client/shell.js');
 const code=source.slice(source.indexOf('function isNodeCanvasTab('),source.indexOf('async function saveTabBeforeClose('));
 const context=vm.createContext({URL});vm.runInContext(code,context);
 for(const file of ['ai-node-canvas.html','ai-node-canvas-v2.html','ai-node-canvas-test.html?workspace=production'])assert.ok(context.isNodeCanvasTab({url:'file:///app/'+file}));
 assert.equal(context.isNodeCanvasTab({url:'file:///app/homepage-test.html'}),false);
});
test('release includes native converter and bundled Blender script',()=>{
 const config=JSON.parse(read('desktop-client/package.json'));
 assert.equal(config.version,'2.0.5');
 assert.ok(config.build.files.includes('director-ipc.cjs'));
 assert.ok(config.build.files.includes('director-converter.cjs'));
 assert.ok(config.build.extraResources.some(x=>x.to==='director/convert-blend.py'));
 assert.match(read('desktop-client/main.js'),/getAppRoot\(\), "homepage-test.html"/);
});
