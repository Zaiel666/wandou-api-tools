// Opt-in: real image requests incur the provider's usual generation charge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const sharp = require('sharp');

(async () => {
  const key = process.env.WANDOU_API_KEY;
  if (!key) { console.log('SKIP: real Grok API test requires WANDOU_API_KEY'); return; }
  const endpoint = 'https://www.zayapi.top/v1/images/generations';
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/ai-node-canvas.html')).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
    const results = [];
    for (const resolution of ['2K', '4K']) {
      const payload = await page.evaluate(async (resolution) => {
        const size = resolution === '2K' ? '2048x2048' : '4096x4096';
        return JSON.parse((await buildApiRequest({ type: 'generator', model: 'grok-imagine-image-2.0',
          prompt: 'A cute small tiger sitting on pale green grass, clean illustration, full body centered, no text or watermark.',
          resolution, ratio: '1:1', count: 1, _targetSize: size, _apiTargetSize: size }, [])).body);
      }, resolution);
      console.log(`START: Grok ${resolution}`);
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(240000) });
      const raw = await response.text();
      if (!response.ok) {
        const error = raw.replaceAll(key, '[redacted]').slice(0, 500);
        results.push({ resolution, status: response.status, error });
        console.log(JSON.stringify(results.at(-1)));
        continue;
      }
      const media = await page.evaluate(raw => extractMediaUrl(JSON.parse(raw)), raw);
      assert.ok(media, 'API returned no image');
      let bytes;
      if (media.startsWith('data:')) bytes = Buffer.from(media.slice(media.indexOf(',') + 1), 'base64');
      else {
        const imageResponse = await fetch(media, { signal: AbortSignal.timeout(60000) });
        assert.ok(imageResponse.ok, `image fetch HTTP ${imageResponse.status}`);
        bytes = Buffer.from(await imageResponse.arrayBuffer());
      }
      const meta = await sharp(bytes).metadata();
      const outputDir = path.resolve(__dirname, '../dist/grok-validation');
      fs.mkdirSync(outputDir, { recursive: true });
      await sharp(bytes).png().toFile(path.join(outputDir, `${resolution}.png`));
      results.push({ resolution, status: response.status, width: meta.width, height: meta.height, format: meta.format });
      console.log(JSON.stringify(results.at(-1)));
    }
    assert.ok(results.some(r => r.resolution === '2K' && r.status === 200 && Math.max(r.width, r.height) >= 2000), '2K native output was not verified');
    console.log('PASS: real Grok 2K output verified; 4K result recorded separately');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
