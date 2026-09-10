const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const htmlPath = path.join(__dirname, "..", "app", "ai-node-canvas.html");

test("画板节点、创作技能和结果图信息采用同一节点工作流", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator('[data-add-node="sketch"]').click();
  const sketch = page.locator(".node.sketch").last();
  const sketchPreview = sketch.locator("[data-sketch-open]");
  assert.equal(await sketchPreview.evaluate((element) => getComputedStyle(element).borderRadius), "10px");
  assert.equal(await sketchPreview.locator("img").evaluate((element) => getComputedStyle(element).borderRadius), "0px");
  await sketch.locator("[data-sketch-open]").click();
  const editor = page.locator("#sketchEditor");
  await assert.doesNotReject(() => editor.waitFor({ state: "visible" }));
  const board = editor.locator("#sketchEditorCanvas");
  assert.equal(await board.evaluate((canvas) => getComputedStyle(canvas).backgroundColor), "rgb(255, 255, 255)");
  assert.deepEqual(
    await board.evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(0, 0, 1, 1).data)),
    [255, 255, 255, 255]
  );
  assert.match(await editor.locator('[data-editor-tool="brush"]').innerText(), /画笔/);
  assert.match(await editor.locator('[data-editor-tool="eraser"]').innerText(), /橡皮/);
  await editor.locator('[data-editor-tool="eraser"]').click();
  assert.ok(await editor.locator('[data-editor-tool="eraser"]').evaluate((element) => element.classList.contains("active")));
  const box = await board.boundingBox();
  await board.dispatchEvent("pointermove", { pointerId: 1, clientX: box.x + 120, clientY: box.y + 120 });
  const cursor = editor.locator("#sketchEditorBrushPreview");
  assert.ok(await cursor.evaluate((element) => element.classList.contains("visible")));
  assert.ok(await cursor.evaluate((element) => element.classList.contains("eraser")));
  const thinCursor = await cursor.evaluate((element) => parseFloat(getComputedStyle(element).width));
  await editor.locator("#sketchEditorSize").evaluate((input) => { input.value = "96"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  const thickCursor = await cursor.evaluate((element) => parseFloat(getComputedStyle(element).width));
  assert.ok(thickCursor > thinCursor * 4, "cursor preview should reflect the selected brush size");
  await editor.locator('[data-editor-tool="brush"]').click();
  await board.dispatchEvent("pointerdown", { pointerId: 1, clientX: box.x + 100, clientY: box.y + 100 });
  await board.dispatchEvent("pointermove", { pointerId: 1, clientX: box.x + 160, clientY: box.y + 150 });
  await board.dispatchEvent("pointerup", { pointerId: 1, clientX: box.x + 160, clientY: box.y + 150 });
  await editor.locator("#sketchEditorClose").click();
  await assert.doesNotReject(() => sketch.getByText(/此节点用于展示和连线/).waitFor());
  assert.match(await sketch.evaluate((element) => nodes.find((item) => item.id === element.dataset.id)?.status || ""), /自动更新/);
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
  assert.deepEqual(await page.evaluate(() => [
    sizeFromRatio("16:9 横屏", "1K"),
    sizeFromRatio("16:9 横屏", "2K"),
    sizeFromRatio("16:9 横屏", "4K"),
    sizeFromRatio("3:4 竖图", "1K"),
  ]), ["1920x1080", "2560x1440", "3840x2160", "1200x1600"]);
  const labels = await generator.locator(".form-row > label").allTextContents();
  assert.ok(labels.indexOf("Skill") < labels.indexOf("创作技能"));
  assert.ok(labels.indexOf("创作技能") < labels.indexOf("模型"));
  assert.match(await generator.locator("[data-creative-style-toggle]").innerText(), /无选择/);
  assert.equal(await generator.locator("[data-node-select-toggle]").first().innerText(), "gpt-image-2.5-1k");
  const creativeTriggerBox = await generator.locator("[data-creative-style-toggle]").boundingBox();
  const modelTriggerBox = await generator.locator("[data-node-select-toggle]").first().boundingBox();
  assert.ok(Math.abs(creativeTriggerBox.height - modelTriggerBox.height) < 1, "creative style control should match neighboring control height");
  await generator.locator("[data-creative-style-toggle]").click();
  assert.equal(await generator.locator("[data-creative-style]").count(), 17);
  assert.match(await generator.locator('[data-creative-style="poster"] .creative-style-preview').evaluate((element) => getComputedStyle(element).backgroundImage), /creative-styles-grid\.png/);
  assert.equal(await generator.locator('[data-creative-style="poster"]').evaluate((element) => getComputedStyle(element).borderRadius), "8px");
  const styleCardBox = await generator.locator('[data-creative-style="poster"]').boundingBox();
  assert.ok(Math.abs(styleCardBox.width - styleCardBox.height) < 1, "creative style card should be square");
  await generator.locator('[data-creative-style="poster"]').click();
  assert.match(await generator.locator("[data-creative-style-toggle]").innerText(), /海报/);
  await generator.locator("[data-creative-style-toggle]").click();
  await generator.locator('[data-creative-style=""]').click();
  assert.match(await generator.locator("[data-creative-style-toggle]").innerText(), /无选择/);
  const ratioRow = generator.locator('.form-row > label').filter({ hasText: "比例尺寸" }).locator("..");
  await ratioRow.locator("[data-node-select-toggle]").dispatchEvent("click");
  const autoRatioBox = await ratioRow.locator('[data-node-ratio="Auto自适应"]').boundingBox();
  const customRatioBox = await ratioRow.locator('[data-node-ratio="自定义尺寸"]').boundingBox();
  assert.ok(Math.abs(autoRatioBox.y - customRatioBox.y) < 2, "Auto and custom size should share one row");
  assert.ok(customRatioBox.x > autoRatioBox.x, "custom size should appear to the right of Auto");
  await ratioRow.locator('[data-node-ratio="自定义尺寸"]').dispatchEvent("click");
  assert.equal(await generator.locator("[data-custom-size]").count(), 2);
  await generator.locator('[data-custom-size="width"]').fill("2560");
  await generator.locator('[data-custom-size="width"]').dispatchEvent("change");
  await generator.locator('[data-custom-size="height"]').fill("1440");
  await generator.locator('[data-custom-size="height"]').dispatchEvent("change");
  assert.equal(await generator.evaluate((element) => {
    const node = nodes.find((item) => item.id === element.dataset.id);
    return sizeFromRatio(node.ratio, node.resolution, [], { customWidth: node.customWidth, customHeight: node.customHeight });
  }), "2560x1440");
  assert.deepEqual(await page.evaluate(() => imageRatioOptions), [
    "Auto自适应", "自定义尺寸", "1:1 方图", "21:9 超宽屏", "16:9 横屏", "9:16 竖屏",
    "4:3 横图", "3:4 竖图", "3:2 摄影横图", "2:3 摄影竖图", "5:4 商品图", "4:5 社媒图",
    "3:1 屏幕横图", "1:3 长竖图",
  ]);
  assert.ok(await page.evaluate(() => imageRatioOptions
    .filter((ratio) => !/^(Auto|自定义)/.test(ratio))
    .every((ratio) => {
      const { width, height } = parseSize(sizeFromRatio(ratio, "1K"));
      return Math.min(width, height) >= 1024;
    })));
  await page.evaluate(() => document.body.classList.remove("dark-theme"));
  await generator.locator("[data-creative-style-toggle]").click();
  await generator.locator('[data-creative-style="logo"]').click();
  assert.match(await generator.locator("[data-creative-style-toggle]").innerText(), /Logo/);
  assert.equal(await generator.locator("[data-skill-picker-toggle]").count(), 1);
  await generator.locator("[data-skill-row-toggle]").click();
  await generator.locator('[data-generator-skill="builtin-design"]').click();
  assert.match(await generator.locator("[data-skill-row-toggle]").innerText(), /design/i);
  assert.ok(await generator.locator("[data-skill-picker-toggle]").evaluate((button) => button.classList.contains("skill-active")));

  const result = page.locator(".node.result").first();
  assert.equal(await result.locator(".preview > .result-meta-line").count(), 1);
  assert.equal(await result.locator(".result-time-meta svg").count(), 1);
  const resultMetaText = await result.locator(".result-meta-line").innerText();
  assert.doesNotMatch(resultMetaText, /尺寸|px|用时|秒/);
  assert.deepEqual(await result.locator(".result-size-meta").evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, height: style.height };
  }), { background: "rgba(15, 18, 17, 0.31)", color: "rgba(255, 255, 255, 0.6)", height: "22px" });
  assert.equal(await result.locator(".result-time-meta").evaluate((element) => getComputedStyle(element).height), "22px");
  const linkMarkCenter = await page.locator(".line-cut .line-cut-mark").first().evaluate((mark) => {
    const box = mark.getBBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  assert.ok(Math.abs(linkMarkCenter.x) < .01 && Math.abs(linkMarkCenter.y) < .01, "link remove icon should be centered on its connection point");
  assert.deepEqual(errors, []);
});

