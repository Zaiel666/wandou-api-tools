const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
const save = source.slice(source.indexOf('async function saveCanvasStateNow('), source.indexOf('function saveCanvasState()'));
const close = source.slice(source.indexOf('window.wandouSaveBeforeClose ='), source.indexOf('document.addEventListener("visibilitychange"'));
async function run({desktop = true, backup = true, serializeFailure = false, empty = false, queueHang = false, browserHang = false} = {}) {
  const context = {projectId: 'test', state: {nodes: empty ? [] : [{id: 1}], savedAt: 1}};
  const quota = () => { throw new Error('QuotaExceededError'); };
  const sandbox = {
    window: {wandouShell: desktop ? {writeCanvasBackup: true} : {}},
    canvasRecoveryBlocked: false, saveTimer: null, canvasSaveQueue: Promise.resolve(),
    clearTimeout() {}, setTimeout: callback => { callback(); return 1; }, projects: [{id: 'test'}], activeProjectId: 'test',
    console: {warn() {}}, warnCanvasStorageSkipped() {},
    createCanvasSaveContext: () => context, saveCanvasStateImmediate: () => false,
    verifyCanvasStateSaved: () => false, writeCanvasStateToLocalStorage: quota,
    writeCanvasStateBackup: browserHang ? () => new Promise(() => {}) : quota, saveProjects: quota, queueDesktopCanvasBackup() {},
    serializeNodeForStorage: async node => { if (serializeFailure) throw new Error('media failure'); return node; },
    writeDesktopCanvasBackup: async () => ({success: backup, error: backup ? '' : 'disk denied'})
  };
  if (queueHang) sandbox.canvasSaveQueue = new Promise(() => {});
  vm.createContext(sandbox);
  vm.runInContext(save + '\n' + close, sandbox);
  return sandbox.window.wandouSaveBeforeClose();
}
(async () => {
  assert.equal((await run()).success, true);
  assert.equal((await run({empty: true})).success, true);
  assert.equal((await run({backup: false})).success, false);
  assert.equal((await run({empty: true, backup: false})).success, false);
  assert.equal((await run({desktop: false})).success, false);
  assert.equal((await run({queueHang: true, browserHang: true})).success, true);
  const failed = await run({serializeFailure: true});
  assert.equal(failed.success, false);
  assert.match(failed.error, /media failure/);
  console.log('PASS: cache failure does not block verified desktop saves; disk/media failures still block close');
})().catch(error => { console.error(error); process.exitCode = 1; });
