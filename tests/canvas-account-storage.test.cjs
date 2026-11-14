const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas-test-storage.js'), 'utf8');
const root = 'wandou:canvas-account:v1:';

function storage(values = {}) {
  const value = { ...values };
  Object.defineProperties(value, {
    getItem: { value: key => Object.hasOwn(value, key) ? value[key] : null },
    setItem: { value: (key, item) => { value[key] = String(item); } },
    removeItem: { value: key => { delete value[key]; } }
  });
  return value;
}
function load({ local = storage(), session = storage(), idb, user = { id: 'user-a' }, search = '?workspace=production', pathname = '/ai-node-canvas-test.html', origin = 'http://127.0.0.1:8787' } = {}) {
  let currentUser = user, failure = false;
  const calls = [];
  const indexedDB = idb || { open: (...args) => { calls.push(['open', ...args]); return {}; }, deleteDatabase: (...args) => { calls.push(['delete', ...args]); return {}; } };
  const window = { localStorage: local, sessionStorage: session, indexedDB, location: { origin, search, pathname } };
  const context = vm.createContext({ window, indexedDB, AbortSignal, console, IDBKeyRange: { lowerBound: (key, open) => ({ key, open }) },
    fetch: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8788/api/me');
      assert.equal(options.credentials, 'include');
      if (failure) throw new Error('offline');
      return { ok: true, json: async () => ({ user: currentUser }) };
    }
  });
  vm.runInContext(source + '\nthis.store = canvasTestStorage; this.session = canvasTestSessionStorage;', context);
  return { context, window, scope: window.WandouCanvasScope, store: context.store, session: context.session, local, rawSession: session, indexedDB, calls,
    setUser: user => { currentUser = user; }, setOffline: value => { failure = value; } };
}

test('anonymous or unreachable account service cannot read, change, enumerate or open local canvas data', async () => {
  const a = load({ user: null, local: storage({ aiCanvasStateV1: 'private legacy' }) });
  for (const operation of [() => a.store.getItem('aiCanvasStateV1'), () => a.store.setItem('x', 'y'),
    () => a.store.clear(), () => a.store.key(0), () => a.store.length, () => a.session.getItem('job'),
    () => a.indexedDB.open('media'), () => a.indexedDB.deleteDatabase('media')])
    assert.throws(operation, /验证当前账户/);
  await assert.rejects(a.scope.initialize(), /请先登录账户/);
  assert.equal(a.scope.ready, false);
  assert.equal(a.local.getItem('aiCanvasStateV1'), 'private legacy');
  a.setOffline(true);
  await assert.rejects(a.scope.initialize(), /无法连接/);
  assert.equal(a.calls.length, 0);
});

test('two verified accounts have separate project, session, directory and image namespaces', async () => {
  const sharedLocal = storage(), sharedSession = storage();
  const a = load({ local: sharedLocal, session: sharedSession }), b = load({ local: sharedLocal, session: sharedSession, user: { id: 'user-b' } });
  await a.scope.initialize(); await b.scope.initialize();
  a.store.setItem('aiCanvasStateV1', 'A project'); a.session.setItem('job', 'A job');
  b.store.setItem('aiCanvasStateV1', 'B project'); b.session.setItem('job', 'B job');
  assert.equal(a.store.getItem('aiCanvasStateV1'), 'A project');
  assert.equal(b.store.getItem('aiCanvasStateV1'), 'B project');
  assert.equal(a.session.getItem('job'), 'A job');
  assert.equal(b.session.getItem('job'), 'B job');
  a.indexedDB.open('wandou-auto-save-v1', 1); b.indexedDB.open('ai-node-canvas-media-v1', 2);
  assert.equal(a.calls[0][1], root + 'user-a:wandou-auto-save-v1');
  assert.equal(b.calls[0][1], root + 'user-b:ai-node-canvas-media-v1');
  a.store.clear(); a.session.clear();
  assert.equal(b.store.getItem('aiCanvasStateV1'), 'B project');
  assert.equal(b.session.getItem('job'), 'B job');
});

test('same-document account changes and logout fail closed instead of repointing storage', async () => {
  const a = load();
  await a.scope.initialize(); a.store.setItem('aiCanvasStateV1', 'A');
  a.setUser({ id: 'user-b' });
  await assert.rejects(a.scope.initialize(), /账户已经切换/);
  assert.equal(a.scope.userId, 'user-a');
  assert.equal(a.scope.prefix, root + 'user-a:');
  assert.throws(() => a.store.getItem('aiCanvasStateV1'));
  a.setUser({ id: 'user-a' }); await a.scope.initialize();
  assert.equal(a.store.getItem('aiCanvasStateV1'), 'A');
  a.setUser(null); await assert.rejects(a.scope.initialize());
  assert.throws(() => a.store.getItem('aiCanvasStateV1'));
});

