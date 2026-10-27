const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../desktop-client/node_modules/playwright');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
let browser, server, origin;

test.before(async () => {
  server = http.createServer((req, res) => {
    const file = path.resolve(app, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(app + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function open({ entry = 'asset-library.html', theme = 'light', mode = 'success' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/image-export.js') return route.fulfill({ contentType: 'text/javascript', body: `
      window.WandouImageExport = { save: async options => {
        exportCalls.push(options);
        if (exportMode === 'cancel') return {success:false,canceled:true};
        if (exportMode === 'failure') return {success:false,error:'磁盘空间不足'};
        if (exportMode === 'throw') throw new Error('保存窗口暂时不可用');
        if (exportMode === 'pending') return await new Promise(resolve => window.finishExport = resolve);
        return {success:true,path:'D:/用户选择的位置/原图.png',filename:'原图.png'};
      } };
    ` });
    return route.continue();
  });
  await context.addInitScript(({ theme, mode }) => {
    localStorage.setItem('ai-tools-theme', theme);
    localStorage.setItem('wd-theme', theme);
    const preview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="gray"/></svg>');
    window.testOriginal = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    window.testTransparent = 'data:image/png;base64,transparent-original-test-bytes';
    window.exportCalls = []; window.mediaReads = []; window.exportMode = mode;
    const nodes = [
      { id: '1', title: '原始大图', fullUrl: 'indexed-media:full-original', mediaUrl: 'indexed-media:media-copy' },
      { id: '2', title: '仅有预览' },
      { id: '3', title: '透明图片', transparent: true, fullUrl: 'indexed-media:before-alpha', mediaUrl: 'indexed-media:alpha-original' }
    ].map(node => ({ type: 'result', mediaType: 'image', previewUrl: preview, width: 4096, height: 4096, createdAt: Number(node.id), ...node }));
    localStorage.setItem('aiCanvasProjectsV1', JSON.stringify([{ id: 'folder', name: '测试文件夹' }]));
    localStorage.setItem('aiCanvasStateV1:folder:project', JSON.stringify({ folderId: 'folder', projectId: 'project', nodes, links: [], savedAt: 100 }));
    window.wandouShell = {
      readCanvasMedia: async ({ id }) => {
        mediaReads.push(id);
        return exportMode === 'missing' ? { success: false } : { success: true, value: id === 'alpha-original' ? testTransparent : testOriginal };
      },
      getCanvasMediaLocation: async () => ({ success: true, storageFormat: 'data-url', path: 'G:/豌豆AI数据/canvas-media/full-original.data' }),
      showCanvasMediaInFolder: async () => ({ success: true })
    };
  }, { theme, mode });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin + '/' + entry);
  await page.waitForFunction(() => document.querySelectorAll('[data-asset-download]').length === 3);
  await page.locator('[data-filter="image"]').click();
  assert.equal(await page.locator('[data-asset-download]').count(), 3);
  return { page, context, errors };
}
const card = (page, title) => page.locator('.media-card').filter({ has: page.locator('.asset-card-title', { hasText: new RegExp('^' + title + '$') }) });

for (const entry of ['asset-library.html', 'asset-library-test.html']) for (const theme of ['light', 'dark']) {
  test(`${entry} ${theme}: card and original-location dialog export full original and choose on each click`, async () => {
    const { page, context, errors } = await open({ entry, theme });
    try {
      assert.deepEqual(await page.evaluate(() => mediaReads), [], 'asset listing must not read original bytes');
      await card(page, '原始大图').locator('[data-asset-download]').click();
      await page.waitForFunction(() => exportCalls.length === 1 && !document.querySelector('[data-asset-download]').disabled);
      assert.deepEqual(await page.evaluate(() => exportCalls), [{ source: await page.evaluate(() => testOriginal), filename: '原始大图' }]);
      assert.equal(await page.locator('#assetLightbox').evaluate(element => element.classList.contains('open')), false);
      assert.match(await page.locator('#assetToast').innerText(), /用户选择的位置/);
      await card(page, '原始大图').locator('[data-asset-location]').click();
      await page.waitForFunction(() => document.querySelector('#assetLocationPath').value.endsWith('.data'));
      assert.match(await page.locator('#assetLocationStatus').innerText(), /资源管理器不能直接预览/);
      await page.locator('#assetLocationDownload').click();
      await page.waitForFunction(() => exportCalls.length === 2 && !document.querySelector('#assetLocationDownload').disabled);
      assert.deepEqual(await page.evaluate(() => mediaReads), ['full-original', 'full-original']);
      assert.match(await page.locator('#assetLocationDownloadStatus').innerText(), /图片已保存到/);
      assert.equal(await page.locator('#assetLocationDialog').evaluate(element => element.open), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('canceled or failed save does not claim success or start another download', async () => {
  const { page, context } = await open();
  try {
    await card(page, '原始大图').locator('[data-asset-location]').click();
    for (const mode of ['cancel', 'failure', 'throw']) {
      await page.evaluate(mode => { exportMode = mode; exportCalls = []; }, mode);
      await page.locator('#assetLocationDownload').click();
      await page.waitForFunction(() => exportCalls.length === 1 && !document.querySelector('#assetLocationDownload').disabled);
      assert.equal(await page.locator('#assetLocationDownload').innerText(), '另存为图片');
      if (mode === 'cancel') assert.equal(await page.locator('#assetLocationDownloadStatus').isHidden(), true);
      else assert.match(await page.locator('#assetLocationDownloadStatus').innerText(), mode === 'failure' ? /磁盘空间不足/ : /保存窗口暂时不可用/);
      assert.equal(await page.evaluate(() => exportCalls.length), 1);
    }
  } finally { await context.close(); }
});

test('preview-only and missing original never export a thumbnail', async () => {
  const { page, context } = await open({ mode: 'missing' });
  try {
    await card(page, '仅有预览').locator('[data-asset-download]').click();
    assert.match(await page.locator('#assetToast').innerText(), /只保留了预览/);
    await card(page, '原始大图').locator('[data-asset-download]').click();
    await page.waitForFunction(() => !document.querySelector('[data-asset-download]').disabled);
    assert.match(await page.locator('#assetToast').innerText(), /未找到原图/);
    assert.deepEqual(await page.evaluate(() => exportCalls), []);
    assert.deepEqual(await page.evaluate(() => mediaReads), ['full-original']);
  } finally { await context.close(); }
});

test('transparent assets use processed original and pending save suppresses duplicates', async () => {
  const { page, context } = await open({ mode: 'pending' });
  try {
    await card(page, '透明图片').locator('[data-asset-download]').click();
    await page.waitForFunction(() => !!window.finishExport);
    assert.equal(await page.locator('[data-asset-download]:disabled').count(), 3);
    await card(page, '透明图片').locator('[data-asset-location]').click();
    assert.equal(await page.locator('#assetLocationDownload').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => mediaReads), ['alpha-original']);
    assert.equal(await page.evaluate(() => exportCalls[0].source), await page.evaluate(() => testTransparent));
    await page.evaluate(() => finishExport({ success: false, canceled: true }));
    await page.waitForFunction(() => !document.querySelector('#assetLocationDownload').disabled);
    assert.equal(await page.evaluate(() => exportCalls.length), 1);
  } finally { await context.close(); }
});
