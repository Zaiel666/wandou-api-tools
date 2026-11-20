const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createCloseCoordinator } = require("../desktop-client/close-coordinator.cjs");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const main = read("desktop-client/main.js");
const preload = read("desktop-client/preload.js");
const shell = read("desktop-client/shell.js");

assert.match(main, /contents\.on\("render-process-gone"/);
assert.match(main, /mainWindow\.on\("unresponsive"/);
assert.match(main, /downloadFileWithFallback[\s\S]*fetchWithTimeout\(target[\s\S]*120000/);
assert.match(preload, /onGuestRendererGone/);
assert.match(shell, /function recoverTabView\(/);
assert.match(shell, /view\.addEventListener\("did-fail-load"/);
assert.match(shell, /view\.addEventListener\("render-process-gone"/);
assert.match(shell, /window\.wandouShell\?\.onGuestRendererGone/);

// Exercise the real native-dialog callback and unresponsive event registration,
// not an obsolete literal list of buttons. Never replace the actual coordinator
// with a stub that blindly treats a renderer failure as permission to quit.
const registrationStart = main.indexOf('  closeCoordinator?.dispose();');
const registrationEnd = main.indexOf('  mainWindow.loadFile(', registrationStart);
assert.ok(registrationStart >= 0 && registrationEnd > registrationStart);
async function verifyRecovery({ response, critical }) {
  const handlers = new Map(), dialogs = [], saves = [], finishes = [];
  const context = vm.createContext({
    APP_NAME: 'Synthetic recovery', closeCoordinator: null, closePromptPending: false,
    allowWindowClose: false, shellReady: true,
    updateInProgress: critical === 'update', storageMigrationPreparing: critical === 'migration', storageOutageHandling: critical === 'outage',
    mainWindow: { isDestroyed: () => false, webContents: { send: (...args) => saves.push(args) }, on: (name, callback) => handlers.set(name, callback) },
    createCloseCoordinator: options => createCloseCoordinator({ ...options, schedule: () => ({ unref() {} }), cancelTimer() {} }),
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response }; } },
    finishConfirmedClose: result => finishes.push(result)
  });
  vm.runInContext(main.slice(registrationStart, registrationEnd), context);
  assert.equal(typeof handlers.get('unresponsive'), 'function');
  handlers.get('unresponsive')();
  await context.closeCoordinator.emergency();
  assert.equal(context.closePromptPending, true);
  assert.equal(dialogs.length, 1, 'The same recovery intent has one native prompt');
  const options = dialogs[0];
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  if (critical) {
    assert.deepEqual(Array.from(options.buttons), ['继续等待']);
    assert.match(options.detail, /不能在此阶段强制退出/);
    assert.equal(saves.length, 0); assert.equal(finishes.length, 0);
  } else {
    assert.deepEqual(Array.from(options.buttons), ['继续等待', '仍然退出']);
    assert.match(options.detail, /丢失最近未保存的修改/); assert.match(options.detail, /中断生成、下载或导出任务/);
    assert.equal(saves.length, 1); assert.equal(saves[0][0], 'desktop:request-close');
    assert.equal(finishes.length, response === 1 ? 1 : 0);
    if (response === 1) assert.equal(finishes[0].forced, true);
  }
  context.closeCoordinator.dispose();
}
(async () => {
  await verifyRecovery({ response: 0 });
  await verifyRecovery({ response: 1 });
  for (const critical of ['update', 'migration', 'outage']) await verifyRecovery({ response: 1, critical });
  console.log('PASS: actual desktop recovery preserves edits until explicit exit and protects update/migration/storage handoffs');
})().catch(error => { console.error(error); process.exitCode = 1; });
