const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const canvasUrl = `${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=media-persist-folder`;

test("切换文件夹内项目会等待大图保存，返回和重载后仍能恢复效果图", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    const now = Date.now();
    const folder = "media-persist-folder";
    const projects = [
      { id: "project-a", name: "有图片", createdAt: now - 2000, updatedAt: now - 1000, nodeCount: 3 },
      { id: "project-b", name: "其他项目", createdAt: now - 1000, updatedAt: now, nodeCount: 3 },
    ];
    const seed = (projectId, folderId = folder) => ({
      savedAt: now,
      folderId,
      projectId,
      nodes: [
        { id: 1, type: "image", title: "参考图", x: 70, y: 130, prompt: "" },
        { id: 2, type: "generator", title: "AI文字绘图", x: 430, y: 70, prompt: "测试" },
        { id: 3, type: "result", title: "效果图", x: 1040, y: 120, prompt: "" },
      ],
      links: [{ from: 1, to: 2 }, { from: 2, to: 3 }],
      nodeId: 4,
      view: { x: 0, y: 0, zoom: 0.8 },
    });
    localStorage.setItem(`aiCanvasStateV1:project-collection:${folder}`, JSON.stringify(projects));
    localStorage.setItem(`aiCanvasStateV1:active-project-collection:${folder}`, "project-a");
    localStorage.setItem(`aiCanvasStateV1:${folder}:project-a`, JSON.stringify(seed("project-a")));
    localStorage.setItem(`aiCanvasStateV1:${folder}:project-b`, JSON.stringify(seed("project-b")));
    localStorage.setItem("aiCanvasProjectsV1", JSON.stringify([
      { id:folder, name:"图片文件夹", createdAt:now - 3000, updatedAt:now },
      { id:"other-media-folder", name:"其他文件夹", createdAt:now - 2000, updatedAt:now },
    ]));
    localStorage.setItem("aiCanvasStateV1:project-collection:other-media-folder", JSON.stringify([
      { id:"other-project", name:"项目01", createdAt:now, updatedAt:now, nodeCount:3 },
    ]));
    localStorage.setItem("aiCanvasStateV1:active-project-collection:other-media-folder", "other-project");
    localStorage.setItem("aiCanvasStateV1:other-media-folder:other-project", JSON.stringify(seed("other-project", "other-media-folder")));
  });

  const page = await context.newPage();
  await page.goto(canvasUrl);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  const originalLength = await page.evaluate(() => {
    const largeImage = `data:image/png;base64,${"A".repeat(1_300_000)}`;
    const result = nodes.find((node) => node.type === "result");
    result.mediaUrl = largeImage;
    result.previewUrl = largeImage;
    result.fullUrl = largeImage;
    result.mediaType = "image";
    result.width = 2048;
    result.height = 2048;
    result.status = "接口生成完成。";
    render();
    return largeImage.length;
  });

  await page.evaluate(() => switchProject("project-b"));
  await page.waitForFunction(() => activeProjectId === "project-b");
  await page.evaluate(() => switchProject("project-a"));
  await page.waitForFunction(() => activeProjectId === "project-a");
  assert.equal(await page.evaluate(() => nodes.find((node) => node.type === "result")?.mediaUrl.length), originalLength);

  await page.reload();
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  assert.equal(await page.evaluate(() => nodes.find((node) => node.type === "result")?.mediaUrl.length), originalLength);

  await page.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=other-media-folder`);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  assert.equal(await page.evaluate(() => nodes.find((node) => node.type === "result")?.mediaUrl || ""), "");
  await page.goto(canvasUrl);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  assert.equal(await page.evaluate(() => nodes.find((node) => node.type === "result")?.mediaUrl.length), originalLength);
});
