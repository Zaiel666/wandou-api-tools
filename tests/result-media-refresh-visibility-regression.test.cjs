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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
    await page.goto(`${pathToFileURL(pagePath).href}?project=result-media-refresh-test`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    const resultId = await page.evaluate(() => {
      nodes = [];
      links = [];
      nodeId = 1;
      view = { x: 80, y: 80, zoom: 1 };
      const result = createNode("result", 120, 120, {
        mediaType: "image",
        pending: true,
        width: 64,
        height: 64,
        status: "正在生成",
        _deferRender: true,
      });
      render();

      const generatedCanvas = document.createElement("canvas");
      generatedCanvas.width = 64;
      generatedCanvas.height = 64;
      const context = generatedCanvas.getContext("2d");
      context.fillStyle = "#25b95d";
      context.fillRect(0, 0, 64, 64);
      const generatedUrl = generatedCanvas.toDataURL("image/png");

      result.pending = false;
      result.mediaUrl = generatedUrl;
      result.previewUrl = generatedUrl;
      result.fullUrl = generatedUrl;
      result.status = "接口生成完成";
      refreshRenderedNode(result.id);
      return result.id;
    });

    const image = page.locator(`[data-id="${resultId}"] [data-canvas-media]`);
    await image.waitFor({ state: "visible" });
    await page.waitForFunction((id) => {
      const media = document.querySelector(`[data-id="${id}"] [data-canvas-media]`);
      return Boolean(media?.getAttribute("src") && media.complete && media.naturalWidth > 0);
    }, resultId);

    const state = await image.evaluate((media) => ({
      hasSource: Boolean(media.getAttribute("src")),
      naturalWidth: media.naturalWidth,
      naturalHeight: media.naturalHeight,
      deferred: media.closest(".node")?.classList.contains("media-deferred"),
    }));
    assert.deepEqual(state, {
      hasSource: true,
      naturalWidth: 64,
      naturalHeight: 64,
      deferred: false,
    });

    console.log("PASS: a generated result becomes visible after the fast node refresh path");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
