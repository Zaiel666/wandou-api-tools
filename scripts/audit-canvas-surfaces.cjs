const { chromium } = require('../desktop-client/node_modules/playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1600,height:1000}});
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname,'../app/ai-node-canvas.html')).href);
    await page.waitForFunction(() => document.body.dataset.canvasReady === 'true');
    fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
    const results = [];
    for (const theme of ['light','dark']) {
      const result = await page.evaluate(theme => {
        document.body.classList.toggle('dark-theme',theme === 'dark');
        nodes = []; links = []; nodeId = 1;
        const types = [...new Set([...document.querySelectorAll('[data-add-node]')].map(el => el.dataset.addNode))];
        types.forEach((type,i) => createNode(type,40+(i%4)*550,100+Math.floor(i/4)*950,{_deferRender:true}));
        render();
        return {theme,types};
      },theme);
      await page.waitForTimeout(250);
      result.tintedSurfaces = await page.evaluate(() => [...document.querySelectorAll('.node, .node *, .sidebar, .tool-group, .assistant-panel')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 100 && r.height > 25 && getComputedStyle(el).display !== 'none';
      }).map(el => ({selector:el.className,color:getComputedStyle(el).backgroundColor})).filter(item => {
        const c = item.color.match(/[\d.]+/g)?.map(Number) || [];
        return c.length >= 3 && (c.length < 4 || c[3] > .05) && Math.max(...c.slice(0,3))-Math.min(...c.slice(0,3)) > 8;
      }));
      await page.screenshot({path:path.resolve(__dirname,`../artifacts/canvas-audit-${theme}.png`)});
      results.push(result);
    }
    console.log(JSON.stringify({results,errors},null,2));
    if (errors.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
