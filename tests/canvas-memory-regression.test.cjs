const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const canvasPath = path.resolve(__dirname, "../app/ai-node-canvas.html");
  const source = fs.readFileSync(canvasPath, "utf8");
  const historySerializer = source.match(/function serializeNodeForHistory[\s\S]*?\n    function queueLargeMediaPersist/)?.[0] || "";
  assert.ok(historySerializer);
  assert.doesNotMatch(historySerializer, /JSON\.parse\(JSON\.stringify\(node\)\)/);
  assert.match(source, /function cloneCompactHistoryValue\(/);
  assert.match(source, /function cleanLoadedNodes\(/);
  assert.match(source, /const mediaCache = new Map\(\)/);

  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--enable-precise-memory-info"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__mediaReadCount = 0;
      window.__sharedMedia = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;
      window.wandouShell = {
        readCanvasMedia: async () => {
          window.__mediaReadCount += 1;
          return { success: true, value: window.__sharedMedia };
        },
        hasCanvasMedia: async () => ({ exists: true }),
      };
    });
    await page.goto(`${pathToFileURL(canvasPath).href}?project=memory-regression`);

    const result = await page.evaluate(async () => {
      const stored = "indexed-media:shared-original";
      const restored = Array.from({ length: 12 }, (_, index) => ({
        id: `restored-${index}`,
        type: "result",
        title: "恢复图片",
        mediaType: "image",
        mediaUrl: stored,
        previewUrl: stored,
        fullUrl: stored,
        sourceUrl: stored,
        references: [{ url: stored, mediaType: "image" }],
      }));
      await cleanLoadedNodes(restored);
      nodes = restored;
      const heapBefore = performance.memory?.usedJSHeapSize || 0;
      const startedAt = performance.now();
      const snapshot = getCanvasSnapshot();
      const duration = performance.now() - startedAt;
      const heapAfter = performance.memory?.usedJSHeapSize || 0;
      return {
        readCount: window.__mediaReadCount,
        duration,
        heapGrowth: heapAfter - heapBefore,
        snapshotLength: snapshot.length,
        compact: JSON.parse(snapshot).nodes.every((node) =>
          node.mediaUrl.startsWith("indexed-media:")
          && node.fullUrl.startsWith("indexed-media:")
          && node.references[0].url.startsWith("indexed-media:")
        ),
      };
    });

    assert.equal(result.readCount, 1, "one persisted image should be read only once per canvas restore");
    assert.equal(result.compact, true);
    assert.ok(result.snapshotLength < 12000, `history snapshot remained ${result.snapshotLength} bytes`);
    assert.ok(result.duration < 300, `history snapshot took ${result.duration.toFixed(1)}ms`);
    assert.ok(result.heapGrowth < 50 * 1024 * 1024, `history snapshot grew heap by ${Math.round(result.heapGrowth / 1024 / 1024)}MB`);
    console.log(`PASS: 12 nodes sharing a 2MB original used 1 disk read; history took ${result.duration.toFixed(1)}ms`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
