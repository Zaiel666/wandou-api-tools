const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  let durableState = null;
  try {
    const context = await browser.newContext();
    await context.exposeFunction("__readDurableProjectState", () => ({ success: true, state: durableState }));
    await context.exposeFunction("__writeDurableProjectState", (state) => {
      durableState = JSON.parse(JSON.stringify(state));
      return { success: true, path: "test-project-hub-state.json" };
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const nativeSetItem = Storage.prototype.setItem;
      const now = Date.now();
      nativeSetItem.call(localStorage, "aiCanvasProjectsV1", JSON.stringify([
        { id: "old-1", name: "旧文件夹1", createdAt: now - 2000, updatedAt: now - 2000, favorite: false },
        { id: "old-2", name: "旧文件夹2", createdAt: now - 1000, updatedAt: now - 1000, favorite: false },
      ]));
      nativeSetItem.call(localStorage, "aiCanvasProjectHubSelected", "old-1");
      nativeSetItem.call(localStorage, "aiCanvasActiveProjectV1", "old-1");
      Storage.prototype.setItem = function setItemWithFullCache() {
        throw new DOMException("Setting the value exceeded the quota", "QuotaExceededError");
      };
      window.wandouShell = {
        readProjectHubState: () => window.__readDurableProjectState(),
        writeProjectHubState: (state) => window.__writeDurableProjectState(state),
        readCanvasBackups: async () => ({ success: true, states: [] }),
      };
    });

    const url = pathToFileURL(path.resolve(__dirname, "../app/project-hub.html")).href;
    await page.goto(url);
    await page.locator('[data-project="old-1"]').waitFor();
    await page.locator("#newProject").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-project]").length === 3);
    await page.waitForFunction(() => document.querySelector("#projectNotice")?.textContent.includes("改用磁盘保存"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(durableState, "new folder should be written to durable storage");
    assert.equal(durableState.projects.length, 3);
    const created = durableState.projects.find((project) => project.id.startsWith("project-"));
    assert.ok(created, "durable state should contain the newly created folder");

    await page.reload();
    await page.locator(`[data-project="${created.id}"]`).waitFor();
    assert.equal(await page.locator("[data-project]").count(), 3, "disk-only folder must survive reload when localStorage stays full");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(`[data-delete="${created.id}"]`).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-project]").length === 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(durableState.projects.some((project) => project.id === created.id), false, "deleted disk-only folder must leave durable storage");
    await page.reload();
    await page.locator('[data-project="old-1"]').waitFor();
    assert.equal(await page.locator(`[data-project="${created.id}"]`).count(), 0, "deleted disk-only folder must not return from stale cache");
    console.log("PASS: a full localStorage cache no longer blocks creating or reopening project folders");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
