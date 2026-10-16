const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../desktop-client/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    const page = await browser.newPage({ viewport:{width:1500,height:1000} });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas.html')).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
    await page.evaluate(() => {
      nodes = []; links = []; nodeId = 1;
      createNode('generator',60,100); render();
    });
    const input = page.locator('.node.generator textarea').first();
    await input.fill(Array.from({length:80}, (_,i) => `第 ${i+1} 行提示词`).join('\n'));
    await input.evaluate(el => { el.scrollTop = 0; });
    const zoom = await page.evaluate(() => view.zoom);
    await input.hover();
    await page.mouse.wheel(0,260);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => view.zoom), zoom, 'scrolling prompt must not zoom canvas');
    assert.ok(await input.evaluate(el => el.scrollTop > 0), 'long prompt must actually scroll');
    const ime = await page.evaluate(() => {
      let sends = 0;
      sendAssistantMessage = () => { sends++; };
      const input = document.getElementById('assistantInput');
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
      const composingSends = sends;
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      return {composingSends,sends};
    });
    assert.deepEqual(ime,{composingSends:0,sends:1}, 'IME confirmation must not send; normal Enter still sends');
    assert.deepEqual(errors,[]);
    console.log('PASS: prompt scrolling and Chinese IME Enter remain independent of canvas actions');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
