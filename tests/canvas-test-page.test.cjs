const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = path.resolve(__dirname, '../app');
const read = file => fs.readFileSync(path.join(app, file), 'utf8');
const html = read('ai-node-canvas-test.html');

test('all test-page scripts compile and local script/style dependencies exist', () => {
  let count = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = /src="([^"]+)"/.exec(match[1]);
    const code = src ? read(src[1]) : match[2];
    new vm.Script(code, {filename: src?.[1] || 'inline'});
    count++;
  }
  assert.ok(count >= 7);
  for (const match of html.matchAll(/<link[^>]+href="(\.\/[^"?]+)"/g)) assert.ok(fs.existsSync(path.join(app, match[1])));
});

function storage() {
  const target = {};
  Object.defineProperties(target, {
    getItem: {value: key => Object.hasOwn(target, key) ? target[key] : null},
    setItem: {value: (key, value) => target[key] = String(value)},
    removeItem: {value: key => delete target[key]},
    key: {value: index => Object.keys(target)[index] ?? null},
    length: {get: () => Object.keys(target).length}
  });
  return target;
}

test('release workspace reads legacy projects and keeps prototype data intact', () => {
  const localStorage = storage(), sessionStorage = storage();
  localStorage.setItem('aiCanvasStateV1', 'legacy');
  localStorage.setItem('wandou:canvas-ui-test:v1:aiCanvasStateV1', 'prototype');
  const open = () => ({});
  const indexedDB = {open,deleteDatabase:()=>{}};
  const window = {localStorage,sessionStorage,indexedDB,location:{search:'?project=old-folder&workspace=production'}};
  const context = vm.createContext({window,indexedDB});
  vm.runInContext(read('ai-node-canvas-test-storage.js')+'\nthis.store=canvasTestStorage;', context);
  assert.equal(context.store.getItem('aiCanvasStateV1'), 'legacy');
  assert.equal(indexedDB.open,open);
  context.store.setItem('aiCanvasStateV1','updated');
  assert.equal(localStorage.getItem('wandou:canvas-ui-test:v1:aiCanvasStateV1'),'prototype');
});

test('test project, theme, session and database operations cannot hit production namespaces', () => {
  const localStorage = storage(), sessionStorage = storage();
  localStorage.setItem('aiCanvasStateV1', 'production');
  localStorage.setItem('ai-tools-theme', 'dark');
  sessionStorage.setItem('job-1', 'production job');
  const calls = [];
  const indexedDB = {open: (...args) => {calls.push(['open', ...args]); return {};}, deleteDatabase: (...args) => calls.push(['delete', ...args])};
  const window = {localStorage, sessionStorage, indexedDB};
  const context = vm.createContext({window, indexedDB, console, setTimeout, clearTimeout});
  vm.runInContext(read('ai-node-canvas-test-storage.js') + '\nthis.store=canvasTestStorage;this.session=canvasTestSessionStorage;', context);
  assert.equal(context.store.getItem('aiCanvasStateV1'), null);
  context.store.setItem('aiCanvasStateV1', 'test');
  assert.equal(context.store.getItem('aiCanvasStateV1'), 'test');
  assert.equal(localStorage.getItem('aiCanvasStateV1'), 'production');
  assert.equal(context.store.key(0), 'aiCanvasStateV1');
  context.session.setItem('job-1', 'test job');
  assert.equal(sessionStorage.getItem('job-1'), 'production job');
  vm.runInContext(read('ai-node-canvas-test-cache.js'), context);
  window.WandouLocalCache.syncTheme('light');
  assert.equal(localStorage.getItem('ai-tools-theme'), 'dark');
  assert.equal(context.store.getItem('ai-tools-theme'), 'light');
  indexedDB.open('media', 1);
  indexedDB.deleteDatabase('media');
  assert.ok(calls.every(call => call[1].startsWith('wandou:canvas-ui-test:v1:')));
  context.store.clear();
  assert.equal(context.store.length, 0);
  assert.equal(localStorage.getItem('aiCanvasStateV1'), 'production');
});

test('all original creation actions plus batch editing and project controls remain wired', () => {
  const production = read('ai-node-canvas.html');
  const actions = source => [...source.matchAll(/<button\b[^>]*data-add-node="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(actions(html).filter(action => action !== 'batch'), actions(production));
  assert.equal(actions(html).filter(action => action === 'batch').length, 1);
  assert.equal(actions(html).length, 12);
  for (const id of ['exportProjectButton','importProjectButton','newProjectButton','themeToggleButton','assistantSendButton']) {
    assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes(`${id}.addEventListener`) || html.includes(`getElementById("${id}")`));
  }
  assert.ok(!/\blocalStorage\./.test(html));
  assert.ok(!/\bsessionStorage\./.test(html));
});

test('test decorations preserve real handlers and four compact result actions', () => {
  const js = read('ai-node-canvas-test.js');
  assert.match(js, /originalRenderNode\(node, \.\.\.args\)/);
  assert.match(js, /menu\.insertBefore\(button, remove\)/);
  for (const action of ['data-favorite','data-regenerate','data-download','data-delete']) assert.ok(js.includes(action));
  assert.match(js, /target\?\.click\(\)/);
  assert.match(js, /undoCanvas\(\)/);
  assert.match(js, /redoCanvas\(\)/);
  assert.match(js, /fitCanvasToContent\(false\)/);
  assert.match(js, /querySelector\('#clearButton'\)\.hidden = true/);
  assert.match(read('ai-node-canvas-test-v2.css'), /prefers-reduced-motion/);
});
