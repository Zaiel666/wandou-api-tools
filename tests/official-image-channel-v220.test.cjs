const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const channels = require('../app/image-api-channels.js');
const main = fs.readFileSync(path.join(root, 'desktop-client/main.js'), 'utf8');
const createPolicy = require('../desktop-client/ipc-policy.cjs');
function fragment(from, to) { const start = main.indexOf(from), end = main.indexOf(to, start + from.length); assert.ok(start >= 0 && end > start, from); return main.slice(start, end); }
function createBridge(fetch) {
  const handlers = new Map(), events = new Map();
  const localFrame = { url: pathToFileURL(path.join(root, 'app/ai-node-canvas-test.html')).href };
  const local = { senderFrame: localFrame, sender: { id: 7, mainFrame: localFrame } };
  const policy = createPolicy({ appRoot: () => path.join(root, 'app'), shellFile: path.join(root, 'desktop-client/shell.html'), shellContents: () => null });
  const ipc = { handle: (key, handler) => handlers.set(key, handler), on: (key, handler) => events.set(key, handler) };
  const context = vm.createContext({ URL, Buffer, AbortController, MAX_DESKTOP_API_RESPONSE_BYTES: 32 * 1024 * 1024,
    updateInProgress: false, storageMigrationPreparing: false,
    isLocalAppPage: url => url === localFrame.url, apiRequestHeaders: value => value, apiRequestBody: value => value.body?.value,
    net: { fetch }, handleDesktop: (key, handler) => policy.handle(ipc, key, handler), onDesktop: (key, handler) => policy.on(ipc, key, handler) });
  vm.runInContext(fragment('const CANVAS_API_HOSTS =', 'const MAX_DESKTOP_API_RESPONSE_BYTES') + fragment('function isAllowedCanvasApiUrl(', 'function isLocalAppPage(') + fragment('const activeCanvasApiRequests =', 'handleDesktop("desktop:get-theme"'), context);
  return { context, local, call: (payload, event = local) => handlers.get('desktop:api-fetch')(event, payload), cancel: payload => events.get('desktop:api-fetch-cancel')(local, payload) };
}

test('legacy gateway config remains compatible; official credentials are isolated and round-trip', () => {
  const old = { key: 'synthetic-gateway-1', key2: 'synthetic-gateway-2', savedAt: 'old' };
  const before = JSON.stringify(old);
  let config = channels.normalize(old);
  assert.equal(JSON.stringify(old), before);
  assert.equal(channels.profile(config).url, channels.GATEWAY);
  config = channels.update(config, 'channel1', { provider: 'openai' });
  assert.equal(channels.profile(config).key, '');
  config = channels.update(config, 'channel1', { key: 'synthetic-official' });
  config = channels.normalize(JSON.parse(JSON.stringify(config)));
  assert.equal(channels.profile(config).key, 'synthetic-official');
  assert.equal(channels.profile(config).url, channels.OFFICIAL);
  assert.equal(config.key, old.key); assert.equal(config.key2, old.key2);
  config = channels.update(config, 'channel1', { provider: 'gateway' });
  assert.equal(channels.profile(config).key, old.key);
  config = channels.update(config, 'channel1', { key: '' });
  assert.equal(config.key, '');
  assert.equal(channels.profile(channels.update(config, 'channel1', { provider: 'openai' })).key, 'synthetic-official');
});

test('provider URLs cannot be set to arbitrary origin, credentials or custom ports', () => {
  for (const url of ['https://evil.test', 'http://www.zayapi.top', 'https://www.zayapi.top:8443', 'https://key@www.zayapi.top']) assert.equal(channels.gatewayUrl(url), channels.GATEWAY);
  assert.equal(channels.gatewayUrl('https://zexitongxue.com/v1'), 'https://zexitongxue.com/v1');
  const config = channels.normalize({ channels: { channel1: { provider: 'openai', openai: { key: 'fake', url: 'https://evil.test' } } } });
  assert.equal(channels.profile(config).url, channels.OFFICIAL); assert.equal(config.key, '');
  assert.throws(() => channels.update(config, 'channel1', { provider: 'evil' }), /不支持/);
});

test('native bridge only permits explicit official image routes and methods', async () => {
  const seen = [];
  const bridge = createBridge(async (url, request) => { seen.push({ url, request }); return new Response('{"data":[]}'); });
  for (const [url, method] of [['https://api.openai.com/v1/models','GET'], ['https://api.openai.com/v1/images/generations','POST'], ['https://api.openai.com/v1/images/edits','POST']]) {
    const result = await bridge.call({ url, request: { method, headers: { authorization: 'Bearer synthetic' } } });
    assert.equal(result.ok, true);
  }
  for (const [url, method] of [
    ['https://api.openai.com/v1/files','POST'], ['https://api.openai.com/v1/chat/completions','POST'],
    ['https://api.openai.com/v1/models','POST'], ['https://api.openai.com/v1/images/generations','GET'],
    ['https://api.openai.com.evil.test/v1/models','GET'], ['https://api.openai.com:8443/v1/models','GET'],
    ['https://key@api.openai.com/v1/models','GET'], ['https://api.openai.com/v1/models?target=elsewhere','GET'],
    ['http://api.openai.com/v1/models','GET'], ['https://api.openai.com/v1/%6dodels','GET']
  ]) await assert.rejects(bridge.call({ url, request: { method } }), /允许|仅支持/);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(call => call.request.redirect === 'manual'));
  await bridge.call({ url: 'https://www.zayapi.top/v1/models', request: { method: 'GET' } });
  assert.equal(seen.length, 4);
});

