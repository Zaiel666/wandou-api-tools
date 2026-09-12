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
  }), { background: "rgba(15, 18, 17, 0.157)", color: "rgba(255, 255, 255, 0.6)", height: "16px" });
  assert.equal(await result.locator(".result-time-meta").evaluate((element) => getComputedStyle(element).height), "16px");
  const generatedGridGap = await page.evaluate(() => {
    view = { x: 0, y: 0, zoom: 1 };
    const source = { id: "gap-test-source", type: "generator", x: 0, y: 100, frameWidth: 520 };
    const parsed = { width: 1080, height: 1920 };
    const position = resultGridPositioner(source, 6, parsed);
    const ids = Array.from({ length: 6 }, (_item, index) => {
      const point = position(index);
      return createNode("result", point.x, point.y, {
        width: parsed.width,
        height: parsed.height,
        frameWidth: 240,
        pending: true,
        _deferRender: true,
      }).id;
    });
    render();
    const first = document.querySelector(`[data-id="${ids[0]}"]`).getBoundingClientRect();
    const below = document.querySelector(`[data-id="${ids[3]}"]`).getBoundingClientRect();
    return below.top - first.bottom;
  });
  assert.ok(Math.abs(generatedGridGap - 2) < .1, `generated result rows should have a 2px gap, received ${generatedGridGap}px`);
  const linkMarkCenter = await page.locator(".line-cut .line-cut-mark").first().evaluate((mark) => {
    const box = mark.getBBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  assert.ok(Math.abs(linkMarkCenter.x) < .01 && Math.abs(linkMarkCenter.y) < .01, "link remove icon should be centered on its connection point");
  assert.deepEqual(errors, []);
});

test("生成器输入后不再显示提示词优化提示", async (t) => {
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
  await page.waitForTimeout(900);
  assert.equal(await generator.locator("[data-prompt-optimize-nudge]").count(), 0);
  assert.equal(await generator.locator("[data-generator-prompt-optimize-yes]").count(), 0);
  assert.equal(await generator.locator("[data-generator-prompt-optimize-no]").count(), 0);
  assert.equal(await prompt.inputValue(), "一张简洁的现代产品海报");
});

test("节点 Skill 每次打开时自动检测软件已有的本地 Skill", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.__skillListRequests = [];
    window.wandouShell = {
      listSkills: async (options = {}) => {
        window.__skillListRequests.push(Boolean(options.force));
        if (!options.force) return [];
        return [{
          id: "local-weijing-detail",
          name: "weijing-one-click-detail",
          directoryName: "weijing-one-click-detail",
          description: "Create premium Taobao product detail pages from reference screenshots.",
          source: "个人",
          canDelete: true,
        }];
      },
      readSkill: async () => ({ success: true, instructions: "用于电商详情页绘图。" }),
    };
  });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  const generator = page.locator(".node.generator").first();
  assert.equal(await generator.getByText("weijing-one-click-detail", { exact: true }).count(), 0);
  await generator.locator("[data-skill-row-toggle]").click();
  const localSkill = generator.locator('[data-generator-skill="local-weijing-detail"]');
  await assert.doesNotReject(() => localSkill.waitFor({ state: "visible" }));
  assert.match(await localSkill.innerText(), /weijing-one-click-detail/);
  assert.equal(await page.evaluate(() => window.__skillListRequests.includes(true)), true);
  await localSkill.click();
  assert.equal(await generator.evaluate((element) => {
    const node = nodes.find((item) => item.id === element.dataset.id);
    return node.skillId;
  }), "local-weijing-detail");
});

test("页面源码不再包含关键词优化确认控件", () => {
  const source = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(source, /是否优化提示词？/);
  assert.doesNotMatch(source, /data-prompt-optimize-yes/);
  assert.doesNotMatch(source, /data-prompt-optimize-no/);
  assert.doesNotMatch(source, /prompt-optimize-choice/);
});
