const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const htmlPath = path.join(__dirname, "..", "app", "ai-node-canvas.html");

test("画板节点、创作技能和结果图信息采用同一节点工作流", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator('[data-add-node="sketch"]').click();
  const sketch = page.locator(".node.sketch").last();
  await sketch.locator("[data-sketch-open]").click();
  const editor = page.locator("#sketchEditor");
  await assert.doesNotReject(() => editor.waitFor({ state: "visible" }));
  const board = editor.locator("#sketchEditorCanvas");
  assert.equal(await board.evaluate((canvas) => getComputedStyle(canvas).backgroundColor), "rgb(255, 255, 255)");
  assert.deepEqual(
    await board.evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(0, 0, 1, 1).data)),
    [255, 255, 255, 255]
  );
  const box = await board.boundingBox();
  await board.dispatchEvent("pointerdown", { pointerId: 1, clientX: box.x + 100, clientY: box.y + 100 });
  await board.dispatchEvent("pointermove", { pointerId: 1, clientX: box.x + 160, clientY: box.y + 150 });
  await board.dispatchEvent("pointerup", { pointerId: 1, clientX: box.x + 160, clientY: box.y + 150 });
  await editor.locator("#sketchEditorDone").click();
  await assert.doesNotReject(() => sketch.getByText(/此节点用于展示和连线/).waitFor());
  await page.evaluate(() => {
    const legacy = document.createElement("canvas");
    legacy.width = 1024;
    legacy.height = 1024;
    const context = legacy.getContext("2d");
    context.fillStyle = "#181818";
    context.fillRect(0, 0, legacy.width, legacy.height);
    context.fillStyle = "#111827";
    context.fillRect(10, 10, 20, 20);
    const node = nodes.find((item) => item.type === "sketch");
    node.mediaUrl = legacy.toDataURL("image/png");
    node.references = [{ url: node.mediaUrl, mediaType: "image", width: 1024, height: 1024 }];
    render();
  });
  await sketch.locator("[data-sketch-open]").click();
  assert.deepEqual(
    await board.evaluate((canvas) => {
      const context = canvas.getContext("2d");
      return {
        background: Array.from(context.getImageData(0, 0, 1, 1).data),
        ink: Array.from(context.getImageData(15, 15, 1, 1).data),
      };
    }),
    { background: [255, 255, 255, 255], ink: [17, 24, 39, 255] }
  );
  await editor.locator("#sketchEditorDone").click();

  const generator = page.locator(".node.generator").first();
  const labels = await generator.locator(".form-row > label").allTextContents();
  assert.ok(labels.indexOf("Skill") < labels.indexOf("创作技能"));
  assert.ok(labels.indexOf("创作技能") < labels.indexOf("模型"));
  await generator.locator("[data-creative-style-toggle]").click();
  assert.equal(await generator.locator("[data-creative-style]").count(), 16);
  assert.match(await generator.locator('[data-creative-style="poster"] .creative-style-preview').evaluate((element) => getComputedStyle(element).backgroundImage), /creative-styles-grid\.png/);
  assert.equal(await generator.locator('[data-creative-style="poster"]').evaluate((element) => getComputedStyle(element).borderRadius), "12px");
  await generator.locator('[data-creative-style="poster"]').click();
  assert.match(await generator.locator("[data-creative-style-toggle]").innerText(), /海报/);
  assert.equal(await generator.locator("[data-skill-picker-toggle]").count(), 1);
  await generator.locator("[data-skill-row-toggle]").click();
  await generator.locator('[data-generator-skill="builtin-design"]').click();
  assert.match(await generator.locator("[data-skill-row-toggle]").innerText(), /design/i);
  assert.ok(await generator.locator("[data-skill-picker-toggle]").evaluate((button) => button.classList.contains("skill-active")));

  const result = page.locator(".node.result").first();
  assert.equal(await result.locator(".preview > .result-meta-line").count(), 1);
  assert.deepEqual(errors, []);
  await browser.close();
});

test("关键词结果提供可选的提示词优化确认", () => {
  const source = fs.readFileSync(htmlPath, "utf8");
  assert.match(source, /是否优化提示词？/);
  assert.match(source, /data-prompt-optimize-yes/);
  assert.match(source, /data-prompt-optimize-no/);
  assert.match(source, /node\.text \? `<div class="prompt-optimize-choice/);
});
