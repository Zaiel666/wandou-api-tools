const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const desktop = process.env.WANDOU_TEST_DESKTOP_ROOT || path.resolve(__dirname, '../desktop-client');
const source = fs.readFileSync(path.join(desktop, 'shell.js'), 'utf8');
const helpers = source.slice(source.indexOf('function isNodeCanvasTab('), source.indexOf('function activeView('));
const action = source.slice(source.indexOf('dialogDownload.addEventListener("click",'), source.indexOf('dialogOverlay.addEventListener("click",'));
assert.ok(helpers && action);

function setup({ filename = 'ai-node-canvas-test.html', hook, nativeResult = { started: true } } = {}) {
  const classes = new Set(), calls = [], messages = [], removed = [];
  const guest = vm.createContext({ window: hook ? { wandouSaveBeforeClose: hook } : {} });
  const tab = { id: 'canvas', title: '测试项目', url: 'file:///app/' + filename, domReady: true, pinned: false,
    view: { isLoading: () => false, executeJavaScript: async script => vm.runInContext(script, guest), remove: () => removed.push('view') },
    button: { remove: () => removed.push('button') } };
  const context = vm.createContext({ URL, tabs: new Map([[tab.id, tab]]), activeId: tab.id,
    canvasBackupDirectory: 'synthetic-backup', updateStarted: false, closeInProgress: false,
    setInterval: () => 1, clearInterval: () => {},
    safeWebviewCall: (view, method, fallback = false) => { try { return view[method](); } catch (_) { return fallback; } },
    clearTabSuspendTimer: () => {}, activateTab: () => {},
    showToast: (...args) => messages.push(args),
    document: { body: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } } },
    dialogCancel: {}, dialogDownload: { addEventListener: (_event, callback) => { context.clickUpdate = callback; } }, dialogNotes: {},
    updateInfo: { available: true, latestVersion: '2.0.16' },
    window: { wandouShell: { startUpdate: async data => { calls.push(data); return nativeResult; } } }
  });
  vm.runInContext(helpers + '\n' + action, context);
  return { context, tab, calls, messages, classes, removed };
}

test('recognized canvas pages without a save hook block update and preserve their open tab', async () => {
  for (const filename of ['ai-node-canvas.html', 'ai-node-canvas-test.html?workspace=production', 'ai-node-canvas-v2.html']) {
    const f = setup({ filename });
    const report = await f.context.saveTabBeforeClose(f.tab);
    assert.equal(report.supported, true); assert.equal(report.success, false);
    assert.match(report.error, /画布尚未准备好保存/);
    await f.context.clickUpdate();
    assert.equal(f.calls.length, 0);
    assert.equal(f.context.updateStarted, false); assert.equal(f.context.dialogDownload.disabled, false);
    assert.equal(f.classes.has('update-in-progress'), false);
    assert.match(f.context.dialogNotes.textContent, /保存校验失败/);
    await f.context.closeTab(f.tab.id);
    assert.equal(f.context.tabs.size, 1); assert.deepEqual(f.removed, []);
  }
});

test('ordinary tools without a save hook remain closable and do not block an update', async () => {
  const f = setup({ filename: 'asset-library.html' });
  const report = await f.context.saveTabBeforeClose(f.tab);
  assert.equal(report.supported, false); assert.equal(report.success, true);
  await f.context.clickUpdate();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].savedWorkflowCount, 0);
  await f.context.closeTab(f.tab.id);
  assert.equal(f.context.tabs.size, 0); assert.deepEqual(f.removed, ['view', 'button']);
});

test('a successfully verified canvas provides fresh update authorization only after saving', async () => {
  const order = [];
  const f = setup({ hook: async () => { order.push('saved'); return { success: true, backupPath: 'synthetic-backup/verified.json' }; } });
  await f.context.clickUpdate();
  assert.deepEqual(order, ['saved']); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].saveVerified, true); assert.equal(f.calls[0].savedWorkflowCount, 1);
  assert.ok(Date.now() - f.calls[0].saveVerifiedAt < 1000);
});

test('failed, throwing, or unsupported canvas save hooks cannot dispatch native update', async () => {
  for (const hook of [async () => ({ success: false, error: '写入失败' }), async () => { throw Error('保存调用失败'); }, async () => ({ supported: false, success: true })]) {
    const f = setup({ hook }); await f.context.clickUpdate();
    assert.equal(f.calls.length, 0); assert.equal(f.context.updateStarted, false);
    assert.equal(f.context.dialogCancel.disabled, false); assert.equal(f.context.dialogDownload.disabled, false);
    assert.match(f.context.dialogNotes.textContent, /保存校验失败/);
  }
});

test('a download or checksum failure from native update restores retry controls', async () => {
  const f = setup({ hook: async () => ({ success: true }), nativeResult: { started: false, error: '更新文件校验失败，已停止安装' } });
  await f.context.clickUpdate();
  assert.equal(f.calls.length, 1); assert.equal(f.context.updateStarted, false);
  assert.equal(f.context.dialogCancel.disabled, false); assert.equal(f.context.dialogDownload.disabled, false);
  assert.equal(f.classes.has('update-in-progress'), false); assert.match(f.context.dialogNotes.textContent, /校验失败/);
});

test('repeated update clicks while saving dispatch exactly one native update', async () => {
  let finishSave, saves = 0;
  const f = setup({ hook: () => { saves++; return new Promise(resolve => { finishSave = resolve; }); } });
  const first = f.context.clickUpdate();
  await f.context.clickUpdate();
  assert.equal(saves, 1); assert.equal(f.calls.length, 0);
  finishSave({ success: true }); await first;
  assert.equal(f.calls.length, 1);
});
