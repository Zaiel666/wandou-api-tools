const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pageSource = fs.readFileSync(
  path.resolve(__dirname, "../app/ai-node-canvas.html"),
  "utf8",
);
const shellSource = fs.readFileSync(
  path.resolve(__dirname, "../desktop-client/shell.js"),
  "utf8",
);

const saveStart = pageSource.indexOf("async function saveCanvasStateNow");
const saveEnd = pageSource.indexOf("function saveCanvasState()", saveStart);
const saveSource = pageSource.slice(saveStart, saveEnd);

assert.notEqual(saveStart, -1, "saveCanvasStateNow is missing");
assert.match(
  saveSource,
  /context\.state\s*=\s*storedState[\s\S]*queueDesktopCanvasBackup\(context\)/,
  "desktop backups must receive the compact indexed-media state",
);
assert.match(
  pageSource,
  /pendingLocalMediaWrites\.has\(id\)/,
  "duplicate media persistence must share one in-flight write",
);
assert.doesNotMatch(shellSource, /保存超过 300 秒|300000/, 'local saves must not fail on a fixed five-minute timer');
assert.match(shellSource, /attempt !== closeAttempt/, 'cancelled close attempts must ignore late save results');

// Keep the existing single file-level case. Run the real save functions with a
// controlled clock; a timeout must report failure, never manufacture durability.
const saveFunctions = shellSource.slice(shellSource.indexOf('function isNodeCanvasTab('), shellSource.indexOf('async function closeTab('));
const timeoutFunction = shellSource.slice(shellSource.indexOf('function withShellCloseTimeout('), shellSource.indexOf('function showCloseDialog('));
assert.ok(saveFunctions.includes('async function saveAllOpenWorkflows('));
assert.ok(timeoutFunction.startsWith('function withShellCloseTimeout('));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function saveFixture(hook) {
  const timers = new Map();
  let calls = 0;
  const guest = vm.createContext({ window: { wandouSaveBeforeClose: hook } });
  const tab = { id: 'synthetic-canvas', title: '合成画布', url: 'file:///app/ai-node-canvas-test.html', domReady: true,
    view: { isLoading: () => false, executeJavaScript: async script => { calls++; return vm.runInContext(script, guest); } } };
  const context = vm.createContext({ URL, tabs: new Map([[tab.id, tab]]), canvasBackupDirectory: 'synthetic-backup', closeInProgress: false, updateStarted: false,
    setTimeout: (callback, ms) => { const id = {}; timers.set(id, { callback, ms }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: () => 1, clearInterval: () => {},
    safeWebviewCall: (view, method, fallback = false) => { try { return view[method](); } catch { return fallback; } } });
  vm.runInContext(saveFunctions + '\n' + timeoutFunction, context);
  return { context, tab, timers, calls: () => calls };
}
async function verifyActualSaveAwait() {
  const gate = deferred(), held = saveFixture(() => gate.promise);
  let settled = false;
  const first = held.context.saveTabBeforeClose(held.tab);
  const duplicate = held.context.saveTabBeforeClose(held.tab);
  first.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'Pending durability cannot be treated as a successful close save');
  assert.equal(held.calls(), 1, 'Repeated requests share the actual pending guest save');
  gate.resolve({ success: true, backupPath: 'synthetic-committed' });
  for (const result of await Promise.all([first, duplicate])) {
    assert.equal(result.supported, true); assert.equal(result.success, true); assert.equal(result.backupPath, 'synthetic-committed');
  }
  assert.equal(held.tab.pendingCloseSave, null);
  assert.equal(held.timers.size, 0, 'Completed save clears its timeout callbacks');

  const failed = saveFixture(async () => { throw Error('synthetic disk failure'); });
  const failure = await failed.context.saveAllOpenWorkflows();
  assert.equal(failure.success, false); assert.equal(failure.failures.length, 1); assert.match(failure.failures[0].error, /synthetic disk failure/);
  assert.equal(failed.timers.size, 0);

  const lateGate = deferred(), late = saveFixture(() => lateGate.promise);
  const attempt = late.context.saveAllOpenWorkflows();
  await tick();
  const deadlines = [...late.timers.values()];
  assert.equal(deadlines.length, 1); assert.equal(deadlines[0].ms, 120000);
  deadlines[0].callback();
  const timeout = await attempt;
  assert.equal(timeout.success, false); assert.equal(timeout.failures.length, 1); assert.equal(timeout.saved.length, 0);
  assert.match(timeout.failures[0].error, /保存暂未完成/);
  assert.ok(late.tab.pendingCloseSave, 'Timeout keeps the actual in-flight save available for a later retry');
  lateGate.resolve({ success: true, backupPath: 'synthetic-late-commit' });
  await tick();
  assert.equal(timeout.success, false, 'Late durability cannot rewrite the failed close attempt');
  assert.equal(timeout.saved.length, 0); assert.equal(late.tab.pendingCloseSave, null); assert.equal(late.timers.size, 0);
}
verifyActualSaveAwait().then(() => {
  console.log('PASS: compact close backups await shared durability; failed or timed-out saves do not authorize closure');
}).catch(error => { console.error(error); process.exitCode = 1; });
