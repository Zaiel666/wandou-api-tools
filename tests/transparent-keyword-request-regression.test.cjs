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

  await page.locator('[data-add-node="png"]').click();
  const pngNode = page.locator('.node.png').last();
  assert.equal(await pngNode.locator('[data-transparent-background-toggle]').getAttribute('aria-checked'), 'true');
  await pngNode.locator('[data-transparent-background-toggle]').click();
  assert.equal(await page.locator('.node.png').last().locator('[data-transparent-background-toggle]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('.node.png').last().locator('[data-generate]').innerText(), '生成图片');
  const pngRequests = await page.evaluate(async () => {
    const node = nodes.filter((item) => item.type === 'png').at(-1);
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 80;
    canvas.getContext('2d').fillRect(0,0,100,80);
    const reference = [{ url:canvas.toDataURL('image/png'), width:100, height:80 }];
    const ordinary = await buildApiRequest({ ...node, _apiTargetSize:'100x80' }, reference);
    const transparent = await buildApiRequest({ ...node, transparentBackground:true, prompt:'抠出主体', _apiTargetSize:'100x80' }, reference);
    const translucent = document.createElement('canvas'); translucent.width = 100; translucent.height = 80;
    translucent.getContext('2d').fillStyle = 'rgba(19,170,114,.5)';
    translucent.getContext('2d').fillRect(0,0,100,80);
    const opaqueUrl = await normalizeGeneratedImage(translucent.toDataURL('image/png'), '100x80', false);
    const opaqueImage = new Image(); opaqueImage.src = opaqueUrl; await opaqueImage.decode();
    const output = document.createElement('canvas'); output.width = 100; output.height = 80;
    const outputContext = output.getContext('2d'); outputContext.drawImage(opaqueImage,0,0);
    return { ordinaryBackground:ordinary.body.get('background'), ordinaryPrompt:ordinary.body.get('prompt'), transparentBackground:transparent.body.get('background'), opaqueAlpha:outputContext.getImageData(10,10,1,1).data[3] };
  });
  assert.equal(pngRequests.ordinaryBackground, null);
  assert.match(pngRequests.ordinaryPrompt, /普通不透明图片/);
  assert.equal(pngRequests.transparentBackground, 'transparent');
  assert.equal(pngRequests.opaqueAlpha, 255);
});
