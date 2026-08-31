const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const source = fs.readFileSync(path.resolve(__dirname, "../app/ai-node-canvas.html"), "utf8");
assert.match(source, /data-generator-ref-index=/);
assert.match(source, /role="button" tabindex="0" aria-label="放大查看/);
assert.match(source, /openLightbox\(ref\.url, \{ mode: "image", nodeId: node\.id, refIndex: index \}\)/);
assert.match(source, /event\.key !== "Enter" && event\.key !== " "/);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=generator-reference-preview-test`);
    await page.locator('body[data-canvas-ready="true"]').waitFor();
    const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Crect width='12' height='8' fill='%2343d13b'/%3E%3C/svg%3E";
    await page.evaluate((src) => {
      nodes = [];
      links = [];
      createNode("generator", 80, 80, {
        references: [
          { url: src, mediaType: "image", width: 12, height: 8, name: "图1" },
          { url: src.replace("%2343d13b", "%233b82f6"), mediaType: "image", width: 12, height: 8, name: "图2" }
        ]
      });
    }, image);

    const thumbnails = page.locator("[data-generator-ref-index]");
    assert.equal(await thumbnails.count(), 2);
    await thumbnails.nth(0).click();
    assert.equal(await page.locator("#lightbox").evaluate((element) => element.classList.contains("open")), true);
    assert.match(await page.locator("#lightboxImage").getAttribute("src"), /^data:image\/svg\+xml/);
    await page.keyboard.press("Escape");
    await thumbnails.nth(1).focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#lightbox").evaluate((element) => element.classList.contains("open")), true);
    console.log("PASS: AI drawing reference thumbnails open a full preview by mouse and keyboard");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
