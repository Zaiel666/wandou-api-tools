const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    const colors = await page.evaluate(async () => {
      nodes = []; links = []; nodeId = 1;
      createNode("generator", 0, 0, { _deferRender: true });
      createNode("outpaint", 500, 0, { _deferRender: true });
      render();
      document.querySelector(".assistant-rail").style.transition = "none";
      const selectors = {
        rail: ".assistant-rail",
        generate: ".node.generator button.wide-button[data-generate]",
        outpaint: ".node.outpaint .outpaint-visual-preview",
        empty: ".node.outpaint .reference-empty-visual"
      };
      const read = () => Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        return [key, getComputedStyle(element).backgroundColor];
      }));
      document.body.classList.remove("dark-theme");
      const light = read();
      document.querySelector(".node.generator button.wide-button[data-generate]").classList.add("generating");
      light.generating = getComputedStyle(document.querySelector(".node.generator button.wide-button[data-generate]")).backgroundColor;
      document.body.classList.add("dark-theme");
      await new Promise((resolve) => setTimeout(resolve, 220));
      const dark = read();
      return { light, dark };
    });
    const red = (rgb) => Number(rgb.match(/\d+/)[0]);
    for (const [part, color] of Object.entries(colors.light)) {
      assert.ok(red(color) >= 220, `Light ${part} remains dark: ${color}`);
    }
    assert.ok(red(colors.dark.rail) <= 70, `Dark rail changed unexpectedly: ${colors.dark.rail}`);
    console.log("PASS: light-mode node surfaces are neutral and dark mode remains dark");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
