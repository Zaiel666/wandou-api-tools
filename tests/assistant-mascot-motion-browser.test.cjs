const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {pathToFileURL} = require('node:url');
const {chromium} = require('../desktop-client/node_modules/playwright');
const sharp = require('../desktop-client/node_modules/sharp');

const root = path.resolve(__dirname, '../app');
const output = path.resolve(__dirname, '../artifacts/mascot-motion');
const pageSource = fs.readFileSync(path.join(root, 'ai-node-canvas-test.html'), 'utf8');
const launcher = pageSource.match(/<button id="assistantToggleButton"[\s\S]*?<\/button>/)[0];
const fixture = `<!doctype html><html><head><link rel="stylesheet" href="/ai-node-canvas-test-controls.css">
<style>body{margin:0;background:#f5f5f5}#assistantToggleButton.assistant-launcher{position:absolute;left:20px;top:20px;width:300px;height:300px}.assistant-mascot-label{font-size:29px!important;line-height:40px!important}</style>
</head><body>${launcher}<script src="/assets/pea-assistant-portrait.js" defer></script><script src="/assistant-mascot-motion.js" defer></script></body></html>`;

async function raw(image) {
  return sharp(image).removeAlpha().raw().toBuffer({resolveWithObject: true});
}
function difference(a, b, from = 0, to = a.data.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / (to - from);
}

