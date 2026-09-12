const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href}?project=style-transfer-browser-test`);
    await page.locator('body[data-canvas-ready="true"]').waitFor();

    const state = await page.evaluate(async () => {
      nodes = [];
      links = [];
      const contentUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'%3E%3Crect width='1200' height='800' fill='%2322c55e'/%3E%3C/svg%3E";
      const styleUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1200'%3E%3Crect width='800' height='1200' fill='%23f97316'/%3E%3C/svg%3E";
      const node = createNode("style", 100, 100, {
        references: [
          { url: contentUrl, width: 1200, height: 800, mediaType: "image", styleRole: "content" },
          { url: styleUrl, width: 800, height: 1200, mediaType: "image", styleRole: "style" }
        ]
      });
      const ordered = styleTransferReferenceItems(node);
      const request = await buildApiRequest({ ...node, prompt: styleTransferPrompt(node), _apiTargetSize: "1536x1024", count: 1 }, ordered);
      return {
        title: node.title,
        refs: ordered.map((item) => item.styleRole),
        prompt: styleTransferPrompt(node),
        requestPrompt: request.body.get("prompt"),
        requestImageCount: request.body.getAll("image").length
      };
    });

    assert.equal(state.title, "风格迁移");
    assert.deepEqual(state.refs, ["content", "style"]);
    assert.match(state.prompt, /第 1 张是内容图/);
    assert.match(state.prompt, /第 2 张是风格参考图/);
    assert.match(state.requestPrompt, /第 1 张是内容图/);
    assert.equal(state.requestImageCount, 2);
    assert.equal(await page.locator(".style-transfer-slot").count(), 2);
    assert.equal(await page.locator(".style-transfer-preview img").count(), 2);
    assert.equal(await page.locator("[data-style-generate]").textContent(), "开始风格迁移");
    const previewGeometry = await page.locator(".style-transfer-preview img").evaluateAll((images) => images.map((image) => {
      const rect = image.getBoundingClientRect();
      const preview = image.parentElement.getBoundingClientRect();
      return {
        fit: getComputedStyle(image).objectFit,
        position: getComputedStyle(image).objectPosition,
        naturalRatio: Math.round((image.naturalWidth / image.naturalHeight) * 100) / 100,
        inset: Math.round((preview.width - rect.width + preview.height - rect.height) * 10) / 10
      };
    }));
    assert.deepEqual(previewGeometry.map(({ fit, position }) => ({ fit, position })), [
      { fit: "contain", position: "50% 50%" },
      { fit: "contain", position: "50% 50%" }
    ]);
    assert.equal(previewGeometry[0].naturalRatio, 1.5, JSON.stringify(previewGeometry));
    assert.equal(previewGeometry[1].naturalRatio, 0.67, JSON.stringify(previewGeometry));
    assert.ok(previewGeometry.every((item) => item.inset >= 20), JSON.stringify(previewGeometry));

    await page.evaluate(() => {
      const node = nodes.find((item) => item.type === "style");
      node.references = [];
      node.mediaUrl = "";
      selectedNodeId = node.id;
      activePasteNodeId = node.id;
      render();
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([
        "<svg xmlns='http://www.w3.org/2000/svg' width='900' height='300'><rect width='900' height='300' fill='green'/></svg>"
      ], "wide.svg", { type: "image/svg+xml" }));
      clipboardData.items.add(new File([
        "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='900'><rect width='300' height='900' fill='orange'/></svg>"
      ], "tall.svg", { type: "image/svg+xml" }));
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      window.dispatchEvent(event);
    });
    await page.waitForFunction(() => {
      const node = nodes.find((item) => item.type === "style");
      return styleTransferReferenceItems(node).filter(Boolean).length === 2;
    });
    assert.deepEqual(await page.evaluate(() => {
      const node = nodes.find((item) => item.type === "style");
      return styleTransferReferenceItems(node).map((item) => [item.styleRole, item.width, item.height]);
    }), [["content", 900, 300], ["style", 300, 900]]);

    await page.locator('[data-style-remove="content"]').click();
    await page.evaluate(() => {
      const preview = document.querySelector('[data-style-preview="0"]');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([
        "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='640'><rect width='640' height='640' fill='blue'/></svg>"
      ], "square.svg", { type: "image/svg+xml" }));
      preview.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      preview.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });
    await page.waitForFunction(() => styleTransferOwnReference(nodes.find((item) => item.type === "style"), "content")?.width === 640);
    assert.equal(await page.locator('[data-style-preview="0"] img').evaluate((image) => getComputedStyle(image).objectFit), "contain");

    const selects = page.locator("[data-style-select]");
    assert.equal(await selects.count(), 2);
    await selects.nth(0).locator("[data-style-select-toggle]").click();
    assert.equal(await selects.nth(0).evaluate((element) => element.classList.contains("open")), true);
    assert.equal(await selects.nth(0).locator("[data-style-model]").count(), 7);
    await selects.nth(0).locator('[data-style-model="Nano Banana2"]').click();
    assert.equal(await selects.nth(0).locator("[data-style-select-toggle] .model-value-label > span:last-child").textContent(), "Nano Banana2");

    await page.locator('[data-style-strength="strong"]').click();
    assert.equal(await page.locator('[data-style-strength="strong"]').evaluate((element) => element.classList.contains("active")), true);
    await page.evaluate(() => document.body.classList.add("dark-theme"));
    const unifiedActions = await page.evaluate(() => {
      const selected = document.querySelector('.node.style .choice-option.active');
      const generate = document.querySelector('.node.style [data-generate]');
      const read = (element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, border: style.borderTopColor };
      };
      return { selected: read(selected), generate: read(generate) };
    });
    assert.deepEqual(unifiedActions.selected, { color: "rgb(19, 170, 114)", background: "rgb(27, 31, 29)", border: "rgb(19, 170, 114)" });
    assert.deepEqual(unifiedActions.generate, { color: "rgb(19, 170, 114)", background: "rgb(27, 31, 29)", border: "rgb(19, 170, 114)" });
    const lightUnifiedActions = await page.evaluate(() => {
      document.body.classList.remove("dark-theme");
      const read = (element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, border: style.borderTopColor };
      };
      return {
        selected: read(document.querySelector('.node.style .choice-option.active')),
        generate: read(document.querySelector('.node.style [data-generate]')),
      };
    });
    assert.deepEqual(lightUnifiedActions.selected, { color: "rgb(19, 170, 114)", background: "rgb(255, 255, 255)", border: "rgb(19, 170, 114)" });
    assert.deepEqual(lightUnifiedActions.generate, { color: "rgb(19, 170, 114)", background: "rgb(255, 255, 255)", border: "rgb(19, 170, 114)" });
    const restored = await page.evaluate(async () => {
      const snapshot = getCanvasSnapshot();
      nodes = [];
      links = [];
      await applyCanvasSnapshot(snapshot);
      const node = nodes.find((item) => item.type === "style");
      return {
        type: node?.type,
        strength: node?.styleStrength,
        roles: styleTransferReferenceItems(node).map((item) => item?.styleRole)
      };
    });
    assert.deepEqual(restored, { type: "style", strength: "strong", roles: ["content", "style"] });
    assert.deepEqual(pageErrors, []);
    console.log("PASS: style transfer node renders two ordered images and interactive controls");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
