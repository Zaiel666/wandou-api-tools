const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../artifacts/theme-fix-20261025/app');
for (const [file, start, end, name] of [
  ['local-cache.js', '  async function clearHeavyCache()', '\n  window.WandouLocalCache', 'clearHeavyCache'],
  ['ai-node-canvas-test-cache.js', '  async function clearHeavyCache()', '\n  window.WandouLocalCache', 'clearHeavyCache'],
  ['image-workbench/customize.js', '  async function clearWorkbenchCache()', '\n  const WORKBENCH_IMAGE_DB', 'clearWorkbenchCache'],
  ['workflow.js', 'async function clearHeavyCacheSafe()', '\ndocument.querySelector("[data-cache-clear]")', 'clearHeavyCacheSafe']
]) {
  test(`${file}: cleanup removes only discarded history and never databases/project/API settings`, async () => {
    const source = fs.readFileSync(path.join(root, file), 'utf8'), begin = source.indexOf(start), finish = source.indexOf(end, begin);
    assert.ok(begin >= 0 && finish > begin);
    const data = new Map([['canvas:project:one', 'project'], ['canvas:deleted-results:one', 'history'], ['api-settings', 'test-only-not-a-key']]);
    const localStorage = { get length() { return data.size; }, key: i => [...data.keys()][i], removeItem: key => data.delete(key) };
    const forbidden = () => { throw Error('Persistent database deletion attempted'); };
    const env = { window: {}, localStorage, canvasTestStorage: localStorage, indexedDB: { deleteDatabase: forbidden }, deleteDb: forbidden, deleteCacheDb: forbidden };
    vm.runInNewContext(source.slice(begin, finish), env);
    const result = await env[name](); assert.equal(result.ok, true); assert.equal(result.clearedRecords, 1); assert.equal(result.clearedDatabases, 0);
    assert.equal(data.get('canvas:project:one'), 'project'); assert.equal(data.get('api-settings'), 'test-only-not-a-key'); assert.equal(data.has('canvas:deleted-results:one'), false);
    assert.equal((await env[name]()).clearedRecords, 0);
    localStorage.removeItem = () => { throw Error('storage denied'); }; data.set('canvas:deleted-results:two', 'history');
    assert.equal((await env[name]()).ok, false);
  });
}
