const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const htmlPath = path.resolve(__dirname, "../app/project-hub.html");
  const source = fs.readFileSync(htmlPath, "utf8");
  const renderBody = source.match(/function render\(\) \{([\s\S]*?)\n    function bindCards\(/)?.[1] || "";
  assert.ok(renderBody, "project hub render function should be present");
  assert.doesNotMatch(renderBody, /readState\(/, "render must not synchronously parse every canvas");
  assert.match(source, /await nextProjectHubTask\(\);[\s\S]*readState\(project\.id\)/);
  assert.match(source, /Promise\.all\(\[worker\(\), worker\(\)\]\)/);

  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const now = Date.now();
      const projects = Array.from({ length: 30 }, (_, index) => ({
        id: `busy-${index}`,
        name: `历史文件夹${index + 1}`,
        color: "#76b900",
        createdAt: now - index * 1000,
        updatedAt: now - index * 1000,
        favorite: false,
      }));
      localStorage.setItem("aiCanvasProjectsV1", JSON.stringify(projects));
      projects.forEach((project, projectIndex) => {
        localStorage.setItem(`aiCanvasStateV1:${project.id}`, JSON.stringify({
          savedAt: now - projectIndex * 1000,
          nodes: Array.from({ length: 120 }, (_, nodeIndex) => ({
            id: `${projectIndex}-${nodeIndex}`,
            type: nodeIndex % 4 === 0 ? "result" : "image",
            mediaType: "image",
            pending: true,
            title: `节点 ${nodeIndex}`,
            x: nodeIndex * 8,
            y: nodeIndex * 5,
          })),
          links: [],
        }));
      });
      window.__backupReads = { active: 0, maxActive: 0, calls: 0 };
      window.wandouShell = {
        readCanvasBackups: async () => {
          window.__backupReads.active += 1;
          window.__backupReads.calls += 1;
          window.__backupReads.maxActive = Math.max(window.__backupReads.maxActive, window.__backupReads.active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          window.__backupReads.active -= 1;
          return { success: true, states: [] };
        },
      };
    });

    await page.goto(pathToFileURL(htmlPath).href);
    await page.locator('[data-node-count="busy-0"]').waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector('[data-node-count="busy-0"]')?.textContent === "120 个节点");

    const created = await page.evaluate(() => {
      const before = performance.now();
      document.getElementById("newProject").click();
      const elapsed = performance.now() - before;
      const activeId = localStorage.getItem("aiCanvasActiveProjectV1");
      const card = document.querySelector(`[data-project="${activeId}"]`);
      return { elapsed, activeId, cardExists: Boolean(card) };
    });
    assert.ok(created.activeId.startsWith("project-"));
    assert.equal(created.cardExists, true);
    assert.ok(created.elapsed < 200, `new folder click took ${created.elapsed.toFixed(1)}ms`);

    const input = page.locator(`[data-name="${created.activeId}"]`);
    await page.waitForFunction((projectId) => document.querySelector(`[data-name="${projectId}"]`)?.readOnly === false, created.activeId);
    assert.equal(await input.isEditable(), true);

    await page.waitForFunction(() => window.__backupReads.calls >= 2);
    const backupReads = await page.evaluate(() => window.__backupReads);
    assert.ok(backupReads.maxActive <= 2, `backup concurrency reached ${backupReads.maxActive}`);
    console.log(`PASS: project creation stayed responsive (${created.elapsed.toFixed(1)}ms) and backup concurrency was ${backupReads.maxActive}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