test('continuous mascot loop, stable nameplate, motion preferences, context recovery and launcher gestures', async () => {
  fs.mkdirSync(output, {recursive: true});
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/mascot-fixture.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(fixture);
    }
    const file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader('Content-Type', ({
        '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
        '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp'
      })[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const page = await browser.newPage({viewport:{width:640,height:540}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let id = 0, now = 0;
      const queue = new Map();
      window.requestAnimationFrame = fn => { queue.set(++id, fn); return id; };
      window.cancelAnimationFrame = id => queue.delete(id);
      window.motionClock = {
        pending: () => queue.size,
        advance: milliseconds => {
          const end = now + milliseconds;
          while (now < end) {
            now = Math.min(end, now + 1000 / 60);
            const tasks = [...queue.values()];
            queue.clear();
            for (const fn of tasks) fn(now);
          }
        }
      };
    });
    await page.goto(origin + '/mascot-fixture.html');
    const button = page.locator('#assistantToggleButton');
    await page.waitForSelector('[data-mascot-animated]');
    await page.evaluate(() => motionClock.advance(1000/60));
    const images = [], tiles = [];
    let last = 0;
    for (const [i, seconds] of [0, 1.8, 3.57, 3.65, 3.73, 5.7, 7.65, 8.4].entries()) {
      await page.evaluate(delta => motionClock.advance(delta), (seconds - last) * 1000);
      last = seconds;
      const image = await button.screenshot();
      images.push(await raw(image));
      fs.writeFileSync(path.join(output, `pose-${i}.png`), image);
      tiles.push({input:image, left:(i % 4)*300, top:Math.floor(i/4)*300});
    }
    await sharp({create:{width:1200,height:600,channels:4,background:'#f5f5f5'}})
      .composite(tiles).png().toFile(path.join(output,'motion-contact.png'));
    assert.ok(difference(images[0], images[1]) > .3, 'gaze and breathing visibly move');
    assert.ok(difference(images[0], images[3]) > .5, 'blink changes the expression');
    assert.ok(difference(images[0], images[7]) < .1, 'complete cycle meets its first frame');
    const plateStart = 245 * 300 * 3;
    for (const image of images) assert.ok(difference(images[0], image, plateStart) < .01, 'nameplate never deforms');
    await button.evaluate(el => el.dataset.mascotDragging = 'true');
    assert.equal(await page.evaluate(() => motionClock.pending()), 0, 'drag suspends rendering');
    const paused = await raw(await button.screenshot());
    await page.evaluate(() => motionClock.advance(5000));
    assert.equal(difference(paused, await raw(await button.screenshot())), 0);
    await button.evaluate(el => delete el.dataset.mascotDragging);
    assert.equal(await page.evaluate(() => motionClock.pending()), 1);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(() => motionClock.pending() === 0, null, {polling:50});
    assert.equal(await button.locator('img').evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.equal(await button.locator('canvas').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(() => motionClock.pending() === 1, null, {polling:50});
    await page.evaluate(() => {
      window.contextLoss = document.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context');
      contextLoss.loseContext();
    });
    await page.waitForFunction(() => !document.querySelector('[data-mascot-animated]'), null, {polling:50});
    assert.equal(await button.locator('img').evaluate(el => getComputedStyle(el).visibility), 'visible');
    await page.evaluate(() => contextLoss.restoreContext());
    await page.waitForSelector('[data-mascot-animated]');
    await page.waitForFunction(() => motionClock.pending() === 1, null, {polling:50});
    assert.deepEqual(errors, []);
    await page.close();

    // Exercise real canvas interactions with the browser's normal frame clock.
    const app = await browser.newPage({viewport:{width:1440,height:960}});
    app.on('pageerror', error => errors.push(error.message));
    await app.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => route.abort());
    await app.goto(origin + '/ai-node-canvas-test.html?workspace=production');
    await app.waitForSelector('body[data-canvas-ready="true"][data-test-ready="true"]');
    await app.waitForSelector('[data-mascot-animated]');
    const actual = app.locator('#assistantToggleButton');
    await app.evaluate(() => setAssistantOpen(false, false));
    await actual.click();
    assert.equal(await actual.getAttribute('aria-expanded'), 'true');
    assert.equal(await actual.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    const before = await actual.boundingBox();
    await app.mouse.move(before.x + 65, before.y + 65);
    await app.mouse.down();
    await app.mouse.move(500, 500, {steps:10});
    await app.mouse.up();
    assert.equal(await actual.getAttribute('aria-expanded'), 'true', 'drag does not toggle the panel');
    const after = await actual.boundingBox();
    assert.ok(Math.abs(before.x - after.x) > 50);
    await actual.focus();
    await app.keyboard.press('Enter');
    assert.equal(await actual.getAttribute('aria-expanded'), 'false');
    await app.mouse.move(900, 30);
    await actual.evaluate(el => el.blur());
    await app.screenshot({path:path.join(output, 'canvas-light.png')});
    await app.evaluate(() => document.body.classList.add('dark-theme'));
    await app.waitForTimeout(350);
    assert.equal(await actual.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await app.screenshot({path:path.join(output, 'canvas-dark.png')});
    await app.reload();
    await app.waitForSelector('body[data-canvas-ready="true"][data-test-ready="true"]');
    const restored = await actual.boundingBox();
    assert.ok(Math.abs(restored.x - after.x) < 1 && Math.abs(restored.y - after.y) < 1);
    await app.setViewportSize({width:390,height:700});
    const mobile = await actual.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 391);
    assert.ok(mobile.y >= 0 && mobile.y + mobile.height <= 701);
    assert.deepEqual(errors, []);
    await app.close();

    const local = await browser.newPage();
    await local.route(/^https?:/, route => route.abort());
    await local.goto(pathToFileURL(path.join(root, 'ai-node-canvas-test.html')).href);
    await local.waitForSelector('body[data-canvas-ready="true"][data-test-ready="true"]');
    await local.waitForSelector('[data-mascot-animated]');
    await local.close();

    const unavailable = await browser.newPage();
    await unavailable.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === 'webgl' ? null : getContext.call(this, type, ...args);
      };
    });
    await unavailable.goto(origin + '/mascot-fixture.html');
    await unavailable.waitForFunction(() => document.querySelector('img').naturalWidth > 0);
    assert.equal(await unavailable.locator('[data-mascot-animated]').count(), 0);
    assert.equal(await unavailable.locator('img').evaluate(el => getComputedStyle(el).visibility), 'visible');
    await unavailable.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
