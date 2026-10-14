const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
function block(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
function fixture() {
  let finish;
  const timers = new Map(); let serial = 0;
  const node = {id:1, type:'audio', prompt:'hello', model:'tts', audioFormat:'mp3', x:0, y:0};
  const c = {
    AbortController, DOMException, nodes:[node], links:[], audioJobs:new Map(), activeProjectId:'A',
    apiProfileForModel:()=>({key:'FAKE', url:'https://test.invalid'}), pushHistory(){}, nodeWidth:()=>100,
    render(){c.renders++;}, renders:0, scheduleCanvasSave(){c.saves++;}, saves:0, showToast(){},
    cloneReferences: refs => refs.map(ref=>({...ref})), updatePendingElapsed(){}, friendlyApiError:error=>error.message,
    createNode(type,x,y,options){const result={id:2,type,x,y,...options};c.nodes.push(result);return result;},
    setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;}, clearTimeout:id=>timers.delete(id),
    setInterval(fn,ms){timers.set(++serial,{fn,ms});return serial;}, clearInterval:id=>timers.delete(id),
    callAudioApi(snapshot, signal, profile){c.request={snapshot,signal,profile};return new Promise(resolve=>{finish=resolve;});},
  };
  vm.createContext(c);
  vm.runInContext(block('    function abortablePromise(', '    async function fetchMaybeProxied(')
    +block('    async function generateAudioFromNode(', '    async function generateFromNode('), c);
  return {c,node,timers,finish:value=>finish(value)};
}
test('audio request snapshots settings, rejects double send and cleans up after success', async () => {
  const {c,node,timers,finish}=fixture();
  const pending=c.generateAudioFromNode(1); await c.generateAudioFromNode(1);
  node.prompt='changed';node.audioFormat='wav';
  assert.equal(c.nodes.length,2);assert.equal(c.request.snapshot.prompt,'hello');
  finish({url:'data:audio/mpeg;base64,example',mimeType:'audio/mpeg'});await pending;
  assert.equal(c.nodes[1].audioFormat,'mp3');assert.equal(node.audioGenerating,false);
  assert.equal(timers.size,0);assert.equal(c.audioJobs.size,0);
});
test('timeout settles even when audio transport ignores abort, permitting retry', async () => {
  const {c,node,timers,finish}=fixture();const pending=c.generateAudioFromNode(1);
  [...timers.values()].find(t=>t.ms===300000).fn();await pending;
  assert.match(node.status,/5 分钟/);assert.equal(node.audioGenerating,false);assert.equal(timers.size,0);
  finish({url:'late'});await new Promise(setImmediate);
  assert.equal(c.nodes[1].mediaUrl,undefined);
});
test('project switch cannot insert audio or save/render into the destination project', async () => {
  const {c,node,timers,finish}=fixture();const pending=c.generateAudioFromNode(1);
  c.audioJobs.get(1).controller.abort(new Error('switched'));c.audioJobs.clear();
  c.activeProjectId='B';c.nodes=[{id:1,type:'audio'}];c.renders=0;c.saves=0;
  finish({url:'late'});await pending;
  assert.equal(c.renders,0);assert.equal(c.saves,0);assert.equal(c.nodes[0].mediaUrl,undefined);
  assert.equal(node.audioGenerating,false);assert.equal(timers.size,0);
});
test('deleting the result cancels work and leaves the source able to generate again', async () => {
  const {c,node,finish}=fixture();const pending=c.generateAudioFromNode(1);
  c.nodes=[node];c.audioJobs.get(1).controller.abort(new Error('结果节点已删除，生成已取消。'));
  await pending;finish({url:'late'});
  assert.equal(node.audioGenerating,false);assert.match(node.status,/已取消/);assert.equal(c.audioJobs.size,0);
});
test('empty result is a visible failure instead of a successful unplayable node', async () => {
  const {c,node,finish}=fixture();const pending=c.generateAudioFromNode(1);finish({url:''});await pending;
  assert.match(node.status,/没有返回可播放/);assert.equal(c.nodes[1].pending,false);
});
