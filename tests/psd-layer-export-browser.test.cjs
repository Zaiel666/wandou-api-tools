const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/ai-node-canvas.html')).href);

    await page.locator('[data-add-node="image"]').click();
    assert.equal(await page.locator('.node.image').last().evaluate((element) => getComputedStyle(element).width), '520px');
    assert.equal(await page.locator('.node.image').last().locator('[data-resize-corner]').count(), 4, 'reference resizing must remain available');

    await page.locator('[data-add-node="psd"]').click();
    assert.equal(await page.locator('.node.psd').count(), 1);
    assert.equal(await page.locator('[data-menu-node="psd"]').count(), 1);
    assert.equal(await page.locator('.node.psd [data-psd-upload]').count(), 1);
    assert.match(await page.locator('.node.psd [data-psd-model-toggle]').innerText(), /gpt-image-2\.5-1k/, 'PSD must default to the configured GPT image model instead of a hardcoded GPT-image-2');
    const previewSize = await page.locator('.node.psd .psd-source-preview').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [rect.width, rect.height, getComputedStyle(element.querySelector('img') || element).objectFit];
    });
    assert.ok(Math.abs(previewSize[0] - previewSize[1]) < 1, 'the entire source must sit inside a square preview');
    await page.locator('.node.psd [data-psd-generate]').click();
    assert.match(await page.locator('.node.psd .status').innerText(), /请先上传图片或连接参考图/);

    const result = await page.evaluate(async () => {
      const original = document.createElement('canvas');
      original.width = 100;
      original.height = 80;
      const context = original.getContext('2d');
      context.fillStyle = '#ed233c';
      context.fillRect(0, 0, 100, 80);
      const source = createNode('image', 0, 0, {
        references: [{ url:original.toDataURL('image/png'), mediaType:'image', width:100, height:80 }],
        _deferRender: true,
      });
      const node = nodes.find((item) => item.type === 'psd');
      links.push({ from:source.id, to:node.id });
      apiKeyInput.value = 'test-only-key';
      const realCallApi = callApi;
      const realVision = postChatCompletion;
      let requests = 0;
      let visionRequests = 0;
      const requestModels = [];
      postChatCompletion = async () => {
        visionRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 1250));
        return { text:JSON.stringify({ layers:[
          { name:'人物', category:'subject' },
          { name:'标题', category:'text' },
          { name:'角标', category:'element' },
          { name:'光效', category:'lighting' },
        ] }) };
      };
      callApi = async (request) => {
        requests += 1;
        requestModels.push({ model:request.model, masked:Boolean(request._psdLayerJob) });
        if (requests === 1) await new Promise((resolve) => setTimeout(resolve, 1000));
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');
        if (request.transparentBackground) {
          ctx.fillStyle = '#000';
          if (request.prompt.includes('人物')) ctx.fillRect(10, 15, 20, 25);
          else if (request.prompt.includes('标题')) ctx.fillRect(60, 20, 25, 15);
          else if (request.prompt.includes('角标')) ctx.fillRect(5, 5, 8, 8);
          else ctx.fillRect(70, 55, 20, 15);
        } else {
          ctx.fillStyle = '#277da1';
          ctx.fillRect(0, 0, 100, 80);
        }
        return { url:canvas.toDataURL('image/png'), fromApi:true, mediaType:'image' };
      };
      let initialCountdown = '';
      let tickedCountdown = '';
      let plannedCountdown = '';
      try {
        const job = generatePsdFromNode(node.id);
        initialCountdown = canvas.querySelector('.node.psd [data-psd-countdown]')?.textContent || '';
        await new Promise((resolve) => setTimeout(resolve, 1100));
        tickedCountdown = canvas.querySelector('.node.psd [data-psd-countdown]')?.textContent || '';
        await new Promise((resolve) => setTimeout(resolve, 400));
        plannedCountdown = canvas.querySelector('.node.psd [data-psd-countdown]')?.textContent || '';
        await job;
      } finally {
        callApi = realCallApi;
        postChatCompletion = realVision;
      }
      const exported = psdExportFiles.get(node.id);
      if (!exported) return { error:node.status };
      const buffer = await exported.blob.arrayBuffer();
      const psd = agPsd.readPsd(buffer, { useImageData:true });
      const pixel = (layer, x, y) => {
        const data = layer.imageData.data;
        const index = (y * 100 + x) * 4;
        return Array.from(data.slice(index, index + 4));
      };
      return {
        requests,
        requestModels,
        visionRequests,
        initialCountdown,
        tickedCountdown,
        plannedCountdown,
        names:psd.children.map((layer) => layer.name),
        hidden:psd.children.map((layer) => Boolean(layer.hidden)),
        size:[psd.width, psd.height],
        bytes:buffer.byteLength,
        subjectPixel:pixel(psd.children[0], 15, 20),
        subjectOutside:pixel(psd.children[0], 50, 40),
        repairedInside:pixel(psd.children[4], 15, 20),
        originalOutside:pixel(psd.children[4], 50, 40),
      };
    });

    assert.equal(result.error, undefined, result.error);
    assert.equal(result.visionRequests, 1, 'the source should be analyzed automatically');
    assert.match(result.initialCountdown, /图层分析预计剩余约 \d{2}:\d{2}.*总时长稍后估算/, 'the estimate should appear as generation begins');
    assert.notEqual(result.initialCountdown, result.tickedCountdown, 'the countdown should visibly tick while analysis is pending');
    assert.match(result.plannedCountdown, /图像处理 0\/5/, 'the estimate should update after discovering the layer count');
    assert.equal(result.requests, 5, 'four detected objects and one background repair should be requested');
    assert.ok(result.requestModels.every((request) => request.model === 'gpt-image-2.5-1k'), 'all PSD image stages should use the selected model');
    assert.equal(result.requestModels.filter((request) => request.masked).length, 1, 'background repair should use the selected model even with a mask');
    assert.deepEqual(result.names, ['人物', '标题', '角标', '光效', '修补背景', '原图备份（隐藏）']);
    assert.deepEqual(result.hidden, [false, false, false, false, false, true]);
    assert.deepEqual(result.size, [100, 80]);
    assert.equal(await page.locator('.node.psd .psd-source-preview img').evaluate((element) => getComputedStyle(element).objectFit), 'contain', 'uploaded or linked images must remain fully visible');
    assert.ok(result.bytes > 500, 'PSD must contain actual layer data');
    assert.deepEqual(result.subjectPixel, [237, 35, 60, 255], 'subject layer must retain original pixels');
    assert.equal(result.subjectOutside[3], 0, 'subject layer must be transparent outside its mask');
    assert.deepEqual(result.repairedInside, [39, 125, 161, 255], 'removed subject area should contain repaired background');
    assert.deepEqual(result.originalOutside, [237, 35, 60, 255], 'unmasked background should preserve original pixels');
    assert.equal(await page.locator('.node.psd [data-psd-download]').count(), 1);
    assert.equal(await page.locator('.node.psd [data-psd-countdown]').count(), 0, 'finished jobs must stop and remove the countdown');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.node.psd [data-psd-download]').click(),
    ]);
    assert.match(download.suggestedFilename(), /\.psd$/i);
    await page.evaluate(() => {
      const node = nodes.find((item) => item.type === 'psd');
      const updated = document.createElement('canvas');
      updated.width = 100; updated.height = 80;
      updated.getContext('2d').fillRect(0, 0, 100, 80);
      node.references = [{ url:updated.toDataURL('image/png'), mediaType:'image', width:100, height:80 }];
      render();
    });
    assert.equal(await page.locator('.node.psd [data-psd-download]').count(), 0, 'changing the source should invalidate stale PSD');
    const timeoutResult = await page.evaluate(async () => {
      const controller = new AbortController();
      try { await runPsdStage(controller, () => new Promise(() => {}), '图层分析', 30); }
      catch (error) { return { aborted:controller.signal.aborted, message:error.message }; }
      return { aborted:false, message:'' };
    });
    assert.equal(timeoutResult.aborted, true, 'a hung provider request must be interrupted by a stage timeout');
    assert.match(timeoutResult.message, /图层分析超过.*已停止等待/);
    const bridgeAbort = await page.evaluate(async () => {
      const originalBridge = window.wandouDesktopApi;
      const originalClassifier = isDesktopApiEndpoint;
      let cancelledId = '';
      window.wandouDesktopApi = {
        fetch: () => new Promise(() => {}),
        cancel: (requestId) => { cancelledId = requestId; },
      };
      isDesktopApiEndpoint = () => true;
      const controller = new AbortController();
      const pending = fetchMaybeProxied('https://example.test/v1/images/generations', { signal:controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort(new Error('test cancel'));
      let message = '';
      try { await pending; } catch (error) { message = error.message; }
      window.wandouDesktopApi = originalBridge;
      isDesktopApiEndpoint = originalClassifier;
      return { cancelledId, message };
    });
    assert.match(bridgeAbort.cancelledId, /^canvas-/, 'desktop IPC requests must receive cancellation IDs');
    assert.equal(bridgeAbort.message, 'test cancel', 'desktop requests must stop waiting when aborted');

    await page.evaluate(() => {
      const node = nodes.find((item) => item.type === 'psd');
      window.__originalPsdVision = postChatCompletion;
      postChatCompletion = () => new Promise(() => {});
      window.__stalledPsdJob = generatePsdFromNode(node.id);
    });
    await page.locator('.node.psd [data-psd-cancel]').waitFor();
    assert.equal(await page.locator('.node.psd [data-psd-countdown]').count(), 1, 'a pending request must show progress and a cancel action');
    await page.locator('.node.psd [data-psd-cancel]').click();
    await page.evaluate(async () => {
      await window.__stalledPsdJob;
      postChatCompletion = window.__originalPsdVision;
    });
    assert.match(await page.locator('.node.psd .status').innerText(), /PSD 生成已取消/);
    assert.equal(await page.locator('.node.psd [data-psd-countdown]').count(), 0, 'cancelling must stop the countdown');
    assert.equal(await page.locator('.node.psd [data-psd-generate]').isEnabled(), true, 'the node should be retryable');

    const recoveredStatus = await page.evaluate(() => {
      const node = nodes.find((item) => item.type === 'psd');
      node.status = '正在智能分析主体、文字、元素与光效...';
      render();
      return node.status;
    });
    assert.match(recoveredStatus, /上次 PSD 生成已中断/, 'a restored status must not pretend that a job is still running');
    await page.evaluate(() => {
      const node = nodes.find((item) => item.type === 'psd');
      setPsdJobMarker(node.id, '图层分析');
      node.status = '正在智能分析主体、文字、元素与光效...';
      saveCanvasStateImmediate();
    });
    await page.reload();
    assert.match(await page.locator('.node.psd .status').innerText(), /页面运行意外停止.*图层分析.*请保持页面打开并重试/, 'reloaded jobs must explain which stage was interrupted');
    assert.equal(await page.locator('.node.psd [data-psd-generate]').isEnabled(), true, 'a reloaded job should be retryable');
    assert.deepEqual(errors, []);
    console.log('PASS: compact reference node and layered PSD export');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
