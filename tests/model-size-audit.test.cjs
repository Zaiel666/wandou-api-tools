const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = process.env.WANDOU_TEST_APP_ROOT || path.resolve(__dirname, '../app');
const files = ['ai-node-canvas-test.html', 'ai-node-canvas.html', 'image-workbench/customize.js'];
const sources = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(app, file), 'utf8').replace(/\r\n/g, '\n')]));

function extract(source, name) {
  const match = new RegExp('^( +)(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, name);
  const end = source.indexOf('\n' + match[1] + '}', match.index) + match[1].length + 2;
  return source.slice(match.index, end);
}

test('canvas and workbench GPT requests obey all size limits after rounding', () => {
  for (const file of files) {
    const source = sources[file];
    const context = vm.createContext({});
    const parse = file.endsWith('.js') ? 'parseSizeText' : 'parseSize';
    vm.runInContext(extract(source, parse) + '\n' + extract(source, 'apiSafeGenerationSize'), context);
    const cases = ['100x100', '100x300', '100x970', '1024x341', '2048x1365', '4096x4096', '8192x100', '3840x2160'];
    if (file.endsWith('.html')) cases.push('64x192', '64x97', '8192x64');
    for (let width = 100; width < 8192; width += 127) {
      for (let height = 100; height < 8192; height += 251) cases.push(`${width}x${height}`);
    }
    for (const input of cases) {
      const output = context.apiSafeGenerationSize(input);
      const [width, height] = output.split('x').map(Number);
      const message = `${file}: ${input} -> ${output}`;
      assert.equal(width % 16, 0, message);
      assert.equal(height % 16, 0, message);
      assert.ok(width <= 3840 && height <= 3840, message);
      assert.ok(width * height >= 655360 && width * height <= 8294400, message);
      assert.ok(Math.max(width / height, height / width) <= 3, message);
    }
    assert.equal(context.apiSafeGenerationSize('4096x4096'), '2880x2880');
    assert.equal(context.apiSafeGenerationSize('3840x2160'), '3840x2160');
  }
});

test('known one-K-only models cannot advertise larger native resolution tiers', () => {
  for (const file of files.filter(file => file.endsWith('.html'))) {
    const c = vm.createContext({ imageResolutionOptions: ['1K', '2K', '4K'], modelToApiModel: value => value });
    vm.runInContext(['imageResolutionOptionsForModel', 'isOneKOnlyImageModel'].map(name => extract(sources[file], name)).join('\n'), c);
    assert.deepEqual(Array.from(c.imageResolutionOptionsForModel('gpt-image-2.5-1k')), ['1K']);
    assert.deepEqual(Array.from(c.imageResolutionOptionsForModel('grok-imagine-image-2.0')), ['1K', '2K']);
    assert.deepEqual(Array.from(c.imageResolutionOptionsForModel('gpt-image-2.5-flare')), ['1K', '2K', '4K']);
  }
  let model = 'gpt-image-2.5-1k';
  const c = vm.createContext({ QUALITY_OPTIONS: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }], readModel: () => model, modelToApiModel: value => value, localStorage: { getItem: () => 'high' } });
  vm.runInContext(['qualityOptionsForModel', 'readQuality'].map(name => extract(sources[files[2]], name)).join('\n'), c);
  assert.equal(c.readQuality(), 'low');
  model = 'grok-imagine-image-2.0';
  assert.deepEqual(Array.from(c.qualityOptionsForModel(), option => option.value), ['low', 'medium']);
  assert.equal(c.readQuality(), 'medium');
});

