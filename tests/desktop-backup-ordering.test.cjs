const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const desktop = process.env.WANDOU_TEST_DESKTOP_ROOT || path.resolve(__dirname, '../desktop-client');
const appRoot = process.env.WANDOU_TEST_APP_ROOT || path.resolve(desktop, '../app');
const main = fs.readFileSync(path.join(desktop, 'main.js'), 'utf8');
const makeGuard = require(path.join(desktop, 'canvas-backup-guard.cjs'));
function extract(source, name, next) {
  const start = source.indexOf(name), end = source.indexOf(next, start + name.length);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
function fixture() {
  const parent = path.resolve(__dirname, '../artifacts/theme-fix-20261025/test-fixtures');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'backup-order-'));
  const fault = { snapshot: false, hint: false }; let clock = 1000;
  const promises = new Proxy(fs.promises, { get(target, key) {
    if (key === 'rename') return async (from, to) => {
      if ((fault.snapshot && /\d+-[a-f0-9]+\.json$/.test(to)) || (fault.hint && to.endsWith('.latest-backup.json'))) throw new Error('synthetic disk failure');
      return target.rename(from, to);
    };
    return target[key].bind(target);
  } });
  const env = { fs: { ...fs, promises }, path, crypto, Date: { now: () => clock },
    safeCanvasBackupId: (value, fallback) => String(value || fallback).replace(/[^a-z0-9_-]/gi, '_'),
    canvasBackupDirectory: (folder, project) => path.join(root, folder, project),
    canvasBackupRootDirectory: () => root,
    canvasBackupFingerprint: makeGuard.fingerprint,
    compactEmbeddedCanvasMedia: async state => state, containsEmbeddedCanvasMedia: () => false };
  vm.runInNewContext(extract(main, 'async function writeCanvasBackup(', 'async function fetchWithTimeout('), env);
  const guard = makeGuard({ latest: env.latestCanvasBackupForGuard, write: env.writeCanvasBackup, keyFor: p => `${p.folderId}/${p.projectId}` });
  const payload = (title, savedAt = clock) => ({ folderId: 'folder', projectId: 'project', state: { folderId: 'folder', projectId: 'project', savedAt, nodes: [{ id: '1', type: 'image', title }], links: [] } });
  const read = () => env.readCanvasBackups({ folderId: 'folder', projectId: 'project' });
  const seedLegacy = (state, timestamp = state.savedAt) => {
    const dir = env.canvasBackupDirectory('folder', 'project'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${timestamp}-${crypto.randomBytes(4).toString('hex')}.json`);
    fs.writeFileSync(file, JSON.stringify({ format: 'wandou-canvas-backup', version: 1, savedAt: timestamp, state })); return file;
  };
  return { env, guard, fault, payload, read, seedLegacy, root, setClock: value => { clock = value; } };
}
test('same clock ticks and backwards clocks preserve the actual last commit', async () => {
  const f = fixture(); let previous = 0;
  for (let i = 0; i < 8; i++) {
    const result = await f.guard.save('A', f.payload(`commit-${i}`, 999999 - i));
    assert.equal(result.success, true); assert.ok(result.savedAt > previous); previous = result.savedAt;
    const read = await f.read(); assert.equal(read.states[0].nodes[0].title, `commit-${i}`); assert.equal(read.states[0].savedAt, result.savedAt);
    f.setClock(10);
  }
});
test('future legacy snapshots and stale hint cannot make an older identical snapshot win deduplication', async () => {
  const f = fixture(), old = f.payload('future-legacy', 900000).state;
  f.seedLegacy(old); const stale = f.payload('last-client-state', 100).state, staleFile = f.seedLegacy(stale);
  fs.writeFileSync(path.join(path.dirname(staleFile), '.latest-backup.json'), JSON.stringify({ fingerprint: makeGuard.fingerprint(stale), path: staleFile, savedAt: 100 }));
  const result = await f.guard.save('A', f.payload('last-client-state', 10));
  assert.equal(result.success, true); assert.equal(result.deduplicated, undefined); assert.equal(result.savedAt, 900001);
  const restored = (await f.read()).states[0]; assert.equal(restored.nodes[0].title, 'last-client-state');
  const duplicate = await f.guard.save('A', f.payload('last-client-state', 99999999));
  assert.equal(duplicate.deduplicated, true); assert.equal(duplicate.savedAt, result.savedAt); assert.equal(duplicate.path, result.path);
});
test('failed snapshot retry preserves baseline; optional metadata failure is a committed save and conflicts remain protected', async () => {
  const f = fixture(), original = f.payload('original'); await f.guard.save('A', original);
  f.guard.rememberRead('B', original, await f.read());
  f.fault.snapshot = true; assert.equal((await f.guard.save('A', f.payload('retry'))).success, false);
  assert.equal((await f.read()).states[0].nodes[0].title, 'original');
  f.fault.snapshot = false; f.fault.hint = true;
  assert.equal((await f.guard.save('A', f.payload('retry'))).success, true);
  assert.equal((await f.read()).states[0].nodes[0].title, 'retry');
  assert.equal((await f.guard.save('B', original)).newerVersionPreserved, true);
  assert.equal((await f.guard.save('B', f.payload('stale-edit'))).conflict, true);
});
test('damaged newest snapshot falls back to valid legacy format and subsequent save recovers', async () => {
  const f = fixture(); const legacy = f.seedLegacy(f.payload('legacy', 5000).state);
  fs.writeFileSync(path.join(path.dirname(legacy), '99999-deadbeef.json'), '{incomplete');
  assert.equal((await f.read()).states[0].nodes[0].title, 'legacy');
  const saved = await f.guard.save('A', f.payload('recovered', 1)); assert.equal(saved.success, true);
  assert.equal((await f.read()).states[0].nodes[0].title, 'recovered');
});
for (const file of ['ai-node-canvas-test.html', 'ai-node-canvas.html']) {
  test(`${file}: explicit empty reset survives clock rollback; accidental empty state does not hide content`, async () => {
    const f = fixture(), previous = f.payload('existing', 900000).state; f.seedLegacy(previous);
    const reset = f.payload('unused', 20); reset.state.nodes = []; reset.state.intentionalResetAt = 20;
    assert.equal((await f.guard.save('A', reset)).success, true);
    const html = fs.readFileSync(path.join(appRoot, file), 'utf8');
    const env = { isSeedCanvasState: () => false, isMeaningfulCanvasState: state => Boolean(state?.nodes?.length) };
    vm.runInNewContext(extract(html, 'function canvasStateSavedAt(', 'async function readDesktopCanvasBackups('), env);
    const disk = (await f.read()).states;
    assert.equal(env.chooseCanvasRecoveryState([...disk, previous]).nodes.length, 0);
    assert.equal(env.chooseCanvasRecoveryState([{ nodes: [], savedAt: 99999999 }, previous]).nodes[0].title, 'existing');
    const load = extract(html, 'async function loadCanvasState(', 'function projectHasStoredCanvasEvidence(');
    assert.match(load, /return nodes\.length > 0 \|\| intentionalResetAt > 0/);
    assert.match(load, /!state\.nodes\.length && !\(Number\(state\.intentionalResetAt\) > 0\)/);
  });
}
