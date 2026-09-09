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

    const selects = page.locator("[data-style-select]");
    assert.equal(await selects.count(), 2);
    await selects.nth(0).locator("[data-style-select-toggle]").click();
    assert.equal(await selects.nth(0).evaluate((element) => element.classList.contains("open")), true);
    assert.equal(await selects.nth(0).locator("[data-style-model]").count(), 8);
    await selects.nth(0).locator('[data-style-model="Nano Banana2"]').click();
    assert.equal(await selects.nth(0).locator("[data-style-select-toggle] span").textContent(), "Nano Banana2");

    await page.locator('[data-style-strength="strong"]').click();
    assert.equal(await page.locator('[data-style-strength="strong"]').evaluate((element) => element.classList.contains("active")), true);
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
