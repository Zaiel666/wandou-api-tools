const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const root = path.resolve(__dirname, "..");
const canvasPath = path.join(root, "app", "ai-node-canvas.html");
const workbenchPath = path.join(root, "app", "image-workbench", "customize.js");
const expectedModels = [
  "gpt-image-2.5-1k",
  "GPT-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
];

test("全部 GPT 绘图模型按统一顺序出现在各图片节点并映射到真实 API ID", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(canvasPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

  for (const type of ["style", "outpaint", "png"]) {
    await page.locator(`[data-add-node="${type}"]`).click();
  }
  await page.evaluate(() => {
    nodes.push(createNode("upscale", 900, 700));
    render();
  });

  const selectors = [
    [".node.generator", "[data-node-model]"],
    [".node.style", "[data-style-model]"],
    [".node.upscale", "[data-upscale-model-option]"],
    [".node.outpaint", "[data-outpaint-model-option]"],
    [".node.png", "[data-png-model-option]"],
  ];
  for (const [nodeSelector, optionSelector] of selectors) {
    const labels = await page.locator(nodeSelector).last().locator(optionSelector).allTextContents();
    assert.deepEqual(labels.slice(0, expectedModels.length), expectedModels, nodeSelector);
  }

  const mapping = await page.evaluate((models) => models.map((model) => imageGenerationApiModel(model)), expectedModels);
  assert.deepEqual(mapping, [
    "gpt-image-2.5-1k",
    "gpt-image-2",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
  ]);
  assert.deepEqual(await page.evaluate(() => imageResolutionOptionsForModel("gpt-image-2.5-1k")), ["1K", "2K", "4K"]);

  const payload = await page.evaluate(async () => {
    const request = await buildApiRequest({
      id: "model-payload-test",
      type: "generator",
      model: "gpt-image-2.5-sunburst",
      prompt: "测试",
      ratio: "1:1",
      resolution: "2K",
      count: 1,
    }, []);
    return JSON.parse(request.body);
  });
  assert.equal(payload.model, "gpt-image-2.5-sunburst");
  assert.equal(payload.resolution, "2k");
  assert.equal(payload.quality, "high");
  const upscaledPayload = await page.evaluate(async () => {
    const request = await buildApiRequest({
      id: "one-k-upscale-test",
      type: "generator",
      model: "gpt-image-2.5-1k",
      prompt: "测试",
      ratio: "16:9 横屏",
      resolution: "4K",
      count: 1,
    }, []);
    return JSON.parse(request.body);
  });
  assert.equal(upscaledPayload.model, "gpt-image-2.5-1k");
  assert.equal(upscaledPayload.resolution, "1k");
  assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("工作台模式移除不存在模型，1K 专用模型使用低档请求并保留放大目标", () => {
  const source = fs.readFileSync(workbenchPath, "utf8");
  for (const model of expectedModels.map((item) => item.replace(/^GPT/, "gpt"))) {
    assert.match(source, new RegExp(`"${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.doesNotMatch(source, /gpt-image-2-high/);
  assert.match(source, /model === "gpt-image-2\.5-1k" \? "low" : targetQuality/);
  assert.match(source, /sizeForQuality\(rawSize, targetQuality\)/);
  assert.match(source, /syncModelOptionsFromApi/);
  assert.match(source, /PREFERRED_DEFAULT_MODEL = "gpt-image-2\.5-1k"/);
  assert.match(source, /MODEL_OPTIONS\.includes\(PREFERRED_DEFAULT_MODEL\)/);
});

test("节点画布从 API 模型接口同步并只显示绘图模型", async (t) => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("ai-tools-api-config", JSON.stringify({ key: "test-key" })));
  await page.route("https://www.zayapi.top/v1/models", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [
      { id: "gpt-image-2" },
      { id: "gpt-image-2.5-1k" },
      { id: "gemini-3.1-flash-lite-image" },
      { id: "gpt-6-astra" },
      { id: "veo3.1-fast" },
    ] }),
  }));
  await page.goto(pathToFileURL(canvasPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  assert.deepEqual(await page.evaluate(() => [...imageModelOptions]), [
    "GPT-image-2",
    "gpt-image-2.5-1k",
    "gemini-3.1-flash-lite-image",
  ]);
});

test("两个 API 渠道独立识别同名模型并按节点选择使用对应密钥", async (t) => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const generationAuthorizations = [];
  await page.addInitScript(() => localStorage.setItem("ai-tools-api-config", JSON.stringify({
    key: "channel-one-key",
    key2: "channel-two-key",
  })));
  await page.route("https://www.zayapi.top/v1/models", (route) => {
    const authorization = route.request().headers().authorization || "";
    const models = authorization === "Bearer channel-two-key"
      ? ["gpt-image-2", "gpt-image-4k-official"]
      : ["gpt-image-2", "gpt-image-2.5-1k", "gpt-6-astra"];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: models.map((id) => ({ id })) }),
    });
  });
  await page.route("https://www.zayapi.top/v1/images/generations", (route) => {
    generationAuthorizations.push(route.request().headers().authorization || "");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [{ url: "https://example.test/channel-two-result.png" }] }),
    });
  });
  await page.goto(pathToFileURL(canvasPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

  await page.locator("#settingsButton").click();
  assert.equal(await page.locator("#apiKey").inputValue(), "channel-one-key");
  assert.equal(await page.locator("#apiKey2").inputValue(), "channel-two-key");
  assert.equal(await page.locator("#apiChannelOneTitle").textContent(), "渠道 1 必填");
  assert.equal(await page.locator("#apiChannelTwoTitle").textContent(), "渠道 2 选填");
  const channelTwoVisibility = page.locator('[data-api-key-visibility="apiKey2"]');
  await channelTwoVisibility.click();
  assert.equal(await page.locator("#apiKey2").getAttribute("type"), "text");
  assert.equal(await channelTwoVisibility.getAttribute("aria-pressed"), "true");
  await channelTwoVisibility.click();
  assert.equal(await page.locator("#apiKey2").getAttribute("type"), "password");
  const settingsBounds = await page.locator("#settingsPopover").boundingBox();
  assert.ok(settingsBounds);
  assert.ok(settingsBounds.y >= 0 && settingsBounds.y + settingsBounds.height <= 600);
  await page.locator("#closeSettingsButton").click();

  assert.deepEqual(await page.evaluate(() => [...imageModelOptions]), [
    "GPT-image-2",
    "gpt-image-2.5-1k",
    "GPT-image-2 · 渠道 2",
    "gpt-image-4k-official · 渠道 2",
  ]);
  assert.deepEqual(await page.evaluate(() => ({
    channelOne: apiProfileForModel("GPT-image-2"),
    channelTwo: apiProfileForModel("GPT-image-2 · 渠道 2"),
    apiModel: modelToApiModel("GPT-image-2 · 渠道 2"),
  })), {
    channelOne: { id: "channel1", label: "渠道 1", url: "https://www.zayapi.top", key: "channel-one-key" },
    channelTwo: { id: "channel2", label: "渠道 2", url: "https://www.zayapi.top", key: "channel-two-key" },
    apiModel: "gpt-image-2",
  });

  const result = await page.evaluate(() => callApi({
    id: "channel-two-request",
    type: "generator",
    model: "GPT-image-2 · 渠道 2",
    prompt: "测试渠道",
    ratio: "1:1",
    resolution: "4K",
    count: 1,
  }));
  assert.equal(result.url, "https://example.test/channel-two-result.png");
  assert.deepEqual(generationAuthorizations, ["Bearer channel-two-key"]);
});
