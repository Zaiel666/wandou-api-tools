const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../desktop-client/node_modules/playwright');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function previewPage(browser) {
  const page = await browser.newPage();
  await page.setContent('<style>.canvas-wrap{width:300px;height:250px;overflow:hidden;position:relative}.thumb{width:100px;height:100px}.thumb img{width:100%;height:100%}</style><div class="canvas-wrap"><div class="thumb"><img></div></div>');
  await page.evaluate(() => {
    window.mediaObjectUrls = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (blob.type.startsWith('image/')) window.mediaObjectUrls.push(url);
      return url;
    };
  });
  await page.addScriptTag({ path: path.join(app, 'canvas-media-preview.js') });
  return page;
}

test('reference thumbnails release decoded resources off-screen and restore without changing the original', async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    // Both direct small previews and resized large originals must release their
    // visible resources. Only the large-image path creates media object URLs.
    for (const [width, height] of [[80, 48], [2048, 1228]]) {
      const page = await previewPage(browser);
      await page.evaluate(({ width, height }) => {
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        c.getContext('2d').fillRect(0, 0, width, height);
        window.original = c.toDataURL(); document.querySelector('img').src = window.original;
        WandouCanvasPreview.prepare(document.body);
      }, { width, height });
      await page.waitForFunction(() => document.querySelector('img').naturalWidth > 0 && WandouCanvasPreview.stats().inflight === 0);
      const oldUrl = await page.locator('img').getAttribute('src');
      if (width > 1536) assert.ok(oldUrl.startsWith('blob:'), 'large original must exercise the resized blob path');
      else assert.equal(oldUrl, await page.evaluate(() => original), 'small preview must preserve the original container bytes');
      await page.evaluate(() => document.querySelector('.thumb').style.transform = 'translateY(2000px)');
      await page.waitForFunction(() => !document.querySelector('img').hasAttribute('src'));
      assert.deepEqual(await page.evaluate(() => {
        const r = WandouCanvasPreview.dimensions(document.querySelector('img'));
        return { active: r.active, objectUrl: r.objectUrl, result: r.result, originalPreserved: r.source === window.original };
      }), { active: false, objectUrl: null, result: null, originalPreserved: true });
      if (oldUrl.startsWith('blob:')) assert.equal(await page.evaluate(async old => { try { await fetch(old); return false; } catch { return true; } }, oldUrl), true);
      await page.evaluate(() => document.querySelector('.thumb').style.transform = '');
      await page.waitForFunction(() => document.querySelector('img').naturalWidth > 0);
      const restored = await page.evaluate(() => ({ src: document.querySelector('img').src, source: WandouCanvasPreview.dimensions(document.querySelector('img')).source, original }));
      assert.equal(restored.source, restored.original);
      if (oldUrl.startsWith('blob:')) assert.notEqual(restored.src, oldUrl);
      else assert.equal(restored.src, oldUrl);
      await page.evaluate(() => WandouCanvasPreview.release(document.body));
      assert.equal(await page.evaluate(() => WandouCanvasPreview.dimensions(document.querySelector('img'))), undefined);
      const released = await page.evaluate(async () => {
        const revoked = await Promise.all(mediaObjectUrls.map(async url => { try { await fetch(url); return false; } catch { return true; } }));
        return { count: mediaObjectUrls.length, allRevoked: revoked.every(Boolean) };
      });
      assert.equal(released.allRevoked, true, 'every created media object URL must be revoked after release');
      assert.equal(released.count, width > 1536 ? 2 : 0);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('leaving the viewport cancels queued decodes and the preview cache obeys its byte budget', async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent('<body></body>');
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      window.testBlob = await new Promise(resolve => c.toBlob(resolve));
      window.decodePosts = []; window.holdDecoder = true;
      window.Worker = class {
        constructor() { window.testDecoder = this; }
        postMessage(message) {
          window.decodePosts.push(message.source);
          this.message = message;
          if (!window.holdDecoder) queueMicrotask(() => this.finish());
        }
        finish() { this.onmessage({ data: { id: this.message.id, blob: window.testBlob, width: 16, height: 16 } }); }
        terminate() {}
      };
    });
    await page.addScriptTag({ path: path.join(app, 'canvas-media-preview.js') });
    await page.evaluate(() => {
      for (const id of ['first', 'leave-a', 'leave-b']) {
        const image = new Image(); image.id = id; document.body.append(image);
        WandouCanvasPreview.setSource(image, 'data:image/png;base64,' + id);
      }
    });
    await page.waitForFunction(() => window.decodePosts.length === 1 && WandouCanvasPreview.stats().queuedDecodes === 2);
    await page.evaluate(() => {
      WandouCanvasPreview.setSource(document.getElementById('leave-a'), '');
      WandouCanvasPreview.setSource(document.getElementById('leave-b'), '');
      window.holdDecoder = false; window.testDecoder.finish();
    });
    await page.waitForFunction(() => WandouCanvasPreview.stats().queuedDecodes === 0);
    assert.equal(await page.evaluate(() => window.decodePosts.length), 1);
    // The worker is controlled here to exercise many large source keys cheaply;
    // the existing media tests verify real decoding, fallbacks and animation.
    const stats = await page.evaluate(async () => {
      const image = document.getElementById('first');
      for (let n = 0; n < 40; n++) {
        const source = 'data:image/png;base64,' + n + 'A'.repeat(500000);
        WandouCanvasPreview.setSource(image, source);
        await new Promise(resolve => image.addEventListener('load', resolve, { once: true }));
      }
      const before = WandouCanvasPreview.stats();
      const source = WandouCanvasPreview.dimensions(image).source;
      window.cacheBeforeRelease = before;
      WandouCanvasPreview.releaseSource(source);
      return { before };
    });
    // Eviction resolves the same asynchronous cache key used for admission.
    await page.waitForFunction(() => WandouCanvasPreview.stats().cacheBytes < window.cacheBeforeRelease.cacheBytes);
    stats.after = await page.evaluate(() => WandouCanvasPreview.stats());
    assert.ok(stats.before.cacheBytes <= stats.before.cacheBudget);
    assert.ok(stats.before.cacheEntries < 40, 'entry count alone is insufficient for large base64 keys');
    assert.ok(stats.after.cacheBytes < stats.before.cacheBytes, 'runtime URL replacement can release the old source cache');
    assert.equal(stats.after.cacheEntries, stats.before.cacheEntries - 1, 'only the explicitly released source is evicted');
  } finally { await browser.close(); }
});

