const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../desktop-client/node_modules/playwright');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
const sourceFor = file => fs.readFileSync(path.join(app, file), 'utf8').replace(/\r\n/g, '\n');
function extract(source, name) {
  const match = new RegExp('^( +)(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf('\n' + match[1] + '}', match.index) + match[1].length + 2);
}

test('unsupported masked generation, batch planning and regeneration stop before requests or pending nodes without changing the selected model', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const page = await browser.newPage();
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(app, 'ai-node-canvas-test.html')).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
    const results = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      c.getContext('2d').fillRect(0, 0, 32, 32); const image = c.toDataURL();
      let networkRequests = 0, planRequests = 0;
      apiProfileForModel = () => ({ url: 'https://offline.invalid/v1', key: 'test', id: 'main' });
      fetchMaybeProxied = async () => { networkRequests++; throw Error('No paid calls allowed'); };
      analyzeAutoSplitPlan = async () => { planRequests++; throw Error('No plan calls allowed'); };
      const results = [];
      for (const model of ['Nano Banana2', 'Nano BananaPro', 'grok-imagine-image-2.0']) {
        nodes = []; links = [];
        const node = createNode('generator', 0, 0, { model, resolution: '2K', prompt: '透明背景，局部修改', autoSplit: true, references: [{ url: image, maskUrl: image, maskSelectionUrl: image, width: 32, height: 32 }], _deferRender: true });
        await generateFromNode(node.id);
        const generated = { selected: node.model, status: node.status, pendingNodes: nodes.filter(n => n.type === 'result').length, sourcePreserved: node.references[0].url === image && node.references[0].maskUrl === image };
        let directError = '', builderError = '';
        try { await callApi(node); } catch (e) { directError = e.message; }
        try { await buildApiRequest(node, node.references); } catch (e) { builderError = e.message; }
        const result = createNode('result', 300, 0, { model, mediaType: 'image', mediaUrl: image, fullUrl: image, width: 32, height: 32, _deferRender: true });
        links.push({ from: node.id, to: result.id });
        await regenerateResultNode(result.id);
        results.push({ model, generated, directError, builderError, afterRetryNodes: nodes.length, afterRetrySelected: node.model });
      }
      return { results, networkRequests, planRequests };
    });
    assert.equal(results.networkRequests, 0); assert.equal(results.planRequests, 0);
    for (const entry of results.results) {
      assert.equal(entry.generated.selected, entry.model); assert.equal(entry.afterRetrySelected, entry.model);
      assert.equal(entry.generated.pendingNodes, 0); assert.equal(entry.afterRetryNodes, 2);
      assert.equal(entry.generated.sourcePreserved, true);
      for (const message of [entry.generated.status, entry.directError, entry.builderError]) assert.match(message, /当前局部重绘功能仅支持 GPT/);
    }
  } finally { await browser.close(); }
});

for (const file of ['ai-node-canvas-test.html', 'ai-node-canvas.html']) test(`${file}: stable Gemini IDs use native requests; Lite is capped and exact custom/outpaint targets survive`, async () => {
  const source = sourceFor(file); let payload, endpoint;
  const c = vm.createContext({ imageResolutionOptions: ['1K', '2K', '4K'], modelLabelWithoutChannel: value => value, ratioKey: value => String(value).split(' ')[0], parseSize: value => { const [width,height] = value.split('x').map(Number); return { width, height }; }, defaultApiBaseUrl: () => '', referenceToGeminiImagePart: () => null,
    fetchMaybeProxied: async (url, init) => { endpoint = url; payload = JSON.parse(init.body); return new Response(JSON.stringify({ url: 'data:image/png;base64,AA==' })); }, Response,
    extractMediaUrl: data => data.url, extractMediaUrls: data => [data.url], createOutpaintGuide: async () => ({ imageUrl: 'data:image/png;base64,AA==' }) });
  vm.runInContext(['modelToApiModel', 'isNanoBananaModel', 'isOneKOnlyImageModel', 'imageResolutionOptionsForModel', 'greatestCommonDivisor', 'ratioLabelFromSize', 'nanoBananaImageSettings', 'normalizeGeminiGenerateEndpoint', 'callNanoBananaApi'].map(n => extract(source, n)).join('\n'), c);
  for (const model of ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image']) {
    assert.equal(c.isNanoBananaModel(model), true);
    const lite = model.includes('lite');
    assert.deepEqual(Array.from(c.imageResolutionOptionsForModel(model)), lite ? ['1K'] : ['1K', '2K', '4K']);
    for (const resolution of ['1K', '2K', '4K']) {
      const node = { type: 'generator', model, resolution, ratio: '16:9 横屏', _targetSize: '1920x1080', prompt: 'test' };
      await c.callNanoBananaApi(node, [], 'https://offline.invalid/v1', {});
      assert.match(endpoint, new RegExp('/' + model.replaceAll('.', '\\.') + ':generateContent$'));
      assert.equal(payload.generationConfig.imageConfig.imageSize, lite ? '1K' : resolution);
      assert.equal(payload.generationConfig.imageConfig.aspectRatio, '16:9');
      assert.equal(c.nanoBananaImageSettings({ ...node, ratio: '自定义尺寸' }, '1200x1800').size, '1200x1800');
      assert.equal(c.nanoBananaImageSettings({ ...node, type: 'outpaint' }, '1200x1800').size, '1200x1800');
    }
  }
  assert.equal(c.modelToApiModel('Nano Banana2'), 'gemini-3.1-flash-image-preview');
  assert.equal(c.modelToApiModel('Nano BananaPro'), 'gemini-3-pro-image-preview');
  assert.equal(c.isNanoBananaModel('unverified-image-model'), false);
});

