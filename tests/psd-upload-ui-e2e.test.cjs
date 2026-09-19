const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    const page = await browser.newPage({ acceptDownloads:true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/ai-node-canvas.html')).href);
    await page.locator('[data-add-node="psd"]').click();

    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 160;
      const context = canvas.getContext('2d');
      context.fillStyle = '#142642'; context.fillRect(0, 0, 240, 160);
      context.fillStyle = '#ee5665'; context.fillRect(80, 35, 75, 100);
      context.fillStyle = '#fff'; context.font = 'bold 20px sans-serif'; context.fillText('TEST', 15, 27);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('.node.psd [data-psd-upload]').setInputFiles({ name:'psd-upload-test.png', mimeType:'image/png', buffer:Buffer.from(image, 'base64') });
    assert.equal(await page.locator('.node.psd .psd-source-preview img').count(), 1, 'file selection should create a visible uploaded preview');
    assert.match(await page.locator('.node.psd .status').innerText(), /图片已上传/);
    assert.match(await page.locator('.node.psd [data-psd-model-toggle]').innerText(), /gpt-image-2\.5-sunburst$/);
    const maskedModel = await page.evaluate(async () => {
      const node = nodes.find((item) => item.type === 'psd');
      const source = psdSourceReference(node);
      const mask = document.createElement('canvas'); mask.width = 240; mask.height = 160;
      const maskReference = { ...source, maskUrl:mask.toDataURL('image/png'), maskSelectionUrl:mask.toDataURL('image/png'), maskWidth:240, maskHeight:160 };
      const request = await buildApiRequest({ type:'generator', model:node.model, resolution:'1K', count:1, _psdLayerJob:true, _apiTargetSize:'240x160', prompt:'修补背景' }, [maskReference]);
      return request.body.get('model');
    });
    assert.equal(maskedModel, 'gpt-image-2.5-sunburst', 'masked background repair must use the verified highest-quality edit model');
    const visionCandidates = await page.evaluate(() => {
      const existing = assistantModelOptions;
      assistantModelOptions = ['gpt-image-2.5-1k', 'glm-4.6v', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-5.6-sol'];
      const choices = psdVisionModelCandidates();
      assistantModelOptions = existing;
      return choices;
    });
    assert.deepEqual(visionCandidates, ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna'], 'all synced GPT vision models should be tried from highest quality to fastest tier');
    assert.ok(!visionCandidates.includes('glm-4.6v'), 'PSD analysis should use GPT vision models only');
    assert.ok(!visionCandidates.includes('gpt-image-2.5-1k'), 'image generation models cannot analyze an image as chat JSON');
    const visionTimeouts = await page.evaluate(() => ({
      primary:psdVisionAttemptTimeoutMs('gpt-6-astra', 0),
      fallback:psdVisionAttemptTimeoutMs('gpt-5.6-sol', 1),
      stage:psdVisionStageTimeoutMs,
    }));
    assert.equal(visionTimeouts.primary, 300000, 'the highest-quality GPT vision request should have up to five minutes');
    assert.equal(visionTimeouts.fallback, 90000, 'fallback models should still have enough time for a large image');
    assert.equal(visionTimeouts.stage, 590000, 'the complete vision fallback stage must remain within ten minutes');

    await page.evaluate(() => {
      apiKeyInput.value = 'isolated-ui-test-key';
      window.__realPostChatCompletion = postChatCompletion;
      const realGenerate = generatePsdFromNode;
      generatePsdFromNode = (...args) => {
        window.__psdUiJob = realGenerate(...args);
        return window.__psdUiJob;
      };
      postChatCompletion = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { text:JSON.stringify({ layers:[
          { name:'红色主体', category:'subject' },
          { name:'TEST 标题', category:'text' },
        ] }) };
      };
      callApi = async (request) => {
        const canvas = document.createElement('canvas');
        canvas.width = 240; canvas.height = 160;
        const context = canvas.getContext('2d');
        if (request._psdObjectMaskJob) {
          context.fillStyle = '#000';
          context.fillRect(0, 0, 240, 160);
          context.fillStyle = '#fff';
          if (request.prompt.includes('红色主体')) context.fillRect(80, 35, 75, 100);
          else context.fillRect(12, 8, 80, 24);
        } else {
          context.fillStyle = '#142642'; context.fillRect(0, 0, 240, 160);
        }
        return { url:canvas.toDataURL('image/png'), mediaType:'image', fromApi:true };
      };
    });

    const downloadPromise = page.waitForEvent('download', { timeout:30000 });
    await page.locator('.node.psd [data-psd-generate]').click();
    assert.equal(await page.locator('.node.psd [data-psd-cancel]').count(), 1, 'real button click should enter running state');
    assert.match(await page.locator('.node.psd [data-psd-countdown]').innerText(), /图层分析预计剩余/);
    const download = await downloadPromise;
    await page.evaluate(() => window.__psdUiJob);
    assert.match(download.suggestedFilename(), /\.psd$/i);
    const result = await page.evaluate(() => {
      const node = nodes.find((item) => item.type === 'psd');
      const exported = psdExportFiles.get(node.id);
      return { status:node.status, layers:exported?.layerNames, marker:getPsdJobMarker(node.id), busy:psdJobs.has(node.id) };
    });
    assert.match(result.status, /PSD 已生成/);
    assert.deepEqual(result.layers, ['红色主体', 'TEST 标题', '修补背景', '原图备份（隐藏）']);
    assert.equal(result.marker, null, 'completed jobs must leave no stale interruption marker');
    assert.equal(result.busy, false);
    if (process.env.PSD_UI_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.PSD_UI_ARTIFACT_DIR, { recursive:true });
      await download.saveAs(path.join(process.env.PSD_UI_ARTIFACT_DIR, 'psd-ui-test.psd'));
      await page.locator('.node.psd').screenshot({ path:path.join(process.env.PSD_UI_ARTIFACT_DIR, 'psd-ui-test.png') });
    }

    let receivedVisionImage = false;
    const visionModels = [];
    let rejectAllVision = false;
    await page.route('https://mock-psd.test/**', async (route) => {
      const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'authorization, content-type', 'access-control-allow-methods':'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status:204, headers });
      const payload = route.request().postDataJSON();
      visionModels.push(payload.model);
      receivedVisionImage ||= payload.messages?.[1]?.content?.some((item) => item.type === 'image_url' && item.image_url.url.startsWith('data:image/jpeg;base64,'));
      if (!rejectAllVision && payload.model === 'gpt-6-astra') {
        return route.fulfill({ status:200, headers, contentType:'application/json', body:JSON.stringify({ choices:[{ message:{ content:'{"layers":[{"name":"红色主体","category":"subject"}]}' } }] }) });
      }
      await route.fulfill({ status:400, headers, contentType:'application/json', body:'{"error":"No available channel for model"}' });
    });
    await page.evaluate(() => {
      postChatCompletion = window.__realPostChatCompletion;
      apiUrlInput.value = 'https://mock-psd.test/v1';
    });
    const fallbackDownload = page.waitForEvent('download', { timeout:30000 });
    await page.locator('.node.psd [data-psd-generate]').click();
    await fallbackDownload;
    await page.evaluate(() => window.__psdUiJob);
    assert.equal(receivedVisionImage, true, 'vision endpoint should receive an uploaded image in the chat request');
    assert.equal(visionModels[0], 'gpt-6-astra', 'PSD analysis should start with the highest GPT vision model');
    assert.match(await page.locator('.node.psd .status').innerText(), /PSD 已生成/);
    rejectAllVision = true;
    await page.locator('.node.psd [data-psd-generate]').click();
    await page.evaluate(() => window.__psdUiJob);
    assert.match(await page.locator('.node.psd .status').innerText(), /视觉分析接口不可用。已尝试 gpt-6-astra.*gpt-5\.6-sol.*gpt-5\.6.*gpt-5\.6-terra.*支持 chat\/completions 图片输入的视觉模型/);
    assert.equal(await page.locator('.node.psd [data-psd-generate]').isEnabled(), true);
    await page.evaluate(() => {
      postChatCompletion = async () => ({ text:'{"layers":[{"name":"红色主体","category":"subject"}]}' });
      callApi = async () => { throw new Error('No available channel for model gpt-image-2.5-sunburst'); };
    });
    await page.locator('.node.psd [data-psd-generate]').click();
    await page.evaluate(() => window.__psdUiJob);
    assert.match(await page.locator('.node.psd .status').innerText(), /第 1 层“红色主体”遮罩生成（gpt-image-2\.5-sunburst）失败：接口后台没有开通当前选择的图片模型通道/);
    assert.equal(await page.locator('.node.psd [data-psd-generate]').isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: actual file upload, UI click, selected GPT model, downloadable PSD, and stage-specific provider errors');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
