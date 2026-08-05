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
    const context = await browser.newContext();
    const page = await context.newPage();
    const projectHubUrl = pathToFileURL(path.resolve(__dirname, "../app/project-hub.html")).href;
    await page.goto(projectHubUrl);
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem("aiCanvasProjectsV1", JSON.stringify([
        { id: "cover-test", name: "封面测试", color: "#76b900", createdAt: now, updatedAt: now, favorite: false },
      ]));
      localStorage.setItem("aiCanvasStateV1:cover-test", JSON.stringify({
        savedAt: now,
        nodes: [
          {
            id: 1,
            type: "result",
            mediaType: "image",
            pending: false,
            previewUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='16' height='9' fill='%2376b900'/%3E%3C/svg%3E",
          },
        ],
        links: [],
      }));
    });
    await page.reload();
    const coverImage = page.locator('[data-cover="cover-test"] .cover-media-cell img');
    await coverImage.waitFor({ state: "visible" });
    assert.match(await coverImage.getAttribute("src"), /^data:image\/svg\+xml/);

    const canvasPage = await context.newPage();
    const canvasUrl = `${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=compact-test`;
    await canvasPage.goto(canvasUrl);
    const compactResult = await canvasPage.evaluate(async () => {
      const dataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='red'/%3E%3C/svg%3E";
      nodes.push({
        id: 987654,
        type: "result",
        title: "精简保存测试",
        x: 0,
        y: 0,
        mediaType: "image",
        mediaUrl: dataUrl,
        previewUrl: dataUrl,
        fullUrl: dataUrl,
        references: [{ url: dataUrl, mediaType: "image" }],
      });
      const saveContext = createCanvasSaveContext();
      const success = await saveCanvasStateNow(saveContext, { skipDesktopBackup: true });
      const saved = JSON.parse(localStorage.getItem(saveContext.projectKey));
      const node = saved.nodes.find((item) => item.id === 987654);
      return { success, node };
    });
    assert.equal(compactResult.success, true);
    assert.match(compactResult.node.mediaUrl, /^indexed-media:/);
    assert.equal(compactResult.node.mediaUrl, compactResult.node.fullUrl);
    assert.equal(compactResult.node.mediaUrl, compactResult.node.references[0].url);
    console.log("PASS: real project cover and compact media references");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
