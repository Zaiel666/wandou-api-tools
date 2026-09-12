const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../desktop-client/node_modules/playwright");

const htmlPath = path.resolve(__dirname, "../app/ai-node-canvas.html");

test("透明背景开关和兼容关键词都生成真实 Alpha PNG 请求", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

  const requests = await page.evaluate(async () => {
    const base = {
      type: "generator",
      model: "gpt-image-2.5-1k",
      ratio: "1:1",
      resolution: "1K",
      count: 1,
      skillId: "",
      creativeSkill: "",
    };
    const transparent = await buildApiRequest({ ...base, prompt: "请抠图并输出透明底 PNG" }, []);
    const toggled = await buildApiRequest({ ...base, prompt: "绿色产品图标", transparentBackground: true }, []);
    const ordinary = await buildApiRequest({ ...base, prompt: "绿色产品海报，纯色背景", transparentBackground: false }, []);
    return {
      matches: [
        promptRequestsTransparentPng("透明底 PNG"),
        promptRequestsTransparentPng("移除背景并保留 Alpha 通道"),
        promptRequestsTransparentPng("普通产品海报"),
      ],
      transparent: JSON.parse(transparent.body),
      toggled: JSON.parse(toggled.body),
      ordinary: JSON.parse(ordinary.body),
    };
  });

  assert.deepEqual(requests.matches, [true, true, false]);
  assert.equal(requests.transparent.background, "transparent");
  assert.equal(requests.transparent.output_format, "png");
  assert.match(requests.transparent.prompt, /真实 Alpha 透明通道/);
  assert.equal(requests.toggled.background, "transparent");
  assert.equal(requests.toggled.output_format, "png");
  assert.equal("background" in requests.ordinary, false);

  const generator = page.locator(".node.generator").first();
  const toggle = generator.locator("[data-transparent-background-toggle]");
  assert.equal(await toggle.getAttribute("role"), "switch");
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  assert.equal(await generator.locator(".transparent-background-row > label").innerText(), "开启透明背景");
  assert.match(await generator.locator(".transparent-background-row").innerText(), /仅 GPT 模型可用/);
  const controlLayout = await generator.locator(".transparent-background-control").evaluate((control) => {
    const hint = control.querySelector(".transparent-background-hint");
    const button = control.querySelector(".transparent-background-toggle");
    const controlRect = control.getBoundingClientRect();
    const hintRect = hint.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      firstChildClass: control.firstElementChild.className,
      buttonWidth: buttonRect.width,
      rightGap: controlRect.right - buttonRect.right,
      itemGap: buttonRect.left - hintRect.right,
    };
  });
  assert.equal(controlLayout.firstChildClass, "transparent-background-hint");
  assert.ok(controlLayout.buttonWidth < 92, JSON.stringify(controlLayout));
  assert.ok(Math.abs(controlLayout.rightGap) < 1, JSON.stringify(controlLayout));
  assert.ok(controlLayout.itemGap >= 7, JSON.stringify(controlLayout));
  await toggle.click();
  assert.equal(await generator.locator("[data-transparent-background-toggle]").getAttribute("aria-checked"), "true");
  assert.equal(await generator.evaluate((element) => nodes.find((item) => item.id === element.dataset.id).transparentBackground), true);
});
