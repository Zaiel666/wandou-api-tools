const nodeTest = require('node:test');
const test = (name, run) => nodeTest(name, {timeout:3000}, run);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
function block(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from); return source.slice(from, to);
}
function fixture() {
  const timers = new Map(); let serial = 0;
  const node = {id:1, type:'psd', model:'gpt-image-2'};
  const c = {
    AbortController, DOMException, nodes:[node], psdJobs:new Set(), psdJobControllers:new Map(),
    activeProjectId:'A', currentFolderId:'folder', apiKeyInput:{value:'FAKE'}, gptImageModelOptions:['gpt-image-2'],
    apiProfileForModel: () => ({key:'FAKE', id:'channel1'}), psdSourceReference: () => ({url:'source'}),
    invalidateNodeExport() {}, setPsdJobMarker() {}, startPsdCountdown() {}, stopPsdCountdown() {}, takePsdJobMarker() {},
    render() {}, refreshRenderedNode() {}, scheduleCanvasSave() {}, showToast() {},
    waitForUiPaint: async () => {}, getLocalMedia: () => new Promise(() => {}),
    friendlyErrorMessage: error => error.message,
    setTimeout(fn, delay) { timers.set(++serial, {fn, delay}); return serial; }, clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(c);
  vm.runInContext(block('    function abortablePromise(', '    async function fetchMaybeProxied(')
    + block('    async function runPsdStage(', '    function outpaintRatioInsets('), c);
  return {c, node, timers};
}
test('the ten-minute task deadline aborts stalled work and clears all timers', async () => {
  const {c, node, timers} = fixture();
  const pending = c.generatePsdFromNode(1); await new Promise(setImmediate);
  const total = [...timers.values()].find(timer => timer.delay === 600000);
  assert.ok(total); total.fn(); await pending;
  assert.match(node.status, /10 分钟总时限/); assert.equal(c.psdJobs.size, 0);
  assert.equal(c.psdJobControllers.size, 0); assert.equal(timers.size, 0);
});
test('manual cancellation and stage timeout have distinct messages and can restart', async () => {
  for (const manual of [true, false]) {
    const {c, node, timers} = fixture();
    const pending = c.generatePsdFromNode(1); await new Promise(setImmediate);
    if (manual) c.psdJobControllers.get(1).abort(new Error('用户已取消 PSD 生成'));
    else [...timers.values()].find(timer => timer.delay === 45000).fn();
    await pending;
    assert.match(node.status, manual ? /生成已取消/ : /读取本地原图超过/);
    assert.equal(c.psdJobs.size, 0); assert.equal(timers.size, 0);
  }
});
test('old project cleanup cannot delete a new project task with the same node id', async () => {
  const {c} = fixture(); const pending = c.generatePsdFromNode(1); await new Promise(setImmediate);
  const old = c.psdJobControllers.get(1), next = new AbortController();
  c.activeProjectId = 'B'; c.nodes = [{id:1, type:'psd'}]; c.psdJobControllers.set(1, next);
  old.abort(); await pending;
  assert.equal(c.psdJobControllers.get(1), next); assert.equal(c.psdJobs.has(1), true);
});
