const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href, {
      waitUntil: "domcontentloaded",
    });

    const result = await page.evaluate(async () => {
      const makeImage = (width, height, color) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        return canvas.toDataURL("image/png");
      };
      const original = makeImage(100, 80, "#ef233c");
      const generated = makeImage(150, 80, "#277da1");
      const composed = await composeOutpaintImage(
        generated,
        { url: original, width: 100, height: 80 },
        "150x80",
        "horizontal",
        50,
      );
      const image = new Image();
      image.src = composed;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return {
        width: canvas.width,
        height: canvas.height,
        left: pixel(5, 40),
        center: pixel(75, 40),
        right: pixel(145, 40),
      };
    });

    assert.deepEqual([result.width, result.height], [150, 80]);
    assert.ok(result.left[2] > 100 && result.left[0] < 100, "left extension should remain generated");
    assert.ok(result.center[0] > 200 && result.center[2] < 100, "center should restore original pixels");
    assert.ok(result.right[2] > 100 && result.right[0] < 100, "right extension should remain generated");
    console.log("PASS: outpaint preserves original pixels and only keeps generated extensions");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