test('legacy data is not claimed by a newly registered account and test workspace remains separate', async () => {
  const local = storage({ aiCanvasStateV1: 'legacy', [root + 'user-a:aiCanvasStateV1']: 'release' });
  const a = load({ local, search: '' });
  await a.scope.initialize();
  assert.equal(a.store.getItem('aiCanvasStateV1'), null);
  assert.equal(a.scope.prefix, root + 'user-a:wandou:canvas-ui-test:v1:');
  assert.equal(local.getItem('aiCanvasStateV1'), 'legacy');
  assert.equal(local.getItem(root + 'user-a:aiCanvasStateV1'), 'release');
});

test('project folders and production canvas share the authenticated account namespace', async () => {
  const local = storage({ aiCanvasProjectsV1: 'legacy folders' });
  const canvas = load({ local });
  const hub = load({ local, pathname: '/project-hub.html', search: '' });
  await canvas.scope.initialize(); await hub.scope.initialize();
  canvas.store.setItem('aiCanvasProjectsV1', 'private folders');
  assert.equal(hub.store.getItem('aiCanvasProjectsV1'), 'private folders');
  const otherHub = load({ local, pathname: '/project-hub.html', search: '', user: { id: 'user-b' } });
  await otherHub.scope.initialize();
  assert.equal(otherHub.store.getItem('aiCanvasProjectsV1'), null);
  assert.equal(local.getItem('aiCanvasProjectsV1'), 'legacy folders');
  const html = fs.readFileSync(path.join(__dirname, '../app/project-hub.html'), 'utf8');
  assert.doesNotMatch(html, /\b(?:localStorage|sessionStorage)\./);
  assert.match(html, /type="text\/wandou-canvas" data-canvas-src="\.\/ai-node-canvas-test-cache\.js"/);
  assert.match(html, /window\.WandouCanvasBoot = initializeProjectState\(\)/);
  assert.match(html, /src="\.\/canvas-bootstrap\.js"/);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))
    if (match[2].trim()) new vm.Script(match[2]);
});

