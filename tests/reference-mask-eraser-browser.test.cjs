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
    const page = await browser.newPage({ viewport: { width: 1258, height: 1280 } });
    const pagePath = path.resolve(__dirname, "../app/ai-node-canvas.html");
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

    await page.evaluate(() => {
      const original = document.createElement("canvas");
      original.width = 120;
      original.height = 120;
      const originalContext = original.getContext("2d");
      originalContext.fillStyle = "#dce8df";
      originalContext.fillRect(0, 0, 120, 120);

      const selection = document.createElement("canvas");
      selection.width = 120;
      selection.height = 120;
      const selectionContext = selection.getContext("2d");
      selectionContext.fillStyle = "rgba(34, 197, 94, 1)";
      selectionContext.fillRect(20, 20, 80, 80);

      nodes = [];
      links = [];
      nodeId = 1;
      const node = createNode("generator", 80, 100, {
        references: [{
          url: original.toDataURL("image/png"),
          maskSelectionUrl: selection.toDataURL("image/png"),
          width: 120,
          height: 120,
        }],
        _deferRender: true,
      });
      openLightbox(node.references[0].url, { mode: "paint", nodeId: node.id, refIndex: 0 });
    });

    await page.waitForFunction(() => paintUndoStack.length === 1 && paintCanvas.width === 120);
    const toolbarLayout = await page.evaluate(() => {
      const toolbarRect = document.querySelector(".lightbox-tools").getBoundingClientRect();
      const clearButton = document.querySelector("#paintClear");
      const clearRect = clearButton.getBoundingClientRect();
      const sliderRect = document.querySelector("#paintSize").getBoundingClientRect();
      return {
        toolbarWidth: toolbarRect.width,
        viewportWidth: window.innerWidth,
        toolbarHeight: toolbarRect.height,
        clearWhiteSpace: getComputedStyle(clearButton).whiteSpace,
        clearWidth: clearRect.width,
        clearHeight: clearRect.height,
        sliderWidth: sliderRect.width,
        sliderMax: document.querySelector("#paintSize").max,
      };
    });
    assert.ok(toolbarLayout.toolbarWidth <= toolbarLayout.viewportWidth - 20, JSON.stringify(toolbarLayout));
    assert.ok(toolbarLayout.toolbarHeight < 60, JSON.stringify(toolbarLayout));
    assert.equal(toolbarLayout.clearWhiteSpace, "nowrap");
    assert.ok(toolbarLayout.clearWidth > toolbarLayout.clearHeight, JSON.stringify(toolbarLayout));
    assert.ok(toolbarLayout.sliderWidth >= 130, JSON.stringify(toolbarLayout));
    assert.equal(toolbarLayout.sliderMax, "160");
    assert.equal(await page.locator("#paintBrush").getAttribute("aria-pressed"), "true");
    await page.locator("#paintErase").click();
    assert.equal(await page.locator("#paintErase").textContent(), "橡皮擦");
    assert.equal(await page.locator("#paintErase").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#paintBrush").getAttribute("aria-pressed"), "false");

    const canvas = page.locator("#paintCanvas");
    const box = await canvas.boundingBox();
    assert.ok(box, "paint canvas should be visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const alphaAfterTap = await page.evaluate(() => (
      paintSelectionCanvas.getContext("2d").getImageData(60, 60, 1, 1).data[3]
    ));
    assert.equal(alphaAfterTap, 0, "a single eraser tap should erase a visible dot");

    const stateAfterTap = await page.evaluate(() => ({
      drawing: paintDrawing,
      lastPoint: paintLastPoint,
      historyLength: paintUndoStack.length,
      touchAction: getComputedStyle(paintCanvas).touchAction,
    }));
    assert.equal(stateAfterTap.drawing, false, "pointer state should finish after a tap");
    assert.equal(stateAfterTap.lastPoint, null, "the next stroke must not reuse a stale point");
    assert.ok(stateAfterTap.historyLength >= 2, "the tap should be undoable");
    assert.equal(stateAfterTap.touchAction, "none", "touch gestures must not steal mask strokes");

    await page.locator("#paintBrush").click();
    assert.equal(await page.locator("#paintBrush").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#paintErase").getAttribute("aria-pressed"), "false");

    console.log("PASS: separate brush and eraser buttons switch reliably and eraser taps finish safely");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
