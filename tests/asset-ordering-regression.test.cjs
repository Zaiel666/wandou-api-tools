const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const assetUrl = pathToFileURL(path.resolve(__dirname, "../app/asset-library.html")).href;

test("asset library sorts both recent directories and their generated files", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const oldTime = 1700000000000;
    const newTime = oldTime + 100000;
    localStorage.setItem("aiCanvasProjectsV1", JSON.stringify([
      { id: "folder-old", name: "较早目录", createdAt: oldTime, updatedAt: oldTime },
      { id: "folder-new", name: "最近目录", createdAt: newTime, updatedAt: newTime },
    ]));
    localStorage.setItem("aiCanvasStateV1:project-collection:folder-old", JSON.stringify([
      { id: "project-old", name: "较早项目", createdAt: oldTime, updatedAt: oldTime },
    ]));
    localStorage.setItem("aiCanvasStateV1:project-collection:folder-new", JSON.stringify([
      { id: "project-new", name: "最近项目", createdAt: newTime, updatedAt: newTime },
    ]));
    localStorage.setItem("aiCanvasStateV1:folder-old:project-old", JSON.stringify({
      savedAt: oldTime,
      folderId: "folder-old",
      projectId: "project-old",
      nodes: [{ id: `result-${oldTime}`, type: "result", mediaType: "image", title: "较早图片", createdAt: oldTime, width: 1024, height: 1024, mediaUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }],
      links: [],
    }));
    localStorage.setItem("aiCanvasStateV1:folder-new:project-new", JSON.stringify({
      savedAt: newTime,
      folderId: "folder-new",
      projectId: "project-new",
      nodes: [
        { id: "node-10", type: "result", mediaType: "image", title: "最近图片一", width: 1920, height: 1080, mediaUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='2' height='1'/%3E%3C/svg%3E" },
        { id: "node-11", type: "result", mediaType: "image", title: "最近图片二", width: 1920, height: 1080, mediaUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='3' height='1'/%3E%3C/svg%3E" },
      ],
      links: [],
    }));
  });
  await page.goto(assetUrl, { waitUntil: "domcontentloaded" });
  await page.locator('[data-filter="image"]').click();
  await page.locator(".asset-group").first().waitFor();

  assert.equal(await page.locator("#assetSort").inputValue(), "desc");
  assert.deepEqual(await page.locator(".asset-group-head h2").allTextContents(), [
    "最近目录 / 最近项目",
    "较早目录 / 较早项目",
  ]);
  assert.deepEqual(await page.locator(".asset-card-title").allTextContents(), ["最近图片二", "最近图片一", "较早图片"]);
  assert.equal(await page.locator(".asset-card-directory").first().innerText(), "最近目录 / 最近项目");
  assert.deepEqual(await page.locator("#folderFilter option").allTextContents(), [
    "全部项目文件夹",
    "最近目录（2）",
    "较早目录（1）",
  ]);

  await page.locator("#assetSort").selectOption("asc");
  assert.deepEqual(await page.locator(".asset-group-head h2").allTextContents(), [
    "较早目录 / 较早项目",
    "最近目录 / 最近项目",
  ]);
  assert.deepEqual(await page.locator(".asset-card-title").allTextContents(), ["较早图片", "最近图片一", "最近图片二"]);
  assert.deepEqual(await page.locator("#folderFilter option").allTextContents(), [
    "全部项目文件夹",
    "较早目录（1）",
    "最近目录（2）",
  ]);
});
