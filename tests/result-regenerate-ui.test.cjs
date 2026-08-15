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
    await page.waitForTimeout(1200);

    const seeded = await page.evaluate(() => {
      const makeImage = (color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#fff";
        context.font = "bold 18px sans-serif";
        context.fillText("海报", 27, 70);
        return canvas.toDataURL("image/png");
      };
      const originalUrl = makeImage("#165d2f");
      const regeneratedUrl = makeImage("#257a42");
      nodes = [];
      links = [];
      nodeId = 1;
      const source = createNode("generator", 80, 100, {
        prompt: "统一绿色系列海报",
        model: "GPT-image-2",
        autoSplit: true,
        autoSplitConsistency: "series",
        _deferRender: true,
      });
      const original = createNode("result", 620, 100, {
        prompt: "第一张绿色系列海报",
        generationPrompt: "第一张绿色系列海报，严格保持系列版式与绿色视觉风格",
        model: "GPT-image-2",
        mediaType: "image",
        mediaUrl: originalUrl,
        previewUrl: originalUrl,
        fullUrl: originalUrl,
        width: 96,
        height: 128,
        autoSplitIndex: 1,
        autoSaveBatchFolder: "ui-regenerate-test",
        pending: false,
        _deferRender: true,
      });
      links.push({ from: source.id, to: original.id });
      apiKeyInput.value = "ui-test-key";
      nativeAutoSaveDirectory = "C:\\ui-test";
      window.wandouShell = {
        writeSaveFile: async (filename) => ({ success: true, filename }),
      };
      callApi = async () => ({
        urls: [regeneratedUrl],
        url: regeneratedUrl,
        mediaType: "image",
        fromApi: true,
      });
      render();
      return { sourceId: source.id, originalId: original.id, originalUrl };
    });

    await page.evaluate((originalId) => {
      const original = nodes.find((node) => node.id === originalId);
      openLightbox(favoriteMediaUrl(original), { mode: "image", nodeId: originalId });
    }, seeded.originalId);
    await page.locator("#lightboxImage").click({ button: "right" });
    await page.locator("#lightboxContextRegenerate").waitFor({ state: "visible" });
    assert.equal(await page.locator("#lightboxContextRegenerate").textContent(), "重新生成");
    await page.locator("#lightboxContextRegenerate").click();

    await page.waitForFunction((originalId) => nodes.some((node) => node.regeneratedFromId === originalId), seeded.originalId);
    await page.waitForFunction((originalId) => nodes.filter((node) => node.regeneratedFromId === originalId).every((node) => !node.pending), seeded.originalId);
    await page.waitForFunction((originalId) => nodes.find((node) => node.id === originalId)?.regenerating === false, seeded.originalId);
    const result = await page.evaluate(({ originalId, originalUrl }) => {
      const original = nodes.find((node) => node.id === originalId);
      const replacement = nodes.find((node) => node.regeneratedFromId === originalId);
      const sourceId = links.find((link) => link.to === originalId)?.from;
      const replacementLink = links.find((link) => link.to === replacement?.id);
      return {
        resultCount: links.filter((link) => link.from === sourceId).map((link) => nodes.find((node) => node.id === link.to)).filter((node) => node?.type === "result").length,
        originalUnchanged: original?.fullUrl === originalUrl,
        replacementExists: Boolean(replacement?.fullUrl),
        appendedBelow: Number(replacement?.y) > Number(original?.y),
        sameSource: replacementLink?.from === sourceId,
        samePrompt: replacement?.generationPrompt === original?.generationPrompt,
        sameModel: replacement?.model === original?.model,
        sameSize: replacement?.width === original?.width && replacement?.height === original?.height,
        regenerationStopped: original?.regenerating === false,
      };
    }, seeded);

    assert.deepEqual(result, {
      resultCount: 2,
      originalUnchanged: true,
      replacementExists: true,
      appendedBelow: true,
      sameSource: true,
      samePrompt: true,
      sameModel: true,
      sameSize: true,
      regenerationStopped: true,
    });

    await page.locator("#lightboxClose").click();
    const controls = await page.locator(`[data-id="${seeded.originalId}"] .preview`).evaluate((preview) => {
      const favorite = preview.querySelector(".preview-favorite").getBoundingClientRect();
      const regenerate = preview.querySelector(".preview-regenerate").getBoundingClientRect();
      const download = preview.querySelector(".preview-download").getBoundingClientRect();
      return {
        favoriteToRegenerate: Math.round(regenerate.left - favorite.right),
        regenerateToDownload: Math.round(download.left - regenerate.right),
      };
    });
    assert.deepEqual(controls, { favoriteToRegenerate: 2, regenerateToDownload: 2 });

    console.log("PASS: right-click regeneration keeps the original, appends a selectable result below, and preserves prompt/model/size");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
