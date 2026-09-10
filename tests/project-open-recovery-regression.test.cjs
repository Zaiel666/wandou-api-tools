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
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const now = Date.now();
      const folderId = "legacy-folder-recovery";
      const projects = [
        { id: "inner-first", name: "项目01", createdAt: now - 5000, updatedAt: now - 3000 },
        { id: "inner-empty", name: "项目02", createdAt: now - 4000, updatedAt: now - 1000 },
      ];
      const seedNodes = [
        { id: 1, type: "image", title: "参考图", x: 70, y: 130, prompt: "" },
        { id: 2, type: "generator", title: "AI文字绘图", x: 430, y: 70, prompt: "把参考图优化成适合社交平台传播的高级质感海报，画面干净，文字清晰，现代商业视觉。" },
        { id: 3, type: "result", title: "效果图", x: 1040, y: 120, prompt: "" },
      ];
      const seed = {
        savedAt: now - 1000,
        nodes: seedNodes,
        links: [{ from: 1, to: 2 }, { from: 2, to: 3 }],
        nodeId: 4,
        view: { x: 40, y: 20, zoom: 0.9 },
        intentionalResetAt: 0,
      };
      const legacy = {
        savedAt: now - 6000,
        nodes: Array.from({ length: 15 }, (_, index) => ({
          id: index + 10,
          type: index === 14 ? "result" : "image",
          title: `原文件 ${index + 1}`,
          x: 120 + (index % 5) * 340,
          y: 100 + Math.floor(index / 5) * 330,
          prompt: "",
          pending: false,
        })),
        links: [],
        nodeId: 30,
        view: { x: -100000, y: -100000, zoom: 0.9 },
        intentionalResetAt: 0,
      };
      localStorage.setItem(`aiCanvasStateV1:project-collection:${folderId}`, JSON.stringify(projects));
      localStorage.setItem(`aiCanvasStateV1:active-project-collection:${folderId}`, "inner-empty");
      localStorage.setItem(`aiCanvasStateV1:${folderId}:inner-first`, JSON.stringify(seed));
      localStorage.setItem(`aiCanvasStateV1:${folderId}:inner-empty`, JSON.stringify(seed));
      localStorage.setItem(`aiCanvasStateV1:${folderId}`, JSON.stringify(legacy));
    });

    const canvasUrl = `${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=legacy-folder-recovery`;
    await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    const restored = await page.evaluate(() => {
      const nested = JSON.parse(localStorage.getItem("aiCanvasStateV1:legacy-folder-recovery:inner-first"));
      const legacy = JSON.parse(localStorage.getItem("aiCanvasStateV1:legacy-folder-recovery"));
      return {
        activeProjectId,
        nodeCount: nodes.length,
        firstTitle: nodes[0]?.title,
        nestedNodeCount: nested.nodes.length,
        legacyNodeCount: legacy.nodes.length,
        visible: restoredCanvasHasVisibleContent(),
        view: { ...view },
      };
    });
    assert.equal(restored.activeProjectId, "inner-first", "legacy files should reopen in the first inner project");
    assert.equal(restored.nodeCount, 15);
    assert.equal(restored.firstTitle, "原文件 1");
    assert.equal(restored.nestedNodeCount, 15, "legacy state should be copied to the scoped project key");
    assert.equal(restored.legacyNodeCount, 15, "migration must preserve the original folder record");
    assert.equal(restored.visible, true, "an off-screen saved view should be repaired after restore");
    assert.ok(restored.view.x > -100000 && restored.view.y > -100000);

    const isolatedBackup = await page.evaluate(async () => {
      const db = await openLocalMediaDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(canvasStateStoreName, "readwrite");
        tx.objectStore(canvasStateStoreName).put({
          id: folderCanvasStorageKey(),
          savedAt: Date.now(),
          state: { projectId: "inner-first", savedAt: Date.now(), nodes: [{ id: 99, type: "image" }], links: [] },
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      activeProjectId = "inner-empty";
      return readCanvasStateBackup();
    });
    assert.equal(isolatedBackup, null, "a folder backup must not leak into another inner project");

    await page.evaluate(() => {
      const now = Date.now();
      const projectA = { savedAt: now - 1000, nodes: [{ id: 301, type: "image", title: "项目 A", x: 50, y: 50 }], links: [] };
      const projectB = { savedAt: now, nodes: [{ id: 302, type: "image", title: "项目 B", x: 50, y: 50 }], links: [] };
      localStorage.setItem("aiCanvasStateV1:project-collection:alias-folder", JSON.stringify([
        { id: "project-a", name: "项目 A", createdAt: now - 3000, updatedAt: now - 1000 },
        { id: "project-b", name: "项目 B", createdAt: now - 2000, updatedAt: now },
      ]));
      localStorage.setItem("aiCanvasStateV1:active-project-collection:alias-folder", "project-a");
      localStorage.setItem("aiCanvasStateV1:alias-folder:project-a", JSON.stringify(projectA));
      localStorage.setItem("aiCanvasStateV1:alias-folder:project-b", JSON.stringify(projectB));
      localStorage.setItem("aiCanvasStateV1:alias-folder", JSON.stringify(projectB));
    });
    const aliasPage = await context.newPage();
    await aliasPage.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=alias-folder`, { waitUntil: "domcontentloaded" });
    await aliasPage.waitForFunction(() => document.body.dataset.canvasReady === "true");
    assert.equal(await aliasPage.evaluate(() => nodes[0]?.title), "项目 A", "the last folder alias must not replace another project");
    await aliasPage.close();

    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem("aiCanvasProjectsV1", JSON.stringify([
        { id: "legacy-folder-recovery", name: "旧文件夹", createdAt: now - 2000, updatedAt: now - 1000 },
        { id: "other-folder", name: "其他文件夹", createdAt: now - 1000, updatedAt: now },
      ]));
      localStorage.setItem("aiCanvasStateV1", JSON.stringify({
        savedAt: now,
        nodes: Array.from({ length: 9 }, (_, index) => ({ id: 200 + index, type: "image", x: index * 100, y: 0 })),
        links: [],
      }));
    });
    const otherPage = await context.newPage();
    await otherPage.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=other-folder`, { waitUntil: "domcontentloaded" });
    await otherPage.waitForFunction(() => document.body.dataset.canvasReady === "true");
    assert.equal(await otherPage.evaluate(() => nodes.length), 3, "the global legacy canvas must not appear in every folder");
    await otherPage.close();

    const diskContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await diskContext.addInitScript(() => {
      const now = Date.now();
      const seed = {
        savedAt: now,
        folderId: "disk-folder",
        projectId: "current-empty",
        nodes: [
          { id: 1, type: "image", title: "参考图", x: 70, y: 130, prompt: "" },
          { id: 2, type: "generator", title: "AI文字绘图", x: 430, y: 70, prompt: "把参考图优化成适合社交平台传播的高级质感海报，画面干净，文字清晰，现代商业视觉。" },
          { id: 3, type: "result", title: "效果图", x: 1040, y: 120, prompt: "" },
        ],
        links: [{ from: 1, to: 2 }, { from: 2, to: 3 }],
        nodeId: 4,
        intentionalResetAt: 0,
      };
      const recovered = {
        savedAt: now - 10_000,
        folderId: "disk-folder",
        projectId: "disk-original",
        nodes: Array.from({ length: 4 }, (_, index) => ({
          id: index + 20,
          type: index === 3 ? "result" : "image",
          title: `磁盘原文件 ${index + 1}`,
          x: 80 + index * 280,
          y: 120,
        })),
        links: [],
        nodeId: 30,
        intentionalResetAt: 0,
      };
      localStorage.setItem("aiCanvasStateV1:project-collection:disk-folder", JSON.stringify([
        { id: "current-empty", name: "项目01", createdAt: now - 1000, updatedAt: now, nodeCount: 3 },
      ]));
      localStorage.setItem("aiCanvasStateV1:active-project-collection:disk-folder", "current-empty");
      localStorage.setItem("aiCanvasStateV1:disk-folder:current-empty", JSON.stringify(seed));
      window.wandouShell = {
        readProjectHubState: async () => ({
          success: true,
          state: { projects: [{ id: "disk-folder", name: "扩展" }] },
        }),
        readCanvasBackups: async ({ allProjects, projectId }) => {
          if (allProjects) {
            return {
              success: true,
              states: [seed, recovered],
              projectStates: [
                { projectId: "current-empty", states: [seed] },
                { projectId: "disk-original", states: [recovered] },
              ],
            };
          }
          return { success: true, states: projectId === "disk-original" ? [recovered] : [seed] };
        },
      };
    });
    const diskPage = await diskContext.newPage();
    await diskPage.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=disk-folder`, { waitUntil: "domcontentloaded" });
    await diskPage.waitForFunction(() => document.body.dataset.canvasReady === "true");
    const diskRestore = await diskPage.evaluate(() => ({
      activeProjectId,
      nodeCount: nodes.length,
      firstTitle: nodes[0]?.title,
      folderName: document.getElementById("currentFolderName")?.textContent,
      projects: JSON.parse(localStorage.getItem("aiCanvasStateV1:project-collection:disk-folder") || "[]").map((project) => project.id),
    }));
    assert.equal(diskRestore.activeProjectId, "disk-original", "an orphaned meaningful disk project should replace an untouched seed selection");
    assert.equal(diskRestore.nodeCount, 4, "all nodes from the original disk project should reopen");
    assert.equal(diskRestore.firstTitle, "磁盘原文件 1");
    assert.equal(diskRestore.folderName, "扩展", "the durable folder name should remain visible when browser storage is incomplete");
    assert.deepEqual(diskRestore.projects.sort(), ["current-empty", "disk-original"], "the recovered project must return to the inner project list");
    await diskContext.close();

    console.log("PASS: legacy and orphaned disk projects reopen safely, remain visible, and backups stay folder/project-scoped");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
