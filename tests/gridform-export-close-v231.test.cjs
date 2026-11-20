'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = path.join(__dirname, '../app');
const local = fs.readFileSync(path.join(app, 'gridform.local.js'), 'utf8');
const exporter = fs.readFileSync(path.join(app, 'image-export.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function fixture(format, saveFileAs, loadExporter = true) {
  const nodes = new Map(), bytes = format === 'psd' ? Buffer.from('8BPS\x00\x01synthetic layers') : Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  const mime = format === 'psd' ? 'image/vnd.adobe.photoshop' : 'image/png';
  const blob = new Blob([bytes], { type: mime }); let init;
  const node = () => ({ innerHTML: 'Export', disabled: false, value: format, checked: false, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const get = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  const gridform = { ready: true, state: { layout: 'test', config: { ratio: '1:1' } }, whenRendered: async () => {}, serialize: () => 'stable', saveDraft: async () => true };
  const context = vm.createContext({ window: { Gridform: gridform, wandouShell: { saveFileAs } }, Gridform: gridform, PosterEngine: { clone: value => value, renderPoster: async () => {} }, PosterPSD: { create: async () => ({ blob, layers: ['background','text'] }) }, Uint8Array, document: { readyState: 'loading', fonts: { ready: Promise.resolve() }, activeElement: { blur() {} }, addEventListener(_name, fn) { init = fn; }, querySelector: get, createElement(tag) { assert.equal(tag, 'canvas', 'Native saves must not create a detached anchor download'); return { getContext() { return {}; }, toBlob(resolve) { resolve(blob); } }; } }, console: { error() {} }, setTimeout: () => 1, clearTimeout() {} });
  if (loadExporter) vm.runInContext(exporter, context);
  vm.runInContext(local, context); await init();
  return { context, get, bytes, mime, start: () => get('#export').onclick(), close: () => context.window.wandouSaveBeforeClose() };
}

for (const format of ['png','psd']) {
  test(`${format}: close stays busy through the picker and committed writer; bytes remain exact`, async () => {
    const picker = deferred(), writer = deferred(), calls = []; let writerStarted = false;
    const f = await fixture(format, async (filename, bytes, type) => { calls.push({ filename, bytes: Buffer.from(bytes), type }); await picker.promise; writerStarted = true; await writer.promise; return { success: true }; });
    const exporting = f.start(); await tick(); assert.equal(calls.length, 1);
    assert.equal((await f.close()).busy, true); assert.equal(f.get('#export').disabled, true); assert.doesNotMatch(f.get('#toast').textContent || '', /已导出/);
    await f.start(); assert.equal(calls.length, 1, 'Repeated clicks cannot queue a second save dialog');
    picker.resolve(); await tick(); assert.equal(writerStarted, true); assert.equal((await f.close()).busy, true); assert.equal(f.get('#export').disabled, true);
    writer.resolve(); await exporting;
    assert.deepEqual(calls[0].bytes, f.bytes); assert.equal(calls[0].type, f.mime); assert.ok(calls[0].filename.endsWith('.' + format));
    assert.match(f.get('#toast').textContent, /已导出/); assert.equal(f.get('#export').disabled, false); assert.equal((await f.close()).success, true);
  });

  test(`${format}: cancellation releases busy without success or fallback download`, async () => {
    let calls = 0; const f = await fixture(format, async () => { calls += 1; return { success: false, canceled: true }; });
    await f.start(); assert.equal(calls, 1); assert.equal(f.get('#toast').textContent, '已取消导出'); assert.equal(f.get('#export').disabled, false); assert.equal((await f.close()).success, true);
  });

  test(`${format}: failed native write reports failure and supports a clean retry`, async () => {
    let calls = 0; const f = await fixture(format, async () => ++calls === 1 ? { success: false, error: 'synthetic disk failure' } : { success: true });
    await f.start(); assert.match(f.get('#toast').textContent, /导出失败.*synthetic disk failure/); assert.equal(f.get('#export').disabled, false); assert.equal((await f.close()).success, true);
    await f.start(); assert.equal(calls, 2); assert.match(f.get('#toast').textContent, /已导出/);
  });
}

test('missing save component fails visibly instead of starting an untracked anchor download', async () => {
  const f = await fixture('png', async () => { throw new Error('Must not be called'); }, false);
  await f.start(); assert.match(f.get('#toast').textContent, /导出失败.*保存组件未就绪/); assert.equal((await f.close()).success, true);
});

test('an initiated browser download is described as started rather than completed', async () => {
  const f = await fixture('png', async () => ({ success: true, started: true })); await f.start();
  assert.equal(f.get('#toast').textContent, '高清 PNG 已开始下载');
});

test('Gridform loads the existing save component before its local adapter', () => {
  const html = fs.readFileSync(path.join(app, 'gridform.html'), 'utf8');
  assert.ok(html.indexOf('src="./image-export.js"') >= 0); assert.ok(html.indexOf('src="./image-export.js"') < html.indexOf('src="./gridform.local.js"'));
});
