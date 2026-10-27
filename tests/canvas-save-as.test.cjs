const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../desktop-client/node_modules/playwright');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
});
test.after(async () => { await browser?.close(); });

async function open(filename) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const downloads = [], errors = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(path.join(app, filename)).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === 'true' && window.WandouImageExport);
  const fixture = await page.evaluate(() => {
    const original = document.createElement('canvas'); original.width = 73; original.height = 51;
    const ctx = original.getContext('2d'); ctx.clearRect(0, 0, 73, 51); ctx.fillStyle = '#31b260'; ctx.fillRect(10, 9, 32, 21);
    const full = original.toDataURL('image/png');
    const preview = document.createElement('canvas'); preview.width = preview.height = 12;
    preview.getContext('2d').fillRect(0, 0, 12, 12);
    window.saveAsCalls = []; window.legacyWrites = 0; window.dialogMode = 'success'; window.toastHistory = [];
    const originalToast = showToast;
    showToast = (...args) => { toastHistory.push(String(args[0])); return originalToast(...args); };
    window.wandouShell = {
      saveFileAs: async (filename, bytes, mimeType) => {
        saveAsCalls.push({ filename, bytes: Array.from(bytes), mimeType });
        if (dialogMode === 'cancel') return { success: false, canceled: true };
        if (dialogMode === 'failure') return { success: false, error: '测试目录不可写' };
        return { success: true, filename, path: 'X:/chosen-' + saveAsCalls.length + '/' + filename };
      },
      getSaveDirectory: async () => ({ directory: 'X:/old-directory' }),
      writeSaveFile: async () => { legacyWrites++; throw Error('Must not write to the remembered folder'); }
    };
    nativeAutoSaveDirectory = { directory: 'X:/old-directory' };
    autoSaveDirectoryHandle = null;
    nodes = []; links = [];
    const node = createNode('result', 0, 0, { _deferRender: true, title: '透明原图', mediaType: 'image', fullUrl: full,
      mediaUrl: full, previewUrl: preview.toDataURL('image/png'), width: 73, height: 51, transparent: true, pending: false });
    render({ skipSave: true }); centerOnNode(node.id);
    return { id: node.id, originalBase64: full.split(',')[1] };
  });
  return { page, context, downloads, errors, ...fixture };
}

async function waitForCalls(page, count) {
  await page.waitForFunction(count => saveAsCalls.length === count, count);
  await page.waitForFunction(() => !document.querySelector('#toast')?.textContent.includes('正在准备'));
}

function verifyPng(call, originalBase64) {
  assert.equal(call.mimeType, 'image/png');
  assert.match(call.filename, /\.png$/);
  assert.deepEqual(Buffer.from(call.bytes), Buffer.from(originalBase64, 'base64'), 'Export must preserve original PNG bytes and alpha, not export the small preview');
}

for (const filename of ['ai-node-canvas-test.html', 'ai-node-canvas.html']) {
  test(filename + ': repeated footer exports choose each time, cancel and write failure never fall through', async () => {
    const { page, context, downloads, errors, id, originalBase64 } = await open(filename);
    try {
      const button = page.locator(`[data-id="${id}"] [data-download]`);
      assert.equal(await page.evaluate(() => saveAsCalls.length), 0, 'Rendering a result must not export it');
      await button.click(); await waitForCalls(page, 1);
      await button.click(); await waitForCalls(page, 2);
      await page.evaluate(() => { dialogMode = 'cancel'; toastHistory = []; });
      await button.click(); await waitForCalls(page, 3);
      assert.match(await page.locator('#toast').innerText(), /取消/);
      assert.equal(await page.evaluate(() => toastHistory.some(text => /已保存|保存失败|跨域/.test(text))), false);
      await page.evaluate(() => { dialogMode = 'failure'; toastHistory = []; });
      await button.click(); await waitForCalls(page, 4);
      assert.match(await page.locator('#toast').innerText(), /测试目录不可写/);
      assert.equal(await page.evaluate(() => toastHistory.some(text => /已保存|下载已开始|跨域/.test(text))), false);
      const calls = await page.evaluate(() => saveAsCalls);
      calls.forEach(call => verifyPng(call, originalBase64));
      assert.equal(await page.evaluate(() => legacyWrites), 0);
      assert.deepEqual(downloads, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test(filename + ': preview footer and gallery download use original PNG and native Save As', async () => {
    const { page, context, downloads, errors, id, originalBase64 } = await open(filename);
    try {
      await page.locator(`[data-id="${id}"] [data-result-transfer]`).click();
      await page.locator('#lightboxDownload').click(); await waitForCalls(page, 1);
      await page.locator('#lightboxClose').click();
      await page.locator('#openGalleryButton').click();
      await page.locator(`[data-gallery-node="${id}"]`).dblclick();
      await page.locator('[data-gallery-action="download"]').click(); await waitForCalls(page, 2);
      const calls = await page.evaluate(() => saveAsCalls);
      calls.forEach(call => verifyPng(call, originalBase64));
      assert.equal(await page.evaluate(() => legacyWrites), 0);
      assert.deepEqual(downloads, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('desktop canvas right-click image Download opens Save As; cancel leaves the original usable', async () => {
  const { page, context, downloads, errors, id, originalBase64 } = await open('ai-node-canvas-test.html');
  try {
    await page.locator(`[data-id="${id}"] [data-result-transfer]`).click();
    await page.locator('#lightboxImage').click({ button: 'right' });
    await page.locator('#lightboxContextDownload').click(); await waitForCalls(page, 1);
    await page.evaluate(() => { dialogMode = 'cancel'; });
    await page.locator('#lightboxImage').click({ button: 'right' });
    await page.locator('#lightboxContextDownload').click(); await waitForCalls(page, 2);
    assert.match(await page.locator('#toast').innerText(), /取消/);
    assert.equal(await page.locator('#lightboxImage').evaluate(img => img.complete && img.naturalWidth === 73 && img.naturalHeight === 51), true);
    (await page.evaluate(() => saveAsCalls)).forEach(call => verifyPng(call, originalBase64));
    assert.equal(await page.evaluate(() => legacyWrites), 0);
    assert.deepEqual(downloads, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