test('workbench requests respect model tiers and send Banana aspect ratios without GPT pixel limits', async () => {
  const source = sources[files[2]];
  let model = 'gpt-image-2.5-1k', quality = 'high', rawSize = '4096x4096', payload;
  const options = [{ value: 'low', label: '1k' }, { value: 'medium', label: '2k' }, { value: 'high', label: '4k' }];
  const c = vm.createContext({
    Headers, Response, QUALITY_OPTIONS: options, RESOLUTION_EDGE: { low: 1024, medium: 2048, high: 4096 }, COMMON_ASPECTS: [[1, 1], [16, 9], [2, 3]], window: {},
    readModel: () => model, readQuality: () => quality, readRawVisibleSize: () => rawSize, readResolutionSource: () => 'quality',
    modelToApiModel: value => value, writeTargetSize: () => {},
    collectImageDataUrls: () => [], dataUrlToGeminiPart: value => value, normalizeGeminiGenerateEndpoint: () => 'https://example.invalid/generateContent',
    nativeFetch: async (_url, init) => { payload = JSON.parse(init.body); return new Response('{}'); }, extractNanoBananaImage: () => 'data:image/png;base64,AA=='
  });
  vm.runInContext(['parseSizeText', 'formatSize', 'nearestCommonAspect', 'sizeForQuality', 'qualityFromSize', 'qualityLabel', 'qualityOptionsForModel', 'apiSafeGenerationSize', 'isGoogleModel', 'normalizeImageBody', 'nanoBananaImageConfig', 'requestNanoBananaImage'].map(name => extract(source, name)).join('\n'), c);
  const oneK = c.normalizeImageBody({ prompt: 'offline test', model, size: rawSize });
  assert.equal(oneK.quality, 'low');
  assert.equal(oneK.size, '1024x1024');
  model = 'gpt-image-2';
  const gpt = c.normalizeImageBody({ prompt: 'offline test', model, size: rawSize });
  assert.equal(gpt.size, '2880x2880');
  for (model of ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview']) {
    for (const [selected, expectedTier] of [['low', '1K'], ['medium', '2K'], ['high', '4K']]) {
      quality = selected;
      rawSize = '1920x1080';
      await c.requestNanoBananaImage('', {}, { prompt: 'offline test', model, size: rawSize });
      assert.equal(payload.generationConfig.imageConfig.imageSize, expectedTier);
      assert.equal(payload.generationConfig.imageConfig.aspectRatio, '16:9');
    }
    quality = 'high';
    rawSize = '4096x4096';
    const native = c.normalizeImageBody({ prompt: 'offline test', model, size: rawSize });
    assert.equal(native.size, '4096x4096', 'Google must not be restricted by GPT max pixels');
  }
  assert.equal(c.nanoBananaImageConfig({ resolution: '2k', targetSize: '1000x700' }).aspectRatio, undefined);
  assert.equal(c.nanoBananaImageConfig({ resolution: '2k', targetSize: '3600x1200' }).aspectRatio, undefined);
});

test('changing generation controls does not relabel or resample an existing workbench result', async () => {
  const source = sources[files[2]];
  let currentSize = '4096x4096';
  let reads = 0;
  const original = new Blob(['original-image-bytes'], { type: 'image/png' });
  const image = { src: 'data:image/png;base64,thumbnail', naturalWidth: 256, naturalHeight: 128, complete: true, getAttribute: () => 'stored-result' };
  const record = { width: 1376, height: 768, dataUrl: 'data:image/png;base64,original' };
  const label = { textContent: '4096×4096' };
  const c = vm.createContext({
    Blob, Date, WeakMap, displayedImageDimensions: new WeakMap(),
    readFullImageRecord: async () => { reads++; return record; },
    readCurrentOutputSize: () => { throw new Error('Must not read current control: ' + currentSize); },
    nativeFetch: async value => { assert.equal(value, record.dataUrl); return { blob: async () => original }; },
    imageExtension: () => 'png', findDownloadImage: () => image,
    sizeTextElements: () => [{ item: label }], normalizeText: item => item.textContent,
    SIZE_TEXT_PATTERN: /(\d{3,5})\s*[x×]\s*(\d{3,5})/i,
    document: { querySelectorAll: () => [{}] }
  });
  vm.runInContext(['actualWorkbenchImageSize', 'updateDisplayedImageSizes', 'buildWorkbenchImageBlob'].map(name => extract(source, name)).join('\n'), c);
  c.updateDisplayedImageSizes();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(label.textContent, '1376×768');
  assert.equal(reads, 1);
  currentSize = '1024x1024';
  c.updateDisplayedImageSizes();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(label.textContent, '1376×768');
  assert.equal(reads, 1, 'cached dimensions avoid repeated reads of the full stored image');
  const download = await c.buildWorkbenchImageBlob({}, image);
  assert.equal(download.blob, original);
  assert.equal(await download.blob.text(), 'original-image-bytes');
});

test('workbench generation proceeds without a file-system picker and does not auto-export', async () => {
  const source = sources[files[2]];
  const start = source.indexOf('  window.fetch = async function (input, init) {');
  const end = source.indexOf('\n  };', start) + '\n  };'.length;
  let fetches = 0;
  const c = vm.createContext({ window: {}, isImageRequest: () => true, isNanoBananaModel: () => false, readModel: () => 'gpt-image-2', normalizeImageBody: value => value, nativeFetch: async () => { fetches++; return { ok: true }; } });
  vm.runInContext(source.slice(start, end), c);
  await c.window.fetch('https://example.invalid/images/generations', { body: JSON.stringify({ prompt: 'test', model: 'gpt-image-2', size: '1024x1024' }) });
  assert.equal(fetches, 1);
  assert.doesNotMatch(extract(source, 'runDownloadEnhancements'), /autoSave|writeBlobToAutoSaveDirectory/);
  assert.doesNotMatch(extract(source, 'ensureAutoSaveControl'), /showDirectoryPicker|chooseAutoSaveDirectory/);
});