test('both asset entries defer private scripts and show only the current account media and selected skill', async () => {
  const local = storage({ aiCanvasStateV1: JSON.stringify({ nodes: [{ type: 'result', mediaType: 'image', title: 'legacy-private', mediaUrl: 'data:image/png;base64,bGVnYWN5' }] }) });
  const durableState = { folderId: 'folder-a', projectId: 'project-b', projectName: 'B canvas', savedAt: 200,
    nodes: [{ id: 'durable-result', type: 'result', mediaType: 'image', title: 'durable-private-image', mediaUrl: 'indexed-media:full-image', previewUrl: 'indexed-media:small-preview' }] };
  const durableKey = 'aiCanvasStateV1:folder-a:project-b';
  const records = [
    { id: durableKey, savedAt: 200, state: durableState },
    { id: 'aiCanvasStateV1:folder-a', savedAt: 200, state: durableState },
    ...Array.from({ length: 20 }, (_, index) => ({ id: durableKey + ':session-' + index, savedAt: 100, state: {
      ...durableState, savedAt: 100, nodes: [{ type: 'result', mediaType: 'image', title: 'old-session-image', mediaUrl: 'indexed-media:old-' + index }]
    } }))
  ];
  const idb = memoryIDB({
    [root + 'user-a:ai-node-canvas-media-v1']: { version: 2, stores: {
      'canvas-state': dbStore(records), media: dbStore([{ id: 'full-image', value: 'large image data' }, { id: 'small-preview', value: 'thumbnail' }])
    } },
    'ai-node-canvas-media-v1': { version: 2, stores: { 'canvas-state': dbStore([{ id: durableKey, state: { ...durableState, nodes: [{ type: 'result', mediaType: 'image', title: 'unscoped-secret', mediaUrl: 'data:image/png;base64,c2VjcmV0' }] } }]) } }
  });
  const canvas = load({ local });
  await canvas.scope.initialize();
  canvas.store.setItem('aiCanvasProjectsV1', JSON.stringify([{ id: 'folder-a', name: 'A folder' }]));
  canvas.store.setItem('aiCanvasStateV1:folder-a', JSON.stringify({ nodes: [
    { type: 'result', mediaType: 'image', title: 'owner-A-private-image', mediaUrl: 'data:image/png;base64,aW1hZ2U=', createdAt: 1 }
  ] }));
  canvas.store.setItem('wandouSelectedSkillV1', JSON.stringify({ id: 'owner-A-skill', name: 'A skill' }));
  canvas.store.setItem(durableKey, JSON.stringify({ storageVersion: 2, external: true, folderId: 'folder-a', projectId: 'project-b', nodeCount: 1, savedAt: 200 }));
  async function assetPage(pathname, user) {
    const page = load({ local, pathname, search: '', user, idb: {
      open: (...args) => idb.api.open(...args), deleteDatabase: (...args) => idb.api.deleteDatabase(...args)
    } });
    const elements = new Map();
    const element = key => {
      if (!elements.has(key)) elements.set(key, {
        value: key === 'assetSort' ? 'desc' : key === 'folderFilter' ? 'all' : '', innerHTML: '', textContent: '',
        options: [{ value: 'all' }], dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
        querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
      });
      return elements.get(key);
    };
    const document = { getElementById: element, querySelector: element, querySelectorAll: () => [],
      documentElement: { dataset: {} }, body: { dataset: {}, classList: { toggle() {} } } };
    Object.assign(page.context, { document, setTimeout, clearTimeout });
    page.window.addEventListener = () => {};
    await page.scope.initialize();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas-test-skills.js'), 'utf8'), page.context);
    page.context.WandouSkills = page.window.WandouSkills;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/canvas-state-reader.js'), 'utf8'), page.context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/asset-library.js'), 'utf8'), page.context);
    await page.window.WandouCanvasBoot;
    return { ...page, document, element };
  }
  for (const file of ['asset-library-test.html', 'asset-library.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../app', file), 'utf8');
    assert.doesNotMatch(html, /\b(?:localStorage|sessionStorage)\./);
    assert.match(html, /type="text\/wandou-canvas" data-canvas-src="\.\/ai-node-canvas-test-skills\.js"/);
    assert.match(html, /type="text\/wandou-canvas" data-canvas-src="\.\/asset-library\.js"/);
    assert.match(html, /src="\.\/canvas-bootstrap\.js"/);
    const owner = await assetPage('/' + file, { id: 'user-a' });
    const other = await assetPage('/' + file, { id: 'user-b' });
    assert.equal(owner.document.body.dataset.assetReady, 'true');
    assert.equal(owner.element('[data-count="image"]').textContent, 2);
    assert.match(owner.element('assetContent').innerHTML, /owner-A-private-image/);
    assert.match(owner.element('assetContent').innerHTML, /durable-private-image/);
    assert.doesNotMatch(owner.element('assetContent').innerHTML, /old-session-image|unscoped-secret/);
    const summaries = await owner.window.WandouCanvasStateReader.readStates();
    const folder = owner.window.WandouCanvasStateReader.folderState(summaries, 'folder-a');
    assert.equal(folder.nodes.length, 1, 'folder preview must count canonical state once, excluding folder alias and session backups');
    assert.equal(folder.nodes[0].previewUrl, 'indexed-media:small-preview');
    assert.equal(owner.window.WandouSkills.getSelected().id, 'owner-A-skill');
    assert.equal(other.element('[data-count="image"]').textContent, 0);
    assert.doesNotMatch(other.element('assetContent').innerHTML, /owner-A-private-image|durable-private-image|legacy-private|unscoped-secret/);
    assert.equal(other.window.WandouSkills.getSelected(), null);
  }
  assert.ok(!idb.stats.storesRead.includes('media'), 'listing reads canvas metadata; media bytes are only loaded by visible thumbnail handlers');
});

test('legacy local canvas entry hides old content and redirects without losing project or hash', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/ai-node-canvas.html'), 'utf8');
  const code = /<head>\s*<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const style = {}, redirects = [];
  const location = { origin: 'http://127.0.0.1:8787', href: 'http://127.0.0.1:8787/ai-node-canvas.html?project=folder-12#node-8',
    search: '?project=folder-12', hash: '#node-8', replace: value => redirects.push(value) };
  vm.runInNewContext(code, { location, document: { documentElement: { style } }, URL });
  assert.equal(style.visibility, 'hidden');
  const destination = new URL(redirects[0]);
  assert.equal(destination.pathname, '/ai-node-canvas-test.html');
  assert.equal(destination.searchParams.get('project'), 'folder-12');
  assert.equal(destination.searchParams.get('workspace'), 'production');
  assert.equal(destination.hash, '#node-8');
  const desktopStyle = {};
  vm.runInNewContext(code, { location: { ...location, origin: 'null' }, document: { documentElement: { style: desktopStyle } }, URL });
  assert.equal(desktopStyle.visibility, undefined);
  assert.equal(redirects.length, 1);
});