test("生成器输入完成后显示可忽略的提示词优化选择", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(pathToFileURL(htmlPath).href);
  const generator = page.locator(".node.generator").first();
  const prompt = generator.locator('[data-field="prompt"]');
  await prompt.fill("一张简洁的现代产品海报");
  await page.waitForTimeout(1250);
  const nudge = generator.locator("[data-prompt-optimize-nudge]");
  assert.ok(await nudge.evaluate((element) => element.classList.contains("visible")));
  assert.ok(await nudge.evaluate((element) => element.classList.contains("open")));
  assert.match(await nudge.innerText(), /是否优化提示词/);
  assert.equal(await nudge.locator("[data-generator-prompt-optimize-yes]").innerText(), "是");
  assert.equal(await nudge.locator("[data-generator-prompt-optimize-no]").innerText(), "否");
  assert.deepEqual(await nudge.locator("[data-generator-prompt-optimize-yes]").evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  }), { color: "rgb(255, 255, 255)", background: "rgb(42, 173, 95)" });
  const toggleCenter = await nudge.locator("[data-generator-prompt-optimize-toggle]").evaluate((button) => {
    const buttonBox = button.getBoundingClientRect();
    const iconBox = button.querySelector("svg").getBoundingClientRect();
    return {
      x: (iconBox.left + iconBox.right - buttonBox.left - buttonBox.right) / 2,
      y: (iconBox.top + iconBox.bottom - buttonBox.top - buttonBox.bottom) / 2,
    };
  });
  assert.ok(Math.abs(toggleCenter.x) < .5 && Math.abs(toggleCenter.y) < .5, "prompt optimization arrow should be centered");
  assert.doesNotMatch(fs.readFileSync(htmlPath, "utf8"), /promptOptimizeCollapseTimer/);
  await nudge.locator("[data-generator-prompt-optimize-toggle]").click();
  assert.equal(await nudge.evaluate((element) => element.classList.contains("open")), false);
  await nudge.locator("[data-generator-prompt-optimize-toggle]").click();
  assert.equal(await nudge.evaluate((element) => element.classList.contains("open")), true);
  await nudge.locator("[data-generator-prompt-optimize-no]").click();
  assert.equal(await generator.locator("[data-prompt-optimize-nudge].visible").count(), 0);
});

test("关键词结果提供可选的提示词优化确认", () => {
  const source = fs.readFileSync(htmlPath, "utf8");
  assert.match(source, /是否优化提示词？/);
  assert.match(source, /data-prompt-optimize-yes/);
  assert.match(source, /data-prompt-optimize-no/);
  assert.match(source, /node\.text \? `<div class="prompt-optimize-choice/);
});
