const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const now = Date.now();
      const folderId = "storage-migration";
      const projectId = "large-legacy-project";
      const state = {
        savedAt: now,
        folderId,
        projectId,
        projectName: "旧大画布",
        nodes: [{
          id: 9001,
          type: "image",
          title: "旧大画布节点",
          x: 80,
          y: 120,
          prompt: "旧数据".repeat(350000),
        }],
        links: [],
        nodeId: 9002,
        view: { x: 0, y: 0, zoom: 1 },
      };
      localStorage.setItem(`aiCanvasStateV1:project-collection:${folderId}`, JSON.stringify([{
        id: projectId,
        name: "旧大画布",
        createdAt: now - 1000,
        updatedAt: now,
        nodeCount: 1,
      }]));
      localStorage.setItem(`aiCanvasStateV1:active-project-collection:${folderId}`, projectId);
      localStorage.setItem(`aiCanvasStateV1:${folderId}:${projectId}`, JSON.stringify(state));
      localStorage.setItem(`aiCanvasStateV1:${folderId}`, JSON.stringify(state));
    });

    const url = `${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=storage-migration`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    assert.equal(await page.evaluate(() => nodes[0]?.title), "旧大画布节点");

    await page.waitForFunction(() => {
      const value = JSON.parse(localStorage.getItem("aiCanvasStateV1:storage-migration:large-legacy-project") || "null");
      return value?.external === true;
    });
    const migrated = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) =>
        key === "aiCanvasStateV1:storage-migration"
        || key === "aiCanvasStateV1:storage-migration:large-legacy-project"
      );
      const records = keys.map((key) => ({ key, raw: localStorage.getItem(key) || "" }));
      return {
        records,
        totalBytes: records.reduce((total, item) => total + item.raw.length * 2, 0),
      };
    });
    assert.ok(migrated.records.length >= 2);
    migrated.records.forEach(({ raw }) => {
      const value = JSON.parse(raw);
      assert.equal(value.external, true);
      assert.equal(value.nodes, undefined);
    });
    assert.ok(migrated.totalBytes < 4096, `canvas localStorage pointers should stay tiny, got ${migrated.totalBytes} bytes`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
    const restored = await page.evaluate(() => ({
      title: nodes[0]?.title,
      promptLength: nodes[0]?.prompt?.length || 0,
    }));
    assert.equal(restored.title, "旧大画布节点");
    assert.ok(restored.promptLength > 1_000_000, "the full canvas should reload from IndexedDB after localStorage migration");

    const desktopContext = await browser.newContext();
    const desktopPage = await desktopContext.newPage();
    await desktopPage.addInitScript(() => {
      const now = Date.now();
      window.__diskWrites = [];
      window.wandouShell = {
        readCanvasBackups: async () => ({ success: true, states: [], projectStates: [] }),
        writeCanvasBackup: async (payload) => {
          window.__diskWrites.push({ folderId: payload.folderId, projectId: payload.projectId, count: payload.state?.nodes?.length || 0 });
          return { success: true, path: `${payload.folderId}/${payload.projectId}.json` };
        },
      };
      const makeState = (folderId, projectId, title) => ({
        savedAt: now,
        folderId,
        projectId,
        nodes: [{ id: title, type: "image", title, x: 0, y: 0, prompt: "磁盘迁移".repeat(100000) }],
        links: [],
      });
      localStorage.setItem("aiCanvasStateV1:project-collection:migration-current", JSON.stringify([
        { id: "current-project", name: "当前", createdAt: now - 1000, updatedAt: now, nodeCount: 1 },
      ]));
      localStorage.setItem("aiCanvasStateV1:active-project-collection:migration-current", "current-project");
      localStorage.setItem("aiCanvasStateV1:migration-current:current-project", JSON.stringify(makeState("migration-current", "current-project", "当前项目")));
      localStorage.setItem("aiCanvasStateV1:project-collection:another-folder", JSON.stringify([
        { id: "another-project", name: "其他", createdAt: now - 1000, updatedAt: now, nodeCount: 1 },
      ]));
      localStorage.setItem("aiCanvasStateV1:another-folder:another-project", JSON.stringify(makeState("another-folder", "another-project", "其他项目")));
    });
    await desktopPage.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=migration-current`, { waitUntil: "domcontentloaded" });
    await desktopPage.waitForFunction(() => document.body.dataset.canvasReady === "true");
    await desktopPage.waitForFunction(() => {
      const current = JSON.parse(localStorage.getItem("aiCanvasStateV1:migration-current:current-project") || "null");
      const another = JSON.parse(localStorage.getItem("aiCanvasStateV1:another-folder:another-project") || "null");
      return current?.external === true && another?.external === true;
    });
    const diskWrites = await desktopPage.evaluate(() => window.__diskWrites);
    assert.ok(diskWrites.some((item) => item.folderId === "migration-current" && item.projectId === "current-project"));
    assert.ok(diskWrites.some((item) => item.folderId === "another-folder" && item.projectId === "another-project"));
    await desktopContext.close();
    console.log("PASS: large legacy canvas migrates out of localStorage and reloads from IndexedDB");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
