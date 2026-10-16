// Offline DOM/math/lifecycle tests. GPU output and real browser encoding are not mocked claims.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../app/director-core.js');
const {parseHTML}=require('../tools/canvas-ui-test/node_modules/linkedom');
const source=fs.readFileSync('app/director-test.js','utf8');
const vendorContext=vm.createContext({console,TextDecoder,TextEncoder,URL,Blob,atob,setTimeout,clearTimeout,AbortController,Request,Headers,ArrayBuffer,Uint8Array});
vm.runInContext(fs.readFileSync('app/vendor/director-three.js','utf8'),vendorContext,{displayErrors:false});
const V=vendorContext.WandouDirectorVendor;
test('director clamps persisted state and preserves exact endpoint interpolation',()=>{
  const data=C.normalize({duration:99,ratio:'bad',light:Infinity,current:{fov:100}});
  assert.equal(data.duration,15);assert.equal(data.ratio,'16:9');assert.equal(data.light,2.5);assert.equal(data.current.fov,90);
  const a=C.pose(),b=C.pose({position:[-3,4,7],subject:[2,0,1],yaw:90});
  assert.deepEqual(C.interpolate(a,b,0),a);assert.deepEqual(C.interpolate(a,b,1),b);
  assert.equal(C.interpolate(a,b,.5).yaw,45);assert.equal(C.interpolate(a,b,Infinity).yaw,0);
  assert.deepEqual(C.dimensions('9:16'),[720,1280]);assert.deepEqual(C.dimensions('1:1'),[960,960]);
});
test('import and video formats reject invalid models and do not label WebM as MP4',()=>{
  assert.equal(C.validateModel('车.GLB',1024),'glb');assert.equal(C.validateModel('mesh.obj',1),'obj');
  assert.equal(C.validateModel('mesh.FBX',1),'fbx');assert.throws(()=>C.validateModel('mesh.blend',1),/BLEND_CONVERSION_REQUIRED/);
  assert.throws(()=>C.validateModel('mesh.exe',1));assert.throws(()=>C.validateModel('mesh.glb',21*1024*1024));assert.throws(()=>C.validateModel('mesh.obj',0));
  assert.equal(C.recordingFormat(null),'');assert.equal(C.recordingFormat({isTypeSupported:t=>t==='video/webm'}),'video/webm');
});
test('real vendored OBJ loader parses geometry without a network dependency',()=>{
  const obj=new V.OBJLoader().parse('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  assert.equal(obj.children[0].geometry.attributes.position.count,3);
});
test('real vendored GLTF loader parses an embedded model',async()=>{
  const positions=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>positions.writeFloatLE(v,i*4));
  // Data URI requires fetch in the loader; instead exercise GLB's embedded BIN chunk.
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],
    buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]};
  const raw=Buffer.from(JSON.stringify(json)),padded=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(padded);
  const bin=Buffer.alloc(12+8+padded.length+8+36);bin.writeUInt32LE(0x46546c67,0);bin.writeUInt32LE(2,4);bin.writeUInt32LE(bin.length,8);
  bin.writeUInt32LE(padded.length,12);bin.writeUInt32LE(0x4e4f534a,16);padded.copy(bin,20);
  const offset=20+padded.length;bin.writeUInt32LE(36,offset);bin.writeUInt32LE(0x004e4942,offset+4);positions.copy(bin,offset+8);
  // GLTFLoader uses instanceof ArrayBuffer in its own realm.
  vendorContext.glbBytes=Array.from(bin);
  const result=await vm.runInContext('new WandouDirectorVendor.GLTFLoader().parseAsync(new Uint8Array(glbBytes).buffer, "")',vendorContext);
  assert.equal(result.scene.children[0].geometry.attributes.position.count,3);
});
function setup(extra={},native=null){
  const {document,window}=parseHTML('<html><body data-test-ready="true"><aside class="sidebar"><div class="button-grid"></div></aside></body></html>');
  window.HTMLElement.prototype.showModal=function(){this.open=true;};
  window.HTMLElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  let focus=null;Object.defineProperty(document,'activeElement',{get:()=>focus});
  window.HTMLElement.prototype.focus=function(){focus=this;};
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {bottom:this.localName==='dialog'?800:300};};
  // Linkedom select.value is getter-only; browser selects are writable.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this._value||'';},set(v){this._value=String(v);},configurable:true});
  const events={downloads:[],frames:[],disposed:0,stopped:0,history:0,renders:0,saves:0};
  class Renderer{constructor(){this.domElement=document.createElement('canvas');this.domElement.toDataURL=()=> 'data:image/png;base64,aGVsbG8=';this.domElement.captureStream=()=>({getTracks:()=>[{stop:()=>events.stopped++}]});this.shadowMap={};}setPixelRatio(){}setSize(w,h){this.domElement.width=w;this.domElement.height=h;}render(){events.renders++;}dispose(){events.disposed++;}forceContextLoss(){}}
  class Controls{constructor(){this.target=new V.THREE.Vector3();}update(){}addEventListener(){}dispose(){}}
  class Recorder{static isTypeSupported(t){return t==='video/webm';}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['test recording'],{type:'video/webm'})});this.onstop?.();}}
  const node={id:'director-1',type:'director',x:0,y:0,...extra},nodes=[node],links=[];
  Object.assign(window,{WandouDirectorCore:C,WandouDirectorVendor:{...V,THREE:{...V.THREE,WebGLRenderer:Renderer},OrbitControls:Controls},MediaRecorder:Recorder});
  if(native)window.wandouDirectorNative=native;
  const context=vm.createContext({window,document,console,nodes,links,Blob,MediaRecorder:Recorder,Uint8Array,TextDecoder,atob,
    setTimeout:()=>{},performance:{now:()=>1000},requestAnimationFrame:cb=>{events.frames.push(cb);return events.frames.length;},cancelAnimationFrame:()=>{},
    readFileAsDataUrl:async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),
    downloadNodeMedia:()=>{},downloadFileName:(n,ext)=>'preview.'+ext,favoriteMediaUrl:n=>n.mediaUrl,
    render:()=>events.renders++,scheduleCanvasSave:()=>events.saves++,pushHistory:()=>events.history++,showToast:()=>{},
    triggerDownload:async(url,name,mime)=>{events.downloads.push({url,name,mime});return true;},
    createNode:(type,x,y,props)=>{const n={id:'n'+nodes.length,type,x,y,...props};nodes.push(n);return n;}});
  vm.runInContext(source,context);
  return {context,document,window,node,nodes,links,events,ui:window.WandouDirector,query:s=>document.querySelector(s)};
}
test('director opens, captures both endpoints, creates connected static workflow and persists on close',async()=>{
  const h=setup();await h.ui.open(h.node);
  assert.ok(h.query('canvas'));assert.match(h.query('[data-status]').textContent,/已就绪/);
  await h.query('[data-action="start"]').onclick();
  h.query('[data-angle="side"]').onclick();await h.query('[data-action="end"]').onclick();
  await h.query('[data-action="image"]').onclick();
  assert.deepEqual(h.nodes.map(n=>n.type),['director','image','generator']);assert.equal(h.links.length,2);
  assert.equal(h.nodes[1].references[0].width,1280);assert.match(h.nodes[2].prompt,/镜头角度/);
  h.query('[data-close]').onclick();assert.ok(h.node.director.start);assert.ok(h.node.director.end);assert.equal(h.events.disposed,1);assert.equal(h.query('dialog'),null);
});
test('previs recording creates a video result, keeps MIME and stops stream tracks',async()=>{
  const h=setup({director:{start:C.pose(),end:C.pose({yaw:90})}});await h.ui.open(h.node);
  const job=h.query('[data-action="record"]').onclick();assert.equal(h.events.frames.length,1);
  h.events.frames.shift()(5001);await job;
  const result=h.nodes.find(n=>n.directorPreview);assert.ok(result);assert.equal(result.videoMime,'video/webm');assert.equal(h.events.stopped,1);
  await h.context.downloadNodeMedia(result);assert.equal(h.events.downloads[0].name,'preview.webm');assert.equal(h.events.downloads[0].mime,'video/webm');
  h.query('[data-close]').onclick();
});
test('cancelled recording creates no output and releases tracks',async()=>{
  const h=setup({director:{start:C.pose(),end:C.pose()}});await h.ui.open(h.node);
  const job=h.query('[data-action="record"]').onclick();h.query('[data-action="stop"]').onclick();await job;
  assert.equal(h.nodes.length,1);assert.equal(h.events.stopped,1);h.query('[data-close]').onclick();
});
test('closing during recording cancels output and disposes the renderer',async()=>{
  const h=setup({director:{start:C.pose(),end:C.pose()}});await h.ui.open(h.node);
  const job=h.query('[data-action="record"]').onclick();h.query('[data-close]').onclick();await job;
  assert.equal(h.nodes.length,1);assert.equal(h.events.stopped,1);assert.equal(h.events.disposed,1);assert.equal(h.query('dialog'),null);
});
test('imported OBJ is kept in source storage and is restored on reopening',async()=>{
  const h=setup();await h.ui.open(h.node);
  const blob=new Blob(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'],{type:'text/plain'});blob.name='triangle.obj';
  const input=h.query('[data-model]');await input.onchange({target:{files:[blob],value:''}});
  assert.match(h.query('[data-status]').textContent,/模型已导入/);h.query('[data-close]').onclick();
  assert.equal(h.node.directorModelName,'triangle.obj');assert.match(h.node.sourceUrl,/^data:text\/plain/);
  await h.ui.open(h.node);assert.match(h.query('[data-status]').textContent,/已就绪/);h.query('[data-close]').onclick();
});
test('repeated static outputs receive separate rows',async()=>{
  const h=setup();await h.ui.open(h.node);
  await h.query('[data-action="image"]').onclick();await h.query('[data-action="image"]').onclick();
  const images=h.nodes.filter(n=>n.type==='image');assert.ok(images[1].y>images[0].y+600);h.query('[data-close]').onclick();
});
test('first/last workflow keeps ordered reference frames and never auto-generates',async()=>{
  const h=setup({director:{start:C.pose(),end:C.pose({yaw:90})}});await h.ui.open(h.node);
  await h.query('[data-action="frames"]').onclick();
  assert.deepEqual(h.nodes.map(n=>n.type),['director','image','video']);assert.equal(h.nodes[1].references.length,2);assert.equal(h.nodes[2].videoMode,'firstLast');assert.equal(h.links.length,2);
  h.query('[data-close]').onclick();
});
test('playback/export refuses missing keyframes',async()=>{
  const h=setup();await h.ui.open(h.node);await h.query('[data-action="play"]').onclick();
  assert.match(h.query('[data-status]').textContent,/先分别记录/);assert.equal(h.events.frames.length,0);h.query('[data-close]').onclick();
});
test('corrupt persisted model is not silently replaced with a demo',async()=>{
  const h=setup({sourceUrl:'invalid',directorModelKind:'glb'});await h.ui.open(h.node);
  assert.match(h.query('[data-status]').textContent,/原模型数据保留/);await h.query('[data-action="image"]').onclick();assert.equal(h.nodes.length,1);
  h.query('[data-close]').onclick();assert.equal(h.node.sourceUrl,'invalid');
});
test('test-only integration retains model copy, storage path and local dependency',()=>{
  const page=fs.readFileSync('app/ai-node-canvas-test.html','utf8'),production=fs.readFileSync('app/ai-node-canvas.html','utf8');
  assert.match(page,/WandouDirector\?\.renderBody/);assert.match(page,/directorModelKind: node.directorModelKind/);
  assert.match(page,/copy.sourceUrl = await persistMediaValue/);assert.match(page,/resolveLoadedMedia\(node.sourceUrl/);
  assert.doesNotMatch(production,/director-test.js/);assert.ok(fs.existsSync('app/vendor/director-three.js'));
});
test('all three director selects use themed accessible menus and preserve changes',async()=>{
  const h=setup();await h.ui.open(h.node);
  assert.equal(h.document.querySelectorAll('.director-picker').length,3);
  const select=h.query('[data-setting="ratio"]'),field=select.nextElementSibling,trigger=field.querySelector('button'),list=field.querySelector('[role=listbox]');
  assert.ok(select.hidden);assert.equal(trigger.getAttribute('aria-expanded'),'false');
  const event={preventDefault(){},stopPropagation(){}};trigger.onclick(event);
  assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(list.hidden,false);
  list.querySelector('[data-value="9:16"]').onclick(event);
  assert.equal(select.value,'9:16');assert.equal(list.hidden,true);assert.equal(h.query('canvas').width,720);assert.equal(h.query('canvas').height,1280);
  trigger.onclick(event);field.onkeydown({...event,key:'ArrowDown'});assert.equal(h.document.activeElement.getAttribute('role'),'option');
  field.onkeydown({...event,key:'Escape'});assert.equal(list.hidden,true);assert.equal(h.query('dialog').open,true);assert.equal(h.document.activeElement,trigger);
  h.query('[data-close]').onclick();assert.equal(h.node.director.ratio,'9:16');
});
test('director creation entry contains the themed local cube icon',()=>{
  const h=setup();const icon=h.query('.button-grid button .ui-icon');assert.ok(icon);assert.equal(icon.getAttribute('alt'),'');
  assert.ok(fs.existsSync('app/'+icon.getAttribute('src').replace('./','')));
});
test('selecting a blend opens conversion instructions without replacing the model',async()=>{
  const h=setup();await h.ui.open(h.node);await h.query('[data-model]').onchange({target:{files:[{name:'scene.blend',size:10}],value:''}});
  assert.equal(h.query('[data-blender-help]').open,true);assert.match(h.query('[data-status]').textContent,/本地转换/);assert.equal(h.node.sourceUrl,undefined);
  h.query('[data-close]').onclick();
});
test('real Blender-generated FBX parses into a visible mesh',()=>{
  const fixture='artifacts/director-format-test/fixture-cube.fbx';
  assert.ok(fs.existsSync(fixture),'Run the real Blender smoke test first');vendorContext.fbxBytes=Array.from(fs.readFileSync(fixture));
  const object=vm.runInContext('new WandouDirectorVendor.FBXLoader().parse(new Uint8Array(fbxBytes).buffer, "")',vendorContext);
  let meshes=0;object.traverse(child=>{if(child.isMesh)meshes++;});assert.ok(meshes>0);
});
test('real Blender conversion produces a valid GLB without modifying the source',async()=>{
  const file='artifacts/director-format-test/fixture-cube.glb',blend='artifacts/director-format-test/fixture-cube.blend';
  assert.ok(fs.existsSync(blend));const bytes=fs.readFileSync(file);assert.equal(bytes.toString('ascii',0,4),'glTF');vendorContext.convertedBytes=Array.from(bytes);
  const result=await vm.runInContext('new WandouDirectorVendor.GLTFLoader().parseAsync(new Uint8Array(convertedBytes).buffer, "")',vendorContext);
  assert.ok(result.scene.children.length>0);
  const converter=fs.readFileSync('tools/director-blender/convert-blend.py','utf8');assert.match(converter,/use_scripts=False/);assert.doesNotMatch(converter,/save_as_mainfile/);
});
test('native blend selection converts and imports automatically without a second file picker',async()=>{
  const url='data:model/gltf-binary;base64,'+fs.readFileSync('artifacts/director-format-test/fixture-cube.glb').toString('base64');
  let calls=0;const native={convertBlend:async(file,id)=>{calls++;assert.equal(file.name,'scene.blend');assert.match(id,/^blend-/);return {success:true,dataUrl:url};}};
  const h=setup({},native);await h.ui.open(h.node);
  await h.query('[data-model]').onchange({target:{files:[{name:'scene.blend',size:10}],value:''}});
  assert.equal(calls,1);assert.match(h.query('[data-status]').textContent,/模型已导入/);
  h.query('[data-close]').onclick();assert.equal(h.node.sourceUrl,url);assert.equal(h.node.directorModelKind,'glb');assert.equal(h.node.directorModelName,'scene.blend');
});
test('native conversion failure keeps the original scene and surfaces the reason',async()=>{
  const h=setup({}, {convertBlend:async()=>({success:false,error:'转换超时。'})});await h.ui.open(h.node);
  await h.query('[data-model]').onchange({target:{files:[{name:'scene.blend',size:10}],value:''}});
  assert.match(h.query('[data-status]').textContent,/转换超时.*原场景保留/);assert.equal(h.node.sourceUrl,undefined);h.query('[data-close]').onclick();
});
test('closing a native conversion cancels it and ignores the late result',async()=>{
  let finish,cancelled=0;
  const h=setup({}, {convertBlend:()=>new Promise(resolve=>finish=resolve),cancel:()=>cancelled++});await h.ui.open(h.node);
  const job=h.query('[data-model]').onchange({target:{files:[{name:'scene.blend',size:10}],value:''}});
  h.query('[data-close]').onclick();assert.equal(cancelled,1);finish({success:true,dataUrl:'data:model/gltf-binary;base64,late'});await job;
  assert.equal(h.node.sourceUrl,'');assert.equal(h.query('dialog'),null);
});
