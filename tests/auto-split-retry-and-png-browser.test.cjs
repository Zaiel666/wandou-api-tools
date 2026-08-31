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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    const seeded = await page.evaluate(() => {
      const generatedCanvas = document.createElement("canvas");
      generatedCanvas.width = 48;
      generatedCanvas.height = 48;
      const generatedContext = generatedCanvas.getContext("2d");
      generatedContext.fillStyle = "#2d8a4a";
      generatedContext.fillRect(8, 8, 32, 32);
      const generatedUrl = generatedCanvas.toDataURL("image/png");

      nodes = [];
      links = [];
      nodeId = 1;
      const source = createNode("generator", 80, 100, {
        prompt: "三张统一风格的绿色产品图",
        model: "GPT-image-2",
        autoSplit: true,
        autoSplitReviewOpen: true,
        autoSplitPlanConfirmed: true,
        autoSplitPlan: [
          { title: "正面", prompt: "绿色产品正面图" },
          { title: "侧面", prompt: "绿色产品侧面图" },
        ],
        autoSplitLockedSize: "48x48",
        autoSplitBatchFolder: "retry-browser-test",
        _deferRender: true,
      });
      const failed = createNode("result", 620, 100, {
        prompt: "绿色产品侧面图",
        generationPrompt: "绿色产品侧面图，保持统一风格",
        model: "GPT-image-2",
        mediaType: "image",
        width: 48,
        height: 48,
        autoSplitIndex: 2,
        autoSaveBatchFolder: "retry-browser-test",
        pending: false,
        status: "生成失败：测试故障",
        _deferRender: true,
      });
      links.push({ from: source.id, to: failed.id });
      apiKeyInput.value = "ui-test-key";
      nativeAutoSaveDirectory = "C:\\ui-test";
      window.wandouShell = {
        writeSaveFile: async (filename) => ({ success: true, filename }),
      };
      callApi = async () => ({
        urls: [generatedUrl],
        url: generatedUrl,
        mediaType: "image",
        fromApi: true,
      });
      render();
      return { sourceId: source.id, failedId: failed.id };
    });

    const retry = page.locator(`[data-id="${seeded.sourceId}"] [data-auto-split-regenerate]`);
    await retry.waitFor({ state: "visible" });
    assert.equal(await retry.getAttribute("aria-label"), "重新生成第 2 张");
    await retry.click();
    await page.waitForFunction((failedId) => nodes.some((node) => node.regeneratedFromId === failedId && !node.pending && node.fullUrl), seeded.failedId);
    await page.waitForFunction((sourceId) => document.querySelectorAll(`[data-id="${sourceId}"] .auto-split-result-state.success`).length === 1, seeded.sourceId);
    const retryState = await page.evaluate((sourceId) => ({
      source: nodes.find((node) => node.id === sourceId),
      results: links.filter((link) => link.from === sourceId).map((link) => nodes.find((node) => node.id === link.to)),
      successCount: document.querySelectorAll(`[data-id="${sourceId}"] .auto-split-result-state.success`).length,
    }), seeded.sourceId);
    assert.equal(retryState.successCount, 1, JSON.stringify(retryState));

    const pngResult = await page.evaluate(async () => {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = 32;
      sourceCanvas.height = 32;
      const context = sourceCanvas.getContext("2d");
      context.clearRect(0, 0, 32, 32);
      context.fillStyle = "rgba(255, 0, 0, 1)";
      context.fillRect(8, 8, 16, 16);
      const convertedUrl = await imageToSizedBlobUrl(sourceCanvas.toDataURL("image/png"), 32, 32, true);
      const blob = await (await fetch(convertedUrl)).blob();
      const transparent = await imageHasTransparentPixels(convertedUrl);
      URL.revokeObjectURL(convertedUrl);
      return { type: blob.type, transparent };
    });
    assert.deepEqual(pngResult, { type: "image/png", transparent: true });

    console.log("PASS: failed auto-split rows retry individually and PNG conversion preserves transparency");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