// Minimal asynchronous IndexedDB fixture: transactions finish only after nested
// requests/cursor continuations drain. No browser, network or production data.
function memoryIDB(seed = {}) {
  const data = new Map(Object.entries(seed).map(([name, value]) => [name, value]));
  const calls = [], stats = { largestWrite: 0, storesRead: [] };
  const names = values => Object.assign([...values], { contains: item => values.includes(item) });
  let failWrite = false;
  function database(name, value) {
    const db = { name, version: value.version, close() {}, get objectStoreNames() { return names(Object.keys(value.stores)); },
      createObjectStore(storeName, options) {
        value.stores[storeName] = { ...options, indexes: {}, rows: new Map() };
        return store(transaction(), storeName);
      },
      transaction(name) { stats.storesRead.push(name); return transaction(); }
    };
    function transaction() {
      let pending = 0, ended = false, writes = 0;
      const tx = { error: null, objectStore: name => store(tx, name), abort() { ended = true; tx.error = new Error('aborted'); queueMicrotask(() => tx.onabort?.()); } };
      tx.enqueue = callback => {
        pending++;
        const request = {};
        setImmediate(() => {
          if (ended) return;
          try { callback(request); }
          catch (cause) { ended = true; tx.error = cause; tx.onerror?.(); return; }
          pending--; settle();
        });
        return request;
      };
      tx.wrote = () => { writes++; stats.largestWrite = Math.max(stats.largestWrite, writes); };
      function settle() { setImmediate(() => { if (!pending && !ended) { ended = true; tx.oncomplete?.(); } }); }
      settle();
      return tx;
    }
    function store(tx, storeName) {
      const valueStore = value.stores[storeName];
      if (!valueStore) throw new Error('missing store');
      return { keyPath: valueStore.keyPath ?? null, autoIncrement: !!valueStore.autoIncrement,
        get indexNames() { return names(Object.keys(valueStore.indexes || {})); },
        index: name => ({ name, ...valueStore.indexes[name] }),
        createIndex(indexName, keyPath, options) { (valueStore.indexes ||= {})[indexName] = { keyPath, ...options }; },
        getKey: key => tx.enqueue(request => { request.result = valueStore.rows.has(key) ? key : undefined; request.onsuccess?.(); }),
        add: (item, suppliedKey) => tx.enqueue(request => {
          if (failWrite) throw new Error('quota exhausted');
          const key = valueStore.keyPath ? item[valueStore.keyPath] : suppliedKey;
          if (valueStore.rows.has(key)) throw new Error('duplicate');
          valueStore.rows.set(key, item); tx.wrote(); request.result = key; request.onsuccess?.();
        }),
        openCursor: range => {
          const rows = [...valueStore.rows].sort(([a], [b]) => String(a).localeCompare(String(b))).filter(([key]) => !range || String(key).localeCompare(String(range.key)) > 0);
          let position = 0;
          const request = {};
          function next() { tx.enqueue(() => {
            const entry = rows[position++];
            request.result = entry ? { primaryKey: entry[0], value: entry[1], continue: next } : null;
            request.onsuccess?.();
          }); }
          next(); return request;
        }
      };
    }
    return db;
  }
  const api = {
    open(name, version) {
      calls.push(['open', name]);
      const request = {};
      setImmediate(() => {
        let value = data.get(name), oldVersion = value?.version || 0;
        if (version && oldVersion > version) { request.error = Object.assign(new Error('version'), { name: 'VersionError' }); request.onerror?.(); return; }
        const draft = value || { version: version || 1, stores: {} };
        let aborted = false;
        const db = database(name, draft);
        request.result = db;
        request.transaction = { abort() { aborted = true; }, objectStore: name => db.transaction(name).objectStore(name) };
        if (!oldVersion || (version && version > oldVersion)) request.onupgradeneeded?.({ oldVersion });
        if (aborted) { request.error = Object.assign(new Error('abort'), { name: 'AbortError' }); request.onerror?.(); return; }
        draft.version = version || draft.version;
        data.set(name, draft); request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase(name) { calls.push(['delete', name]); data.delete(name); return {}; }
  };
  return { api, data, calls, stats, failWrites(value) { failWrite = value; } };
}
function dbStore(rows, keyPath = 'id', indexes = {}) {
  return { keyPath, autoIncrement: false, indexes, rows: new Map(rows.map(row => [row[keyPath] ?? row[0], row])) };
}

test('authorized migration copies blobs, schemas and handles in bounded pages; preserves source, destination edits and skips API secrets', async () => {
  const sourceRows = Array.from({ length: 43 }, (_, index) => ({ id: 'image-' + String(index).padStart(3, '0'), blob: new Blob(['image ' + index]) }));
  const media = { version: 2, stores: { media: dbStore(sourceRows, 'id', { savedAt: { keyPath: 'savedAt', unique: false, multiEntry: false } }) } };
  const cache = { version: 1, stores: { files: dbStore([{ path: 'json/api-config-v1.json', value: 'must not copy' }, { path: 'json/canvas.json', value: 'canvas' }], 'path') } };
  const idb = memoryIDB({
    'ai-node-canvas-media-v1': media, 'wandou-ai-local-cache': cache,
    [root + 'user-a:ai-node-canvas-media-v1']: { version: 2, stores: { media: dbStore([{ id: 'image-000', blob: 'new edit' }], 'id', media.stores.media.indexes) } },
    'wandou-auto-save-v1': { version: 1, stores: { handles: {
      keyPath: null, autoIncrement: false, indexes: {},
      rows: new Map([['directory', { kind: 'directory', name: 'Pictures' }]])
    } } }
  });
  const local = storage({ aiCanvasStateV1: 'legacy', aiCanvasApi: 'secret', 'ai-tools-api-config': 'secret2', unrelated: 'other app',
    [root + 'user-a:aiCanvasStateV1']: 'account edit', wandouBatchImageTemplatesV1: 'templates' });
  const a = load({ idb: idb.api, local, session: storage({ 'wandou:psd-job:1': 'job' }), user: { id: 'user-a', canvasLegacyOwner: true } });
  await a.scope.initialize();
  const target = idb.data.get(root + 'user-a:ai-node-canvas-media-v1').stores.media;
  assert.equal(target.rows.size, 43);
  assert.equal(target.rows.get('image-000').blob, 'new edit');
  assert.equal(await target.rows.get('image-042').blob.text(), 'image 42');
  assert.deepEqual(target.indexes, media.stores.media.indexes);
  assert.equal(media.stores.media.rows.size, 43);
  assert.equal(a.store.getItem('aiCanvasStateV1'), 'account edit');
  assert.equal(a.store.getItem('wandouBatchImageTemplatesV1'), 'templates');
  assert.equal(a.store.getItem('aiCanvasApi'), null);
  assert.equal(a.store.getItem('unrelated'), null);
  assert.equal(a.session.getItem('wandou:psd-job:1'), 'job');
  assert.equal(idb.data.get(root + 'user-a:wandou-ai-local-cache').stores.files.rows.has('json/api-config-v1.json'), false);
  assert.equal(idb.data.get(root + 'user-a:wandou-auto-save-v1').stores.handles.rows.get('directory').name, 'Pictures');
  assert.equal(idb.data.has('wandou-export-artifacts-v1'), false, 'absence check must not create a legacy database');
  assert.ok(idb.stats.largestWrite <= 16);
  const openCount = idb.calls.length;
  await a.scope.initialize();
  assert.equal(idb.calls.length, openCount, 'successful migration is not replayed');
});

test('failed legacy copy leaves source intact, blocks partial canvas access and can be retried', async () => {
  const idb = memoryIDB({ 'ai-node-canvas-media-v1': { version: 2, stores: { media: dbStore([{ id: 'image-1', blob: 'image data' }]) } } });
  idb.failWrites(true);
  const a = load({ idb: idb.api, user: { id: 'user-a', canvasLegacyOwner: true } });
  await assert.rejects(a.scope.initialize(), /quota exhausted/);
  assert.equal(a.scope.ready, false);
  assert.throws(() => a.indexedDB.open('ai-node-canvas-media-v1'));
  assert.throws(() => a.store.getItem('aiCanvasStateV1'));
  assert.equal(a.local.getItem(root + 'user-a:legacy-copy-complete-v1'), null);
  assert.equal(idb.data.get('ai-node-canvas-media-v1').stores.media.rows.size, 1);
  idb.failWrites(false); await a.scope.initialize();
  assert.equal(a.scope.ready, true);
  assert.equal(idb.data.get(root + 'user-a:ai-node-canvas-media-v1').stores.media.rows.get('image-1').blob, 'image data');
});