test('remote pages and local subframes cannot access official API bridge', async () => {
  let calls = 0;
  const bridge = createBridge(async () => { calls++; return new Response('{}'); });
  const remoteFrame = { url: 'https://api.openai.com/' };
  const remote = { senderFrame: remoteFrame, sender: { id: 8, mainFrame: remoteFrame } };
  const subframe = { ...bridge.local, senderFrame: { url: bridge.local.senderFrame.url } };
  for (const event of [remote, subframe]) {
    const result = await bridge.call({ url: 'https://api.openai.com/v1/models' }, event);
    assert.equal(result.success, false); assert.match(result.error, /无权/);
  }
  assert.equal(calls, 0);
});

test('redirect and provider failures never send credentials to another endpoint or retry', async () => {
  for (const status of [302, 307, 401, 429, 500]) {
    const calls = [];
    const bridge = createBridge(async (url, request) => { calls.push({url,request}); return new Response('{}', { status, headers: { location: 'https://evil.test/capture' } }); });
    const pending = bridge.call({ url: 'https://api.openai.com/v1/images/generations', request: { method: 'POST', headers: { authorization: 'Bearer synthetic' } } });
    if (status < 400) await assert.rejects(pending, /重定向/);
    else { const result = await pending; assert.equal(result.ok, false); assert.equal(result.status, status); }
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
    assert.equal(vm.runInContext('activeCanvasApiCount', bridge.context), 0);
  }
});

test('update and migration gates stop official requests; cancellation releases busy state', async () => {
  let calls = 0;
  const bridge = createBridge(async (_url, request) => { calls++; return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')))); });
  for (const flag of ['updateInProgress', 'storageMigrationPreparing']) {
    bridge.context[flag] = true;
    await assert.rejects(bridge.call({ url: 'https://api.openai.com/v1/models' }), /更新|迁移/);
    bridge.context[flag] = false;
  }
  assert.equal(calls, 0);
  const request = bridge.call({ url: 'https://api.openai.com/v1/models', requestId: 'cancel-test' });
  bridge.cancel({requestId:'cancel-test'});
  await assert.rejects(request, /aborted/);
  assert.equal(calls, 1); assert.equal(vm.runInContext('activeCanvasApiCount', bridge.context), 0);
});

test('provider selectors preserve separate keys, block busy changes and fit light/dark small windows', async () => {
  const { chromium } = require('../desktop-client/node_modules/playwright');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<style>:root{--panel:#fff;--text:#161616;--muted:#555;--line:#aaa}body.dark{--panel:#202020;--text:#eee;--muted:#bbb;--line:#666}body{background:var(--panel);color:var(--text)}main{width:440px;max-width:90vw;margin:30px auto}input{width:90%;min-height:30px}section{margin:20px}</style><main>' + ['channel1','channel2'].map((id, i) => `<section class="api-channel-card"><p class="api-channel-help">old help</p><div class="api-key-row"><input id="key${i}" type="password"><input id="url${i}" type="hidden"></div></section>`).join('') + '</main>');
    await page.addStyleTag({ path: path.join(root, 'app/image-api-channels.css') });
    await page.addScriptTag({ path: path.join(root, 'app/image-api-channels.js') });
    await page.evaluate(() => { window.busy = false; window.blocked = 0; window.changed = 0; window.controller = WandouImageChannels.mount({ config: {key:'synthetic-gateway'}, keyInputs:[document.querySelector('#key0'),document.querySelector('#key1')], urlInputs:[document.querySelector('#url0'),document.querySelector('#url1')], isBusy:()=>window.busy,onBlocked:()=>window.blocked++,onChange:()=>window.changed++ }); });
    assert.equal(await page.locator('#key0').inputValue(), 'synthetic-gateway');
    await page.locator('#imageProvider-channel1').selectOption('openai');
    assert.equal(await page.locator('#key0').inputValue(), '');
    await page.locator('#key0').fill('synthetic-official');
    await page.locator('#imageProvider-channel1').selectOption('gateway');
    assert.equal(await page.locator('#key0').inputValue(), 'synthetic-gateway');
    assert.equal(await page.evaluate(() => controller.snapshot().key), 'synthetic-gateway');
    await page.locator('#imageProvider-channel1').selectOption('openai');
    assert.equal(await page.locator('#key0').inputValue(), 'synthetic-official');
    await page.evaluate(() => busy = true);
    await page.locator('#imageProvider-channel1').selectOption('gateway');
    assert.equal(await page.locator('#imageProvider-channel1').inputValue(), 'openai');
    assert.equal(await page.evaluate(() => blocked), 1);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.body.classList.toggle('dark', theme === 'dark'), theme);
      const metrics = await page.locator('#imageProvider-channel1').evaluate(el => { const box=el.getBoundingClientRect(),style=getComputedStyle(el);return {x:box.x,right:box.right,bottom:box.bottom,color:style.color,bg:style.backgroundColor}; });
      assert.ok(metrics.x >= 0 && metrics.right <= 1024 && metrics.bottom <= 800);
      assert.notEqual(metrics.color, metrics.bg);
    }
  } finally { await browser.close(); }
});