test('large graphs batch geometry reads before SVG writes and retain moved node DOM', async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(app, 'ai-node-canvas-test.html')).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
    const result = await page.evaluate(async () => {
      scheduleCanvasSave = () => {}; nodes = []; links = [];
      const base = { ...createNode('result', 0, 0, { _deferRender: true, mediaType: 'image', mediaUrl: '', width: 64, height: 64 }) };
      nodes = Array.from({ length: 400 }, (_, i) => ({ ...base, id: 'graph-' + i, x: i % 10 * 400, y: Math.floor(i / 10) * 350 }));
      links = nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id }));
      render({ skipSave: true }); await new Promise(requestAnimationFrame);
      const element = canvas.querySelector('[data-id="graph-0"]');
      const initialPath = linkElements.get('graph-0:graph-1').path.getAttribute('d');
      nodes[0].x += 80; render({ skipSave: true });
      const retained = canvas.querySelector('[data-id="graph-0"]') === element;
      const descriptors = ['offsetWidth', 'offsetHeight'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
      const originalSet = SVGElement.prototype.setAttribute;
      let reads = 0, writes = 0, readsAfterWrite = 0;
      for (const [name, descriptor] of descriptors) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get() { reads++; if (writes) readsAfterWrite++; return descriptor.get.call(this); } });
      SVGElement.prototype.setAttribute = function (...args) { writes++; return originalSet.apply(this, args); };
      try { drawLinks(); }
      finally { for (const [name, descriptor] of descriptors) Object.defineProperty(HTMLElement.prototype, name, descriptor); SVGElement.prototype.setAttribute = originalSet; }
      const changedPath = linkElements.get('graph-0:graph-1').path.getAttribute('d');
      const allPathsValid = [...linkElements.values()].every(entry => entry.path.getAttribute('d') && !/NaN|undefined/.test(entry.path.getAttribute('d')));
      const keyNode = { ...nodes[0], references: [{ url: 'data:image/png;base64,a', doodleUrl: 'data:image/png;base64,' + 'B'.repeat(2000000) }] };
      return { retained, reads, writes, readsAfterWrite, pathMoved: initialPath !== changedPath, allPathsValid, keyLength: nodeRenderKey(keyNode).length, linkCount: linkElements.size };
    });
    assert.equal(result.retained, true);
    assert.equal(result.pathMoved, true);
    assert.equal(result.allPathsValid, true);
    assert.equal(result.linkCount, 399);
    assert.ok(result.reads <= 800);
    assert.ok(result.writes > 0);
    assert.equal(result.readsAfterWrite, 0);
    assert.ok(result.keyLength < 10000, 'annotation bitmaps must not enter every render comparison');
  } finally { await browser.close(); }
});
