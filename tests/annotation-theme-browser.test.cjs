const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, {waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    const colors = await page.evaluate(() => {
      nodes = []; links = []; nodeId = 1;
      const image = document.createElement("canvas"); image.width = 20; image.height = 20;
      const source = createNode("image", 0, 0, {references:[{url:image.toDataURL(), comments:[{id:"one", shape:"point", x:.5, y:.5, text:"局部修改"}]}], _deferRender:true});
      const generator = createNode("generator", 400, 0, {prompt:"画图", _deferRender:true});
      links.push({from:source.id, to:generator.id});
      render();
      const panel = document.getElementById("imageCommentPanel");
      const textarea = document.getElementById("imageCommentText");
      const lightbox = document.getElementById("lightbox");
      lightbox.classList.add("paint-mode");
      const toolbar = lightbox.querySelector(".lightbox-tools");
      const shell = document.querySelector(".node.generator .prompt-composer-shell");
      const annotation = document.querySelector(".generator-annotation-item");
      const read = () => {
        textarea.focus();
        return {
          panel:getComputedStyle(panel).backgroundColor,
          textarea:getComputedStyle(textarea).backgroundColor,
          toolbar:getComputedStyle(toolbar).backgroundColor,
          shell:getComputedStyle(shell).backgroundColor,
          annotation:getComputedStyle(annotation).backgroundColor
        };
      };
      document.body.classList.remove("dark-theme");
      const light = read();
      document.body.classList.add("dark-theme");
      const dark = read();
      return {light, dark};
    });
    const channels = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number);
    for (const [mode, items] of Object.entries(colors)) {
      for (const [part, rgb] of Object.entries(items)) {
        const values = channels(rgb);
        assert.ok(Math.max(...values) - Math.min(...values) <= 1, `${mode} ${part} is tinted: ${rgb}`);
        assert.ok(mode === "light" ? values[0] >= 240 : values[0] <= 45, `${mode} ${part} has the wrong theme brightness: ${rgb}`);
      }
    }
    console.log("PASS: annotation editor and drawing prompt surfaces stay neutral in light and dark modes");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
