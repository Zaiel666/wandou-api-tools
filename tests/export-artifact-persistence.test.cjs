const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/ai-node-canvas.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop-client/main.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'app/export-artifact-store.js'), 'utf8');
function block(text, start, end) {
  const from = text.indexOf(start), to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start); return text.slice(from, to);
}
function fakeIndexedDB(files) {
  return {open() {
    const db = {
      createObjectStore() {}, close() {},
      transaction() {
        const tx = {objectStore: () => ({
          put(blob, id) { const request = {}; queueMicrotask(() => { files.set(id, blob); tx.oncomplete?.(); }); return request; },
          get(id) { const request = {}; queueMicrotask(() => { request.result = files.get(id); tx.oncomplete?.(); }); return request; },
        })};
        return tx;
      },
    };
    const request = {result: db};
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
    return request;
  }};
}
function store(bridge, files = new Map()) {
  const context = {window:{wandouShell:bridge}, crypto:crypto.webcrypto, Blob, TextEncoder, Uint8Array, indexedDB:fakeIndexedDB(files)};
  vm.createContext(context); vm.runInContext(storeSource, context);
  return context.window.WandouExportStore;
}
function disk(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wandou-export-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('wandou-export-test-'));
    fs.rmSync(directory, {recursive:true, force:true});
  });
  const c = {fs, path, crypto, Buffer, app:{getPath: () => directory}};
  vm.createContext(c);
  vm.runInContext(block(main, 'function exportArtifactPath(', 'async function readProjectHubState('), c);
  return {c, directory, bridge:{writeExportArtifact:c.writeExportArtifact, readExportArtifact:c.readExportArtifact}};
}
function canvas(api) {
  const c = {
    window:{WandouExportStore:api}, psdExportFiles:new Map(), vectorExportFiles:new Map(),
    nodes:[], activeProjectId:'A', currentFolderId:'folder', errors:[],
    psdSourceReference: node => ({url:node.source}), getLocalMedia: async value => value === 'indexed-media:original' ? 'original' : value,
    sourceToBlob: async value => new Blob([value]),
    friendlyErrorMessage: error => error.message, refreshRenderedNode() {}, showToast(message) { c.errors.push(message); },
  };
  vm.createContext(c);
  vm.runInContext(block(source, '    function invalidateNodeExport(', '    async function downloadVectorExport('), c);
  return c;
}

