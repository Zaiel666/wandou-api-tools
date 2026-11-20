'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/gridform.local.js'), 'utf8');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture({ ready = true, save, blur } = {}) {
  const state = { revision: 1 }, writes = [];
  const gridform = { ready, serialize: () => JSON.stringify(state), saveDraft: async () => { writes.push(state.revision); return save ? save(state, writes) : true; } };
  const context = vm.createContext({ window: { Gridform: gridform }, document: { readyState: 'loading', addEventListener() {}, activeElement: { blur() { blur?.(state); } } }, console, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return { state, writes, gridform, context, close: context.window.wandouSaveBeforeClose };
}

test('registers a close gate before initialization and does not claim an unread draft was saved', async () => {
  const f = fixture({ ready: false });
  const result = await f.close();
  assert.equal(result.success, false); assert.equal(result.busy, true); assert.equal(f.writes.length, 0);
  f.gridform.ready = true; assert.equal((await f.close()).success, true);
});

test('awaits committed save and shares one pending close operation', async () => {
  const gate = deferred(), f = fixture({ save: () => gate.promise });
  let settled = false;
  const first = f.close(); first.then(() => { settled = true; });
  assert.equal(f.close(), first); await Promise.resolve();
  assert.equal(settled, false); assert.deepEqual(f.writes, [1]);
  gate.resolve(true); assert.equal((await first).success, true);
});

test('false, undefined and thrown saves remain failures and allow a later retry', async () => {
  for (const failure of [false, undefined, new Error('synthetic write error')]) {
    let fail = true;
    const f = fixture({ save: () => { if (!fail) return true; if (failure instanceof Error) throw failure; return failure; } });
    const result = await f.close(); assert.equal(result.success, false); assert.match(result.error, /保存失败/);
    fail = false; assert.equal((await f.close()).success, true);
  }
});

test('commits focused inline edits before the first save snapshot', async () => {
  const f = fixture({ blur: state => { state.revision = 2; } });
  assert.equal((await f.close()).success, true); assert.deepEqual(f.writes, [2]);
});

test('edits arriving during a transaction are saved again before success', async () => {
  const gate = deferred(), f = fixture({ save: (_state, writes) => writes.length === 1 ? gate.promise : true });
  const closing = f.close(); f.state.revision = 2; gate.resolve(true);
  assert.equal((await closing).success, true); assert.deepEqual(f.writes, [1, 2]);
});

test('continuous edits have a bounded retry and never report a stale snapshot as saved', async () => {
  const f = fixture({ save: state => { state.revision += 1; return true; } });
  const result = await f.close(); assert.equal(result.success, false); assert.equal(result.busy, true);
  assert.deepEqual(f.writes, [1, 2, 3]);
});

test('serialization failures remain explicit close failures without a write', async () => {
  const f = fixture(); f.gridform.serialize = () => { throw new Error('synthetic snapshot error'); };
  assert.equal((await f.close()).success, false); assert.equal(f.writes.length, 0);
});

async function exportFixture(save = async () => true) {
  const gate = deferred(), nodes = new Map(); let init;
  const node = () => ({ innerHTML: 'Export', disabled: false, value: 'png', checked: false, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const get = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  const gridform = { ready: true, state: { layout: 'test', config: { ratio: '1:1' } }, whenRendered: async () => {}, serialize: () => 'stable', saveDraft: save };
  const context = vm.createContext({ window: { Gridform: gridform }, Gridform: gridform, PosterEngine: { clone: x => x, renderPoster: async () => { await gate.promise; throw new Error('synthetic export failure'); } }, document: { readyState: 'loading', fonts: { ready: Promise.resolve() }, activeElement: { blur() {} }, addEventListener(_name, fn) { init = fn; }, querySelector: get, createElement: () => ({ getContext() { return {}; } }) }, console: { error() {} }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context); await init(); return { context, get, gate };
}

test('local export stays busy until its real async operation settles, including failure', async () => {
  const { context, get, gate } = await exportFixture(); get('#export').onclick(); await Promise.resolve();
  const busy = await context.window.wandouSaveBeforeClose(); assert.equal(busy.success, false); assert.equal(busy.busy, true); assert.equal(get('#export').disabled, true);
  gate.resolve(); await new Promise(r => setImmediate(r));
  assert.equal(get('#export').disabled, false); assert.equal((await context.window.wandouSaveBeforeClose()).success, true);
});

test('an export started during a pending draft transaction prevents closing after that commit', async () => {
  const saveGate = deferred(), { context, get, gate } = await exportFixture(() => saveGate.promise);
  const closing = context.window.wandouSaveBeforeClose(); get('#export').onclick(); await Promise.resolve();
  saveGate.resolve(true); const result = await closing; assert.equal(result.success, false); assert.equal(result.busy, true);
  gate.resolve(); await new Promise(r => setImmediate(r)); assert.equal((await context.window.wandouSaveBeforeClose()).success, true);
});
