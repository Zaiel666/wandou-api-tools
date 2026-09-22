const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

test("PSD and vector actions always show feedback and accept restored/SVG sources", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ acceptDownloads:true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname, "../app/ai-node-canvas.html")).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");

  await page.locator('[data-add-node="psd"]').click();
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 6;
    canvas.getContext("2d").fillRect(0, 0, 8, 6);
    const node = nodes.find((item) => item.type === "psd");
    node.references = [{ url:canvas.toDataURL("image/png"), width:8, height:6, mediaType:"image" }];
    apiKeyInput.value = "";
    render();
  });
  await page.locator(".node.psd [data-psd-generate]").click();
  assert.match(await page.locator(".node.psd .status").innerText(), /尚未配置渠道 1 API 密钥/);
  assert.equal(await page.locator("#settingsPopover").evaluate((item) => item.classList.contains("open")), true);
  await page.evaluate(() => setSettingsOpen(false));

  await page.locator('[data-add-node="vector"]').click();
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 3;
    const context = canvas.getContext("2d");
    context.fillStyle = "#2787ff";
    context.fillRect(0, 0, 4, 3);
    window.__restoredVectorImage = canvas.toDataURL("image/png");
    const node = nodes.find((item) => item.type === "vector");
    node.references = [{ url:"indexed-media:restored-vector", width:4, height:3, mediaType:"image" }];
    node.vectorMode = "preserve";
    getLocalMedia = async (value) => value === "indexed-media:restored-vector" ? window.__restoredVectorImage : value;
    render();
  });
  const restoredDownload = page.waitForEvent("download");
  await page.locator(".node.vector [data-vector-generate]").click();
  assert.match(await page.locator(".node.vector .status").innerText(), /正在封装原图/);
  await restoredDownload;
  assert.match(await page.locator(".node.vector .status").innerText(), /SVG 已生成/);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="10"><rect width="12" height="10" fill="#ff4f70"/></svg>';
  await page.locator(".node.vector [data-vector-upload]").setInputFiles({
    name:"source.svg",
    mimeType:"application/octet-stream",
    buffer:Buffer.from(svg),
  });
  await page.waitForFunction(() => /图片已上传|图片读取失败/.test(document.querySelector(".node.vector .status")?.textContent || ""));
  assert.match(await page.locator(".node.vector .status").innerText(), /图片已上传，可以生成 SVG/);
  assert.equal(await page.locator(".node.vector .vector-source-preview img").count(), 1);
  assert.deepEqual(errors, []);
});