test('workbench actual fetch adapter sends independent Grok resolution/aspect and native stable Gemini capabilities', async () => {
  const source = sourceFor('image-workbench/customize.js');
  let model = 'grok-imagine-image-2.0', quality = 'medium', rawSize = '1920x1080', sizeSource = 'quality', captured;
  const c = vm.createContext({ window: {}, Headers, Response,
    QUALITY_OPTIONS: [{ value: 'low', label: '1k' }, { value: 'medium', label: '2k' }, { value: 'high', label: '4k' }], RESOLUTION_EDGE: { low: 1024, medium: 2048, high: 4096 }, COMMON_ASPECTS: [[1, 1], [16, 9], [9, 16], [2, 3], [3, 2]],
    readModel: () => model, readQuality: () => quality, readRawVisibleSize: () => rawSize, readResolutionSource: () => sizeSource, writeTargetSize: () => {},
    nativeFetch: async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }] })); }
  });
  vm.runInContext(source.slice(source.indexOf('  const MODEL_OPTIONS'), source.indexOf('  const SIZE_OPTIONS')), c);
  vm.runInContext(['normalizeModelName', 'modelToApiModel', 'isNanoBananaModel', 'qualityOptionsForModel', 'parseSizeText', 'formatSize', 'nearestCommonAspect', 'sizeForQuality', 'qualityFromSize', 'qualityLabel', 'apiSafeGenerationSize', 'isGoogleModel', 'grokImageAspectRatio', 'normalizeImageBody', 'nanoBananaImageConfig', 'normalizeGeminiGenerateEndpoint', 'collectImageDataUrls', 'dataUrlToGeminiPart', 'extractNanoBananaImage', 'requestNanoBananaImage', 'isImageRequest'].map(n => extract(source, n)).join('\n'), c);
  vm.runInContext('MODEL_OPTIONS.push("grok-imagine-image-2.0", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-3.1-flash-lite-image");', c);
  const start = source.indexOf('  window.fetch = async function (input, init) {'), end = source.indexOf('\n  };', start) + '\n  };'.length;
  vm.runInContext(source.slice(start, end), c);
  const send = () => c.window.fetch('https://offline.invalid/v1/images/generations', { body: JSON.stringify({ model, prompt: 'test', size: rawSize }) });
  for (const [selectedQuality, resolution] of [['low', '1k'], ['medium', '2k'], ['high', '2k']]) {
    quality = selectedQuality; await send(); assert.equal(captured.body.resolution, resolution); assert.equal(captured.body.aspect_ratio, '16:9');
  }
  rawSize = '1200x1800'; sizeSource = 'size'; await send();
  assert.equal(captured.body.size, rawSize); assert.equal(captured.body.aspect_ratio, '2:3');
  assert.equal(c.grokImageAspectRatio('5000x2000'), '5:2');
  assert.equal(c.grokImageAspectRatio('900x2100'), 'auto');
  for (model of ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image']) {
    rawSize = '1920x1080'; sizeSource = 'quality'; quality = 'high'; await send();
    assert.match(captured.url, /:generateContent$/); assert.ok(captured.url.includes(model));
    assert.equal(captured.body.generationConfig.imageConfig.imageSize, model.includes('lite') ? '1K' : '4K');
    assert.equal(captured.body.generationConfig.imageConfig.aspectRatio, '16:9');
  }
});
