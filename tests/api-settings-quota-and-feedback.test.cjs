const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.join(__dirname, "..", "desktop-client", "node_modules", "playwright"));

const canvasPath = path.join(__dirname, "..", "app", "ai-node-canvas.html");

test("API 设置在 localStorage 满时仍保存、识别并在重载后恢复", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const pageErrors = [];
  const modelAuthorizations = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithQuotaFailure(key, value) {
      if ([
        "aiCanvasApi",
        "ai-tools-api-config",
        "aiCanvasAllModels",
        "aiCanvasImageModels",
        "aiCanvasAllModelsChannel2",
        "aiCanvasImageModelsChannel2",
      ].includes(key)) {
        throw new DOMException("Setting the value exceeded the quota", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.route("https://www.zayapi.top/v1/models", async (route) => {
    modelAuthorizations.push(route.request().headers().authorization || "");
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-image-2" }, { id: "gemini-3.1-flash-tts-preview" }] }),
    });
  });

  await page.goto(pathToFileURL(canvasPath).href);
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.locator("#settingsButton").click();
  await page.locator("#apiKey").fill("quota-channel-one");
  await page.locator("#apiKey2").fill("quota-channel-two");
  await page.locator("#saveApiButton").click();

  await assert.doesNotReject(async () => {
    await page.locator("#saveApiButton[disabled]").waitFor({ state: "attached" });
    assert.equal(await page.locator("#saveApiButton").getAttribute("aria-busy"), "true");
    assert.equal(await page.locator("#saveApiButton").textContent(), "正在保存并识别模型…");
  });
  await page.locator("#settingsPopover:not(.open)").waitFor({ state: "attached" });
  assert.deepEqual(modelAuthorizations.slice(-2).sort(), [
    "Bearer quota-channel-one",
    "Bearer quota-channel-two",
  ]);
  assert.match(await page.locator(".toast").textContent(), /已保存|已同步/);
  assert.deepEqual(pageErrors, []);

  await page.reload();
  await page.waitForFunction(() => document.body.dataset.canvasReady === "true");
  await page.locator("#settingsButton").click();
  assert.equal(await page.locator("#apiKey").inputValue(), "quota-channel-one");
  assert.equal(await page.locator("#apiKey2").inputValue(), "quota-channel-two");
  assert.deepEqual(pageErrors, []);
});
