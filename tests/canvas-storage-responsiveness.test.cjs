const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
const { mapLimited } = require(path.join(app, 'canvas-save-pipeline.js'));

function mediaFixture(filename, desktopResult) {
  const source = fs.readFileSync(path.join(app, filename), 'utf8');
  const start = source.indexOf('    async function getLocalMedia(');
  const end = source.indexOf('\n    async function ', start + 1);
  assert.ok(start >= 0 && end > start, 'use the actual packaged media restore function');
  const counts = { desktopReads: 0, browserReads: 0, browserWrites: 0 };
  const persistedLocalMediaIds = new Set();
  const env = {
    window: { wandouShell: { readCanvasMedia: async () => {
      counts.desktopReads++;
      if (desktopResult instanceof Error) throw desktopResult;
      return desktopResult;
    } } },
    localMediaPrefix: 'indexed-media:', localMediaStoreName: 'media',
    pendingLocalMediaWrites: new Map(), persistedLocalMediaIds,
    cacheRecoveredDesktopMedia: async () => { counts.browserWrites++; },
    openLocalMediaDb: async () => ({ transaction: (_store, mode) => {
      assert.equal(mode, 'readonly');
      return { objectStore: () => ({ get: id => {
        counts.browserReads++;
        const request = { result: id === 'legacy' ? { value: 'data:image/png;base64,legacy-copy' } : null };
        queueMicrotask(() => request.onsuccess());
        return request;
      } }) };
    } })
  };
  vm.runInNewContext(source.slice(start, end), env);
  return { get: env.getLocalMedia, counts, persistedLocalMediaIds };
}

for (const filename of ['ai-node-canvas-test.html', 'ai-node-canvas.html']) {
  test(`${filename}: intact desktop media does not create a duplicate browser copy`, async () => {
    const f = mediaFixture(filename, { success: true, value: 'data:image/png;base64,desktop-copy' });
    assert.equal(await f.get('indexed-media:original'), 'data:image/png;base64,desktop-copy');
    assert.deepEqual(f.counts, { desktopReads: 1, browserReads: 0, browserWrites: 0 });
    assert.equal(f.persistedLocalMediaIds.has('original'), true);
  });
  for (const outcome of [{ success: false, missing: true }, new Error('disk unavailable')]) {
    test(`${filename}: legacy browser media remains recoverable after ${outcome instanceof Error ? 'disk read error' : 'missing desktop file'}`, async () => {
      const f = mediaFixture(filename, outcome);
      assert.equal(await f.get('indexed-media:legacy'), 'data:image/png;base64,legacy-copy');
      assert.deepEqual(f.counts, { desktopReads: 1, browserReads: 1, browserWrites: 0 });
    });
  }
}

test('cached-media batches allow timers to run before all nodes finish', async () => {
  let completed = 0, observedCompleted = -1;
  const timer = new Promise(resolve => setTimeout(() => { observedCompleted = completed; resolve(); }, 0));
  const items = Array.from({ length: 160 }, (_, i) => i);
  const result = await mapLimited(items, 2, value => {
    // Approximate many synchronous metadata steps followed by already-resolved cache reads.
    const until = performance.now() + 0.35;
    while (performance.now() < until) {}
    return Promise.resolve(value * 2);
  }, count => { completed = count; });
  await timer;
  assert.ok(observedCompleted > 0 && observedCompleted < items.length,
    `a queued UI task must run during saving, observed ${observedCompleted}/${items.length}`);
  assert.deepEqual(result, items.map(value => value * 2));
});

test('bounded saves retain input order, accurate progress and maximum concurrency', async () => {
  let active = 0, maximum = 0;
  const progress = [];
  const result = await mapLimited([8, 1, 5, 2, 3, 1], 3, async (delay, index) => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, delay));
    active--;
    return `node-${index}`;
  }, (done, total) => progress.push([done, total]));
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  assert.deepEqual(result, ['node-0', 'node-1', 'node-2', 'node-3', 'node-4', 'node-5']);
  assert.deepEqual(progress, Array.from({ length: 6 }, (_, i) => [i + 1, 6]));
});

test('a failed save stops taking new nodes and waits for already-started writes', async () => {
  const failure = new Error('disk full');
  const started = [], finished = [];
  await assert.rejects(mapLimited([0, 1, 2, 3], 2, async value => {
    started.push(value);
    await new Promise(resolve => setTimeout(resolve, value === 0 ? 2 : 12));
    if (value === 0) throw failure;
    finished.push(value);
    return value;
  }), error => error === failure);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(finished, [1]);
});

test('empty save batches do not invoke task or progress callbacks', async () => {
  assert.deepEqual(await mapLimited([], 2, () => assert.fail('task'), () => assert.fail('progress')), []);
});