test('desktop binary exports survive a new store instance; metadata contains no file bytes', async t => {
  const {bridge, directory} = disk(t);
  for (const type of ['image/vnd.adobe.photoshop', 'image/svg+xml']) {
    const input = new Blob([new Uint8Array([0, 1, 2, 255, 30, 0, 88])], {type});
    const saved = await store(bridge).save(input);
    assert.equal(saved.storage, 'disk'); assert.ok(JSON.stringify(saved).length < 300);
    assert.ok(fs.existsSync(path.join(directory, 'export-artifacts', `${saved.id}.bin`)));
    const output = await store(bridge).load(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(Buffer.from(await output.arrayBuffer()), Buffer.from(await input.arrayBuffer()));
    await store(bridge).save(input); // Same content can be saved twice without changing it.
  }
});

test('browser Blob transaction survives store reinitialization and detects missing/corrupt files', async () => {
  const files = new Map(), first = store(null, files);
  const metadata = await first.save(new Blob(['<svg/>'], {type:'image/svg+xml'}));
  assert.equal(metadata.storage, 'browser');
  assert.equal(await (await store(null, files).load(metadata)).text(), '<svg/>');
  files.set(metadata.id, new Blob(['BROKEN']));
  await assert.rejects(first.load(metadata), /校验失败/);
  files.delete(metadata.id); await assert.rejects(first.load(metadata), /缺失/);
});

test('disk persistence rejects traversal, wrong hash and tampered data', async t => {
  const {c, bridge} = disk(t);
  assert.equal((await c.writeExportArtifact({id:'../../outside', bytes:new ArrayBuffer(1)})).success, false);
  assert.equal((await c.writeExportArtifact({id:'a'.repeat(64), bytes:new ArrayBuffer(1)})).success, false);
  const metadata = await store(bridge).save(new Blob(['PSD binary']));
  fs.writeFileSync(c.exportArtifactPath(metadata.id), 'tampered');
  await assert.rejects(store(bridge).load(metadata), /校验失败/);
});

test('new binary IPC is restricted to local app senders', async () => {
  const handlers = new Map(); let calls = 0;
  const c = {ipcMain:{handle:(name, handler) => handlers.set(name, handler)},
    isLocalAppPage:url => url === 'file:///allowed.html',
    writeExportArtifact:() => { calls++; return {success:true}; }, readExportArtifact:() => { calls++; return {success:true}; }};
  vm.createContext(c);
  vm.runInContext(block(main, 'ipcMain.handle("desktop:write-export-artifact"', 'ipcMain.handle("desktop:get-local-data-config"'), c);
  for (const handler of handlers.values()) {
    assert.equal((await handler({senderFrame:{url:'https://untrusted.invalid'}})).success, false);
    assert.equal((await handler({senderFrame:{url:'file:///allowed.html'}})).success, true);
  }
  assert.equal(calls, 2);
});

test('restored PSD/vector node offers saved export without loading all large blobs at startup', async () => {
  const files = new Map(), api = store(null, files), c = canvas(api);
  for (const kind of ['psd', 'vector']) {
    const node = {id:1, type:kind, source:'original', vectorMode:'trace', vectorFormat:'svg'};
    c.nodes = [node];
    const exported = {node, blob:new Blob(['bytes']), name:`file.${kind === 'psd' ? 'psd' : 'svg'}`, sourceUrl:'original', mode:'trace', format:'svg', layerNames:['text']};
    assert.equal(await c.persistNodeExport(node, kind, exported, () => true), true);
    const restored = JSON.parse(JSON.stringify(node)); restored.source = 'indexed-media:original'; c.nodes = [restored];
    assert.ok(c.nodeExportRecord(restored, kind));
    const result = await c.resolveNodeExport(restored, kind);
    assert.equal(await result.blob.text(), 'bytes'); assert.equal(result.node, restored);
    c.psdExportFiles.clear(); c.vectorExportFiles.clear();
  }
});

test('same node id in another project cannot reuse a cached artifact', async () => {
  const c = canvas(store(null));
  const old = {id:1, type:'psd', source:'original'}, other = {...old};
  c.psdExportFiles.set(1, {node:old, sourceUrl:'original', blob:new Blob(['old'])});
  c.activeProjectId = 'B'; c.nodes = [other];
  assert.equal(c.nodeExportRecord(other, 'psd'), null);
  assert.equal(await c.resolveNodeExport(other, 'psd'), null);
});

test('source and format changes invalidate saved download; missing bytes report an actionable error', async () => {
  const files = new Map(), c = canvas(store(null, files));
  const node = {id:1, type:'vector', source:'original', vectorMode:'trace', vectorFormat:'svg'}; c.nodes = [node];
  await c.persistNodeExport(node, 'vector', {node, blob:new Blob(['svg']), name:'file.svg', sourceUrl:node.source, mode:'trace', format:'svg'}, () => true);
  node.source = 'different'; assert.equal(await c.resolveNodeExport(node, 'vector'), null); assert.match(node.status, /源图已变化/);
  node.source = 'original'; node.vectorFormat = 'eps'; assert.equal(c.nodeExportRecord(node, 'vector'), null);
  node.vectorFormat = 'svg'; files.clear(); assert.equal(await c.resolveNodeExport(node, 'vector'), null); assert.match(node.status, /缺失/);
});

test('late saves and late downloads cannot attach artifacts after switching projects', async () => {
  let finishSave, finishLoad;
  const api = {fingerprint:async () => 'hash', save:() => new Promise(resolve => {finishSave=resolve;}), load:() => new Promise(resolve => {finishLoad=resolve;})};
  const c = canvas(api), node = {id:1, type:'psd', source:'original'}; c.nodes = [node];
  const saving = c.persistNodeExport(node, 'psd', {blob:new Blob(['x']), sourceUrl:'original'}, () => c.activeProjectId === 'A');
  await new Promise(setImmediate); c.activeProjectId = 'B'; finishSave({version:1}); await saving;
  assert.equal(node.exportArtifact, undefined);
  c.activeProjectId = 'A'; node.exportArtifact = {version:1, kind:'psd', sourceHash:'hash'};
  const loading = c.resolveNodeExport(node, 'psd'); await new Promise(setImmediate);
  c.activeProjectId = 'B'; c.nodes = []; finishLoad(new Blob(['old']));
  assert.equal(await loading, null); assert.equal(c.psdExportFiles.size, 0);
});

test('disk full keeps the in-memory download but never claims durable persistence', async () => {
  const api = {fingerprint:async () => 'hash', save:async () => {throw new Error('disk full');}};
  const c = canvas(api), node = {id:1, type:'psd', source:'original'}; c.nodes = [node];
  const exported = {node, blob:new Blob(['x']), sourceUrl:'original'}; c.psdExportFiles.set(1, exported);
  assert.equal(await c.persistNodeExport(node, 'psd', exported, () => true), false);
  assert.equal(node.exportArtifact, undefined); assert.equal(exported.persistenceError, 'disk full');
  assert.equal(await c.resolveNodeExport(node, 'psd'), exported);
});

test('actual vector generation persists metadata and can download again after a simulated project reload', async () => {
  const c = canvas(store(null));
  Object.assign(c, {
    Blob, vectorJobs:new Set(), vectorJobTokens:new Map(), render() {}, scheduleCanvasSave() {},
    waitForUiPaint:async () => {}, sourceToBlob:async () => new Blob(['image']),
    blobToDataUrl:async () => 'original', getImageDimensions:async () => ({width:8, height:6}),
    vectorEmbeddedSvg:() => '<svg xmlns="http://www.w3.org/2000/svg"/>', downloadVectorExport() {},
  });
  vm.runInContext(block(source, '    async function generateVectorFromNode(', '    function renderVectorBody('), c);
  const node = {id:1, type:'vector', source:'original', vectorMode:'preserve', vectorFormat:'svg'};
  c.nodes = [node]; await c.generateVectorFromNode(1);
  assert.ok(node.exportArtifact?.id); assert.match(node.status, /文件已保存在本机/);
  assert.equal(c.vectorJobs.size, 0); assert.equal(c.vectorJobTokens.size, 0);
  const restored = JSON.parse(JSON.stringify(node)); c.nodes = [restored]; c.vectorExportFiles.clear();
  assert.match(await (await c.resolveNodeExport(restored, 'vector')).blob.text(), /<svg/);
});
