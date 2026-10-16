const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {convertBlend,findBlender}=require('../desktop-client/director-converter.cjs');
const source=path.resolve('artifacts/director-format-test/fixture-cube.blend');
const tempRoot=path.resolve('artifacts/director-native-test');
const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
test('native converter rejects non-blend inputs and already cancelled work',async()=>{
  await assert.rejects(convertBlend('some-file.exe'),/blend/);
  const abort=new AbortController();abort.abort();await assert.rejects(convertBlend(source,{signal:abort.signal}),/取消/);
});
test('real native conversion returns embedded GLB, preserves original and cleans its temporary directory',async()=>{
  await fs.mkdir(tempRoot,{recursive:true});const before=await hash(source),existing=await fs.readdir(tempRoot);
  const result=await convertBlend(source,{blender:await findBlender(),tempRoot});
  assert.equal(result.success,true);assert.equal(Buffer.from(result.dataUrl.split(',')[1],'base64').toString('ascii',0,4),'glTF');
  assert.equal(await hash(source),before);assert.deepEqual(await fs.readdir(tempRoot),existing);
});
test('native cancellation settles and removes temporary output without altering source',async()=>{
  await fs.mkdir(tempRoot,{recursive:true});const before=await hash(source),existing=await fs.readdir(tempRoot),controller=new AbortController();
  const job=convertBlend(source,{blender:await findBlender(),tempRoot,signal:controller.signal});
  const timer=setTimeout(()=>controller.abort(),50);
  try{await assert.rejects(job,/取消/);}finally{clearTimeout(timer);}
  assert.equal(await hash(source),before);assert.deepEqual(await fs.readdir(tempRoot),existing);
});
test('desktop test bridge is scoped and leaves production storage bridges absent',async()=>{
  const main=await fs.readFile('desktop-client/director-test-main.cjs','utf8'),preload=await fs.readFile('desktop-client/director-test-preload.cjs','utf8');
  assert.match(main,/event.senderFrame!==event.sender.mainFrame/);assert.match(main,/Wandou-Director-Test/);
  assert.match(preload,/webUtils.getPathForFile/);assert.doesNotMatch(preload,/exposeInMainWorld\('wandouShell'/);
  const converter=await fs.readFile('desktop-client/director-converter.cjs','utf8');assert.match(converter,/windowsHide:true,shell:false/);assert.match(converter,/--disable-autoexec/);
});
