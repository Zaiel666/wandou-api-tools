// Executes the real test-page handlers in a DOM. No browser layout or paid API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('../tools/canvas-ui-test/node_modules/linkedom');
const app = path.resolve(__dirname, '../app');
const page = fs.readFileSync(path.join(app, 'ai-node-canvas-test.html'), 'utf8');
const css = fs.readFileSync(path.join(app, 'ai-node-canvas-test-controls.css'), 'utf8');
function fn(name) {
  const start = page.indexOf('    function ' + name + '(');
  assert.ok(start > 0, name);
  return page.slice(start, page.indexOf('\n    function ', start + 1));
}
function setup() {
  const {document, window} = parseHTML(page);
  const ctx = {document, window, Event:window.Event, console, pendingImageComment:null, editingImageCommentId:null, paintReady:true,
    nodes:[{id:'ref', mediaUrl:'original.png', references:[{url:'original.png', comments:[]}]}],
    activeLightbox:{nodeId:'ref', refIndex:0}, paintCommentPointerId:1,
    pushHistory:()=>{}, render:()=>{}, scheduleCanvasSave:()=>{}, showToast:()=>{},
    escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
  for (const id of ['lightbox','paintCanvas','imageCommentList','imageCommentText','imageCommentForm','imageCommentPosition','imageCommentCancel','paintUndo','paintRedo','paintClear']) ctx[id]=document.getElementById(id);
  window.innerWidth=1100;window.innerHeight=800;
  ctx.lightbox.classList.add('open','paint-mode');
  ctx.paintCanvas.width=1000;ctx.paintCanvas.height=700;
  ctx.paintCanvas.getBoundingClientRect=()=>({left:30,top:40,width:1000,height:700});
  ctx.paintCanvas.hasPointerCapture=()=>false;
  document.querySelector('.lightbox-tools').getBoundingClientRect=()=>({top:690});
  const context=vm.createContext(ctx);
  for (const name of ['normalizeReferences','activePaintReference','imageCommentRegion','syncInlineImageComment','showInlineImageComment','renderImageComments','startImageComment','beginImageCommentEdit','removeReference','savePaintToReference']) vm.runInContext(fn(name),context);
  // Actual cancel, commit, and list edit/delete listeners.
  const start=page.indexOf('    imageCommentCancel.addEventListener');
  const end=page.indexOf('    paintUndo.addEventListener',start);
  assert.ok(start>0 && end>start);
  vm.runInContext(page.slice(start,end),context);
  const inputStart=page.indexOf('    document.getElementById("paintSaveMask").addEventListener');
  vm.runInContext(page.slice(inputStart,page.indexOf('    paintSave.addEventListener',inputStart)),context);
  const releaseStart=page.indexOf('    paintCanvas.addEventListener("pointerup"');
  vm.runInContext(page.slice(releaseStart,page.indexOf('    paintCanvas.addEventListener("pointercancel"',releaseStart)),context);
  ctx.imageCommentForm.requestSubmit=()=>ctx.imageCommentForm.dispatchEvent(new window.Event('submit',{cancelable:true}));
  return {ctx,context,document,window,ref:ctx.nodes[0].references[0],run:code=>vm.runInContext(code,context)};
}

test('drag annotation opens clamped inline input and synchronizes both editors without auto-saving',()=>{
  const {ctx,document,window,ref,run}=setup();
  run('startImageComment({x:200,y:200})');
  const release=new window.Event('pointerup');
  Object.assign(release,{pointerId:1,clientX:1090,clientY:790});
  ctx.paintCanvas.dispatchEvent(release);
  const editor=document.getElementById('imageCommentInline');
  assert.equal(editor.hidden,false);
  assert.ok(parseFloat(editor.style.left)>=12 && parseFloat(editor.style.left)<=808);
  assert.ok(parseFloat(editor.style.top)>=12 && parseFloat(editor.style.top)+184<=678);
  assert.match(document.getElementById('imageCommentInlineLabel').textContent,/批注 1/);
  const inline=document.getElementById('imageCommentInlineText');
  inline.value='改成蓝色';inline.dispatchEvent(new window.Event('input'));
  assert.equal(ctx.imageCommentText.value,'改成蓝色');assert.equal(ref.comments.length,0);
  ctx.imageCommentText.value='改成红色';ctx.imageCommentText.dispatchEvent(new window.Event('input'));
  assert.equal(inline.value,'改成红色');
  assert.equal(run('startImageComment({x:400,y:400})'),false);
  document.getElementById('imageCommentInlineSave').click();
  assert.equal(ref.comments.length,1);assert.equal(ref.comments[0].text,'改成红色');
  assert.ok(editor.hidden);
});

test('blank annotations cannot commit; cancel drops the draft and numbering is contiguous',()=>{
  const {document,ref,run}=setup();
  run('startImageComment({x:10,y:10}); showInlineImageComment(50,50)');
  document.getElementById('imageCommentInlineSave').click();
  assert.equal(ref.comments.length,0);
  assert.equal(document.querySelector('.image-comment-marker').dataset.commentNumber,'1');
  assert.equal(document.querySelector('.image-comment-marker').textContent,'');
  document.getElementById('imageCommentInlineCancel').click();
  assert.equal(document.querySelectorAll('.image-comment-marker').length,0);
  assert.ok(document.getElementById('imageCommentInline').hidden);
  run('startImageComment({x:20,y:20})');
  assert.equal(document.querySelector('.image-comment-marker').dataset.commentNumber,'1');
});

test('existing comments edit through same commit path; deleting an active comment removes the popup',()=>{
  const {document,window,ref,run}=setup();
  ref.comments.push({id:'a',text:'第一处',x:.1,y:.2},{id:'b',text:'第二处',x:.3,y:.4});
  run('beginImageCommentEdit("b");showInlineImageComment(400,400)');
  assert.match(document.getElementById('imageCommentInlineLabel').textContent,/批注 2/);
  const input=document.getElementById('imageCommentInlineText');
  input.value='修改第二处';input.dispatchEvent(new window.Event('input'));
  document.getElementById('imageCommentInlineSave').click();
  assert.equal(ref.comments.length,2);assert.equal(ref.comments[1].text,'修改第二处');
  run('beginImageCommentEdit("a");showInlineImageComment(200,200)');
  document.querySelector('[data-remove-comment="a"]').click();
  assert.equal(ref.comments.length,1);assert.equal(ref.comments[0].id,'b');
  assert.ok(document.getElementById('imageCommentInline').hidden);
  assert.equal(document.querySelector('.image-comment-marker').dataset.commentNumber,'1');
});

test('removing reference survives history serialization replacing the reference array, including last image',()=>{
  const {ctx,run}=setup();
  ctx.nodes[0].references.push({url:'second.png'});
  ctx.pushHistory=()=>run('normalizeReferences(nodes[0])');
  run('removeReference(nodes[0],0)');
  assert.equal(ctx.nodes[0].references.length,1);assert.equal(ctx.nodes[0].mediaUrl,'second.png');
  run('removeReference(nodes[0],0);normalizeReferences(nodes[0])');
  assert.equal(ctx.nodes[0].references.length,0);assert.equal(ctx.nodes[0].mediaUrl,'');
});

test('mask-only save retains source/doodle/comments and stays open; save editing commits doodle and closes',()=>{
  const {ctx,ref,run}=setup();
  ref.doodleUrl='saved-doodle';ref.comments.push({id:'a',text:'保留我'});
  let closed=0,saved=0;
  Object.assign(ctx,{paintSelectionHasPixels:()=>true,createApiMaskDataUrl:()=> 'mask.png',
    paintSelectionCanvas:{toDataURL:()=> 'selection.png'},
    paintDoodleCanvas:{width:1,height:1,getContext:()=>({getImageData:()=>({data:[0,0,0,255]})}),toDataURL:()=> 'new-doodle'},
    closeLightbox:()=>closed++,scheduleCanvasSave:()=>saved++});
  run('savePaintToReference(true)');
  assert.equal(ref.maskUrl,'mask.png');assert.equal(ref.doodleUrl,'saved-doodle');assert.equal(closed,0);
  assert.equal(ref.url,'original.png');assert.equal(ref.comments.length,1);
  run('savePaintToReference()');
  assert.equal(ref.doodleUrl,'new-doodle');assert.equal(closed,1);assert.equal(saved,2);
  run('startImageComment({x:10,y:10});savePaintToReference()');
  assert.equal(closed,1,'cannot silently discard pending annotation on save');
});

test('toolbar orders eight edit actions then three media actions; brush track and transparent regions are explicit',()=>{
  const {document}=parseHTML(page);
  assert.deepEqual([...document.querySelectorAll('#paintControls button:not([hidden])')].map(el=>el.id),['paintBrush','paintErase','paintDoodle','paintComment','paintUndo','paintRedo','paintSaveMask','paintSave']);
  assert.deepEqual([...document.querySelectorAll('.test-lightbox-media-actions button')].slice(0,3).map(el=>el.id),['lightboxFavorite','lightboxCopy','lightboxDownload']);
  assert.match(css,/#lightboxZoomOut,#lightboxZoomIn,#lightboxZoomReset,#lightboxScaleText/);
  assert.match(css,/批注 ' attr\(data-comment-number\)/);
  assert.match(css,/#lightbox \.image-comment-marker:hover:not\(:disabled\)[^}]*background:transparent/);
  assert.match(css,/--paint-progress/);
  assert.match(css,/\.node\.keyword \.prompt-output textarea \{resize:none/);
  assert.match(css,/data-resize-corner=ne\] \{right:-6px;top:-6px/);
});
