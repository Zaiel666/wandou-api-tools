const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const source = require("node:fs").readFileSync(path.join(__dirname, "..", "app", "ai-node-canvas.html"), "utf8");
assert.match(source, /const mountedNodes = new Map\(/);
assert.match(source, /current\.dataset\.renderKey === renderKey/);
assert.match(source, /function compactMediaRenderKey\(/);
assert.doesNotMatch(source, /function render\(\)\s*\{[\s\S]{0,300}?querySelectorAll\("\.node"\)\].*\.remove\(\)/);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=render-retention-test`);
    const result = await page.evaluate(() => {
      const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%2376b900'/%3E%3C/svg%3E";
      const source = nodes[0] || createNode("generator", 60, 60, { _deferRender: true });
      for (let index = 0; index < 12; index += 1) {
        nodes.push({
          id: `retained-${index}`, type: "result", title: "", x: 700 + index * 20, y: 100,
          mediaType: "image", mediaUrl: image, previewUrl: image, fullUrl: image,
          references: [{ url: image, mediaType: "image", width: 8, height: 8 }], width: 8, height: 8,
          pending: false, status: "完成"
        });
      }
      render();
      const before = [...canvas.querySelectorAll(".result")];
      source.status = "仅源节点状态变化";
      render();
      const after = [...canvas.querySelectorAll(".result")];
      return { count: after.length, retained: before.every((element, index) => element === after[index]) };
    });
    assert.equal(result.count >= 12, true);
    assert.equal(result.retained, true, "unrelated result images must keep their DOM nodes when another node changes");
    console.log("PASS: canvas retains unchanged result DOM during unrelated updates");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
