const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../desktop-client/node_modules/playwright');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function openCanvas(filename = 'ai-node-canvas-test.html') {
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(path.join(app, filename)).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
  await page.evaluate(() => {
    window.exportCalls = { choose: 0, writes: [], saveAs: [], folders: 0, api: 0 };
    window.wandouShell = {
      getSaveDirectory: async () => null,
      chooseSaveDirectory: async () => { exportCalls.choose++; return { name: 'manual-downloads', directory: 'X:/isolated-manual-downloads' }; },
      createSaveDirectory: async () => { exportCalls.folders++; return { success: true }; },
      saveFileAs: async (filename, bytes, mimeType) => { exportCalls.saveAs.push({ filename, length: bytes.length, signature: Array.from(bytes.slice(0, 8)), mimeType }); return { success: true, filename }; },
      writeSaveFile: async (filename, bytes, folderName) => { exportCalls.writes.push({ filename, length: bytes.length, signature: Array.from(bytes.slice(0, 8)), folderName }); return { success: true, filename }; }
    };
    nativeAutoSaveDirectory = autoSaveDirectoryHandle = null;
    autoSaveDirectoryLoaded = false;
    apiProfileForModel = () => ({ id: 'main', key: 'offline-test', label: 'offline' });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d'); context.fillStyle = '#57b64e'; context.fillRect(0, 0, 32, 32);
    window.offlineImage = canvas.toDataURL('image/png');
    callApi = async () => { exportCalls.api++; return { url: offlineImage, urls: [offlineImage], mediaType: 'image', fromApi: true }; };
    nodes = []; links = []; render({ skipSave: true }); updateAutoSaveDirectoryButton();
  });
  return { browser, page };
}

for (const filename of ['ai-node-canvas-test.html', 'ai-node-canvas.html']) {
  test(`${filename}: generate without directory, keep internal project after reload, and manually download`, async () => {
    const { browser, page } = await openCanvas(filename);
    try {
      const result = await page.evaluate(async () => {
        const node = createNode('generator', 0, 0, { _deferRender: true, model: 'GPT-image-2', ratio: '1:1 方图', resolution: '1K', prompt: 'offline persistence test', count: 1, autoSplit: false });
        render({ skipSave: true }); await generateFromNode(node.id);
        const generated = nodes.find(item => item.type === 'result' && item.fullUrl);
        const saved = await saveCanvasState();
        return { saved, calls: exportCalls, id: generated?.id, width: generated?.width, projectId: activeProjectId };
      });
      assert.equal(result.calls.api, 1); assert.equal(result.calls.choose, 0);
      assert.deepEqual(result.calls.saveAs, []);
      assert.deepEqual(result.calls.writes, []); assert.equal(result.calls.folders, 0);
      assert.equal(result.saved, true); assert.equal(result.width, 32); assert.ok(result.id);
      assert.equal(await page.locator('#autoSaveDirectoryButton').count(), 0, 'The canvas does not show a download directory control');
      await page.reload(); await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
      const restored = await page.evaluate(id => { const node = nodes.find(item => item.id === id); return { projectId: activeProjectId, type: node?.mediaType, width: node?.width, hasMedia: Boolean(node?.fullUrl || node?.mediaUrl) }; }, result.id);
      assert.deepEqual(restored, { projectId: result.projectId, type: 'image', width: 32, hasMedia: true });
      await page.evaluate(() => {
        window.restoredExports = [];
        window.wandouShell = { saveFileAs: async (filename, bytes, mimeType) => {
          restoredExports.push({ filename, signature: Array.from(bytes.slice(0, 8)), mimeType });
          return { success: true, filename };
        } };
      });
      await page.evaluate(id => downloadNodeMedia(nodes.find(item => item.id === id)), result.id);
      const downloads = await page.evaluate(() => restoredExports);
      assert.equal(downloads.length, 1); assert.match(downloads[0].filename, /\.png$/);
      assert.deepEqual(downloads[0].signature, [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(downloads[0].mimeType, 'image/png');
    } finally { await browser.close(); }
  });
}

test('selected directory does not trigger exports or backfill; explicit download always uses Save As', async () => {
  const { browser, page } = await openCanvas();
  try {
    const result = await page.evaluate(async () => {
      nativeAutoSaveDirectory = { name: 'old-output', directory: 'X:/old-output' };
      const node = createNode('generator', 0, 0, { _deferRender: true, model: 'GPT-image-2', ratio: '1:1 方图', resolution: '1K', prompt: 'offline manual export', count: 1, autoSplit: false });
      render({ skipSave: true }); await generateFromNode(node.id);
      const original = nodes.find(item => item.type === 'result' && item.fullUrl);
      original.autoSaveBatchFolder = 'original-batch';
      original.autoSplitIndex = 1;
      await regenerateResultNode(original.id);
      const replacementBatch = nodes.find(item => item.regeneratedFromId === original.id)?.autoSaveBatchFolder;
      const beforeChoice = exportCalls.writes.length;
      await chooseAutoSaveDirectory();
      const afterChoice = exportCalls.writes.length;
      await downloadNodeMedia(original);
      return { beforeChoice, afterChoice, replacementBatch, calls: exportCalls, results: nodes.filter(item => item.type === 'result' && item.fullUrl).length };
    });
    assert.equal(result.calls.api, 2); assert.equal(result.results, 2);
    assert.equal(result.replacementBatch, 'original-batch');
    assert.equal(result.beforeChoice, 0); assert.equal(result.afterChoice, 0);
    assert.equal(result.calls.choose, 1); assert.deepEqual(result.calls.writes, []);
    assert.equal(result.calls.saveAs.length, 1);
    assert.match(result.calls.saveAs[0].filename, /\.png$/);
    assert.deepEqual(result.calls.saveAs[0].signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(result.calls.saveAs[0].mimeType, 'image/png');
  } finally { await browser.close(); }
});

test('browser-only remote video/audio fallback works without accessing a saved directory', async () => {
  for (const filename of ['ai-node-canvas.html', 'ai-node-canvas-test.html']) {
    const source = fs.readFileSync(path.join(app, filename), 'utf8');
    const start = source.indexOf('    async function triggerDownload(');
    const end = source.indexOf('    async function downloadNodeMedia(', start);
    assert.ok(start >= 0 && end > start);
    for (const mediaType of ['video', 'audio']) {
      let fallbackReads = 0, opened = 0;
      const c = vm.createContext({
        window: {},
        loadAutoSaveDirectoryHandle: async () => { assert.fail('Browser fallback must not read a remembered directory'); },
        sourceToBlobUrl: async () => { fallbackReads++; return ''; },
        openNamedTab: () => opened++, showToast: () => {}, console: { warn: () => {} }
      });
      vm.runInContext(source.slice(start, end), c);
      const extension = mediaType === 'video' ? 'mp4' : 'mp3';
      assert.equal(await c.triggerDownload(`https://example.invalid/generated.${extension}`, `generated.${extension}`, mediaType === 'video' ? 'video/mp4' : 'audio/mpeg'), true, `${filename}: ${mediaType}`);
      assert.equal(fallbackReads, 1); assert.equal(opened, 1);
    }
  }
});

test('automatic split creates an internal batch without creating an export folder', async () => {
  const { browser, page } = await openCanvas();
  try {
    const result = await page.evaluate(async () => {
      analyzeAutoSplitPlan = async () => ({ items: [{ title: '图一', prompt: '图一' }, { title: '图二', prompt: '图二' }], seriesSpec: 'offline series' });
      const node = createNode('generator', 0, 0, { _deferRender: true, model: 'GPT-image-2', ratio: '1:1 方图', resolution: '1K', prompt: 'offline split', autoSplit: true });
      render({ skipSave: true }); await generateFromNode(node.id); stopAutoSplitCountdown(node);
      return { batch: node.autoSplitBatchFolder, plan: node.autoSplitPlan.length, calls: exportCalls };
    });
    assert.equal(result.plan, 2); assert.ok(result.batch);
    assert.deepEqual(result.calls.saveAs, []);
    assert.equal(result.calls.choose, 0); assert.equal(result.calls.folders, 0); assert.deepEqual(result.calls.writes, []);
  } finally { await browser.close(); }
});

test('transparent PNG generation also stays in the project until downloaded', async () => {
  const { browser, page } = await openCanvas();
  try {
    const result = await page.evaluate(async () => {
      nativeAutoSaveDirectory = { name: 'old-output', directory: 'X:/old-output' };
      makeTransparentPngFromOriginalAndMask = async () => offlineImage;
      const node = createNode('png', 0, 0, { _deferRender: true, model: 'GPT-image-2', resolution: '1K', prompt: 'offline PNG', transparentBackground: true, mediaUrl: offlineImage, references: [{ url: offlineImage, width: 32, height: 32, mediaType: 'image' }] });
      render({ skipSave: true }); await generateFromNode(node.id);
      const generated = nodes.find(item => item.type === 'result' && item.fullUrl);
      return { generated: Boolean(generated), transparent: generated?.transparent, saved: await saveCanvasState(), calls: exportCalls };
    });
    assert.equal(result.generated, true); assert.equal(result.transparent, true); assert.equal(result.saved, true);
    assert.deepEqual(result.calls.saveAs, []);
    assert.equal(result.calls.api, 1); assert.equal(result.calls.choose, 0); assert.deepEqual(result.calls.writes, []);
  } finally { await browser.close(); }
});

test('batch image generation works without selecting an export directory', async () => {
  const { browser, page } = await openCanvas();
  try {
    await page.waitForFunction(() => window.WandouBatchImage);
    const image = await page.evaluate(() => { WandouBatchImage.open(); return offlineImage.split(',')[1]; });
    for (let index = 0; index < 2; index++) {
      await page.locator('#batchImageDialog .batch-slot input[type=file]').nth(index).setInputFiles({ name: `reference-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.waitForFunction(() => !document.querySelector('#batchImageDialog [data-add]').disabled);
    }
    await page.locator('#batchImageDialog [data-run]').click();
    await page.waitForFunction(() => /本批处理结束：成功 1\/1/.test(document.querySelector('.batch-progress').textContent), { timeout: 30000 });
    const calls = await page.evaluate(() => exportCalls);
    assert.deepEqual(calls.saveAs, []);
    assert.equal(calls.api, 1); assert.equal(calls.choose, 0); assert.equal(calls.folders, 0); assert.deepEqual(calls.writes, []);
  } finally { await browser.close(); }
});
